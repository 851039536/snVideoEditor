// 视频变速 ffmpeg 滤镜处理（setpts + atempo 链）与批量变速合并编排

import { app } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

import {
  getFfmpegPath,
  parseProgressLine,
  timeToSeconds,
  setFfmpegProc,
  clearFfmpegProc,
  isCancelled,
  resetCancelled,
  type ProgressCallback
} from './ffmpeg-shared'
import { splitVideo, mergeVideos } from './ffmpeg'

// ─── 接口定义 ─────────────────────────────────────────────────────────────────

export interface SpeedChangeOptions {
  input: string
  output: string
  /** 选取段起始（秒） */
  startTime: number
  /** 选取段时长（秒） */
  duration: number
  /** 速度倍率 0.25~4.0，<1 减速 >1 加速 */
  speed: number
  /** 强制重编码：true 时即使 speed=1 也走 libx264 重编码（用于批量变速中统一各段编码，避免 merge -c copy 失败） */
  forceReencode?: boolean
  onProgress?: ProgressCallback
}

// ─── atempo 链生成 ────────────────────────────────────────────────────────────

/**
 * 构建 atempo 滤镜链。
 * atempo 仅支持 [0.5, 2.0] 范围，超出需链式拼接：
 *   4.0  → atempo=2.0,atempo=2.0
 *   3.0  → atempo=2.0,atempo=1.5
 *   0.25 → atempo=0.5,atempo=0.5
 *   1.5  → atempo=1.5
 */
function buildAtempoChain(speed: number): string {
  const filters: string[] = []
  let remaining = speed

  while (remaining > 2.0) {
    filters.push('atempo=2.0')
    remaining /= 2.0
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5')
    remaining /= 0.5
  }
  filters.push(`atempo=${remaining.toFixed(6)}`)

  return filters.join(',')
}

// ─── changeSpeed ──────────────────────────────────────────────────────────────

export function changeSpeed(opts: SpeedChangeOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(opts.input)) {
      reject(new Error(`输入文件不存在: ${opts.input}`))
      return
    }

    if (opts.speed <= 0) {
      reject(new Error('速度倍率必须大于 0'))
      return
    }

    resetCancelled()

    // speed=1.0 且未强制重编码时无需滤镜，直接流拷贝截取
    const isUnitySpeed = Math.abs(opts.speed - 1.0) < 0.001 && !opts.forceReencode

    const args: string[] = [
      '-ss', String(opts.startTime),
      '-i', opts.input,
      '-t', String(opts.duration)
    ]

    if (isUnitySpeed) {
      args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero')
    } else {
      // fps=30 归一化输出帧率，确保批量变速各段 time_base 一致，使 concat -c copy 合并正确
      args.push(
        '-filter:v', `setpts=PTS/${opts.speed},fps=30`,
        '-filter:a', buildAtempoChain(opts.speed),
        '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
        '-async', '1'
      )
    }

    args.push('-y', opts.output)

    const proc = spawn(getFfmpegPath(), args)
    setFfmpegProc(proc)

    // 降低进程优先级，避免重编码占满 CPU 导致系统卡顿
    if (process.platform === 'win32' && proc.pid) {
      try {
        os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
      } catch { /* ignore */ }
    }

    const stderrLines: string[] = []
    // 输出时长 = 原时长 / 速度（变速后的实际输出时长）
    const outputDuration = opts.duration / opts.speed

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderrLines.push(chunk)
      const parsed = parseProgressLine(chunk)
      if (parsed && opts.onProgress) {
        const current = timeToSeconds(parsed.time)
        const percent = Math.min(Math.round((current / outputDuration) * 100), 99)
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
      clearFfmpegProc(proc)
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
        reject(new Error(`FFmpeg 变速失败 (code: ${code}): ${stderrLines.join('').slice(-500)}`))
      }
    })

    proc.on('error', (err: Error) => {
      clearFfmpegProc(proc)
      reject(new Error(`启动 FFmpeg 失败 (${getFfmpegPath()}): ${err.message}`))
    })
  })
}

// ─── 批量变速合并 ──────────────────────────────────────────────────────────────

/** 变速片段（主进程独立定义，避免跨进程类型依赖） */
export interface SpeedSegment {
  id: string
  startSec: number
  endSec: number
  duration: number
  speed: number
}

export interface BatchSpeedOptions {
  input: string
  output: string
  /** 已按 startSec 排序的变速段 */
  segments: SpeedSegment[]
  /** 源视频总时长（秒） */
  sourceDuration: number
  /** 源视频编码（如 'h264'），用于决定未变速段走流拷贝还是重编码 */
  sourceCodec?: string
  onProgress?: ProgressCallback
}

/** 进度重映射：将子任务进度映射到批量整体进度（参照 batchAdjustColor 范式） */
function remapProgress(
  onProgress: ProgressCallback | undefined,
  step: number,
  totalSteps: number,
  label: string
): ProgressCallback {
  return (data) => onProgress?.({
    ...data,
    currentFile: step + 1,
    totalFiles: totalSteps,
    currentFileName: `${label} ${step + 1}/${totalSteps}`
  })
}

/**
 * 批量变速并合并回完整视频（主进程原子操作，单次加锁）。
 * 变速段重编码、未变速段按源编码选择流拷贝或重编码统一格式，最后 concat 合并。
 */
export async function batchSpeedMerge(opts: BatchSpeedOptions): Promise<boolean> {
  resetCancelled()

  // 构建有序任务列表：变速段与未变速间隙交替
  type SegmentTask =
    | { type: 'speed'; seg: SpeedSegment }
    | { type: 'copy'; start: number; duration: number }

  const tasks: SegmentTask[] = []
  let cursor = 0
  for (const seg of opts.segments) {
    if (seg.startSec > cursor) {
      tasks.push({ type: 'copy', start: cursor, duration: seg.startSec - cursor })
    }
    tasks.push({ type: 'speed', seg })
    cursor = seg.endSec
  }
  if (cursor < opts.sourceDuration) {
    tasks.push({ type: 'copy', start: cursor, duration: opts.sourceDuration - cursor })
  }

  const sourceIsH264 = (opts.sourceCodec ?? '').toLowerCase().startsWith('h264')
  const totalSteps = tasks.length + 1 // +1 为合并阶段
  const tempFiles: string[] = []
  let step = 0
  const tempDir = path.join(app.getPath('temp'), 'sn-video-clips')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  try {
    // 顺序处理每段：先变速段/未变速段，最后合并
    for (const task of tasks) {
      if (isCancelled) {
        break
      }
      const tempFile = path.join(tempDir, `speed_${Date.now()}_${step}.mp4`)
      let ok = false
      if (task.type === 'speed') {
        ok = await changeSpeed({
          input: opts.input,
          output: tempFile,
          startTime: task.seg.startSec,
          duration: task.seg.duration,
          speed: task.seg.speed,
          onProgress: remapProgress(opts.onProgress, step, totalSteps, '变速')
        })
      } else if (sourceIsH264) {
        // h264 源：未变速段走流拷贝快路径（-c copy 无需重编码）
        ok = await splitVideo({
          input: opts.input,
          output: tempFile,
          startTime: String(task.start),
          duration: String(task.duration),
          onProgress: remapProgress(opts.onProgress, step, totalSteps, '截取')
        })
      } else {
        // 非 h264 源：未变速段也重编码为 h264，保证合并阶段编码一致
        ok = await changeSpeed({
          input: opts.input,
          output: tempFile,
          startTime: task.start,
          duration: task.duration,
          speed: 1,
          forceReencode: true,
          onProgress: remapProgress(opts.onProgress, step, totalSteps, '截取')
        })
      }
      if (!ok) {
        break
      }
      tempFiles.push(tempFile)
      step++
    }

    // 全部段处理完成且未取消时才进入合并
    if (isCancelled || step < tasks.length) {
      return false
    }
    // 各变速段已通过 fps=30 归一化帧率，未变速段若为 h264 源也保持原始编码，concat -c copy 可直接合并
    return await mergeVideos({
      inputs: tempFiles,
      output: opts.output,
      onProgress: remapProgress(opts.onProgress, step, totalSteps, '合并')
    })
  } finally {
    // 清理所有临时片段：成功合并后清理、失败/取消也清理
    await Promise.allSettled(tempFiles.map((f) => {
      try {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f)
        }
        return true
      } catch {
        return false
      }
    }))
  }
}
