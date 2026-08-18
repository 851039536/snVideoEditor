// 通过 Electron Chromium 网络栈下载 m3u8 分片并本地转码为 MP4

import { net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn, type ChildProcess } from 'child_process'
import {
  getFfmpegPath,
  parseProgressLine,
  timeToSeconds
} from './ffmpeg-shared'
import { DEFAULT_UA } from './download'

// ─── 类型 ────────────────────────────────────────────────────────────────────

export interface ChromiumDownloadOptions {
  /** 远程 m3u8 播放列表地址 */
  url: string
  /** 最终输出路径（如 D:/Videos/video.mp4） */
  output: string
  /** 附加到每个 net.fetch 请求的 HTTP 头（Cookie、Referer 等） */
  headers?: Record<string, string>
  /** 逐项取消信号，替代全局 isCancelled */
  abortSignal?: AbortSignal
  /** TS 分片持久缓存目录（支持断点续传），省略则使用临时目录 */
  cacheDir?: string
  /** 进度回调（0-100），phase 区分下载/转码阶段 */
  onProgress?: (data: {
    percent: number
    speed: string
    eta: string
    phase?: 'download' | 'merge'
  }) => void
  /** ffmpeg 进程创建后回调（用于外部取消） */
  onProcCreated?: (proc: ChildProcess) => void
  /** 检测到总时长后回调 */
  onDurationDetected?: (durationSec: number) => void
}

interface SegmentInfo {
  /** TS 分片远程地址 */
  url: string
  /** 分片本地保存路径 */
  localPath: string
  /** 从 0 开始的索引 */
  index: number
  /** 分片时长（秒），来自 #EXTINF */
  duration: number
}

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 最大并发下载数 */
const MAX_CONCURRENT = 6

/** 瞬时速率滑动窗口时长（毫秒），只统计最近窗口内完成的分片 */
const SPEED_WINDOW_MS = 5000

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 解析 m3u8 播放列表，返回绝对路径的 TS 分片地址及时长 */
function parseTsSegments(m3u8Content: string, baseUrl: string): { url: string; duration: number }[] {
  const lines = m3u8Content.split(/\r?\n/)
  const segments: { url: string; duration: number }[] = []
  let nextDuration = 10.0 // #EXTINF 缺失时的默认值

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) { continue }

    if (line.startsWith('#EXTINF')) {
      // 提取时长：#EXTINF:10.000, 或 #EXTINF:5.5,title
      const match = line.match(/#EXTINF:([\d.]+)/i)
      nextDuration = match ? parseFloat(match[1]) : 10.0
      continue
    }

    if (line.startsWith('#EXT-X-STREAM-INF')) {
      // 主播放列表（master playlist），非直接 TS 列表
      return []
    }

    if (line.startsWith('#')) {
      nextDuration = 10.0
      continue
    }

    // 非注释行 = 分片 URL
    try {
      segments.push({ url: new URL(line, baseUrl).href, duration: nextDuration })
    } catch {
      segments.push({ url: line, duration: nextDuration })
    }
    nextDuration = 10.0
  }

  return segments
}

/** 通过 Chromium 网络栈下载单个 URL，返回响应体 Buffer */
async function chromiumFetch(
  url: string,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>
): Promise<{ body: Buffer; status: number }> {
  const resp = await net.fetch(url, {
    signal,
    headers: {
      'User-Agent': DEFAULT_UA,
      ...(extraHeaders || {})
    }
  })

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
  }

  const arrayBuffer = await resp.arrayBuffer()
  return { body: Buffer.from(arrayBuffer), status: resp.status }
}

/** 将 bytes/sec 格式化为可读速度字符串（字节口径 MB/s，与常见下载工具一致） */
function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) { return '' }
  if (bytesPerSec >= 1024 ** 3) { return `${(bytesPerSec / 1024 ** 3).toFixed(2)} GB/s` }
  if (bytesPerSec >= 1024 ** 2) { return `${(bytesPerSec / 1024 ** 2).toFixed(1)} MB/s` }
  if (bytesPerSec >= 1024) { return `${(bytesPerSec / 1024).toFixed(0)} KB/s` }
  return `${bytesPerSec.toFixed(0)} B/s`
}

// ─── 主流程：Chromium 下载分片 → ffmpeg 本地转码 ─────────────────────────────

export async function downloadViaChromium(
  opts: ChromiumDownloadOptions
): Promise<boolean> {
  // 使用外部 cacheDir（持久化，支持续传）或创建临时目录
  const isPersistentCache = !!opts.cacheDir
  const workDir = opts.cacheDir || path.join(
    os.tmpdir(),
    `sn-chromium-dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  )
  fs.mkdirSync(workDir, { recursive: true })

  // 使用外部取消信号（逐项），向后兼容
  const signal = opts.abortSignal
  const isAborted = (): boolean => signal?.aborted === true

  /** 仅删除临时目录，保留持久缓存 */
  const cleanupIfTemp = (): void => {
    if (!isPersistentCache) {
      try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }

  try {
    // ─── 阶段 1：下载 m3u8 播放列表 ───
    if (isAborted()) { return false }
    if (opts.onProgress) {
      opts.onProgress({ percent: 0, speed: '解析 m3u8...', eta: '', phase: 'download' })
    }

    const m3u8Resp = await chromiumFetch(opts.url, signal, opts.headers)
    const m3u8Content = m3u8Resp.body.toString('utf-8')

    // 检测主播放列表（含 #EXT-X-STREAM-INF）
    if (m3u8Content.includes('#EXT-X-STREAM-INF')) {
      throw new Error(
        '检测到主播放列表 (master playlist)，请先选择具体清晰度的 m3u8 地址。'
      )
    }

    // 解析 TS 分片及真实时长
    const parsedSegs = parseTsSegments(m3u8Content, opts.url)
    if (parsedSegs.length === 0) {
      throw new Error('m3u8 播放列表中未找到视频分片，可能不是有效的流媒体地址。')
    }

    // ─── 阶段 2：通过 Chromium 下载所有 TS 分片 ───
    const segments: SegmentInfo[] = parsedSegs.map((s, i) => ({
      url: s.url,
      localPath: path.join(workDir, `seg_${String(i).padStart(6, '0')}.ts`),
      index: i,
      duration: s.duration
    }))

    const total = segments.length
    let completed = 0
    let downloadedCount = 0 // 本次会话实际新下载的分片数（不含缓存命中，避免稀释均值）
    let totalDownloadedBytes = 0  // 累计字节（用于剩余体积估算）
    let lastReportTime = Date.now()
    // 滑动窗口采样：最近 SPEED_WINDOW_MS 内完成的分片字节数，用于瞬时速率
    const speedSamples: { time: number; bytes: number }[] = []

    // 下载单个分片（3 次重试，线性退避）
    const downloadSegmentWithRetry = async (seg: SegmentInfo): Promise<void> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (isAborted()) { return }
        try {
          const resp = await chromiumFetch(seg.url, signal, opts.headers)
          // 原子写入：先写 .tmp 再 rename，崩溃时留下 .tmp（续传扫描会跳过）
          // 而非截断的 .ts 被误判为已完成
          const tmpPath = `${seg.localPath}.tmp`
          await fs.promises.writeFile(tmpPath, resp.body)
          await fs.promises.rename(tmpPath, seg.localPath)
          totalDownloadedBytes += resp.body.length
          speedSamples.push({ time: Date.now(), bytes: resp.body.length })
          downloadedCount++
          return // 成功
        } catch (e) {
          if (isAborted()) { return }
          if (attempt < 2) {
            // 重试前等待（1s、2s）
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
            if (isAborted()) { return }
          } else {
            throw e // 重试耗尽
          }
        }
      }
    }

    // 预扫描已有分片以支持续传（一次 readdirSync 代替 N 次 existsSync）
    const existingFiles = new Set<string>()
    try {
      for (const name of fs.readdirSync(workDir)) {
        // 清理崩溃残留的 .tmp 文件（原子写入遗留）
        if (name.endsWith('.tmp')) {
          try { fs.unlinkSync(path.join(workDir, name)) } catch { /* ignore */ }
          continue
        }
        existingFiles.add(path.join(workDir, name))
      }
    } catch { /* ignore */ }

    // 并发工作池（索引指针避免 O(n²) shift）
    let queuePtr = 0
    const workers: Promise<void>[] = []

    async function worker(): Promise<void> {
      while (queuePtr < total && !isAborted()) {
        const seg = segments[queuePtr++]

        // 跳过已下载的分片（断点续传）
        if (existingFiles.has(seg.localPath)) {
          completed++
          continue
        }

        await downloadSegmentWithRetry(seg)
        completed++

        // 上报进度（分片下载占 10%–85%）
        const now = Date.now()
        if (now - lastReportTime > 300 && opts.onProgress) {
          const segPercent = Math.round((completed / total) * 75) + 10
          // 瞬时速率：只统计最近 SPEED_WINDOW_MS 内完成的分片，
          // 窗口时长取「现在 - 最旧样本」，下限 1s 避免单样本突发虚高
          while (speedSamples.length > 0 && now - speedSamples[0].time > SPEED_WINDOW_MS) {
            speedSamples.shift()
          }
          const windowBytes = speedSamples.reduce((sum, s) => sum + s.bytes, 0)
          const windowSec = Math.max(
            (now - (speedSamples.length > 0 ? speedSamples[0].time : now)) / 1000,
            1
          )
          const rateBytesPerSec = windowBytes / windowSec
          // 平均分片体积只用实际下载的分片计算（续传时缓存命中不计入）
          const avgSegmentBytes = downloadedCount > 0
            ? totalDownloadedBytes / downloadedCount
            : 0
          const remaining = total - completed
          const etaSec = rateBytesPerSec > 0
            ? Math.round((remaining * avgSegmentBytes) / rateBytesPerSec)
            : 0
          opts.onProgress({
            percent: Math.min(segPercent, 99),
            speed: formatSpeed(rateBytesPerSec),
            eta: etaSec > 0
              ? `${Math.floor(etaSec / 60)}:${String(etaSec % 60).padStart(2, '0')}`
              : '',
            phase: 'download'
          })
          lastReportTime = now
        }
      }
    }

    // 启动并发 worker
    const concurrency = Math.min(MAX_CONCURRENT, total)
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker())
    }
    await Promise.all(workers)

    if (isAborted()) { return false }

    // ─── 阶段 3：生成本地 m3u8 播放列表（含真实时长） ───
    const localM3u8Path = path.join(workDir, 'local.m3u8')
    const maxDuration = Math.ceil(Math.max(...segments.map((s) => s.duration), 10))
    const localLines: string[] = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${maxDuration}`
    ]
    for (const seg of segments) {
      localLines.push(`#EXTINF:${seg.duration.toFixed(3)},`)
      localLines.push(seg.localPath.replace(/\\/g, '/'))
    }
    localLines.push('#EXT-X-ENDLIST')
    fs.writeFileSync(localM3u8Path, localLines.join('\n'), 'utf-8')

    if (opts.onProgress) {
      opts.onProgress({ percent: 88, speed: '转码中...', eta: '', phase: 'merge' })
    }

    // 确保输出目录存在
    fs.mkdirSync(path.dirname(opts.output), { recursive: true })

    // ─── 阶段 4：ffmpeg 本地转码（纯本地文件，无网络） ───
    const result = await convertLocalM3u8(localM3u8Path, opts)

    // 清理临时文件（仅临时目录，保留持久缓存）
    cleanupIfTemp()

    return result
  } catch (e) {
    // 出错时清理临时目录，保留持久缓存以供续传
    cleanupIfTemp()

    if (isAborted()) { return false }
    throw e
  }
}

// ─── 本地 ffmpeg 转码 ─────────────────────────────────────────────────────────

async function convertLocalM3u8(
  localM3u8Path: string,
  opts: ChromiumDownloadOptions
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      '-protocol_whitelist', 'file',
      '-allowed_extensions', 'ALL',
      '-i', localM3u8Path,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-y',
      opts.output
    ]

    const proc = spawn(getFfmpegPath(), args)
    // 降低进程优先级，避免 ffmpeg 转码占满 CPU/IO 导致系统卡顿
    if (process.platform === 'win32' && proc.pid) {
      try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* ignore */ }
    }
    if (opts.onProcCreated) {
      opts.onProcCreated(proc)
    }

    // 响应取消信号：终止 ffmpeg 并 resolve(false)
    const onAbort = (): void => {
      proc.kill('SIGTERM')
    }
    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) {
        proc.kill('SIGTERM')
      } else {
        opts.abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    }

    const MAX_STDERR_LINES = 50
    let durationSec = 0
    const stderrLines: string[] = []

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderrLines.push(chunk)
      if (stderrLines.length > MAX_STDERR_LINES) {
        stderrLines.splice(0, stderrLines.length - MAX_STDERR_LINES)
      }

      // 提取总时长
      if (durationSec === 0) {
        const durMatch = chunk.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/)
        if (durMatch) {
          durationSec = timeToSeconds(durMatch[1])
          if (opts.onDurationDetected) {
            opts.onDurationDetected(durationSec)
          }
        }
      }

      // 解析本地转码进度（88%–99%）
      const parsed = parseProgressLine(chunk)
      if (parsed && opts.onProgress && durationSec > 0) {
        const current = timeToSeconds(parsed.time)
        const segmentPercent = Math.round((current / durationSec) * 100)
        const percent = Math.min(88 + Math.round((segmentPercent * 11) / 100), 99)
        opts.onProgress({
          percent,
          speed: parsed.speed,
          eta: parsed.time,
          phase: 'merge'
        })
      }
    })

    proc.stderr.on('error', (err: Error) => {
      console.error('[convertLocalM3u8] stderr error:', err.message)
    })

    proc.on('close', (code: number | null) => {
      if (opts.abortSignal) {
        opts.abortSignal.removeEventListener('abort', onAbort)
      }
      if (opts.abortSignal?.aborted) {
        resolve(false)
        return
      }
      if (code === 0) {
        if (opts.onProgress) {
          opts.onProgress({ percent: 100, speed: '完成', eta: '0:00', phase: 'merge' })
        }
        resolve(true)
      } else {
        const errOutput = stderrLines.join('')
        reject(new Error(`FFmpeg 本地转码失败 (code: ${code}): ${errOutput.slice(-500)}`))
      }
    })

    proc.on('error', (err: Error) => {
      if (opts.abortSignal) {
        opts.abortSignal.removeEventListener('abort', onAbort)
      }
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
    })
  })
}
