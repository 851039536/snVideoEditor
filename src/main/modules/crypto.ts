import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

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
const HEADER_LENGTH = 64 // 16 bytes IV + 16 bytes salt + 32 bytes for future use
const CHUNK_SIZE = 64 * 1024 // 64KB chunks

// ---- Cancellation support ----
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

/**
 * Derive a 32-byte key from password and salt using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')
}

/**
 * Encrypt a single file using AES-256-CTR stream cipher
 */
export function encryptFile(opts: CryptoOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    if (!opts.password) {
      reject(new Error('密码不能为空'))
      return
    }

    isCancelled = false

    const stat = fs.statSync(opts.input)

    const salt = crypto.randomBytes(16)
    const iv = crypto.randomBytes(16)
    const key = deriveKey(opts.password, salt)

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

    const inputStream = fs.createReadStream(opts.input, { highWaterMark: CHUNK_SIZE })
    const outputStream = fs.createWriteStream(opts.output)
    activeStreams = { input: inputStream, output: outputStream }

    // Write header: IV + Salt + padding
    const header = Buffer.alloc(HEADER_LENGTH)
    iv.copy(header, 0)
    salt.copy(header, 16)
    outputStream.write(header)

    let processed = 0
    const startTime = Date.now()

    inputStream.on('data', (chunk: Buffer) => {
      processed += chunk.length
      if (opts.onProgress) {
        const percent = Math.min(Math.round((processed / stat.size) * 100), 99)
        const elapsed = (Date.now() - startTime) / 1000
        const speed = elapsed > 0
          ? `${(processed / 1024 / 1024 / elapsed).toFixed(1)} MB/s`
          : '计算中...'
        const remaining = stat.size - processed
        const eta = (remaining / (processed / elapsed)).toFixed(0)
        opts.onProgress({
          percent,
          currentFile: 1,
          totalFiles: 1,
          speed,
          eta: `${eta}s`
        })
      }
    })

    inputStream
      .pipe(cipher)
      .pipe(outputStream)

    outputStream.on('finish', () => {
      activeStreams = null
      if (opts.onProgress) {
        opts.onProgress({
          percent: 100,
          currentFile: 1,
          totalFiles: 1,
          speed: '完成',
          eta: '0s'
        })
      }
      resolve(true)
    })

    inputStream.on('error', (err: Error) => {
      activeStreams = null
      if (isCancelled) {
        resolve(false)
      } else {
        reject(new Error(`读取文件失败: ${err.message}`))
      }
    })

    cipher.on('error', (err: Error) => {
      activeStreams = null
      if (isCancelled) {
        resolve(false)
      } else {
        reject(new Error(`加密失败: ${err.message}`))
      }
    })

    outputStream.on('error', (err: Error) => {
      activeStreams = null
      if (isCancelled) {
        resolve(false)
      } else {
        reject(new Error(`写入文件失败: ${err.message}`))
      }
    })
  })
}

/**
 * Decrypt a single file that was encrypted with encryptFile
 */
export function decryptFile(opts: CryptoOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    if (!opts.password) {
      reject(new Error('密码不能为空'))
      return
    }

    isCancelled = false

    const stat = fs.statSync(opts.input)
    if (stat.size < HEADER_LENGTH) {
      reject(new Error('文件格式不正确：文件太小，不包含加密头'))
      return
    }

    // Read header to extract IV and salt
    const fd = fs.openSync(opts.input, 'r')
    const headerBuf = Buffer.alloc(HEADER_LENGTH)
    fs.readSync(fd, headerBuf, 0, HEADER_LENGTH, 0)
    fs.closeSync(fd)

    const iv = headerBuf.subarray(0, 16)
    const salt = headerBuf.subarray(16, 32)

    const key = deriveKey(opts.password, salt)
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)

    const inputStream = fs.createReadStream(opts.input, {
      highWaterMark: CHUNK_SIZE,
      start: HEADER_LENGTH
    })
    const outputStream = fs.createWriteStream(opts.output)
    activeStreams = { input: inputStream, output: outputStream }

    const dataSize = stat.size - HEADER_LENGTH
    let processed = 0
    const startTime = Date.now()

    inputStream.on('data', (chunk: Buffer) => {
      processed += chunk.length
      if (opts.onProgress) {
        const percent = Math.min(Math.round((processed / dataSize) * 100), 99)
        const elapsed = (Date.now() - startTime) / 1000
        const speed = elapsed > 0
          ? `${(processed / 1024 / 1024 / elapsed).toFixed(1)} MB/s`
          : '计算中...'
        const remaining = dataSize - processed
        const eta = (remaining / (processed / elapsed)).toFixed(0)
        opts.onProgress({
          percent,
          currentFile: 1,
          totalFiles: 1,
          speed,
          eta: `${eta}s`
        })
      }
    })

    inputStream
      .pipe(decipher)
      .pipe(outputStream)

    outputStream.on('finish', () => {
      activeStreams = null
      if (opts.onProgress) {
        opts.onProgress({
          percent: 100,
          currentFile: 1,
          totalFiles: 1,
          speed: '完成',
          eta: '0s'
        })
      }
      resolve(true)
    })

    inputStream.on('error', (err: Error) => {
      activeStreams = null
      if (isCancelled) {
        resolve(false)
      } else {
        reject(new Error(`读取文件失败: ${err.message}`))
      }
    })

    decipher.on('error', () => {
      activeStreams = null
      if (isCancelled) {
        resolve(false)
      } else {
        reject(new Error('解密失败：密码错误或文件已损坏'))
      }
    })

    outputStream.on('error', (err: Error) => {
      activeStreams = null
      if (isCancelled) {
        resolve(false)
      } else {
        reject(new Error(`写入文件失败: ${err.message}`))
      }
    })
  })
}

/**
 * Batch encrypt or decrypt files in a directory
 */
export async function batchProcessFiles(
  isEncrypt: boolean,
  opts: BatchCryptoOptions
): Promise<{ success: number; failed: string[] }> {
  let success = 0
  const failed: string[] = []

  const processFn = isEncrypt ? encryptFile : decryptFile

  for (let i = 0; i < opts.files.length; i++) {
    const file = opts.files[i]
    try {
      await processFn({
        input: file.input,
        output: file.output,
        password: opts.password,
        onProgress: (data) => {
          if (opts.onProgress) {
            opts.onProgress({
              ...data,
              currentFile: i + 1,
              totalFiles: opts.files.length
            })
          }
        }
      })
      success++
    } catch (e) {
      failed.push(file.input)
    }
  }

  return { success, failed }
}
