/**
 * Shared operation lock to prevent concurrent ffmpeg/crypto operations.
 * Supports optional timeout to prevent permanent lock stalls.
 *
 * Used by both index.ts (wrapOperation) and download-queue.ts.
 */
let isProcessing = false
let activeOperationType = ''
let lockAcquiredAt = 0
let lockTimeoutId: ReturnType<typeof setTimeout> | null = null

/** Default lock timeout in milliseconds (30 seconds) */
const DEFAULT_LOCK_TIMEOUT = 30000

export class LockTimeoutError extends Error {
  constructor(operationType: string, timeoutMs: number) {
    super(`操作 "${operationType}" 锁等待超时 (${timeoutMs / 1000}s)，可能有其他操作正在运行`)
    this.name = 'LockTimeoutError'
  }
}

/**
 * Acquire the global operation lock.
 * @param type - Human-readable operation type for error messages
 * @param timeoutMs - Max wait time in ms before throwing LockTimeoutError. Default 30s.
 * @returns true if lock was acquired immediately
 * @throws LockTimeoutError if lock couldn't be acquired before timeout
 */
export function acquireLock(type: string, timeoutMs: number = DEFAULT_LOCK_TIMEOUT): boolean {
  if (isProcessing) {
    throw new LockTimeoutError(activeOperationType || type, timeoutMs)
  }
  isProcessing = true
  activeOperationType = type
  lockAcquiredAt = Date.now()

  // Auto-release after timeout to prevent permanent deadlock
  lockTimeoutId = setTimeout(() => {
    if (isProcessing) {
      console.warn(`[lock] 操作 "${activeOperationType}" 超时 (${timeoutMs / 1000}s)，自动释放锁`)
      releaseLock()
    }
  }, timeoutMs)

  return true
}

export function releaseLock(): void {
  isProcessing = false
  activeOperationType = ''
  lockAcquiredAt = 0
  if (lockTimeoutId !== null) {
    clearTimeout(lockTimeoutId)
    lockTimeoutId = null
  }
}

export function isLocked(): boolean {
  return isProcessing
}

export function getActiveOperationType(): string {
  return activeOperationType
}

export function getLockDuration(): number {
  if (!isProcessing || lockAcquiredAt === 0) { return 0 }
  return Date.now() - lockAcquiredAt
}
