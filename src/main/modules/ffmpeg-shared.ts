import { spawn, spawnSync, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

/**
 * Check if a binary file is actually executable.
 * On Windows, the file may exist but be blocked by security policy.
 */
function canExecute(binaryPath: string): boolean {
  if (!fs.existsSync(binaryPath)) {
    return false
  }
  if (process.platform !== 'win32') {
    return true
  }
  try {
    const result = spawnSync(binaryPath, ['-version'], {
      timeout: 10000,
      windowsHide: true
    })
    return result.status === 0 || !result.error
  } catch {
    return false
  }
}

/**
 * Resolve ffmpeg binary path with multiple fallbacks.
 */
function resolveFfmpegPath(): string {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static')
    if (p && typeof p === 'string' && canExecute(p)) {
      return p
    }
  } catch {
    // ignore
  }
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const searchDirs = [__dirname, path.join(__dirname, '..'), path.join(__dirname, '..', '..'), process.cwd()]
  for (const dir of searchDirs) {
    const candidate = path.join(dir, 'node_modules', 'ffmpeg-static', exeName)
    if (fs.existsSync(candidate) && canExecute(candidate)) {
      return candidate
    }
  }
  try {
    const { execSync } = require('child_process')
    const result = execSync(
      process.platform === 'win32' ? 'where ffmpeg 2>nul' : 'which ffmpeg 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000 }
    )
    const sysPath = result.trim().split('\n')[0]?.trim()
    if (sysPath && canExecute(sysPath)) {
      return sysPath
    }
  } catch {
    // ignore
  }
  throw new Error(
    `找不到可用的 FFmpeg。请安装 FFmpeg 并将其添加到 PATH，或设置 FFMPEG_PATH 环境变量。`
  )
}

/**
 * Resolve ffprobe binary path with multiple fallbacks.
 */
function resolveFfprobePath(): string {
  if (process.env.FFPROBE_PATH && fs.existsSync(process.env.FFPROBE_PATH)) {
    return process.env.FFPROBE_PATH
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffprobe-static')
    if (p?.path && typeof p.path === 'string' && canExecute(p.path)) {
      return p.path
    }
  } catch {
    // ignore
  }
  const exeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const searchDirs = [__dirname, path.join(__dirname, '..'), path.join(__dirname, '..', '..'), process.cwd()]
  for (const dir of searchDirs) {
    const candidate = path.join(dir, 'node_modules', 'ffprobe-static', exeName)
    if (fs.existsSync(candidate) && canExecute(candidate)) {
      return candidate
    }
  }
  try {
    const { execSync } = require('child_process')
    const result = execSync(
      process.platform === 'win32' ? 'where ffprobe 2>nul' : 'which ffprobe 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000 }
    )
    const sysPath = result.trim().split('\n')[0]?.trim()
    if (sysPath && canExecute(sysPath)) {
      return sysPath
    }
  } catch {
    // ignore
  }
  throw new Error(
    `找不到可用的 ffprobe。请安装 FFmpeg 并将其添加到 PATH，或设置 FFPROBE_PATH 环境变量。`
  )
}

let _ffmpegPath: string | null = null
let _ffprobePath: string | null = null

export function getFfmpegPath(): string {
  if (!_ffmpegPath) {
    _ffmpegPath = resolveFfmpegPath()
  }
  return _ffmpegPath
}

export function getFfprobePath(): string {
  if (!_ffprobePath) {
    _ffprobePath = resolveFfprobePath()
  }
  return _ffprobePath
}

// ---- Cancellation support ----
export let isCancelled = false
export let currentProc: ChildProcess | null = null

export function resetCancelled(): void {
  isCancelled = false
}

export function cancelFfmpegOperation(): void {
  isCancelled = true
  if (currentProc) {
    killFfmpegProc(currentProc)
    currentProc = null
  }
}

export function killFfmpegProc(proc: ChildProcess): void {
  if (process.platform === 'win32' && proc.pid) {
    spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'])
  } else {
    proc.kill('SIGTERM')
  }
}

export function setFfmpegProc(proc: ChildProcess | null): void {
  currentProc = proc
}

// ---- Shared interfaces ----
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

// ---- Progress parsing utilities ----
export function parseProgressLine(
  line: string
): { time: string; speed: string } | null {
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

export function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':')
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseFloat(parts[2])
  return hours * 3600 + minutes * 60 + seconds
}
