// 时间格式转换工具：HH:MM:SS 与秒数互转、时间输入解析、时长展示

/** 将秒数转换为 HH:MM:SS 展示字符串 */
export function secondsToHMS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.floor(totalSec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 将秒数转换为 HH:MM:SS.mmm 时间码（ffmpeg -ss/-t 原生支持，保留毫秒精度，避免裁切边界丢精度） */
export function secondsToTimecode(totalSec: number): string {
  const totalMs = Math.round(totalSec * 1000)
  const h = Math.floor(totalMs / 3600000)
  const m = Math.floor((totalMs % 3600000) / 60000)
  const s = Math.floor((totalMs % 60000) / 1000)
  const ms = totalMs % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

/** 将 HH:MM:SS 三段字符串转换为总秒数 */
export function hmsToSeconds(h: string, m: string, s: string): number {
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10)
}

/** 解析用户输入的时间字符串为总秒数，支持纯秒（"30"）、M:SS（"1:30"）、H:MM:SS（"0:01:30"），无法解析返回 -1 */
export function parseTimeInput(input: string): number {
  const trimmed = input.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed)
  }
  const parts = trimmed.split(':')
  let result = -1
  if (parts.length === 3) {
    result = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2])
  } else if (parts.length === 2) {
    result = parseInt(parts[0], 10) * 60 + parseFloat(parts[1])
  }
  return Number.isFinite(result) ? result : -1
}

/** 将秒数格式化为 M:SS 展示（用于文件表格中的视频时长） */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
