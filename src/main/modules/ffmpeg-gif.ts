import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import type { ProgressCallback } from './ffmpeg-shared'
import { getFfmpegPath, isCancelled, resetCancelled, setFfmpegProc, parseProgressLine, timeToSeconds } from './ffmpeg-shared'

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

/**
 * Convert a video file to GIF using two-pass palette optimization
 */
export function convertToGif(opts: GifOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    resetCancelled()

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

    const stderrLines: string[] = []
    const paletteProc = spawn(getFfmpegPath(), paletteArgs)
    setFfmpegProc(paletteProc)

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

      const gifProc = spawn(getFfmpegPath(), gifArgs)
      setFfmpegProc(gifProc)
      let gifMeta: { duration: number } | null = null

      gifProc.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString()
        stderrLines.push(chunk)

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
        setFfmpegProc(null)
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
          reject(new Error(`FFmpeg GIF生成失败 (code: ${code}): ${stderrLines.join('').slice(-500)}`))
        }
      })

      gifProc.on('error', (err: Error) => {
        setFfmpegProc(null)
        cleanup()
        reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
      })
    })

    paletteProc.on('error', (err: Error) => {
      setFfmpegProc(null)
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
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

  resetCancelled()

  for (let i = 0; i < opts.files.length; i++) {
    if (isCancelled) { break }
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
      if (isCancelled) { break }
      failed.push(file.input)
    }
  }

  return { success, failed }
}
