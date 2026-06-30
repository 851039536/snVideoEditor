/**
 * ffmpeg.ts — barrel re-export for backward compatibility.
 *
 * Module split (2026-06-30):
 *   ffmpeg-shared.ts    — binary resolution, cancellation, progress parsing, shared interfaces
 *   ffmpeg-compress.ts  — compressVideo, batchCompress, runCompressPass
 *   ffmpeg-gif.ts       — convertToGif, batchConvertToGif
 *   ffmpeg-thumbnails.ts — captureScreenshot, generateThumbnailSprite
 *
 * Core functions (splitVideo, mergeVideos, getVideoMeta, getAvailableEncoders)
 * remain in this file.
 */

import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

// ─── Re-export from shared ────────────────────────────────────────────────────
export {
  getFfmpegPath,
  getFfprobePath,
  cancelFfmpegOperation,
  killFfmpegProc,
  setFfmpegProc,
  parseProgressLine,
  timeToSeconds
} from './ffmpeg-shared'
export type { ProgressCallback, VideoMeta } from './ffmpeg-shared'

// ─── Re-export from sub-modules ───────────────────────────────────────────────
export { compressVideo, batchCompress } from './ffmpeg-compress'
export type { CompressOptions, BatchCompressOptions } from './ffmpeg-compress'

export { convertToGif, batchConvertToGif } from './ffmpeg-gif'
export type { GifOptions, BatchGifOptions } from './ffmpeg-gif'

export { captureScreenshot, generateThumbnailSprite } from './ffmpeg-thumbnails'
export type { ScreenshotOptions, ThumbnailSpriteOptions, ThumbnailSpriteResult } from './ffmpeg-thumbnails'

// ─── Local imports for core functions ─────────────────────────────────────────
import {
  getFfmpegPath,
  getFfprobePath,
  parseProgressLine,
  timeToSeconds,
  setFfmpegProc as _setFfmpegProc,
  isCancelled,
  resetCancelled,
  currentProc,
  type VideoMeta
} from './ffmpeg-shared'

// ─── Core interfaces ──────────────────────────────────────────────────────────

export interface SplitOptions {
  input: string
  output: string
  startTime: string
  duration: string
  onProgress?: import('./ffmpeg-shared').ProgressCallback
}

export interface MergeOptions {
  inputs: string[]
  output: string
  onProgress?: import('./ffmpeg-shared').ProgressCallback
}

// ─── splitVideo ───────────────────────────────────────────────────────────────

export function splitVideo(opts: SplitOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    resetCancelled()

    const args = [
      '-ss', opts.startTime,
      '-i', opts.input,
      '-t', opts.duration,
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-y',
      opts.output
    ]

    const proc = spawn(getFfmpegPath(), args)
    _setFfmpegProc(proc)
    const stderrLines: string[] = []

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderrLines.push(chunk)
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
      _setFfmpegProc(null)
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
        reject(new Error(`FFmpeg 分割失败 (code: ${code}): ${stderrLines.join('').slice(-500)}`))
      }
    })

    proc.on('error', (err: Error) => {
      _setFfmpegProc(null)
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
    })
  })
}

// ─── mergeVideos ──────────────────────────────────────────────────────────────

export function mergeVideos(opts: MergeOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (opts.inputs.length === 0) {
      reject(new Error('没有提供要合并的视频文件'))
      return
    }

    resetCancelled()

    const concatDir = path.dirname(opts.output)
    const concatListPath = path.join(concatDir, `_concat_list_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`)

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

    const proc = spawn(getFfmpegPath(), args)
    _setFfmpegProc(proc)
    const stderrLines: string[] = []

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderrLines.push(chunk)
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
      _setFfmpegProc(null)
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
        reject(new Error(`FFmpeg 合并失败 (code: ${code}): ${stderrLines.join('').slice(-500)}`))
      }
    })

    proc.on('error', (err: Error) => {
      _setFfmpegProc(null)
      if (fs.existsSync(concatListPath)) {
        fs.unlinkSync(concatListPath)
      }
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
    })
  })
}

// ─── getVideoMeta ─────────────────────────────────────────────────────────────

export function getVideoMeta(filePath: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const ffprobeProcess = spawn(getFfprobePath(), [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ])
    _setFfmpegProc(ffprobeProcess)

    let stdout = ''
    let stderr = ''

    ffprobeProcess.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    ffprobeProcess.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    ffprobeProcess.on('close', (code: number | null) => {
      _setFfmpegProc(null)
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
      _setFfmpegProc(null)
      reject(new Error(`启动 ffprobe 失败 (${getFfprobePath()}): ${err.message}`))
    })
  })
}

// ─── getAvailableEncoders ─────────────────────────────────────────────────────

export function getAvailableEncoders(): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn(getFfmpegPath(), ['-encoders'])
    _setFfmpegProc(proc)
    let stdout = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.on('close', () => {
      _setFfmpegProc(null)
      const encoders = stdout
        .split('\n')
        .filter((l) => /^\s+V.....\s+\S/.test(l))
        .map((l) => l.trim().split(/\s+/)[1])
      resolve(encoders)
    })
    proc.on('error', () => { _setFfmpegProc(null); resolve([]) })
  })
}
