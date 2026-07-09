import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

export interface HistoryEntry {
  fileName: string
  url: string
  output: string
  completedAt: number
  fileSize?: number
}

let instance: DownloadHistoryManager | null = null

export class DownloadHistoryManager {
  private filePath: string

  private constructor() {
    this.filePath = path.join(app.getPath('userData'), 'download-history.json')
  }

  static getInstance(): DownloadHistoryManager {
    if (!instance) {
      instance = new DownloadHistoryManager()
    }
    return instance
  }

  /** Get the JSON file path for download history. */
  getFilePath(): string {
    return this.filePath
  }

  /** Append a completed download entry to the history JSON. */
  addEntry(entry: HistoryEntry): void {
    const entries = this.loadAll()
    entries.push(entry)
    this.saveAll(entries)
  }

  /**
   * Check if a filename already exists in download history.
   * Case-insensitive on all platforms for consistency.
   */
  checkDuplicate(fileName: string): HistoryEntry | null {
    const entries = this.loadAll()
    const lower = fileName.toLowerCase()
    return entries.find((e) => e.fileName.toLowerCase() === lower) || null
  }

  /** Return all history entries (most recent first). */
  getAll(): HistoryEntry[] {
    return this.loadAll().reverse()
  }

  /** Clear all history entries. */
  clear(): void {
    this.saveAll([])
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private loadAll(): HistoryEntry[] {
    try {
      if (!fs.existsSync(this.filePath)) { return [] }
      const data = fs.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(data) as { entries: HistoryEntry[] }
      if (!parsed.entries || !Array.isArray(parsed.entries)) { return [] }
      return parsed.entries
    } catch {
      return []
    }
  }

  private saveAll(entries: HistoryEntry[]): void {
    try {
      const data = JSON.stringify({ entries })
      fs.writeFileSync(this.filePath, data, 'utf-8')
    } catch {
      // Silently ignore write failures
    }
  }
}
