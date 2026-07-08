import { net } from 'electron'
import { URL } from 'url'
import { downloadViaChromium } from './chromium-downloader'

export interface DownloadOptions {
  url: string
  output: string
  headers?: Record<string, string>
  /** Resume offset in seconds. When set, ffmpeg will use -ss to skip already-downloaded content. */
  startTime?: number
  /** Per-item abort signal, forwarded to downloadViaChromium. */
  abortSignal?: AbortSignal
  /** Persistent cache dir for resume support. */
  cacheDir?: string
  onProgress?: (data: {
    percent: number
    currentFile: number
    totalFiles: number
    speed: string
    eta: string
  }) => void
  /** Callback with the spawned ffmpeg process, so the caller can cancel it. */
  onProcCreated?: (proc: import('child_process').ChildProcess) => void
  /** Callback when total video duration is first detected from ffmpeg stderr. */
  onDurationDetected?: (durationSec: number) => void
}

/** A single cookie entry extracted from the browser session. */
export interface SessionCookie {
  domain: string
  name: string
  value: string
}

export interface PageFetchResult {
  m3u8Urls: string[]
  pageTitle: string
  pageUrl: string
  /** All cookies from the browser session, including their domain for filtering. */
  cookies: SessionCookie[]
}

/** Default User-Agent string used across all HTTP requests. */
export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/**
 * Download a m3u8 stream and save as MP4.
 *
 * Uses Electron's Chromium network stack (net.fetch) to download the m3u8
 * playlist and all TS segments — this bypasses Cloudflare anti-bot protection
 * because the TLS fingerprint and cookies match a real browser.
 *
 * After local download, ffmpeg handles the local-only m3u8 → MP4 conversion.
 */
export async function downloadM3u8(opts: DownloadOptions): Promise<boolean> {
  return downloadViaChromium({
    url: opts.url,
    output: opts.output,
    headers: opts.headers,
    abortSignal: opts.abortSignal,
    cacheDir: opts.cacheDir,
    onProgress: opts.onProgress
      ? (data) => {
          opts.onProgress!({
            percent: data.percent,
            currentFile: 1,
            totalFiles: 1,
            speed: data.speed,
            eta: data.eta
          })
        }
      : undefined,
    onProcCreated: opts.onProcCreated,
    onDurationDetected: opts.onDurationDetected
  })
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
    const resp = await net.fetch(m3u8Url, {
      headers: {
        'User-Agent': DEFAULT_UA,
        ...(headers || {})
      }
    })
    if (!resp.ok) { return [] }
    const text = await resp.text()
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
  if (height <= 0) { return '未知' }
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
