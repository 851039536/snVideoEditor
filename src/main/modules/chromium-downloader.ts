/**
 * chromium-downloader.ts
 *
 * Downloads m3u8 playlists and their TS segments through Electron's Chromium
 * network stack (net.fetch). This bypasses Cloudflare anti-bot protection
 * because all HTTP requests use the real browser TLS fingerprint and cookies.
 *
 * After all segments are downloaded locally, ffmpeg handles the local-only
 * m3u8 → MP4 conversion.
 */

import { net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn, type ChildProcess } from 'child_process'
import {
  getFfmpegPath,
  parseProgressLine,
  timeToSeconds,
  setFfmpegProc,
  cancelFfmpegOperation,
  isCancelled,
  resetCancelled
} from './ffmpeg-shared'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChromiumDownloadOptions {
  /** The remote m3u8 playlist URL. */
  url: string
  /** Final output path (e.g. /Users/.../video.mp4). */
  output: string
  /** Progress callback (0-100). */
  onProgress?: (data: {
    percent: number
    speed: string
    eta: string
  }) => void
  /** Called when ffmpeg process is spawned (for cancellation). */
  onProcCreated?: (proc: ChildProcess) => void
  /** Called when total duration is detected. */
  onDurationDetected?: (durationSec: number) => void
}

interface SegmentInfo {
  /** Remote URL of the TS segment. */
  url: string
  /** Local file path where the segment will be saved. */
  localPath: string
  /** Zero-based index. */
  index: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max concurrent segment downloads. */
const MAX_CONCURRENT = 6

/**
 * Chrome 125 User-Agent used for net.fetch.
 * Although cookies handle Cloudflare, a plausible UA avoids triggering
 * additional UA-based bot detection on some CDNs.
 */
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse an m3u8 playlist and return absolute TS segment URLs in order. */
function parseTsUrls(m3u8Content: string, baseUrl: string): string[] {
  const lines = m3u8Content.split(/\r?\n/)
  const tsUrls: string[] = []
  let isNextUrl = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) { continue }

    if (line.startsWith('#EXTINF')) {
      isNextUrl = true
      continue
    }

    if (line.startsWith('#EXT-X-STREAM-INF')) {
      // This is a master playlist — not a direct TS playlist.
      // Return empty so caller can detect this case.
      return []
    }

    if (line.startsWith('#')) {
      isNextUrl = false
      continue
    }

    if (isNextUrl) {
      isNextUrl = false
      // Resolve relative URLs
      try {
        tsUrls.push(new URL(line, baseUrl).href)
      } catch {
        tsUrls.push(line)
      }
    }
  }

  return tsUrls
}

/** Download a single URL via Chromium's network stack and return the response body as a Buffer. */
async function chromiumFetch(
  url: string,
  signal?: AbortSignal
): Promise<{ body: Buffer; status: number }> {
  const resp = await net.fetch(url, {
    signal,
    headers: {
      'User-Agent': CHROME_UA
    }
  })

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
  }

  const arrayBuffer = await resp.arrayBuffer()
  return { body: Buffer.from(arrayBuffer), status: resp.status }
}

/** Format bitrate string (e.g. "1677.7kbits/s") to human-readable speed. */
function formatSpeed(bitrate?: string): string {
  if (!bitrate) { return '' }
  const match = bitrate.match(/^([\d.]+)\s*(k|M|G)?bits\/s$/i)
  if (!match) { return bitrate }
  const value = parseFloat(match[1])
  const unit = (match[2] || '').toUpperCase()
  if (unit === 'G') { return `${(value * 1000).toFixed(0)} Mbps` }
  if (unit === 'M') { return `${value.toFixed(1)} Mbps` }
  if (unit === 'K') { return `${(value / 1000).toFixed(1)} Mbps` }
  return `${(value / 1_000_000).toFixed(2)} Mbps`
}

// ─── Main: download via Chromium, then convert locally with ffmpeg ───────────

export async function downloadViaChromium(
  opts: ChromiumDownloadOptions
): Promise<boolean> {
  const workDir = path.join(
    os.tmpdir(),
    `sn-chromium-dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  )
  fs.mkdirSync(workDir, { recursive: true })

  const abortController = new AbortController()
  let aborted = false

  try {
    // ─── Phase 1: Download the m3u8 playlist ───
    if (isCancelled) {
      aborted = true
      return false
    }
    if (opts.onProgress) {
      opts.onProgress({ percent: 0, speed: '解析 m3u8...', eta: '' })
    }

    const m3u8Resp = await chromiumFetch(opts.url, abortController.signal)
    const m3u8Content = m3u8Resp.body.toString('utf-8')

    // Detect master playlist (contains #EXT-X-STREAM-INF)
    if (m3u8Content.includes('#EXT-X-STREAM-INF')) {
      throw new Error(
        '检测到主播放列表 (master playlist)，请先选择具体清晰度的 m3u8 地址。'
      )
    }

    // Parse TS segments
    const tsUrls = parseTsUrls(m3u8Content, opts.url)
    if (tsUrls.length === 0) {
      throw new Error('m3u8 播放列表中未找到视频分片，可能不是有效的流媒体地址。')
    }

    // ─── Phase 2: Download all TS segments via Chromium ───
    const segments: SegmentInfo[] = tsUrls.map((url, i) => ({
      url,
      localPath: path.join(workDir, `seg_${String(i).padStart(6, '0')}.ts`),
      index: i
    }))

    const total = segments.length
    let completed = 0
    let downloadedBytes = 0
    let lastReportTime = Date.now()

    // Download with concurrency control
    const downloadSegment = async (seg: SegmentInfo): Promise<void> => {
      if (aborted) { return }
      try {
        const resp = await chromiumFetch(seg.url, abortController.signal)
        fs.writeFileSync(seg.localPath, resp.body)
        downloadedBytes += resp.body.length
      } catch (e) {
        if (!aborted) { throw e }
      }
    }

    // Process segments in batches
    const queue = [...segments]
    const workers: Promise<void>[] = []

    async function worker(): Promise<void> {
      while (queue.length > 0 && !aborted) {
        if (isCancelled) {
          aborted = true
          break
        }
        const seg = queue.shift()
        if (!seg) { break }
        await downloadSegment(seg)
        completed++
        // Report progress (10%–85% range for segment downloads)
        const now = Date.now()
        if (now - lastReportTime > 300 && opts.onProgress) {
          const segPercent = Math.round((completed / total) * 75) + 10
          const bytesPerSec =
            (downloadedBytes / (now - lastReportTime + 1)) * 1000
          const remaining = total - completed
          const etaSec =
            bytesPerSec > 0
              ? Math.round((remaining * (downloadedBytes / (completed || 1))) / bytesPerSec)
              : 0
          opts.onProgress({
            percent: Math.min(segPercent, 99),
            speed: formatSpeed(`${(bytesPerSec * 8).toFixed(0)}bits/s`),
            eta: etaSec > 0
              ? `${Math.floor(etaSec / 60)}:${String(etaSec % 60).padStart(2, '0')}`
              : ''
          })
          lastReportTime = now
          downloadedBytes = 0
        }
      }
    }

    // Start concurrent workers
    const concurrency = Math.min(MAX_CONCURRENT, total)
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker())
    }
    await Promise.all(workers)

    if (aborted) { return false }

    // Verify all segments were downloaded
    const missing = segments.filter((s) => !fs.existsSync(s.localPath))
    if (missing.length > 0) {
      throw new Error(`下载不完整：${missing.length} 个分片缺失`)
    }

    // ─── Phase 3: Build a local m3u8 playlist ───
    const localM3u8Path = path.join(workDir, 'local.m3u8')
    const localLines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:10']
    for (const seg of segments) {
      localLines.push(`#EXTINF:10.0,`)
      // ffmpeg needs absolute or relative paths; use the filename since ffmpeg
      // will be launched from the workDir or we use full paths
      localLines.push(seg.localPath.replace(/\\/g, '/'))
    }
    localLines.push('#EXT-X-ENDLIST')
    fs.writeFileSync(localM3u8Path, localLines.join('\n'), 'utf-8')

    if (opts.onProgress) {
      opts.onProgress({ percent: 88, speed: '转码中...', eta: '' })
    }

    // ─── Phase 4: Convert with ffmpeg (local files only, no network) ───
    const result = await convertLocalM3u8(localM3u8Path, opts)

    // Clean up temp files
    try {
      fs.rmSync(workDir, { recursive: true, force: true })
    } catch { /* ignore */ }

    return result
  } catch (e) {
    // Clean up on error
    try {
      fs.rmSync(workDir, { recursive: true, force: true })
    } catch { /* ignore */ }

    if (aborted) { return false }
    throw e
  }
}

// ─── Local ffmpeg conversion ──────────────────────────────────────────────────

async function convertLocalM3u8(
  localM3u8Path: string,
  opts: ChromiumDownloadOptions
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
      '-allowed_extensions', 'ALL',
      '-i', localM3u8Path,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      '-y',
      opts.output
    ]

    const proc = spawn(getFfmpegPath(), args)
    setFfmpegProc(proc)
    if (opts.onProcCreated) {
      opts.onProcCreated(proc)
    }

    let durationSec = 0
    const stderrLines: string[] = []

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderrLines.push(chunk)

      // Extract total duration
      if (durationSec === 0) {
        const durMatch = chunk.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/)
        if (durMatch) {
          durationSec = timeToSeconds(durMatch[1])
          if (opts.onDurationDetected) {
            opts.onDurationDetected(durationSec)
          }
        }
      }

      // Parse progress for local conversion (88%–99%)
      const parsed = parseProgressLine(chunk)
      if (parsed && opts.onProgress && durationSec > 0) {
        const current = timeToSeconds(parsed.time)
        const segmentPercent = durationSec > 0
          ? Math.round((current / durationSec) * 100)
          : 0
        const percent = Math.min(88 + Math.round((segmentPercent * 11) / 100), 99)
        opts.onProgress({
          percent,
          speed: formatSpeed(parsed.bitrate),
          eta: parsed.time
        })
      }
    })

    proc.stderr.on('error', (err: Error) => {
      console.error('[convertLocalM3u8] stderr error:', err.message)
    })

    proc.on('close', (code: number | null) => {
      setFfmpegProc(null)
      if (code === 0) {
        if (opts.onProgress) {
          opts.onProgress({ percent: 100, speed: '完成', eta: '0:00' })
        }
        resolve(true)
      } else {
        const errOutput = stderrLines.join('')
        reject(new Error(`FFmpeg 本地转码失败 (code: ${code}): ${errOutput.slice(-500)}`))
      }
    })

    proc.on('error', (err: Error) => {
      setFfmpegProc(null)
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
    })
  })
}

// ─── Cancellation ─────────────────────────────────────────────────────────────

export { cancelFfmpegOperation as cancelChromiumDownload }
