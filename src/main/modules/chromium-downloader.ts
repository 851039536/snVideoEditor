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
  timeToSeconds
} from './ffmpeg-shared'
import { DEFAULT_UA } from './download'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChromiumDownloadOptions {
  /** The remote m3u8 playlist URL. */
  url: string
  /** Final output path (e.g. /Users/.../video.mp4). */
  output: string
  /** HTTP headers (Cookie, Referer, etc.) forwarded to every net.fetch request. */
  headers?: Record<string, string>
  /** Per-item abort signal for cancellation. Replaces global isCancelled. */
  abortSignal?: AbortSignal
  /** Persistent cache directory for TS segments (enables resume). If omitted, uses a temp dir. */
  cacheDir?: string
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
  /** Segment duration in seconds (from #EXTINF). */
  duration: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max concurrent segment downloads. */
const MAX_CONCURRENT = 6

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse an m3u8 playlist and return absolute TS segment URLs with durations. */
function parseTsSegments(m3u8Content: string, baseUrl: string): { url: string; duration: number }[] {
  const lines = m3u8Content.split(/\r?\n/)
  const segments: { url: string; duration: number }[] = []
  let nextDuration = 10.0 // default if #EXTINF missing

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) { continue }

    if (line.startsWith('#EXTINF')) {
      // Extract duration: #EXTINF:10.000, or #EXTINF:5.5,title
      const match = line.match(/#EXTINF:([\d.]+)/i)
      nextDuration = match ? parseFloat(match[1]) : 10.0
      continue
    }

    if (line.startsWith('#EXT-X-STREAM-INF')) {
      // This is a master playlist — not a direct TS playlist.
      return []
    }

    if (line.startsWith('#')) {
      nextDuration = 10.0
      continue
    }

    // Non-comment line after #EXTINF = segment URL
    try {
      segments.push({ url: new URL(line, baseUrl).href, duration: nextDuration })
    } catch {
      segments.push({ url: line, duration: nextDuration })
    }
    nextDuration = 10.0
  }

  return segments
}

/** Download a single URL via Chromium's network stack and return the response body as a Buffer. */
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
  // Use external cacheDir (persistent, for resume) or create a temp one
  const isPersistentCache = !!opts.cacheDir
  const workDir = opts.cacheDir || path.join(
    os.tmpdir(),
    `sn-chromium-dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  )
  fs.mkdirSync(workDir, { recursive: true })

  // Use external abort signal (per-item) or create internal one (backward compat)
  const signal = opts.abortSignal
  const isAborted = (): boolean => signal?.aborted === true

  /** Delete workDir only if it's a temporary dir, not a persistent cache. */
  const cleanupIfTemp = (): void => {
    if (!isPersistentCache) {
      try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }

  try {
    // ─── Phase 1: Download the m3u8 playlist ───
    if (isAborted()) { return false }
    if (opts.onProgress) {
      opts.onProgress({ percent: 0, speed: '解析 m3u8...', eta: '' })
    }

    const m3u8Resp = await chromiumFetch(opts.url, signal, opts.headers)
    const m3u8Content = m3u8Resp.body.toString('utf-8')

    // Detect master playlist (contains #EXT-X-STREAM-INF)
    if (m3u8Content.includes('#EXT-X-STREAM-INF')) {
      throw new Error(
        '检测到主播放列表 (master playlist)，请先选择具体清晰度的 m3u8 地址。'
      )
    }

    // Parse TS segments with real durations
    const parsedSegs = parseTsSegments(m3u8Content, opts.url)
    if (parsedSegs.length === 0) {
      throw new Error('m3u8 播放列表中未找到视频分片，可能不是有效的流媒体地址。')
    }

    // ─── Phase 2: Download all TS segments via Chromium ───
    const segments: SegmentInfo[] = parsedSegs.map((s, i) => ({
      url: s.url,
      localPath: path.join(workDir, `seg_${String(i).padStart(6, '0')}.ts`),
      index: i,
      duration: s.duration
    }))

    const total = segments.length
    let completed = 0
    let totalDownloadedBytes = 0  // cumulative (for accurate ETA)
    let totalElapsedMs = 0
    const downloadStartTime = Date.now()
    let lastReportTime = Date.now()

    // Download a single segment with retry (3 attempts, linear backoff)
    const downloadSegmentWithRetry = async (seg: SegmentInfo): Promise<void> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (isAborted()) { return }
        try {
          const resp = await chromiumFetch(seg.url, signal, opts.headers)
          await fs.promises.writeFile(seg.localPath, resp.body)
          totalDownloadedBytes += resp.body.length
          return // success
        } catch (e) {
          if (isAborted()) { return }
          if (attempt < 2) {
            // Wait before retry (1s, 2s)
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
            if (isAborted()) { return }
          } else {
            throw e // all retries exhausted
          }
        }
      }
    }

    // Pre-scan existing segments for resume (one readdirSync vs N existsSync)
    const existingFiles = new Set<string>()
    try {
      for (const name of fs.readdirSync(workDir)) {
        existingFiles.add(path.join(workDir, name))
      }
    } catch { /* ignore */ }

    // Process segments in batches (use index pointer to avoid O(n²) shift)
    let queuePtr = 0
    const workers: Promise<void>[] = []

    async function worker(): Promise<void> {
      while (queuePtr < total && !isAborted()) {
        const seg = segments[queuePtr++]

        // Skip already-downloaded segments (resume support)
        if (existingFiles.has(seg.localPath)) {
          completed++
          continue
        }

        await downloadSegmentWithRetry(seg)
        completed++

        // Report progress (10%–85% range for segment downloads)
        const now = Date.now()
        if (now - lastReportTime > 300 && opts.onProgress) {
          totalElapsedMs = now - downloadStartTime
          const segPercent = Math.round((completed / total) * 75) + 10
          // Use cumulative averages for accurate speed/ETA
          const avgBytesPerSec = totalElapsedMs > 0
            ? (totalDownloadedBytes / totalElapsedMs) * 1000
            : 0
          const avgSegmentBytes = completed > 0
            ? totalDownloadedBytes / completed
            : 0
          const remaining = total - completed
          const etaSec = avgBytesPerSec > 0
            ? Math.round((remaining * avgSegmentBytes) / avgBytesPerSec)
            : 0
          opts.onProgress({
            percent: Math.min(segPercent, 99),
            speed: formatSpeed(`${(avgBytesPerSec * 8).toFixed(0)}bits/s`),
            eta: etaSec > 0
              ? `${Math.floor(etaSec / 60)}:${String(etaSec % 60).padStart(2, '0')}`
              : ''
          })
          lastReportTime = now
        }
      }
    }

    // Start concurrent workers
    const concurrency = Math.min(MAX_CONCURRENT, total)
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker())
    }
    await Promise.all(workers)

    if (isAborted()) { return false }

    // ─── Phase 3: Build a local m3u8 playlist with real durations ───
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
      opts.onProgress({ percent: 88, speed: '转码中...', eta: '' })
    }

    // ─── Phase 4: Convert with ffmpeg (local files only, no network) ───
    const result = await convertLocalM3u8(localM3u8Path, opts)

    // Clean up temp files (only temp dir, not persistent cache)
    cleanupIfTemp()

    return result
  } catch (e) {
    // On error: clean up temp dir but preserve persistent cache for resume
    cleanupIfTemp()

    if (isAborted()) { return false }
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
      '-y',
      opts.output
    ]

    const proc = spawn(getFfmpegPath(), args)
    if (opts.onProcCreated) {
      opts.onProcCreated(proc)
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
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
    })
  })
}
