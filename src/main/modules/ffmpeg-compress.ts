import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import type { ProgressCallback } from './ffmpeg-shared'
import {
  getFfmpegPath,
  isCancelled,
  resetCancelled,
  setFfmpegProc,
  parseProgressLine,
  timeToSeconds,
  type VideoMeta
} from './ffmpeg-shared'

/**
 * Extract actionable error lines from ffmpeg stderr.
 * Prioritizes encoder/driver errors; falls back to last non-progress lines.
 */
function extractErrorSummary(stderrLines: string[]): string {
  const all = stderrLines.join('')
  const lines = all.split('\n')
  const errorPattern = /(?:nvenc|qsv|amf|vaapi)\s*@|Error while opening|Error initializing|Driver does not|not support|incorrect parameters|Conversion failed|Invalid|Unknown encoder|No such file/i

  // Find lines matching known error patterns
  const errorIdxs: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (errorPattern.test(lines[i])) {
      errorIdxs.push(i)
    }
  }

  if (errorIdxs.length > 0) {
    // Collect error lines + 1 line of surrounding context
    const contextSet = new Set<number>()
    for (const idx of errorIdxs) {
      for (let j = Math.max(0, idx - 1); j <= Math.min(lines.length - 1, idx + 1); j++) {
        contextSet.add(j)
      }
    }
    const sorted = [...contextSet].sort((a, b) => a - b)
    return sorted.map((i) => lines[i].trim()).filter(Boolean).join('\n')
  }

  // Fallback: last lines that aren't progress noise
  const meaningful = lines.filter((l) => {
    const t = l.trim()
    if (!t) { return false }
    if (/^(frame=|size=|bitrate=|Metadata:|Duration:|Stream #|compatible_brands|major_brand|encoder\s*:)/.test(t)) { return false }
    return true
  })
  return meaningful.slice(-20).join('\n').trim()
}

export interface CompressOptions {
  input: string
  output: string
  crf: number
  resolution: string
  bitrate: string
  codec: string
  audioBitrate?: string
  preset?: string
  twoPass?: boolean
  onProgress?: ProgressCallback
}

export interface BatchCompressOptions {
  files: { input: string; output: string; crf: number; resolution: string; bitrate: string; codec: string; audioBitrate?: string; preset?: string; twoPass?: boolean }[]
  onProgress?: ProgressCallback
}

/**
 * Build ffmpeg arguments for a single compress pass.
 * Does NOT include '-pass' or output path — those are added per-pass.
 */
function buildCompressArgs(opts: CompressOptions): string[] {
  const args: string[] = [
    '-i', opts.input,
    '-c:v', opts.codec || 'libx264'
  ]

  const isGpu = (opts.codec || '').includes('nvenc') || (opts.codec || '').includes('qsv')
  if (opts.bitrate) {
    args.push('-b:v', opts.bitrate)
  } else if (opts.codec?.includes('nvenc')) {
    args.push('-rc', 'vbr', '-cq', String(opts.crf || 23))
  } else if (opts.codec?.includes('qsv')) {
    args.push('-global_quality', String(opts.crf || 23))
  } else {
    args.push('-crf', String(opts.crf || 23))
  }

  if (opts.resolution && opts.resolution !== 'original') {
    args.push('-vf', `scale=${opts.resolution}`)
  }

  args.push('-c:a', 'aac', '-b:a', opts.audioBitrate || '32k')

  if (!isGpu) {
    args.push('-preset', opts.preset || 'fast')
  }

  args.push('-movflags', '+faststart')
  args.push('-y')

  return args
}

/**
 * Spawn a single ffmpeg pass and return a Promise that resolves to
 * { success: boolean; stderrLines: string[] }
 */
function runCompressPass(
  args: string[],
  opts: CompressOptions,
  passLabel?: string
): Promise<{ success: boolean; stderrLines: string[] }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegPath(), args)
    setFfmpegProc(proc)
    const stderrLines: string[] = []
    let meta: VideoMeta | null = null

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderrLines.push(chunk)

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

      if (passLabel !== 'pass1') {
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
      }
    })

    proc.on('close', (code: number | null) => {
      setFfmpegProc(null)
      if (isCancelled) {
        resolve({ success: false, stderrLines })
        return
      }
      resolve({ success: code === 0, stderrLines })
    })

    proc.on('error', (err: Error) => {
      setFfmpegProc(null)
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
    })
  })
}

/**
 * Compress a single video file
 */
export function compressVideo(opts: CompressOptions): Promise<boolean> {
  return new Promise(async (resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    resetCancelled()

    const isGpu = (opts.codec || '').includes('nvenc') || (opts.codec || '').includes('qsv')
    const useTwoPass = opts.twoPass && !!opts.bitrate && !isGpu

    if (useTwoPass) {
      const baseArgs = buildCompressArgs(opts)

      // Pass 1: analysis
      const pass1Args = [...baseArgs, '-pass', '1', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null']
      try {
        const pass1Result = await runCompressPass(pass1Args, opts, 'pass1')
        if (!pass1Result.success) {
          reject(new Error(`FFmpeg 2-pass (pass 1) 失败:\n${extractErrorSummary(pass1Result.stderrLines)}`))
          return
        }
      } catch (e) {
        reject(e)
        return
      }

      if (isCancelled) {
        resolve(false)
        return
      }

      // Pass 2: actual encode
      const pass2Args = [...baseArgs, '-pass', '2', opts.output]
      try {
        const pass2Result = await runCompressPass(pass2Args, opts, 'pass2')
        const logDir = path.dirname(opts.output)
        for (const logName of ['ffmpeg2pass-0.log', 'ffmpeg2pass-0.log.mbtree']) {
          try { fs.unlinkSync(path.join(logDir, logName)) } catch { /* ok */ }
        }

        if (!pass2Result.success) {
          reject(new Error(`FFmpeg 2-pass (pass 2) 失败:\n${extractErrorSummary(pass2Result.stderrLines)}`))
          return
        }

        if (opts.onProgress) {
          opts.onProgress({ percent: 100, currentFile: 1, totalFiles: 1, speed: '完成', eta: '0:00' })
        }
        resolve(true)
      } catch (e) {
        reject(e)
      }
    } else {
      // Single-pass (with NVENC driver compatibility auto-fallback)
      const doSinglePass = async (codecOpts: CompressOptions): Promise<boolean> => {
        const args = [...buildCompressArgs(codecOpts), codecOpts.output]
        const result = await runCompressPass(args, codecOpts)
        if (isCancelled) { return false }
        if (result.success) {
          if (codecOpts.onProgress) {
            codecOpts.onProgress({ percent: 100, currentFile: 1, totalFiles: 1, speed: '完成', eta: '0:00' })
          }
          return true
        }
        throw new Error(`FFmpeg 压缩失败:\n${extractErrorSummary(result.stderrLines)}`)
      }

      try {
        const ok = await doSinglePass(opts)
        if (!ok) { resolve(false); return }
        resolve(true)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const isNvenc = (opts.codec || '').includes('nvenc')
        const isDriverErr = /Driver does not support|minimum required/i.test(msg)
        if (isNvenc && isDriverErr) {
          console.warn('[Compress] NVENC 驱动不兼容，自动回退 libx264:', msg.slice(0, 200))
          try {
            const fallbackOpts = { ...opts, codec: 'libx264', preset: opts.preset || 'fast' }
            const ok = await doSinglePass(fallbackOpts)
            if (!ok) { resolve(false); return }
            resolve(true)
          } catch (e2) {
            reject(e2)
          }
        } else {
          reject(e)
        }
      }
    }
  })
}

/**
 * Batch compress multiple video files
 */
export async function batchCompress(opts: BatchCompressOptions): Promise<{ success: number; successFiles: string[]; failed: { input: string; error: string }[] }> {
  let success = 0
  const successFiles: string[] = []
  const failed: { input: string; error: string }[] = []

  resetCancelled()

  for (let i = 0; i < opts.files.length; i++) {
    if (isCancelled) { break }
    const file = opts.files[i]
    try {
      const result = await compressVideo({
        ...file,
        onProgress: (data) => {
          if (opts.onProgress) {
            opts.onProgress({
              ...data,
              currentFile: i + 1,
              totalFiles: opts.files.length,
              currentFileName: path.basename(file.input)
            })
          }
        }
      })
      if (!result) { break }
      success++
      successFiles.push(file.output)
    } catch (e) {
      if (isCancelled) { break }
      const msg = e instanceof Error ? e.message : String(e)
      failed.push({ input: file.input, error: msg })
    }
  }

  return { success, successFiles, failed }
}
