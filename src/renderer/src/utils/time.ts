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
 * Format seconds to M:SS display (used for video duration in file tables).
 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
