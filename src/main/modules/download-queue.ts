import { downloadM3u8, type DownloadOptions } from './download'
import { killFfmpegProc, setFfmpegProc } from './ffmpeg'
import type { ChildProcess } from 'child_process'

/** Maximum number of items allowed in the download queue. */
const MAX_QUEUE_SIZE = 100

export interface QueueItem {
  id: string
  url: string
  output: string
  headers?: Record<string, string>
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled' | 'paused'
  progress: { percent: number; speed: string; eta: string }
  error?: string
  addedAt: number
  fileName: string
  /** Progress percentage at the moment of pause, used for resume offset. */
  pausedAtPercent?: number
  /** Total video duration in seconds recorded during the last download attempt. */
  cachedDurationSec?: number
}

export interface QueueStatus {
  items: QueueItem[]
  isProcessing: boolean
  activeIds: string[]
  concurrency: number
}

export type QueueProgressCallback = (
  itemId: string,
  data: { percent: number; speed: string; eta: string }
) => void

export type QueueStatusCallback = (status: QueueStatus) => void

let instance: DownloadQueueManager | null = null

export class DownloadQueueManager {
  private items: QueueItem[] = []
  private isProcessing = false
  private activeIds = new Set<string>()
  private activeProcs = new Map<string, ChildProcess>()
  private concurrency = 2
  private progressCb: QueueProgressCallback | null = null
  private statusCb: QueueStatusCallback | null = null

  static getInstance(): DownloadQueueManager {
    if (!instance) {
      instance = new DownloadQueueManager()
    }
    return instance
  }

  setProgressCallback(cb: QueueProgressCallback): void {
    this.progressCb = cb
  }

  setStatusCallback(cb: QueueStatusCallback): void {
    this.statusCb = cb
  }

  /** Set max concurrent downloads (clamped 1–8). */
  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, Math.min(8, Math.round(n)))
    // If we have spare slots, try to dispatch
    this.scheduleTasks()
  }

  enqueue(opts: DownloadOptions & { fileName?: string }): QueueItem {
    // Reject if queue is at capacity
    if (this.items.length >= MAX_QUEUE_SIZE) {
      throw new Error(
        `下载队列已满 (上限 ${MAX_QUEUE_SIZE} 个)。请等待部分任务完成或清空已完成项后再添加。`
      )
    }

    let fileName = opts.fileName || ''
    if (!fileName) {
      const parts = opts.output.replace(/\\/g, '/').split('/')
      fileName = parts[parts.length - 1] || 'download.mp4'
    }

    const id = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const item: QueueItem = {
      id,
      url: opts.url,
      output: opts.output,
      headers: opts.headers ? { ...opts.headers } : undefined,
      status: 'pending',
      progress: { percent: 0, speed: '', eta: '' },
      addedAt: Date.now(),
      fileName
    }
    this.items.push(item)
    this.notifyStatus()

    // Trigger scheduling (non-blocking)
    this.scheduleTasks()

    return item
  }

  removeItem(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id)
    if (idx < 0) { return false }
    const item = this.items[idx]
    // Only forbid removing active items; allow pending + terminal states
    if (item.status === 'downloading') { return false }
    this.items.splice(idx, 1)
    this.notifyStatus()
    return true
  }

  /** Batch-remove all terminal items (completed / failed / cancelled). Returns count removed. */
  clearTerminal(): number {
    const before = this.items.length
    this.items = this.items.filter(
      (i) => i.status === 'pending' || i.status === 'downloading' || i.status === 'paused'
    )
    const removed = before - this.items.length
    if (removed > 0) {
      this.notifyStatus()
    }
    return removed
  }

  retryItem(id: string): boolean {
    const item = this.items.find((i) => i.id === id)
    if (!item) { return false }
    if (item.status !== 'failed') { return false }
    item.status = 'pending'
    item.progress = { percent: 0, speed: '', eta: '' }
    item.error = undefined
    this.notifyStatus()
    this.scheduleTasks()
    return true
  }

  cancelAll(): void {
    // Kill all active download processes first
    for (const proc of this.activeProcs.values()) {
      killFfmpegProc(proc)
    }

    // Mark all active items as cancelled BEFORE the Promise callbacks fire
    for (const id of this.activeIds) {
      const item = this.items.find((i) => i.id === id)
      if (item && item.status === 'downloading') {
        item.status = 'cancelled'
      }
    }
    this.activeProcs.clear()
    this.activeIds.clear()
    setFfmpegProc(null)

    // Mark all pending items as cancelled
    for (const item of this.items) {
      if (item.status === 'pending' || item.status === 'paused') {
        item.status = 'cancelled'
      }
    }

    this.isProcessing = false
    this.notifyStatus()
  }

  /** Cancel a single queue item (pending → cancelled, downloading → kill proc + cancelled). */
  cancelItem(id: string): boolean {
    const item = this.items.find((i) => i.id === id)
    if (!item) { return false }

    if (item.status === 'pending' || item.status === 'paused') {
      item.status = 'cancelled'
      this.notifyStatus()
      return true
    }

    if (item.status === 'downloading') {
      this.killAndRelease(item, 'cancelled')
      return true
    }

    return false // can't cancel completed/failed/already-cancelled
  }

  /** Pause a downloading item: kill the ffmpeg process and mark as paused.
   *  The partial output file is discarded; resume will restart from scratch. */
  pauseItem(id: string): boolean {
    const item = this.items.find((i) => i.id === id)
    if (!item) { return false }
    if (item.status !== 'downloading') { return false }

    this.killAndRelease(item, 'paused')
    return true
  }

  /** Resume a paused item: set it back to pending so scheduleTasks picks it up.
   *  Passes the paused-at progress so ffmpeg can seek past already-downloaded content. */
  resumeItem(id: string): boolean {
    const item = this.items.find((i) => i.id === id)
    if (!item) { return false }
    if (item.status !== 'paused') { return false }

    item.status = 'pending'
    // Keep existing progress display — don't flash to 0
    item.error = undefined
    this.notifyStatus()
    this.scheduleTasks()
    return true
  }

  getStatus(): QueueStatus {
    return {
      items: [...this.items],
      isProcessing: this.isProcessing,
      activeIds: [...this.activeIds],
      concurrency: this.concurrency
    }
  }

  hasActiveDownload(): boolean {
    return this.activeIds.size > 0
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Kill the ffmpeg process for an active item and release the concurrency slot.
   * Called by both cancelItem and pauseItem to avoid ~20 lines of duplication.
   * Also synchronises ffmpeg-shared's currentProc to prevent zombie references.
   */
  private killAndRelease(
    item: QueueItem,
    targetStatus: 'cancelled' | 'paused'
  ): void {
    // Mark target status first so .then/.catch guards in startDownload won't overwrite
    item.status = targetStatus
    // Save progress snapshot for resume (pause only, not cancel)
    if (targetStatus === 'paused') {
      item.pausedAtPercent = item.progress.percent
    }
    // Kill the ffmpeg process for this item
    const proc = this.activeProcs.get(item.id)
    if (proc) {
      killFfmpegProc(proc)
    }
    this.activeIds.delete(item.id)
    this.activeProcs.delete(item.id)
    setFfmpegProc(null)
    this.notifyStatus()

    // Release the slot: try to start next pending task
    this.scheduleTasks()

    this.checkIdle()
  }

  /** Mark isProcessing=false if nothing active and nothing pending. */
  private checkIdle(): void {
    if (this.activeIds.size === 0 && !this.items.some((i) => i.status === 'pending')) {
      this.isProcessing = false
    }
  }

  private notifyStatus(): void {
    if (this.statusCb) {
      this.statusCb(this.getStatus())
    }
  }

  private notifyProgress(
    itemId: string,
    data: { percent: number; speed: string; eta: string }
  ): void {
    if (this.progressCb) {
      this.progressCb(itemId, data)
    }
  }

  /**
   * Try to fill available concurrency slots with pending items.
   * This is called whenever a slot opens up (download finishes/fails/cancels)
   * or when new items are enqueued.
   */
  private scheduleTasks(): void {
    const activeCount = this.activeIds.size
    const slots = this.concurrency - activeCount
    if (slots <= 0) { return }

    // Find all pending items
    const pending = this.items.filter((i) => i.status === 'pending')
    if (pending.length === 0) { return }

    this.isProcessing = true

    // Start up to `slots` downloads concurrently
    const toStart = pending.slice(0, slots)
    for (const item of toStart) {
      this.startDownload(item)
    }
  }

  private startDownload(item: QueueItem): void {
    item.status = 'downloading'
    this.activeIds.add(item.id)
    this.notifyStatus()

    downloadM3u8({
      url: item.url,
      output: item.output,
      headers: item.headers,
      startTime: item.pausedAtPercent !== undefined && item.cachedDurationSec
        ? (item.pausedAtPercent / 100) * item.cachedDurationSec
        : undefined,
      onProgress: (data) => {
        item.progress = {
          percent: data.percent,
          speed: data.speed,
          eta: data.eta
        }
        this.notifyProgress(item.id, item.progress)
      },
      onProcCreated: (proc) => {
        this.activeProcs.set(item.id, proc)
      },
      onDurationDetected: (sec) => {
        item.cachedDurationSec = sec
      }
    })
      .then(() => {
        // Guard: don't overwrite if cancelAll() already marked this item
        if (item.status === 'downloading') {
          item.status = 'completed'
          item.progress = { percent: 100, speed: '完成', eta: '0:00' }
        }
      })
      .catch((e) => {
        // Guard: don't overwrite if cancelAll() already marked this item
        if (item.status === 'downloading') {
          item.status = 'failed'
          item.error = cleanError(e)
        }
      })
      .finally(() => {
        this.activeIds.delete(item.id)
        this.activeProcs.delete(item.id)
        setFfmpegProc(null)
        this.notifyProgress(item.id, item.progress)
        this.notifyStatus()

        // Release slot: try to dispatch next pending item
        this.scheduleTasks()

        this.checkIdle()
      })
  }
}

/** Extract a clean error message from caught values. */
function cleanError(e: unknown): string {
  if (e instanceof Error) { return e.message }
  if (typeof e === 'string') { return e }
  return '未知下载错误'
}
