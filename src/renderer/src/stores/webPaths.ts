// 网页路径 store：经 IPC 读写主进程 JSON 文件（userData/web-page-paths.json）
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WebPageEntry, WebPageStatus } from '@/views/Download/types'

export const useWebPathsStore = defineStore('webPaths', () => {
  const entries = ref<WebPageEntry[]>([])
  /** 加载/保存失败时的错误提示（如 JSON 手编损坏） */
  const loadError = ref('')

  /** 从主进程 JSON 文件加载（面板每次挂载时调用，可捡起用户手动编辑的改动） */
  async function init(): Promise<void> {
    try {
      const result = await window.electronAPI.getWebPagePaths()
      entries.value = result.entries
      loadError.value = result.error || ''
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** 整表写回 JSON 文件 */
  async function persist(): Promise<void> {
    try {
      await window.electronAPI.saveWebPagePaths(
        entries.value.map((e) => ({ ...e }))
      )
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** 新增网页路径条目（默认待下载） */
  async function add(url: string): Promise<void> {
    entries.value.push({
      id: `wp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      url,
      createdAt: Date.now(),
      status: 'pending'
    })
    await persist()
  }

  /** 修改条目 URL（地址变化视为未下载，状态重置为 pending） */
  async function update(id: string, url: string): Promise<void> {
    const entry = entries.value.find((e) => e.id === id)
    if (!entry) {
      return
    }
    if (entry.url !== url) {
      entry.url = url
      entry.status = 'pending'
      await persist()
    }
  }

  /** 删除条目 */
  async function remove(id: string): Promise<void> {
    entries.value = entries.value.filter((e) => e.id !== id)
    await persist()
  }

  /** 设置下载状态 */
  async function setStatus(id: string, status: WebPageStatus): Promise<void> {
    const entry = entries.value.find((e) => e.id === id)
    if (entry && entry.status !== status) {
      entry.status = status
      await persist()
    }
  }

  /** 切换下载状态（待下载 ↔ 已下载） */
  async function toggleStatus(id: string): Promise<void> {
    const entry = entries.value.find((e) => e.id === id)
    if (entry) {
      await setStatus(id, entry.status === 'pending' ? 'downloaded' : 'pending')
    }
  }

  /** 备份到用户选择的位置，返回备份文件路径（取消返回 null） */
  async function backup(): Promise<string | null> {
    return window.electronAPI.backupWebPagePaths()
  }

  /** 从备份文件还原（覆盖当前列表），成功返回 true，取消返回 false */
  async function restore(): Promise<boolean> {
    const restored = await window.electronAPI.restoreWebPagePaths()
    if (restored === null) {
      return false
    }
    entries.value = restored
    loadError.value = ''
    return true
  }

  return {
    entries,
    loadError,
    init,
    add,
    update,
    remove,
    setStatus,
    toggleStatus,
    backup,
    restore
  }
})
