/**
 * Clamp a value between min and max (inclusive).
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}
