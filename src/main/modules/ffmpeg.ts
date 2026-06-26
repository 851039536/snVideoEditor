import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffprobePath: string = require('ffprobe-static').path

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

export interface BatchCompressOptions {
  files: { input: string; output: string; crf: number; resolution: string; bitrate: string; codec: string }[]
  onProgress?: ProgressCallback
}

/**
 * Parse FFmpeg stderr output to extract progress information
 */
function parseProgressLine(
  line: string
): { time?: string; speed?: string } | null {
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
    let stderr = ''
    let canceled = false

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
      if (canceled) {
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
      reject(new Error(`启动 FFmpeg 失败: ${err.message}`))
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
    let stderr = ''
    let canceled = false

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
      // Clean up temp file
      if (fs.existsSync(concatListPath)) {
        fs.unlinkSync(concatListPath)
      }

      if (canceled) {
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
      if (fs.existsSync(concatListPath)) {
        fs.unlinkSync(concatListPath)
      }
      reject(new Error(`启动 FFmpeg 失败: ${err.message}`))
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
      reject(new Error(`启动 ffprobe 失败: ${err.message}`))
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
    let stderr = ''
    let meta: VideoMeta | null = null
    let canceled = false

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
      if (canceled) {
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
      reject(new Error(`启动 FFmpeg 失败: ${err.message}`))
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
