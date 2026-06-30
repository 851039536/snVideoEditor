/**
 * Convert elapsed seconds to HH:MM:SS display string.
 */
export function secondsToHMS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.floor(totalSec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Convert HH:MM:SS string parts to total seconds.
 */
export function hmsToSeconds(h: string, m: string, s: string): number {
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)
}

/**
 * Parse a human-readable time string into total seconds.
 * Supports: bare seconds ("30"), M:SS ("1:30"), H:MM:SS ("0:01:30").
 * Returns -1 for unparseable input.
 */
export function parseTimeInput(input: string): number {
  const trimmed = input.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed)
  }
  const parts = trimmed.split(':')
  if (parts.length === 3) {
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2])
  }
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1])
  }
  return -1
}

/**
 * Format seconds to M:SS display (used for video duration in file tables).
 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
