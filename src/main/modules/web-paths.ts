// 网页路径列表的 JSON 文件持久化与备份还原
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

/** 网页路径下载状态（字段需与渲染端 views/Download/types 保持对齐） */
export type WebPageStatus = 'pending' | 'downloaded'

/** 网页路径条目（字段需与渲染端 views/Download/types 的 WebPageEntry 保持对齐） */
export interface WebPageEntry {
  id: string
  url: string
  createdAt: number
  status: WebPageStatus
}

/** loadAll 返回结构：解析失败时 entries 为空并附带错误说明 */
export interface WebPathsLoadResult {
  entries: WebPageEntry[]
  error?: string
}

let instance: WebPathsManager | null = null

export class WebPathsManager {
  private filePath: string

  private constructor() {
    this.filePath = path.join(app.getPath('userData'), 'web-page-paths.json')
  }

  static getInstance(): WebPathsManager {
    if (!instance) {
      instance = new WebPathsManager()
    }
    return instance
  }

  /** 获取 JSON 文件路径 */
  getFilePath(): string {
    return this.filePath
  }

  /**
   * 读取全部网页路径条目。
   * JSON 损坏时把原文件改名保留现场（避免被后续写入覆盖），返回空表 + 错误说明。
   */
  loadAll(): WebPathsLoadResult {
    if (!fs.existsSync(this.filePath)) {
      return { entries: [] }
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        throw new Error('根节点不是数组')
      }
      return { entries: normalizeEntries(parsed) }
    } catch {
      // 损坏文件改名保留现场，避免用户手编内容丢失
      const invalidPath = this.filePath.replace(/\.json$/, `.invalid-${Date.now()}.json`)
      try {
        fs.renameSync(this.filePath, invalidPath)
      } catch { /* ignore */ }
      return {
        entries: [],
        error: `网页路径文件 JSON 格式错误，原文件已备份为:\n${invalidPath}\n修复后可通过"还原"导入。`
      }
    }
  }

  /** 保存全部条目（带缩进格式化，保证可直接查看编辑） */
  saveAll(entries: WebPageEntry[]): void {
    const data = JSON.stringify(entries, null, 2)
    fs.writeFileSync(this.filePath, data, 'utf-8')
  }

  /** 备份当前文件内容到目标路径（无文件时写空数组） */
  backup(targetPath: string): void {
    if (fs.existsSync(this.filePath)) {
      fs.copyFileSync(this.filePath, targetPath)
    } else {
      fs.writeFileSync(targetPath, '[]', 'utf-8')
    }
  }

  /** 从备份文件还原：校验通过后覆盖写入主文件并返回条目，失败抛中文错误 */
  restoreFrom(sourcePath: string): WebPageEntry[] {
    let parsed: unknown
    try {
      const raw = fs.readFileSync(sourcePath, 'utf-8')
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('备份文件不是有效的 JSON，无法还原')
    }
    if (!Array.isArray(parsed)) {
      throw new Error('备份文件格式错误：根节点必须是数组')
    }
    const entries = normalizeEntries(parsed)
    this.saveAll(entries)
    return entries
  }
}

/** 归一化条目：过滤无 url 的脏数据，补齐缺失的 status/id/createdAt */
function normalizeEntries(list: unknown[]): WebPageEntry[] {
  const result: WebPageEntry[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const obj = item as Record<string, unknown>
    if (typeof obj.url !== 'string' || obj.url.length === 0) {
      continue
    }
    result.push({
      id: typeof obj.id === 'string' && obj.id
        ? obj.id
        : `wp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      url: obj.url,
      createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
      status: obj.status === 'downloaded' ? 'downloaded' : 'pending'
    })
  }
  return result
}
