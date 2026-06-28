import { ref } from 'vue'
import type { FileEntry } from '@/types/file'

export function useFileList() {
  const files = ref<FileEntry[]>([])

  async function addFiles(paths: string[]): Promise<void> {
    for (const p of paths) {
      if (files.value.some((f) => f.path === p)) { continue }
      const entry: FileEntry = { path: p, outputPath: '', meta: null }
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
    for (const entry of files.value) {
      const name = entry.path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'output'
      entry.outputPath = `${dir.replace(/\\/g, '/').replace(/\/$/, '')}/${name}${suffix}`
    }
  }

  return { files, addFiles, removeFile, selectOutputDir, setOutputDir }
}
