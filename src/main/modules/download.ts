import { spawn } from 'child_process'
import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'
import {
  getFfmpegPath,
  parseProgressLine,
  timeToSeconds,
  setFfmpegProc,
  cancelFfmpegOperation
} from './ffmpeg'

export interface DownloadOptions {
  url: string
  output: string
  headers?: Record<string, string>
  onProgress?: (data: {
    percent: number
    currentFile: number
    totalFiles: number
    speed: string
    eta: string
  }) => void
  /** Callback with the spawned ffmpeg process, so the caller can cancel it. */
  onProcCreated?: (proc: import('child_process').ChildProcess) => void
}

export interface PageFetchResult {
  m3u8Urls: string[]
  pageTitle: string
  pageUrl: string
}

/** Default User-Agent string used across all HTTP requests. */
export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/** HTTP redirect status codes. */
const REDIRECT_CODES = new Set([301, 302, 307, 308])

/**
 * Perform a simple HTTP GET request, following redirects, and return the
 * response body as a UTF-8 string.
 */
function httpGetText(
  url: string,
  extraHeaders?: Record<string, string>,
  timeoutMs = 15000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const client = parsedUrl.protocol === 'https:' ? https : http

    const reqHeaders: Record<string, string> = {
      'User-Agent': DEFAULT_UA,
      'Accept': '*/*',
      ...(extraHeaders || {})
    }

    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: reqHeaders,
      timeout: timeoutMs
    }

    const req = client.request(options, (res) => {
      if (
        res.statusCode !== undefined &&
        REDIRECT_CODES.has(res.statusCode) &&
        res.headers.location
      ) {
        const redirectUrl = new URL(res.headers.location, url).href
        return resolve(httpGetText(redirectUrl, extraHeaders, timeoutMs))
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`))
      }

      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'))
      })
      res.on('error', (err: Error) => reject(err))
    })

    req.on('error', (err: Error) => reject(err))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('ETIMEDOUT'))
    })
    req.end()
  })
}

/**
 * Format headers object into FFmpeg -headers string format.
 * FFmpeg expects each header line terminated with \r\n, including the last line.
 */
function formatHeaders(headers: Record<string, string>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(headers)) {
    if (value.trim() !== '') {
      lines.push(`${key}: ${value}`)
    }
  }
  // Must end with \r\n for each line including the last
  return lines.map((l) => l + '\r\n').join('')
}

/**
 * Download a m3u8 stream using FFmpeg and save as MP4.
 */
export function downloadM3u8(opts: DownloadOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const headersStr = opts.headers ? formatHeaders(opts.headers) : ''
    const args: string[] = []

    // Protocol whitelist — required by newer ffmpeg versions
    args.push(
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,httpproxy'
    )

    // Add HTTP headers if provided
    if (headersStr) {
      args.push('-headers', headersStr)
    }

    // Override User-Agent if set separately (broader compatibility)
    if (opts.headers?.['User-Agent']) {
      args.push('-user_agent', opts.headers['User-Agent'])
    }

    // Override Referer if set separately
    if (opts.headers?.['Referer']) {
      args.push('-referer', opts.headers['Referer'])
    }

    // Reconnect options for robustness
    args.push(
      '-reconnect', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5'
    )

    args.push(
      '-i', opts.url,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      '-y',
      opts.output
    )

    const proc = spawn(getFfmpegPath(), args)
    setFfmpegProc(proc)
    if (opts.onProcCreated) {
      opts.onProcCreated(proc)
    }

    const stderrLines: string[] = []
    let durationSec = 0

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderrLines.push(chunk)

      // Extract total duration from FFmpeg's initial analysis
      if (durationSec === 0) {
        const durMatch = chunk.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/)
        if (durMatch) {
          durationSec = timeToSeconds(durMatch[1])
        }
      }

      const parsed = parseProgressLine(chunk)
      if (parsed && opts.onProgress) {
        const current = timeToSeconds(parsed.time)
        if (durationSec > 0) {
          const percent = Math.min(Math.round((current / durationSec) * 100), 99)
          opts.onProgress({
            percent,
            currentFile: 1,
            totalFiles: 1,
            speed: parsed.speed,
            eta: parsed.time
          })
        }
      }
    })

    proc.on('close', (code: number | null) => {
      setFfmpegProc(null)
      if (code === 0) {
        if (opts.onProgress) {
          opts.onProgress({
            percent: 100,
            currentFile: 1,
            totalFiles: 1,
            speed: '完成',
            eta: '0:00'
          })
        }
        resolve(true)
      } else {
        const errOutput = stderrLines.join('')
        reject(buildDownloadError(errOutput, code))
      }
    })

    proc.on('error', (err: Error) => {
      setFfmpegProc(null)
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
    })
  })
}

/**
 * Build a user-friendly error message from ffmpeg stderr output.
 */
function buildDownloadError(errOutput: string, code: number | null): Error {
  // HTTP 403 — missing/invalid Referer or auth headers
  if (errOutput.includes('HTTP error 403')) {
    return new Error(
      '下载失败 (HTTP 403 Forbidden)：服务器拒绝访问。\n' +
      '请检查是否设置了正确的 Referer 和 User-Agent 请求头。'
    )
  }
  // HTTP 404 — wrong URL
  if (errOutput.includes('HTTP error 404')) {
    return new Error(
      '下载失败 (HTTP 404 Not Found)：视频地址不存在。\n' +
      '提示：请确保输入的是 .m3u8 流媒体地址，而非网页地址。可使用"从网页提取"功能获取真实 m3u8 链接。'
    )
  }
  // HTTP 5xx
  if (errOutput.includes('Server returned 5XX') || errOutput.includes('Server returned 5')) {
    return new Error('下载失败 (HTTP 5xx)：服务器内部错误，请稍后重试。')
  }
  // Connection refused / timed out
  if (errOutput.includes('Connection refused') || errOutput.includes('Connection timed out')) {
    return new Error('下载失败：无法连接到服务器，请检查网络或确认 URL 可访问。')
  }
  // Connection reset (-10054 on Windows = WSAECONNRESET)
  if (errOutput.includes('-10054') || errOutput.includes('Connection reset by peer')) {
    return new Error(
      '下载失败：服务器重置了连接 (WSAECONNRESET)。\n' +
      '常见原因：\n' +
      '1. 输入的是网页 URL 而非 m3u8 流地址 — 请先用"从网页提取"功能获取真实地址\n' +
      '2. 网站使用了 Cloudflare 等防护 — 需要设置正确的 Referer/Origin/User-Agent\n' +
      '3. 视频链接已过期或需要 Cookie 认证'
    )
  }
  // DNS / host not found
  if (errOutput.includes('No such host') || errOutput.includes('getaddrinfo') || errOutput.includes('Name or service not known')) {
    return new Error('下载失败：无法解析域名，请检查 URL 是否正确或网络是否连接。')
  }
  // Connection timeout
  if (errOutput.includes('Operation timed out') || errOutput.includes('ETIMEDOUT')) {
    return new Error('下载失败：连接超时，服务器无响应。')
  }
  // TLS / SSL errors
  if (errOutput.includes('SSL') || errOutput.includes('TLS') || errOutput.includes('certificate')) {
    return new Error(
      '下载失败 (TLS/SSL 错误)：安全连接失败。\n' +
      '可能是网站的 HTTPS 证书问题，或服务器拒绝了 ffmpeg 的 TLS 握手。'
    )
  }
  // Fallback
  return new Error(`下载失败 (code: ${code}): ${errOutput.slice(-500)}`)
}

// ─── M3U8 Variant Parsing ──────────────────────────────────────────────────

export interface M3u8Variant {
  url: string
  resolution: string // e.g. "854x480"
  height: number // e.g. 480
  label: string // e.g. "480p (854x480)"
  bandwidth?: number
}

/**
 * Fetch and parse a master m3u8 playlist to extract available quality variants.
 * If the playlist is not a master playlist (no #EXT-X-STREAM-INF), returns an
 * empty array — meaning it's a single-quality direct playlist.
 */
export async function fetchM3u8Variants(
  m3u8Url: string,
  headers?: Record<string, string>
): Promise<M3u8Variant[]> {
  try {
    const text = await httpGetText(m3u8Url, headers)
    return parseMasterPlaylist(text, m3u8Url)
  } catch {
    // Silently return empty on any error — caller will try direct download
    return []
  }
}

/**
 * Parse a master m3u8 playlist to extract variant streams.
 */
function parseMasterPlaylist(content: string, baseUrl: string): M3u8Variant[] {
  // Check if it's a master playlist (has #EXT-X-STREAM-INF)
  if (!content.includes('#EXT-X-STREAM-INF')) {
    return []
  }

  const lines = content.split(/\r?\n/)
  const variants: M3u8Variant[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    if (line.startsWith('#EXT-X-STREAM-INF')) {
      // Parse RESOLUTION
      const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i)
      const bwMatch = line.match(/BANDWIDTH=(\d+)/i)

      const height = resMatch ? parseInt(resMatch[2], 10) : 0
      const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : undefined
      const resolution = resMatch ? `${resMatch[1]}x${resMatch[2]}` : '未知'

      // The next non-comment line is the variant URL
      let variantUrl = ''
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim()
        if (nextLine && !nextLine.startsWith('#')) {
          variantUrl = nextLine
          break
        }
      }

      if (variantUrl) {
        // Resolve relative URL
        let fullUrl: string
        try {
          fullUrl = new URL(variantUrl, baseUrl).href
        } catch {
          fullUrl = variantUrl
        }

        // Generate label
        const pLabel = height > 0 ? getStandardLabel(height) : null
        const label = pLabel
          ? `${pLabel} (${resolution})`
          : resolution

        variants.push({
          url: fullUrl,
          resolution,
          height,
          label,
          bandwidth
        })
      }
    }
  }

  // Sort by height ascending (low to high quality)
  variants.sort((a, b) => a.height - b.height)
  return variants
}

/**
 * Map vertical resolution to standard label (360p, 480p, 720p, 1080p, etc.)
 */
function getStandardLabel(height: number): string {
  if (height <= 144) { return '144p' }
  if (height <= 240) { return '240p' }
  if (height <= 360) { return '360p' }
  if (height <= 480) { return '480p' }
  if (height <= 540) { return '540p' }
  if (height <= 720) { return '720p' }
  if (height <= 1080) { return '1080p' }
  if (height <= 1440) { return '2K' }
  return '4K'
}

export { cancelFfmpegOperation as cancelDownloadOperation }
