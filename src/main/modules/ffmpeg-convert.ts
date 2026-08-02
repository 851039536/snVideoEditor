// 格式转换 ffmpeg 处理（视频容器互转 + 音频格式互转）
import { spawn } from 'child_process'
import * as fs from 'fs'
import type { ProgressCallback } from './ffmpeg-shared'
import {
  getFfmpegPath,
  isCancelled,
  resetCancelled,
  setFfmpegProc,
  parseProgressLine,
  timeToSeconds
} from './ffmpeg-shared'

export interface ConvertOptions {
  input: string
  output: string
  /** 目标格式扩展名（不含点），如 'mp4', 'mkv', 'mp3' */
  targetFormat: string
  /** true = stream copy（快速无损），false = 重编码 */
  copy: boolean
  onProgress?: ProgressCallback
}

export interface BatchConvertOptions {
  files: Omit<ConvertOptions, 'onProgress'>[]
  onProgress?: ProgressCallback
}

/** 音频格式集合 */
const AUDIO_FORMATS = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg'])

/** 根据目标格式和模式构建 ffmpeg 参数 */
function buildArgs(opts: ConvertOptions): string[] {
  const { input, output, targetFormat, copy } = opts

  // 快速复制模式：直接 stream copy
  if (copy) {
    return ['-i', input, '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-y', output]
  }

  // 音频目标：去除视频流，ffmpeg 按扩展名自动选择编码器
  if (AUDIO_FORMATS.has(targetFormat)) {
    return ['-i', input, '-vn', '-y', output]
  }

  // 视频目标：重编码
  if (targetFormat === 'webm') {
    return ['-i', input, '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-c:a', 'libopus', '-y', output]
  }

  // mp4/mkv/avi/mov 使用 libx264 + aac
  const args = ['-i', input, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac']
  if (targetFormat === 'mp4') {
    args.push('-movflags', '+faststart')
  }
  args.push('-y', output)
  return args
}

/**
 * 对单个文件执行格式转换
 */
export function convertFormat(opts: ConvertOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    resetCancelled()

    const args = buildArgs(opts)
    const stderrLines: string[] = []
    let duration: number | null = null

    const proc = spawn(getFfmpegPath(), args)
    setFfmpegProc(proc)

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderrLines.push(chunk)

      if (duration === null) {
        const durMatch = chunk.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/)
        if (durMatch) {
          duration = timeToSeconds(durMatch[1])
        }
      }

      const parsed = parseProgressLine(chunk)
      if (parsed && duration && opts.onProgress) {
        const current = timeToSeconds(parsed.time)
        const percent = Math.min(Math.round((current / duration) * 100), 99)
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
      setFfmpegProc(null)
      if (isCancelled) {
        resolve(false)
        return
      }
      if (code === 0) {
        if (opts.onProgress) {
          opts.onProgress({ percent: 100, currentFile: 1, totalFiles: 1, speed: '完成', eta: '0:00' })
        }
        resolve(true)
      } else {
        const errMsg = stderrLines.join('').slice(-500)
        if (opts.copy) {
          reject(new Error(`格式转换失败（编码可能不兼容，请尝试重编码模式）: ${errMsg}`))
        } else {
          reject(new Error(`格式转换失败 (code: ${code}): ${errMsg}`))
        }
      }
    })

    proc.on('error', (err: Error) => {
      setFfmpegProc(null)
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
    })
  })
}

/**
 * 批量格式转换
 */
export async function batchConvertFormat(opts: BatchConvertOptions): Promise<{ success: number; failed: string[] }> {
  let success = 0
  const failed: string[] = []

  resetCancelled()

  for (let i = 0; i < opts.files.length; i++) {
    if (isCancelled) {
      break
    }
    const file = opts.files[i]
    try {
      await convertFormat({
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
    } catch {
      if (isCancelled) {
        break
      }
      failed.push(file.input)
    }
  }

  return { success, failed }
}
