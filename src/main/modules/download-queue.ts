// 下载队列管理：并发调度、暂停/恢复/取消/重试与磁盘持久化
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { downloadM3u8, type DownloadOptions } from './download'
import { DownloadHistoryManager } from './download-history'
import { killFfmpegProc } from './ffmpeg'
import type { ChildProcess } from 'child_process'

/** Maximum number of items allowed in the download queue. */
const MAX_QUEUE_SIZE = 100

/** Debounce delay (ms) for saveToDisk to avoid excessive writes on progress updates. */
const SAVE_DEBOUNCE_MS = 1000

/** 同一队列项两次进度推送的最小间隔（毫秒），用于降低 IPC 频率 */
const PROGRESS_THROTTLE_MS = 250

export interface QueueItem {
  id: string
  url: string
  output: string
  headers?: Record<string, string>
  /** Persistent cache directory for TS segments (enables resume after restart). */
  cacheDir?: string
  status: 'pending' | 'downloading' | 'merging' | 'completed' | 'failed' | 'cancelled' | 'paused'
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
  private activeAbortControllers = new Map<string, AbortController>()
  private concurrency = 2
  private progressCb: QueueProgressCallback | null = null
  private statusCb: QueueStatusCallback | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  /** 各队列项上次进度推送的时间与百分比，用于 IPC 节流 */
  private lastProgressPush = new Map<string, { time: number; percent: number }>()

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
    // Place cache directory next to the output file (same drive) so disk space
    // pressure follows user's save location instead of always hitting C drive.
    const outputDir = path.dirname(opts.output)
    const cacheDir = path.join(outputDir, `.sn-cache-${id}`)
    const item: QueueItem = {
      id,
      url: opts.url,
      output: opts.output,
      headers: opts.headers ? { ...opts.headers } : undefined,
      cacheDir,
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
    if (item.status === 'downloading' || item.status === 'merging') { return false }
    // Clean up cache dir to prevent disk leak (cache is kept for resume, but
    // removing the item means user no longer wants it)
    if (item.cacheDir) {
      try { fs.rmSync(item.cacheDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
    this.items.splice(idx, 1)
    this.notifyStatus()
    return true
  }

  /** Batch-remove all terminal items (completed / failed / cancelled). Returns count removed. */
  clearTerminal(): number {
    // Collect terminal items first so we can clean their cache dirs
    const terminal = this.items.filter(
      (i) => i.status === 'completed' || i.status === 'failed' || i.status === 'cancelled'
    )
    for (const item of terminal) {
      if (item.cacheDir) {
        try { fs.rmSync(item.cacheDir, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    }
    const before = this.items.length
    this.items = this.items.filter(
      (i) => i.status === 'pending' || i.status === 'downloading' || i.status === 'merging' || i.status === 'paused'
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
    // Allow retry for both failed and cancelled items (resume from cache)
    if (item.status !== 'failed' && item.status !== 'cancelled') { return false }
    item.status = 'pending'
    item.progress = { percent: 0, speed: '', eta: '' }
    item.error = undefined
    item.pausedAtPercent = undefined
    this.notifyStatus()
    this.scheduleTasks()
    return true
  }

  cancelAll(): void {
    // Abort all active download controllers first
    for (const ac of this.activeAbortControllers.values()) {
      ac.abort()
    }
    // Kill all active download processes
    for (const proc of this.activeProcs.values()) {
      killFfmpegProc(proc)
    }

    // Mark all active items as cancelled BEFORE the Promise callbacks fire
    for (const id of this.activeIds) {
      const item = this.items.find((i) => i.id === id)
      if (item && (item.status === 'downloading' || item.status === 'merging')) {
        item.status = 'cancelled'
      }
    }
    this.activeProcs.clear()
    this.activeAbortControllers.clear()
    this.activeIds.clear()

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

    if (item.status === 'downloading' || item.status === 'merging') {
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
      // 剔除 headers（可能内嵌大体积 Cookie）：渲染层不使用，
      // 持久化也直接读 this.items 原数据，不受影响
      items: this.items.map(({ headers: _headers, ...rest }) => rest),
      isProcessing: this.isProcessing,
      activeIds: [...this.activeIds],
      concurrency: this.concurrency
    }
  }

  hasActiveDownload(): boolean {
    return this.activeIds.size > 0
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  /** Get the JSON file path for queue persistence. */
  private getQueueFilePath(): string {
    return path.join(app.getPath('userData'), 'download-queue.json')
  }

  /** Save queue state to disk (debounced to avoid excessive writes). */
  saveToDisk(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer) }
    this.saveTimer = setTimeout(() => {
      this.doSaveToDisk()
    }, SAVE_DEBOUNCE_MS)
  }

  /** Immediately save queue state to disk (call on app quit). */
  doSaveToDisk(): void {
    try {
      const data = JSON.stringify({ items: this.items })
      fs.writeFileSync(this.getQueueFilePath(), data, 'utf-8')
    } catch {
      // Silently ignore write failures
    }
  }

  /** Load queue state from disk and restore items. Called on app startup. */
  loadFromDisk(): void {
    try {
      const filePath = this.getQueueFilePath()
      if (!fs.existsSync(filePath)) { return }
      const data = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(data) as { items: QueueItem[] }
      if (!parsed.items || !Array.isArray(parsed.items)) { return }

      // Restore items: downloading/merging → pending (needs re-scheduling), others keep state
      for (const item of parsed.items) {
        if (item.status === 'downloading' || item.status === 'merging') {
          item.status = 'pending'
          item.progress = { percent: 0, speed: '', eta: '' }
        }
        // Cancelled/completed/failed/paused keep their state
        this.items.push(item)
      }

      if (this.items.length > 0) {
        this.notifyStatus()
        // Schedule any pending/paused items for download
        this.scheduleTasks()
      }
    } catch {
      // Silently ignore parse failures — start with empty queue
    }
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
    // Abort the download controller (interrupts net.fetch)
    const ac = this.activeAbortControllers.get(item.id)
    if (ac) { ac.abort() }
    // Kill the ffmpeg process for this item
    const proc = this.activeProcs.get(item.id)
    if (proc) {
      killFfmpegProc(proc)
    }
    this.activeIds.delete(item.id)
    this.activeProcs.delete(item.id)
    this.activeAbortControllers.delete(item.id)
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
    // Debounced save to disk for persistence
    this.saveToDisk()
  }

  private notifyProgress(
    itemId: string,
    data: { percent: number; speed: string; eta: string },
    force = false
  ): void {
    // 按队列项节流：距上次推送不足 PROGRESS_THROTTLE_MS 且整百分数未变化时跳过；
    // force=true（终态推送）始终绕过节流，保证 100%/终态必达
    if (!force) {
      const now = Date.now()
      const last = this.lastProgressPush.get(itemId)
      if (
        last &&
        now - last.time < PROGRESS_THROTTLE_MS &&
        Math.floor(data.percent) === Math.floor(last.percent)
      ) {
        return
      }
      this.lastProgressPush.set(itemId, { time: now, percent: data.percent })
    }
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
    // Create per-item abort controller for cancellation
    const abortController = new AbortController()
    this.activeAbortControllers.set(item.id, abortController)
    // Ensure cacheDir exists
    if (item.cacheDir) {
      fs.mkdirSync(item.cacheDir, { recursive: true })
    }
    this.notifyStatus()

    downloadM3u8({
      url: item.url,
      output: item.output,
      headers: item.headers,
      abortSignal: abortController.signal,
      cacheDir: item.cacheDir,
      startTime: item.pausedAtPercent !== undefined && item.cachedDurationSec
        ? (item.pausedAtPercent / 100) * item.cachedDurationSec
        : undefined,
      onProgress: (data) => {
        item.progress = {
          percent: data.percent,
          speed: data.speed,
          eta: data.eta
        }
        // Switch to merging status when ffmpeg merge phase starts
        if (data.phase === 'merge' && item.status === 'downloading') {
          item.status = 'merging'
          this.notifyStatus()
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
        if (item.status === 'downloading' || item.status === 'merging') {
          item.status = 'completed'
          item.progress = { percent: 100, speed: '完成', eta: '0:00' }
          // Clean up cache dir on success (segments no longer needed)
          if (item.cacheDir) {
            try { fs.rmSync(item.cacheDir, { recursive: true, force: true }) } catch { /* ignore */ }
            item.cacheDir = undefined
          }
          // Append to download history
          try {
            let fileSize: number | undefined
            try { fileSize = fs.statSync(item.output).size } catch { /* ignore */ }
            DownloadHistoryManager.getInstance().addEntry({
              fileName: item.fileName,
              url: item.url,
              output: item.output,
              completedAt: Date.now(),
              fileSize
            })
          } catch { /* silently ignore history write failures */ }
        }
      })
      .catch((e) => {
        // Guard: don't overwrite if cancelAll() already marked this item
        if (item.status === 'downloading' || item.status === 'merging') {
          item.status = 'failed'
          item.error = cleanError(e)
          // Keep cacheDir intact for resume on retry (don't delete partial segments)
        }
      })
      .finally(() => {
        this.activeIds.delete(item.id)
        this.activeProcs.delete(item.id)
        this.activeAbortControllers.delete(item.id)
        this.lastProgressPush.delete(item.id)
        this.notifyProgress(item.id, item.progress, true)
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
