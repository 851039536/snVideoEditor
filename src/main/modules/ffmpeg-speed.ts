// 视频变速 ffmpeg 滤镜处理（setpts + atempo 链）

import { spawn } from 'child_process'
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

    // speed=1.0 无需滤镜，直接流拷贝截取
    const isUnitySpeed = Math.abs(opts.speed - 1.0) < 0.001

    const args: string[] = [
      '-ss', String(opts.startTime),
      '-i', opts.input,
      '-t', String(opts.duration)
    ]

    if (isUnitySpeed) {
      args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero')
    } else {
      args.push(
        '-filter:v', `setpts=PTS/${opts.speed}`,
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
