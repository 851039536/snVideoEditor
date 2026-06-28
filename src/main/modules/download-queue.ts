import { downloadM3u8, type DownloadOptions } from './download'
import { acquireLock, releaseLock } from './lock'
import { cancelFfmpegOperation } from './ffmpeg'

export interface QueueItem {
  id: string
  url: string
  output: string
  headers?: Record<string, string>
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  progress: { percent: number; speed: string; eta: string }
  error?: string
  addedAt: number
  fileName: string
}

export interface QueueStatus {
  items: QueueItem[]
  isProcessing: boolean
  activeId: string | null
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
  private activeId: string | null = null
  private cancelled = false
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

  enqueue(opts: DownloadOptions & { fileName?: string }): QueueItem {
    // Extract filename from output path
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

    // Trigger processing loop (non-blocking)
    this.processLoop()

    return item
  }

  removeItem(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id)
    if (idx < 0) { return false }
    const item = this.items[idx]
    if (item.status !== 'pending') { return false }
    this.items.splice(idx, 1)
    this.notifyStatus()
    return true
  }

  retryItem(id: string): boolean {
    const item = this.items.find((i) => i.id === id)
    if (!item) { return false }
    if (item.status !== 'failed') { return false }
    item.status = 'pending'
    item.progress = { percent: 0, speed: '', eta: '' }
    item.error = undefined
    this.notifyStatus()
    this.processLoop()
    return true
  }

  cancelAll(): void {
    this.cancelled = true

    // Kill current ffmpeg process
    if (this.activeId) {
      cancelFfmpegOperation()
    }

    // Mark pending items as cancelled
    for (const item of this.items) {
      if (item.status === 'pending') {
        item.status = 'cancelled'
      }
    }

    // Mark active item as cancelled
    if (this.activeId) {
      const active = this.items.find((i) => i.id === this.activeId)
      if (active && active.status === 'downloading') {
        active.status = 'cancelled'
      }
    }

    this.activeId = null
    this.isProcessing = false
    this.notifyStatus()
  }

  getStatus(): QueueStatus {
    return {
      items: [...this.items],
      isProcessing: this.isProcessing,
      activeId: this.activeId
    }
  }

  hasActiveDownload(): boolean {
    return this.activeId !== null
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

  private async processLoop(): Promise<void> {
    if (this.isProcessing) { return }
    if (this.cancelled) {
      this.cancelled = false
      return
    }

    this.isProcessing = true

    while (true) {
      // Respect cancel flag
      if (this.cancelled) {
        this.cancelled = false
        this.isProcessing = false
        return
      }

      const idx = this.items.findIndex((i) => i.status === 'pending')
      if (idx < 0) { break }

      const item = this.items[idx]

      // Wait for global lock (other operations like compress/split may be running)
      while (!acquireLock('download')) {
        await new Promise((r) => setTimeout(r, 500))
        if (this.cancelled) { break }
      }

      if (this.cancelled) {
        releaseLock()
        break
      }

      item.status = 'downloading'
      this.activeId = item.id
      this.notifyStatus()

      try {
        await downloadM3u8({
          url: item.url,
          output: item.output,
          headers: item.headers,
          onProgress: (data) => {
            item.progress = {
              percent: data.percent,
              speed: data.speed,
              eta: data.eta
            }
            this.notifyProgress(item.id, item.progress)
          }
        })
        item.status = 'completed'
        item.progress = { percent: 100, speed: '完成', eta: '0:00' }
      } catch (e) {
        if (this.cancelled) {
          item.status = 'cancelled'
        } else {
          item.status = 'failed'
          item.error = cleanError(e)
        }
      } finally {
        releaseLock()
        this.activeId = null
      }

      this.notifyProgress(item.id, item.progress)
      this.notifyStatus()
    }

    this.isProcessing = false
  }
}

/** Extract a clean error message from caught values. */
function cleanError(e: unknown): string {
  if (e instanceof Error) { return e.message }
  if (typeof e === 'string') { return e }
  return '未知下载错误'
}
