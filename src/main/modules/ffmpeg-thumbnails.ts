import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import type { ProgressCallback } from './ffmpeg-shared'
import { getFfmpegPath, isCancelled, resetCancelled, setFfmpegProc } from './ffmpeg-shared'

export interface ScreenshotOptions {
  input: string
  output: string
  time: number
  onProgress?: ProgressCallback
}

export interface ThumbnailSpriteOptions {
  input: string
  outputDir: string
  thumbWidth?: number
  thumbHeight?: number
  interval?: number
  cols?: number
  onProgress?: ProgressCallback
}

export interface ThumbnailSpriteResult {
  spriteUrl: string
  vttUrl: string
  count: number
  interval: number
}

/**
 * Capture a single screenshot frame from a video at a specific time.
 */
export function captureScreenshot(opts: ScreenshotOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    resetCancelled()

    const args = [
      '-ss', String(opts.time),
      '-i', opts.input,
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      opts.output
    ]

    const proc = spawn(getFfmpegPath(), args)
    setFfmpegProc(proc)
    const stderrLines: string[] = []

    proc.stderr.on('data', (data: Buffer) => {
      stderrLines.push(data.toString())
    })

    proc.on('close', (code: number | null) => {
      setFfmpegProc(null)
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
        reject(new Error(`FFmpeg 截图失败 (code: ${code}): ${stderrLines.join('').slice(-500)}`))
      }
    })

    proc.on('error', (err: Error) => {
      setFfmpegProc(null)
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
    })
  })
}

/**
 * Generate thumbnail sprite + VTT for Plyr previewThumbnails.
 */
export function generateThumbnailSprite(opts: ThumbnailSpriteOptions): Promise<ThumbnailSpriteResult> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    const thumbW = opts.thumbWidth ?? 160
    const thumbH = opts.thumbHeight ?? 90
    const interval = opts.interval ?? 5
    const cols = opts.cols ?? 10

    if (!fs.existsSync(opts.outputDir)) {
      fs.mkdirSync(opts.outputDir, { recursive: true })
    }

    const framesDir = path.join(opts.outputDir, 'frames')
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true })
    }

    const spritePath = path.join(opts.outputDir, 'sprite.jpg')
    const vttPath = path.join(opts.outputDir, 'sprite.vtt')

    resetCancelled()

    // Step 1: Extract frames at interval
    const framePattern = path.join(framesDir, 'thumb_%04d.jpg')
    const extractArgs = [
      '-i', opts.input,
      '-vf', `fps=1/${interval},scale=${thumbW}:${thumbH}:force_original_aspect_ratio=decrease,pad=${thumbW}:${thumbH}:(ow-iw)/2:(oh-ih)/2`,
      '-q:v', '3',
      '-y',
      framePattern
    ]

    const extractProc = spawn(getFfmpegPath(), extractArgs)
    setFfmpegProc(extractProc)
    const extractStderr: string[] = []

    extractProc.stderr.on('data', (data: Buffer) => {
      extractStderr.push(data.toString())
    })

    extractProc.on('close', (extractCode: number | null) => {
      setFfmpegProc(null)
      if (isCancelled) {
        cleanupThumbnailDir(opts.outputDir)
        resolve({ spriteUrl: '', vttUrl: '', count: 0, interval })
        return
      }
      if (extractCode !== 0) {
        const errMsg = extractStderr.join('').slice(-500)
        reject(new Error(`缩略图帧提取失败 (code: ${extractCode}): ${errMsg}`))
        return
      }

      // Count extracted frames
      const frameFiles = fs.readdirSync(framesDir)
        .filter((f) => f.startsWith('thumb_') && f.endsWith('.jpg'))
        .sort()

      const count = frameFiles.length
      if (count === 0) {
        reject(new Error('未提取到任何缩略图帧'))
        return
      }

      if (opts.onProgress) {
        opts.onProgress({ percent: 50, currentFile: 1, totalFiles: 1, speed: '正在拼接', eta: '' })
      }

      // Step 2: Tile frames into sprite
      const rows = Math.ceil(count / cols)
      const inputFiles = frameFiles.map((f) => `file '${path.join(framesDir, f).replace(/\\/g, '/')}'`)
      const concatFile = path.join(opts.outputDir, 'frames.txt')
      fs.writeFileSync(concatFile, inputFiles.join('\n'), 'utf-8')

      const tileArgs = [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatFile,
        '-vf', `tile=${cols}x${rows}:padding=0:margin=0`,
        '-q:v', '3',
        '-frames:v', '1',
        '-y',
        spritePath
      ]

      const tileProc = spawn(getFfmpegPath(), tileArgs)
      setFfmpegProc(tileProc)
      const tileStderr: string[] = []

      tileProc.stderr.on('data', (data: Buffer) => {
        tileStderr.push(data.toString())
      })

      tileProc.on('close', (tileCode: number | null) => {
        setFfmpegProc(null)
        try { fs.unlinkSync(concatFile) } catch { /* ignore */ }
        try {
          for (const f of frameFiles) {
            fs.unlinkSync(path.join(framesDir, f))
          }
          fs.rmdirSync(framesDir)
        } catch { /* ignore */ }

        if (isCancelled) {
          cleanupThumbnailDir(opts.outputDir)
          resolve({ spriteUrl: '', vttUrl: '', count: 0, interval })
          return
        }
        if (tileCode !== 0) {
          const errMsg = tileStderr.join('').slice(-500)
          reject(new Error(`缩略图拼接失败 (code: ${tileCode}): ${errMsg}`))
          return
        }

        if (opts.onProgress) {
          opts.onProgress({ percent: 80, currentFile: 1, totalFiles: 1, speed: '正在生成索引', eta: '' })
        }

        // Step 3: Generate VTT
        generateThumbnailVtt(vttPath, spritePath, count, interval, thumbW, thumbH, cols)

        if (opts.onProgress) {
          opts.onProgress({ percent: 100, currentFile: 1, totalFiles: 1, speed: '完成', eta: '0:00' })
        }

        const toFileUrl = (p: string): string => {
          const abs = path.resolve(p)
          return 'file:///' + abs.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:')
        }

        resolve({
          spriteUrl: toFileUrl(spritePath),
          vttUrl: toFileUrl(vttPath),
          count,
          interval
        })
      })

      tileProc.on('error', (err: Error) => {
        setFfmpegProc(null)
        reject(new Error(`启动 FFmpeg 拼接失败: ${err.message}`))
      })
    })

    extractProc.on('error', (err: Error) => {
      setFfmpegProc(null)
      reject(new Error(`启动 FFmpeg 帧提取失败: ${err.message}`))
    })
  })
}

// ---- Internal helpers ----

function generateThumbnailVtt(
  vttPath: string,
  spritePath: string,
  count: number,
  interval: number,
  thumbW: number,
  thumbH: number,
  cols: number
): void {
  const spriteName = path.basename(spritePath)
  const lines: string[] = ['WEBVTT', '']

  for (let i = 0; i < count; i++) {
    const startSec = i * interval
    const endSec = startSec + interval
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * thumbW
    const y = row * thumbH

    const startTs = secondsToVttTime(startSec)
    const endTs = secondsToVttTime(endSec)

    lines.push(`${startTs} --> ${endTs}`)
    lines.push(`${spriteName}#xywh=${x},${y},${thumbW},${thumbH}`)
    lines.push('')
  }

  fs.writeFileSync(vttPath, lines.join('\n'), 'utf-8')
}

function secondsToVttTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.floor(totalSec % 60)
  const ms = Math.floor((totalSec % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

function cleanupThumbnailDir(dir: string): void {
  try {
    const framesDir = path.join(dir, 'frames')
    if (fs.existsSync(framesDir)) {
      for (const f of fs.readdirSync(framesDir)) {
        fs.unlinkSync(path.join(framesDir, f))
      }
      fs.rmdirSync(framesDir)
    }
    const concatFile = path.join(dir, 'frames.txt')
    if (fs.existsSync(concatFile)) { fs.unlinkSync(concatFile) }
    const spritePath = path.join(dir, 'sprite.jpg')
    if (fs.existsSync(spritePath)) { fs.unlinkSync(spritePath) }
    const vttPath = path.join(dir, 'sprite.vtt')
    if (fs.existsSync(vttPath)) { fs.unlinkSync(vttPath) }
  } catch { /* ignore */ }
}
