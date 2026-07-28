// AES-256-CTR 文件加密/解密模块（流式处理，支持取消与批量操作）

import * as crypto from 'crypto'
import * as fs from 'fs'

export interface CryptoProgressCallback {
  (data: { percent: number; currentFile: number; totalFiles: number; speed: string; eta: string }): void
}

export interface CryptoOptions {
  input: string
  output: string
  password: string
  onProgress?: CryptoProgressCallback
}

export interface BatchCryptoOptions {
  files: { input: string; output: string }[]
  password: string
  onProgress?: CryptoProgressCallback
}

const ALGORITHM = 'aes-256-ctr'
const FORMAT_VERSION_V2 = 0x02
const PBKDF2_ITERATIONS = 10
const HEADER_LENGTH = 64 // v2: 16B IV + 16B salt + 1B version + 31B reserved
const CHUNK_SIZE = 64 * 1024 // 64KB 分块

// ─── 取消支持 ────────────────────────────────────────────────────────────────

let isCancelled = false
let activeStreams: { input: fs.ReadStream; output: fs.WriteStream } | null = null

export function cancelCryptoOperation(): void {
  isCancelled = true
  if (activeStreams) {
    activeStreams.input.destroy()
    activeStreams.output.destroy()
    activeStreams = null
  }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** PBKDF2 派生 32 字节密钥 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256')
}

/** 计算传输速度字符串 */
function calcSpeed(processed: number, elapsedSec: number): string {
  if (elapsedSec <= 0) { return '计算中...' }
  return `${(processed / 1024 / 1024 / elapsedSec).toFixed(1)} MB/s`
}

/** 计算剩余时间字符串（修复除零） */
function calcEta(processed: number, total: number, elapsedSec: number): string {
  if (elapsedSec <= 0 || processed <= 0) { return '计算中...' }
  const remaining = total - processed
  const eta = Math.round(remaining / (processed / elapsedSec))
  return `${eta}s`
}

// ─── 通用流式管道 ────────────────────────────────────────────────────────────

/** 流式加/解密通用管道：进度上报 + 错误处理 + 取消响应 */
function streamCrypto(opts: {
  inputStream: fs.ReadStream
  outputStream: fs.WriteStream
  transform: crypto.Cipheriv | crypto.Decipheriv
  totalSize: number
  onProgress?: CryptoProgressCallback
  errorLabel: string
}): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const { inputStream, outputStream, transform, totalSize, onProgress, errorLabel } = opts

    activeStreams = { input: inputStream, output: outputStream }
    let processed = 0
    const startTime = Date.now()

    inputStream.on('data', (chunk: Buffer) => {
      processed += chunk.length
      if (onProgress) {
        const elapsed = (Date.now() - startTime) / 1000
        onProgress({
          percent: Math.min(Math.round((processed / totalSize) * 100), 99),
          currentFile: 1,
          totalFiles: 1,
          speed: calcSpeed(processed, elapsed),
          eta: calcEta(processed, totalSize, elapsed)
        })
      }
    })

    inputStream.pipe(transform).pipe(outputStream)

    outputStream.on('finish', () => {
      activeStreams = null
      if (onProgress) {
        onProgress({ percent: 100, currentFile: 1, totalFiles: 1, speed: '完成', eta: '0s' })
      }
      resolve(true)
    })

    /** 统一错误处理：取消 → resolve(false)，异常 → reject */
    const handleError = (msg: string): void => {
      activeStreams = null
      if (isCancelled) {
        resolve(false)
      } else {
        reject(new Error(msg))
      }
    }

    inputStream.on('error', (err: Error) => { handleError(`读取文件失败: ${err.message}`) })
    transform.on('error', (err: Error) => { handleError(`${errorLabel}: ${err.message}`) })
    outputStream.on('error', (err: Error) => { handleError(`写入文件失败: ${err.message}`) })
  })
}

// ─── 加密 ────────────────────────────────────────────────────────────────────

/** 加密单个文件（AES-256-CTR 流式） */
export function encryptFile(opts: CryptoOptions): Promise<boolean> {
  if (!fs.existsSync(opts.input)) {
    return Promise.reject(new Error(`输入文件不存在: ${opts.input}`))
  }
  if (!opts.password) {
    return Promise.reject(new Error('密码不能为空'))
  }

  isCancelled = false

  const stat = fs.statSync(opts.input)
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(16)
  const key = deriveKey(opts.password, salt)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const inputStream = fs.createReadStream(opts.input, { highWaterMark: CHUNK_SIZE })
  const outputStream = fs.createWriteStream(opts.output)

  // 写入文件头：IV + Salt + version + reserved
  const header = Buffer.alloc(HEADER_LENGTH)
  iv.copy(header, 0)
  salt.copy(header, 16)
  header.writeUInt8(FORMAT_VERSION_V2, 32)
  outputStream.write(header)

  return streamCrypto({
    inputStream,
    outputStream,
    transform: cipher,
    totalSize: stat.size,
    onProgress: opts.onProgress,
    errorLabel: '加密失败'
  })
}

// ─── 解密 ────────────────────────────────────────────────────────────────────

/** 解密单个文件（读取 v2 文件头还原密钥） */
export function decryptFile(opts: CryptoOptions): Promise<boolean> {
  if (!fs.existsSync(opts.input)) {
    return Promise.reject(new Error(`输入文件不存在: ${opts.input}`))
  }
  if (!opts.password) {
    return Promise.reject(new Error('密码不能为空'))
  }

  isCancelled = false

  const stat = fs.statSync(opts.input)
  if (stat.size < HEADER_LENGTH) {
    return Promise.reject(new Error('文件格式不正确：文件太小，不包含加密头'))
  }

  // 读取文件头提取 IV 和 salt
  const fd = fs.openSync(opts.input, 'r')
  const headerBuf = Buffer.alloc(HEADER_LENGTH)
  fs.readSync(fd, headerBuf, 0, HEADER_LENGTH, 0)
  fs.closeSync(fd)

  const iv = headerBuf.subarray(0, 16)
  const salt = headerBuf.subarray(16, 32)
  const version = headerBuf.readUInt8(32)

  if (version !== FORMAT_VERSION_V2) {
    return Promise.reject(
      new Error(`不支持的加密格式版本: 0x${version.toString(16)}，需要 0x${FORMAT_VERSION_V2.toString(16)}`)
    )
  }

  const key = deriveKey(opts.password, salt)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)

  const inputStream = fs.createReadStream(opts.input, {
    highWaterMark: CHUNK_SIZE,
    start: HEADER_LENGTH
  })
  const outputStream = fs.createWriteStream(opts.output)

  return streamCrypto({
    inputStream,
    outputStream,
    transform: decipher,
    totalSize: stat.size - HEADER_LENGTH,
    onProgress: opts.onProgress,
    errorLabel: '解密失败'
  })
}

// ─── 批量处理 ────────────────────────────────────────────────────────────────

/** 批量加密或解密文件 */
export async function batchProcessFiles(
  isEncrypt: boolean,
  opts: BatchCryptoOptions
): Promise<{ success: number; failed: string[] }> {
  let success = 0
  const failed: string[] = []
  const processFn = isEncrypt ? encryptFile : decryptFile

  for (let i = 0; i < opts.files.length; i++) {
    if (isCancelled) { break }
    const file = opts.files[i]
    try {
      await processFn({
        input: file.input,
        output: file.output,
        password: opts.password,
        onProgress: (data) => {
          if (opts.onProgress) {
            opts.onProgress({ ...data, currentFile: i + 1, totalFiles: opts.files.length })
          }
        }
      })
      success++
    } catch (e) {
      if (isCancelled) { break }
      failed.push(file.input)
    }
  }

  return { success, failed }
}
