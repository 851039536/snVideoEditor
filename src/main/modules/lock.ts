/**
 * Shared operation lock to prevent concurrent ffmpeg operations.
 * Used by both index.ts (wrapOperation) and download-queue.ts.
 */
let isProcessing = false
let activeOperationType = ''

export function acquireLock(type: string): boolean {
  if (isProcessing) {
    return false
  }
  isProcessing = true
  activeOperationType = type
  return true
}

export function releaseLock(): void {
  isProcessing = false
  activeOperationType = ''
}

export function isLocked(): boolean {
  return isProcessing
}

export function getActiveOperationType(): string {
  return activeOperationType
}
