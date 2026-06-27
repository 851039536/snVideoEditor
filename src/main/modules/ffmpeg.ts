import { spawn, spawnSync, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

/**
 * Resolve ffmpeg binary path with multiple fallbacks.
 * Some environments (corporate Windows, AV software) may block
 * the ffmpeg-static binary, so we fall back to system PATH.
 */
function resolveFfmpegPath(): string {
  // 1. Try env var first (user override)
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH
  }

  // 2. Try ffmpeg-static (may be blocked by AV on Windows)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static')
    if (p && typeof p === 'string') {
      // Verify the binary is actually runnable
      if (canExecute(p)) {
        return p
      }
    }
  } catch {
    // ignore
  }

  // 3. Search node_modules relative to __dirname
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const searchDirs = [
    __dirname,
    path.join(__dirname, '..'),
    path.join(__dirname, '..', '..'),
    process.cwd()
  ]

  for (const dir of searchDirs) {
    const candidate = path.join(dir, 'node_modules', 'ffmpeg-static', exeName)
    if (fs.existsSync(candidate) && canExecute(candidate)) {
      return candidate
    }
  }

  // 4. Fallback: use system ffmpeg from PATH (bare "ffmpeg")
  try {
    const { execSync } = require('child_process')
    const result = execSync(
      process.platform === 'win32' ? 'where ffmpeg 2>nul' : 'which ffmpeg 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000 }
    )
    const sysPath = result.trim().split('\n')[0]?.trim()
    if (sysPath && canExecute(sysPath)) {
      return sysPath
    }
  } catch {
    // ignore
  }

  throw new Error(
    `找不到可用的 FFmpeg。请安装 FFmpeg 并将其添加到 PATH，或设置 FFMPEG_PATH 环境变量。`
  )
}

/**
 * Check if a binary file is actually executable.
 * On Windows, the file may exist but be blocked by security policy.
 */
function canExecute(binaryPath: string): boolean {
  // Quick existence check first
  if (!fs.existsSync(binaryPath)) {
    return false
  }

  // On non-Windows, assume it's executable if it exists
  if (process.platform !== 'win32') {
    return true
  }

  // On Windows, try to spawn with -version to verify it runs
  try {
    const result = spawnSync(binaryPath, ['-version'], {
      timeout: 10000,
      windowsHide: true
    })
    return result.status === 0 || !result.error
  } catch {
    return false
  }
}

/**
 * Resolve ffprobe binary path with multiple fallbacks.
 */
function resolveFfprobePath(): string {
  if (process.env.FFPROBE_PATH && fs.existsSync(process.env.FFPROBE_PATH)) {
    return process.env.FFPROBE_PATH
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffprobe-static')
    if (p?.path && typeof p.path === 'string' && canExecute(p.path)) {
      return p.path
    }
  } catch {
    // ignore
  }

  const exeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const searchDirs = [
    __dirname,
    path.join(__dirname, '..'),
    path.join(__dirname, '..', '..'),
    process.cwd()
  ]

  for (const dir of searchDirs) {
    const candidate = path.join(dir, 'node_modules', 'ffprobe-static', exeName)
    if (fs.existsSync(candidate) && canExecute(candidate)) {
      return candidate
    }
  }

  // Fallback to system PATH
  try {
    const { execSync } = require('child_process')
    const result = execSync(
      process.platform === 'win32' ? 'where ffprobe 2>nul' : 'which ffprobe 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000 }
    )
    const sysPath = result.trim().split('\n')[0]?.trim()
    if (sysPath && canExecute(sysPath)) {
      return sysPath
    }
  } catch {
    // ignore
  }

  throw new Error(
    `找不到可用的 ffprobe。请安装 FFmpeg 并将其添加到 PATH，或设置 FFPROBE_PATH 环境变量。`
  )
}

const ffmpegPath: string = resolveFfmpegPath()
const ffprobePath: string = resolveFfprobePath()

// ---- Cancellation support ----
let currentProc: ChildProcess | null = null
let isCancelled = false

export function cancelFfmpegOperation(): void {
  isCancelled = true
  if (currentProc) {
    currentProc.kill('SIGTERM')
    currentProc = null
  }
}

export interface ProgressCallback {
  (data: { percent: number; currentFile: number; totalFiles: number; speed: string; eta: string }): void
}

export interface VideoMeta {
  duration: number
  width: number
  height: number
  bitrate: number
  codec: string
  size: number
}

export interface SplitOptions {
  input: string
  output: string
  startTime: string
  duration: string
  onProgress?: ProgressCallback
}

export interface MergeOptions {
  inputs: string[]
  output: string
  onProgress?: ProgressCallback
}

export interface CompressOptions {
  input: string
  output: string
  crf: number
  resolution: string
  bitrate: string
  codec: string
  onProgress?: ProgressCallback
}

export interface GifOptions {
  input: string
  output: string
  fps: number
  width: number
  quality: 'high' | 'medium' | 'low'
  startTime?: number
  duration?: number
  loop: number
  onProgress?: ProgressCallback
}

export interface BatchGifOptions {
  files: {
    input: string
    output: string
    fps: number
    width: number
    quality: 'high' | 'medium' | 'low'
    startTime?: number
    duration?: number
    loop: number
  }[]
  onProgress?: ProgressCallback
}

export interface BatchCompressOptions {
  files: { input: string; output: string; crf: number; resolution: string; bitrate: string; codec: string }[]
  onProgress?: ProgressCallback
}

/**
 * Parse FFmpeg stderr output to extract progress information
 */
function parseProgressLine(
  line: string
): { time: string; speed: string } | null {
  const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/)
  const speedMatch = line.match(/speed=\s*(\S+)x/)
  if (!timeMatch) {
    return null
  }
  return {
    time: timeMatch[1],
    speed: speedMatch ? `${speedMatch[1]}x` : '计算中...'
  }
}

/**
 * Convert time string (HH:MM:SS.mm) to seconds
 */
function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':')
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseFloat(parts[2])
  return hours * 3600 + minutes * 60 + seconds
}

/**
 * Split a video file by start time and duration
 */
export function splitVideo(opts: SplitOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    isCancelled = false

    const args = [
      '-ss', opts.startTime,
      '-i', opts.input,
      '-t', opts.duration,
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-y',
      opts.output
    ]

    const proc = spawn(ffmpegPath, args)
    currentProc = proc
    let stderr = ''

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr += chunk
      const parsed = parseProgressLine(chunk)
      if (parsed && opts.onProgress) {
        const current = timeToSeconds(parsed.time)
        const total = timeToSeconds(opts.duration)
        const percent = Math.min(Math.round((current / total) * 100), 100)
        opts.onProgress({
          percent,
          currentFile: 1,
          totalFiles: 1,
          speed: parsed.speed,
          eta: parsed.time
        })
      }
    })

    proc.on('close', (code: number | null) => {
      currentProc = null
      if (isCancelled) {
        resolve(false)
        return
      }
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
        reject(new Error(`FFmpeg 分割失败 (code: ${code}): ${stderr.slice(-500)}`))
      }
    })

    proc.on('error', (err: Error) => {
      currentProc = null
      reject(new Error(`启动 FFmpeg 失败 (${ffmpegPath}): ${err.message}`))
    })
  })
}

/**
 * Merge multiple video files into one using concat demuxer
 */
export function mergeVideos(opts: MergeOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (opts.inputs.length === 0) {
      reject(new Error('没有提供要合并的视频文件'))
      return
    }

    isCancelled = false

    // Create temporary concat list file
    const concatDir = path.dirname(opts.output)
    const concatListPath = path.join(concatDir, `_concat_list_${Date.now()}.txt`)

    const fileListContent = opts.inputs
      .map((f) => {
        const safePath = f.replace(/\\/g, '/')
        return `file '${safePath}'`
      })
      .join('\n')

    fs.writeFileSync(concatListPath, fileListContent, 'utf-8')

    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      '-y',
      opts.output
    ]

    const proc = spawn(ffmpegPath, args)
    currentProc = proc
    let stderr = ''

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr += chunk
      const parsed = parseProgressLine(chunk)
      if (parsed && opts.onProgress) {
        const totalFrames = opts.inputs.length * 100
        const current = Math.min(Math.round(timeToSeconds(parsed.time)), totalFrames)
        const percent = Math.min(Math.round((current / totalFrames) * 100), 100)
        opts.onProgress({
          percent,
          currentFile: 1,
          totalFiles: 1,
          speed: parsed.speed,
          eta: parsed.time
        })
      }
    })

    proc.on('close', (code: number | null) => {
      currentProc = null
      // Clean up temp file
      if (fs.existsSync(concatListPath)) {
        fs.unlinkSync(concatListPath)
      }

      if (isCancelled) {
        resolve(false)
        return
      }
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
        reject(new Error(`FFmpeg 合并失败 (code: ${code}): ${stderr.slice(-500)}`))
      }
    })

    proc.on('error', (err: Error) => {
      currentProc = null
      if (fs.existsSync(concatListPath)) {
        fs.unlinkSync(concatListPath)
      }
      reject(new Error(`启动 FFmpeg 失败 (${ffmpegPath}): ${err.message}`))
    })
  })
}

/**
 * Get video metadata using ffprobe
 */
export function getVideoMeta(filePath: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const ffprobeProcess = spawn(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ])

    let stdout = ''
    let stderr = ''

    ffprobeProcess.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    ffprobeProcess.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    ffprobeProcess.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`ffprobe 执行失败: ${stderr}`))
        return
      }

      try {
        const data = JSON.parse(stdout)
        const videoStream = data.streams?.find(
          (s: { codec_type: string }) => s.codec_type === 'video'
        )

        const format = data.format || {}

        const meta: VideoMeta = {
          duration: parseFloat(format.duration || '0'),
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          bitrate: parseInt(format.bit_rate || '0', 10),
          codec: videoStream?.codec_name || 'unknown',
          size: parseInt(format.size || '0', 10)
        }

        resolve(meta)
      } catch (e) {
        reject(new Error(`解析视频元数据失败: ${e}`))
      }
    })

    ffprobeProcess.on('error', (err: Error) => {
      reject(new Error(`启动 ffprobe 失败 (${ffprobePath}): ${err.message}`))
    })
  })
}

/**
 * Compress a single video file
 */
export function compressVideo(opts: CompressOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    isCancelled = false

    const args: string[] = [
      '-i', opts.input,
      '-c:v', opts.codec || 'libx264',
      '-crf', String(opts.crf || 23)
    ]

    // Resolution scaling
    if (opts.resolution && opts.resolution !== 'original') {
      args.push('-vf', `scale=${opts.resolution}`)
    }

    // Bitrate limit
    if (opts.bitrate) {
      args.push('-b:v', opts.bitrate)
    }

    // Audio: copy stream
    args.push('-c:a', 'aac', '-b:a', '128k')

    // Fast encode preset
    args.push('-preset', 'fast')
    args.push('-movflags', '+faststart')
    args.push('-y')
    args.push(opts.output)

    const proc = spawn(ffmpegPath, args)
    currentProc = proc
    let stderr = ''
    let meta: VideoMeta | null = null

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr += chunk

      // Try to extract duration from first lines
      if (!meta) {
        const durMatch = chunk.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/)
        if (durMatch) {
          meta = {
            duration: timeToSeconds(durMatch[1]),
            width: 0,
            height: 0,
            bitrate: 0,
            codec: '',
            size: 0
          }
        }
      }

      const parsed = parseProgressLine(chunk)
      if (parsed && meta && opts.onProgress) {
        const current = timeToSeconds(parsed.time)
        const percent = Math.min(Math.round((current / meta.duration) * 100), 99)
        opts.onProgress({
          percent,
          currentFile: 1,
          totalFiles: 1,
          speed: parsed.speed,
          eta: parsed.time
        })
      }
    })

    proc.on('close', (code: number | null) => {
      currentProc = null
      if (isCancelled) {
        resolve(false)
        return
      }
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
        reject(new Error(`FFmpeg 压缩失败 (code: ${code}): ${stderr.slice(-500)}`))
      }
    })

    proc.on('error', (err: Error) => {
      currentProc = null
      reject(new Error(`启动 FFmpeg 失败 (${ffmpegPath}): ${err.message}`))
    })
  })
}

/**
 * Batch compress multiple video files
 */
export async function batchCompress(opts: BatchCompressOptions): Promise<{ success: number; failed: string[] }> {
  let success = 0
  const failed: string[] = []

  for (let i = 0; i < opts.files.length; i++) {
    const file = opts.files[i]
    try {
      await compressVideo({
        ...file,
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

/**
 * Convert a video file to GIF using two-pass palette optimization
 */
export function convertToGif(opts: GifOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    isCancelled = false

    const qualityMap = {
      high: { statsMode: 'diff', dither: 'bayer:bayer_scale=5' },
      medium: { statsMode: 'diff', dither: 'bayer:bayer_scale=3' },
      low: { statsMode: 'full', dither: 'sierra2_4a' }
    }
    const q = qualityMap[opts.quality]
    const widthArg = opts.width > 0 ? `${opts.width}:-1` : '-1:-1'

    const palettePath = path.join(path.dirname(opts.output), `_gif_palette_${Date.now()}.png`)

    const trimArgs: string[] = []
    if (opts.startTime !== undefined && opts.startTime > 0) {
      trimArgs.push('-ss', String(opts.startTime))
    }
    if (opts.duration !== undefined && opts.duration > 0) {
      trimArgs.push('-t', String(opts.duration))
    }

    if (opts.onProgress) {
      opts.onProgress({
        percent: 5, currentFile: 1, totalFiles: 1,
        speed: '生成调色板...', eta: ''
      })
    }

    // Pass 1: Palette generation
    const paletteArgs = [
      ...trimArgs,
      '-i', opts.input,
      '-vf', `fps=${opts.fps},scale=${widthArg}:flags=lanczos,palettegen=stats_mode=${q.statsMode}`,
      '-y',
      palettePath
    ]

    const paletteProc = spawn(ffmpegPath, paletteArgs)

    paletteProc.on('close', (code: number | null) => {
      if (isCancelled) {
        cleanup()
        resolve(false)
        return
      }
      if (code !== 0) {
        cleanup()
        reject(new Error(`FFmpeg 调色板生成失败 (code: ${code})`))
        return
      }

      if (opts.onProgress) {
        opts.onProgress({
          percent: 30, currentFile: 1, totalFiles: 1,
          speed: '生成GIF...', eta: ''
        })
      }

      // Pass 2: GIF generation with palette
      const gifArgs = [
        ...trimArgs,
        '-i', opts.input,
        '-i', palettePath,
        '-lavfi', `fps=${opts.fps},scale=${widthArg}:flags=lanczos [x]; [x][1:v] paletteuse=dither=${q.dither}`,
        '-loop', String(opts.loop),
        '-y',
        opts.output
      ]

      const gifProc = spawn(ffmpegPath, gifArgs)
      currentProc = gifProc
      let stderr = ''
      let gifMeta: { duration: number } | null = null

      gifProc.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString()
        stderr += chunk

        if (!gifMeta) {
          const durMatch = chunk.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/)
          if (durMatch) {
            const fullDuration = timeToSeconds(durMatch[1])
            gifMeta = { duration: opts.duration || fullDuration }
          }
        }

        const parsed = parseProgressLine(chunk)
        if (parsed && gifMeta && opts.onProgress) {
          const current = timeToSeconds(parsed.time)
          const total = gifMeta.duration
          const pass2Percent = Math.min(Math.round((current / total) * 100), 99)
          const overallPercent = 30 + Math.round((pass2Percent / 100) * 65)
          opts.onProgress({
            percent: Math.min(overallPercent, 95),
            currentFile: 1,
            totalFiles: 1,
            speed: parsed.speed,
            eta: parsed.time
          })
        }
      })

      gifProc.on('close', (code: number | null) => {
        currentProc = null
        cleanup()
        if (isCancelled) {
          resolve(false)
          return
        }
        if (code === 0) {
          if (opts.onProgress) {
            opts.onProgress({
              percent: 100, currentFile: 1, totalFiles: 1,
              speed: '完成', eta: '0:00'
            })
          }
          resolve(true)
        } else {
          reject(new Error(`FFmpeg GIF生成失败 (code: ${code}): ${stderr.slice(-500)}`))
        }
      })

      gifProc.on('error', (err: Error) => {
        currentProc = null
        cleanup()
        reject(new Error(`启动 FFmpeg 失败 (${ffmpegPath}): ${err.message}`))
      })
    })

    paletteProc.on('error', (err: Error) => {
      currentProc = null
      reject(new Error(`启动 FFmpeg 失败 (${ffmpegPath}): ${err.message}`))
    })

    function cleanup(): void {
      if (fs.existsSync(palettePath)) {
        try { fs.unlinkSync(palettePath) } catch { /* ignore */ }
      }
    }
  })
}

/**
 * Batch convert video files to GIF
 */
export async function batchConvertToGif(opts: BatchGifOptions): Promise<{ success: number; failed: string[] }> {
  let success = 0
  const failed: string[] = []

  for (let i = 0; i < opts.files.length; i++) {
    const file = opts.files[i]
    try {
      await convertToGif({
        ...file,
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
