// 视频色彩调整 ffmpeg 滤镜处理
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

export interface ColorAdjustOptions {
  input: string
  output: string
  /** 亮度偏移，-1.0 ~ 1.0，默认 0 */
  brightness: number
  /** 对比度倍数，0.0 ~ 2.0，默认 1.0 */
  contrast: number
  /** 饱和度倍数，0.0 ~ 3.0，默认 1.0 */
  saturation: number
  /** 色温偏移，-100(冷) ~ 100(暖)，默认 0 */
  temperature: number
  onProgress?: ProgressCallback
}

export interface BatchColorAdjustOptions {
  files: Omit<ColorAdjustOptions, 'onProgress'>[]
  onProgress?: ProgressCallback
}

/** 将参数限制在有效范围内 */
function clampParams(opts: ColorAdjustOptions): { brightness: number; contrast: number; saturation: number; temperature: number } {
  return {
    brightness: Math.max(-1, Math.min(1, opts.brightness)),
    contrast: Math.max(0, Math.min(2, opts.contrast)),
    saturation: Math.max(0, Math.min(3, opts.saturation)),
    temperature: Math.max(-100, Math.min(100, opts.temperature))
  }
}

/** 构建 ffmpeg 视频滤镜链字符串 */
function buildFilterChain(brightness: number, contrast: number, saturation: number, temperature: number): string {
  const parts: string[] = []

  // eq 滤镜：亮度 / 对比度 / 饱和度
  const eqParts: string[] = []
  if (brightness !== 0) {
    eqParts.push(`brightness=${brightness.toFixed(3)}`)
  }
  if (contrast !== 1) {
    eqParts.push(`contrast=${contrast.toFixed(3)}`)
  }
  if (saturation !== 1) {
    eqParts.push(`saturation=${saturation.toFixed(3)}`)
  }
  if (eqParts.length > 0) {
    parts.push(`eq=${eqParts.join(':')}`)
  }

  // colorbalance 滤镜：色温（midtones 红蓝通道偏移）
  if (temperature !== 0) {
    const offset = (temperature / 100) * 0.3
    const rm = offset.toFixed(3)
    const bm = (-offset).toFixed(3)
    parts.push(`colorbalance=rm=${rm}:bm=${bm}`)
  }

  return parts.join(',')
}

/**
 * 对单个视频文件执行色彩调整
 */
export function adjustColor(opts: ColorAdjustOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    resetCancelled()

    const { brightness, contrast, saturation, temperature } = clampParams(opts)
    const filterChain = buildFilterChain(brightness, contrast, saturation, temperature)

    // 若所有参数均为默认值，直接复制文件
    if (!filterChain) {
      fs.copyFileSync(opts.input, opts.output)
      if (opts.onProgress) {
        opts.onProgress({ percent: 100, currentFile: 1, totalFiles: 1, speed: '完成', eta: '0:00' })
      }
      resolve(true)
      return
    }

    const args = [
      '-i', opts.input,
      '-vf', filterChain,
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'medium',
      '-c:a', 'copy',
      '-y',
      opts.output
    ]

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
        reject(new Error(`FFmpeg 色彩调整失败 (code: ${code}): ${stderrLines.join('').slice(-500)}`))
      }
    })

    proc.on('error', (err: Error) => {
      setFfmpegProc(null)
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
    })
  })
}

/**
 * 批量色彩调整
 */
export async function batchAdjustColor(opts: BatchColorAdjustOptions): Promise<{ success: number; failed: string[] }> {
  let success = 0
  const failed: string[] = []

  resetCancelled()

  for (let i = 0; i < opts.files.length; i++) {
    if (isCancelled) {
      break
    }
    const file = opts.files[i]
    try {
      await adjustColor({
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
