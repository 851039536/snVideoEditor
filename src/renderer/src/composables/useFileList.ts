// 文件列表管理：添加文件、获取元数据、移除与输出目录设置
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { FileEntry } from '@/types/file'
import { useSettingsStore } from '@/stores/settings'

export function useFileList(defaultSuffix?: string, externalFiles?: Ref<FileEntry[]>): {
  files: Ref<FileEntry[]>
  addFiles: (paths: string[]) => Promise<void>
  removeFile: (index: number) => void
  selectOutputDir: (suffix: string) => Promise<void>
  setOutputDir: (dir: string | null, suffix: string) => void
} {
  // 支持传入外部（模块级/store 级）列表，使文件列表跨页面切换持久
  const files = externalFiles ?? ref<FileEntry[]>([])
  const settingsStore = useSettingsStore()

  function makeOutputPath(inputPath: string, dir: string, suffix: string): string {
    const name = inputPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'output'
    return `${dir.replace(/\\/g, '/').replace(/\/$/, '')}/${name}${suffix}`
  }

  async function addFiles(paths: string[]): Promise<void> {
    const storedDir = defaultSuffix ? settingsStore.outputDirectory : ''
    for (const p of paths) {
      if (files.value.some((f) => f.path === p)) { continue }
      const entry: FileEntry = {
        path: p,
        outputPath: storedDir && defaultSuffix ? makeOutputPath(p, storedDir, defaultSuffix) : '',
        meta: null
      }
      files.value.push(entry)
      getMeta(entry)
    }
  }

  async function getMeta(entry: FileEntry): Promise<void> {
    try {
      entry.meta = await window.electronAPI.getVideoMeta(entry.path)
    } catch (e) {
      console.error('Failed to get meta:', e)
    }
  }

  function removeFile(index: number): void {
    files.value.splice(index, 1)
  }

  async function selectOutputDir(suffix: string): Promise<void> {
    const dir = await window.electronAPI.selectDirectory()
    setOutputDir(dir, suffix)
  }

  function setOutputDir(dir: string | null, suffix: string): void {
    if (!dir) { return }
    settingsStore.setOutputDirectory(dir)
    for (const entry of files.value) {
      entry.outputPath = makeOutputPath(entry.path, dir, suffix)
    }
  }

  return { files, addFiles, removeFile, selectOutputDir, setOutputDir }
}
