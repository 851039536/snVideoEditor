import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import type { ProgressCallback } from './ffmpeg-shared'
import {
  getFfmpegPath,
  isCancelled,
  resetCancelled,
  setFfmpegProc,
  parseProgressLine,
  timeToSeconds,
  isGpuCodec,
  isVp9Codec,
  type VideoMeta
} from './ffmpeg-shared'

/**
 * Extract actionable error lines from ffmpeg stderr.
 * Prioritizes encoder/driver errors; falls back to last non-progress lines.
 */
function extractErrorSummary(stderrLines: string[]): string {
  const all = stderrLines.join('')
  const lines = all.split('\n')
  const errorPattern = /(?:nvenc|qsv|amf|vaapi)\s*@|Error while opening|Error initializing|Driver does not|not support|incorrect parameters|Conversion failed|Invalid|Unknown encoder|No such file|hwaccel|cuda|cuInit|No capable devices|Unknown hwaccel/i

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
  /** NVENC-specific preset (p1 fastest ~ p7 best quality). Only used when codec includes 'nvenc'. */
  nvencPreset?: string
  twoPass?: boolean
  onProgress?: ProgressCallback
  /** Called when NVENC driver is incompatible and falls back to CPU encoding */
  onFallback?: (original: string, fallback: string) => void
}

export interface BatchCompressOptions {
  files: { input: string; output: string; crf: number; resolution: string; bitrate: string; codec: string; audioBitrate?: string; preset?: string; nvencPreset?: string; twoPass?: boolean }[]
  onProgress?: ProgressCallback
  /** Called when NVENC driver is incompatible and falls back to CPU encoding */
  onFallback?: (original: string, fallback: string) => void
}

/**
 * GPU pipeline mode for NVENC encoding.
 * - 'full-gpu': NVDEC decode (frames stay in GPU memory) + scale_cuda + NVENC.
 *               Eliminates CPU decode bottleneck → higher GPU utilization & speed.
 * - 'software': CPU decode + CPU scale + NVENC. Fallback when CUDA unavailable.
 */
type GpuPipelineMode = 'full-gpu' | 'software'

/**
 * Double a bitrate string (e.g. '320k' → '640k', '1.5M' → '3M').
 * Used to compute a -bufsize of 2× the target bitrate for NVENC VBR.
 * Returns the input unchanged if it doesn't match the expected pattern.
 */
function doubleBitrate(bitrate: string): string {
  const m = bitrate.match(/^(\d+(?:\.\d+)?)([kKmM]?)$/)
  if (!m) {
    return bitrate
  }
  const val = parseFloat(m[1]) * 2
  return `${val}${m[2] || 'k'}`
}

/**
 * Build ffmpeg arguments for a single compress pass.
 * Does NOT include '-pass' or output path — those are added per-pass.
 */
function buildCompressArgs(opts: CompressOptions, gpuMode: GpuPipelineMode = 'software'): string[] {
  const isGpu = isGpuCodec(opts.codec || '')
  const isNvenc = (opts.codec || '').includes('nvenc')
  const useFullGpu = gpuMode === 'full-gpu' && isNvenc
  const hasScaling = !!opts.resolution && opts.resolution !== 'original'

  const args: string[] = []

  if (useFullGpu) {
    // Full GPU pipeline: NVDEC decode → (scale_cuda) → NVENC encode
    // -hwaccel_output_format cuda keeps decoded frames in GPU memory,
    // avoiding the GPU→CPU→GPU round-trip that made plain -hwaccel cuda slower.
    args.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda')
  }

  args.push('-i', opts.input)
  args.push('-c:v', opts.codec || 'libx264')

  if (opts.bitrate) {
    args.push('-b:v', opts.bitrate)
    if (isNvenc) {
      // NVENC VBR without -maxrate overshoots the target badly (e.g. 320k→560k).
      // Constrain peaks with -maxrate (= target) and a 2× rate buffer.
      args.push('-rc', 'vbr', '-maxrate', opts.bitrate, '-bufsize', doubleBitrate(opts.bitrate))
    }
  } else if (isNvenc) {
    args.push('-rc', 'vbr', '-cq', String(opts.crf || 23))
  } else if (opts.codec?.includes('qsv')) {
    args.push('-global_quality', String(opts.crf || 23))
  } else {
    args.push('-crf', String(opts.crf || 23))
  }

  if (hasScaling) {
    if (useFullGpu) {
      // GPU-side scaling: keeps frames in GPU memory throughout the pipeline
      args.push('-vf', `scale_cuda=${opts.resolution}`)
    } else {
      args.push('-vf', `scale=${opts.resolution}`)
    }
  }

  args.push('-c:a', 'aac', '-b:a', opts.audioBitrate || '32k')

  if (isNvenc) {
    // NVENC preset: p1(fastest) ~ p7(best quality), p4 is the balanced default
    args.push('-preset', opts.nvencPreset || 'p4')
  } else if (!isGpu && !isVp9Codec(opts.codec || '')) {
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
    // Lower process priority so ffmpeg doesn't hog CPU/IO and freeze the system
    if (process.platform === 'win32' && proc.pid) {
      try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* ignore */ }
    }
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

    const isGpu = isGpuCodec(opts.codec || '')
    const useTwoPass = opts.twoPass && !!opts.bitrate && !isGpu

    if (useTwoPass) {
      const baseArgs = buildCompressArgs(opts)
      const passLogPrefix = path.join(path.dirname(opts.output), 'ffmpeg2pass')

      // Pass 1: analysis
      const pass1Args = [...baseArgs, '-pass', '1', '-passlogfile', passLogPrefix, '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null']
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
      const pass2Args = [...baseArgs, '-pass', '2', '-passlogfile', passLogPrefix, opts.output]
      try {
        const pass2Result = await runCompressPass(pass2Args, opts, 'pass2')
        for (const suffix of ['-0.log', '-0.log.mbtree']) {
          try { fs.unlinkSync(passLogPrefix + suffix) } catch { /* ok */ }
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
      // Single-pass (NVENC full-GPU pipeline → software decode → libx264 fallback)
      const doSinglePass = async (codecOpts: CompressOptions, gpuMode: GpuPipelineMode = 'software'): Promise<boolean> => {
        const args = [...buildCompressArgs(codecOpts, gpuMode), codecOpts.output]
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

      const isNvenc = (opts.codec || '').includes('nvenc')
      const gpuPipelineErrorPattern = /hwaccel|cuda|cuInit|No capable devices|Unknown hwaccel|scale_cuda|No such filter|not available|not support/i
      const driverErrorPattern = /Driver does not support|minimum required/i

      const fallbackToCpu = async (err: unknown): Promise<void> => {
        const msg2 = err instanceof Error ? err.message : String(err)
        console.warn('[Compress] NVENC 驱动不兼容，自动回退 libx264:', msg2.slice(0, 200))
        if (opts.onFallback) {
          opts.onFallback(opts.codec, 'libx264')
        }
        try {
          const fallbackOpts = { ...opts, codec: 'libx264', preset: opts.preset || 'fast' }
          const ok2 = await doSinglePass(fallbackOpts, 'software')
          if (!ok2) { resolve(false); return }
          resolve(true)
        } catch (e2) {
          reject(e2)
        }
      }

      try {
        // Level 1: NVENC full-GPU pipeline (NVDEC decode → scale_cuda → NVENC)
        const ok = await doSinglePass(opts, isNvenc ? 'full-gpu' : 'software')
        if (!ok) { resolve(false); return }
        resolve(true)
      } catch (e) {
        if (!isNvenc) {
          reject(e)
          return
        }

        const msg = e instanceof Error ? e.message : String(e)

        if (gpuPipelineErrorPattern.test(msg)) {
          // Level 2: GPU pipeline unavailable (no CUDA / no scale_cuda), retry NVENC with software decode
          console.warn('[Compress] GPU 流水线不可用，回退软件解码 + NVENC:', msg.slice(0, 200))
          try {
            const ok2 = await doSinglePass(opts, 'software')
            if (!ok2) { resolve(false); return }
            resolve(true)
            return
          } catch (e1) {
            if (driverErrorPattern.test(e1 instanceof Error ? e1.message : String(e1))) {
              // Level 3: NVENC driver incompatible after software-decode retry → libx264
              return fallbackToCpu(e1)
            }
            reject(e1)
            return
          }
        }

        if (driverErrorPattern.test(msg)) {
          // Level 3: NVENC driver incompatible directly → libx264
          return fallbackToCpu(e)
        }

        reject(e)
      }
    }
  })
}

/**
 * Batch compress multiple video files
 */
export async function batchCompress(opts: BatchCompressOptions): Promise<{ success: number; successFiles: string[]; failed: { input: string; error: string }[]; fallbacks: { input: string; originalCodec: string; fallbackCodec: string }[] }> {
  let success = 0
  const successFiles: string[] = []
  const failed: { input: string; error: string }[] = []
  const fallbacks: { input: string; originalCodec: string; fallbackCodec: string }[] = []

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
        },
        onFallback: (original, fallback) => {
          fallbacks.push({ input: file.input, originalCodec: original, fallbackCodec: fallback })
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

  return { success, successFiles, failed, fallbacks }
}
