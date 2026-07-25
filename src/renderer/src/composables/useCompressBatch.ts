// 批量压缩执行流程：文件状态跟踪、进度映射与结果汇总（模块级状态跨页面持久）
import { ref, computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { useProgressStore } from '@/stores/progress'
import { getFileName } from '@/utils/format'
import type { FileEntry } from '@/types/file'
import type { CompressPreset } from '@/stores/settings'
import type { CompressResultItem, BatchFileStatus } from '@/views/Compress/types'
import type { ProgressInfo } from '../../../preload/index'

/** batchCompress IPC 返回结构 */
interface BatchResult {
  success: number
  successFiles: string[]
  failed: { input: string; error: string }[]
  fallbacks: { input: string; originalCodec: string; fallbackCodec: string }[]
}

// ─── 模块级持久状态：切换页面再返回时，压缩文件列表/状态/结果仍然可见 ────────
// 运行中的 startCompress 闭包写入的也是这份状态，完成结果不会因组件卸载而丢失。

/** Compress 页面的文件列表（传给 useFileList 作为外部持久列表） */
export const compressFiles = ref<FileEntry[]>([])

// Batch file status tracking
const fileStatuses = ref<Record<string, BatchFileStatus>>({})

// Compression result comparison
const compressResult = ref<CompressResultItem[]>([])

const errorMsg = ref('')
let runId = 0

// Snapshot of the file list for the active run — read by the progress listener
// to map the current file index to a file status.
const runSnapshot = ref<FileEntry[]>([])

export function useCompressBatch(opts: {
  removeFile: (index: number) => void
  params: CompressPreset
}): {
  fileStatuses: Ref<Record<string, BatchFileStatus>>
  compressResult: Ref<CompressResultItem[]>
  errorMsg: Ref<string>
  allOutputsResolved: ComputedRef<boolean>
  canStart: ComputedRef<boolean>
  handleProgress: (info: ProgressInfo) => void
  handleRemoveFile: (index: number) => void
  startCompress: () => Promise<void>
} {
  const { removeFile, params } = opts
  const progressStore = useProgressStore()

  const allOutputsResolved = computed((): boolean => compressFiles.value.every((f) => !!f.outputPath))

  const canStart = computed((): boolean => {
    return compressFiles.value.length > 0 && allOutputsResolved.value && !progressStore.isProcessing
  })

  function pruneFileStatuses(): void {
    const currentPaths = new Set(compressFiles.value.map((f) => f.path))
    for (const key of Object.keys(fileStatuses.value)) {
      if (!currentPaths.has(key)) {
        delete fileStatuses.value[key]
      }
    }
  }

  function handleRemoveFile(index: number): void {
    const entry = compressFiles.value[index]
    if (entry) {
      delete fileStatuses.value[entry.path]
    }
    removeFile(index)
  }

  function handleProgress(info: ProgressInfo): void {
    progressStore.update(info)
    // Update file status using currentFile index against the run snapshot
    if (info.currentFile > 0 && info.currentFile <= runSnapshot.value.length) {
      const entry = runSnapshot.value[info.currentFile - 1]
      fileStatuses.value[entry.path] = 'processing'
    }
  }

  /** 开始前校验并建立本次运行的文件快照，校验失败返回 null */
  function prepareRun(): FileEntry[] | null {
    if (compressFiles.value.length === 0) {
      return null
    }

    const unresolved = compressFiles.value.filter((f) => !f.outputPath)
    if (unresolved.length > 0) {
      errorMsg.value = '请为所有文件选择输出目录'
      return null
    }

    // Set all files to pending and prune stale entries
    pruneFileStatuses()
    for (const entry of compressFiles.value) {
      fileStatuses.value[entry.path] = 'pending'
    }

    // Snapshot the file list so progress indices and result matching stay
    // consistent even if the list changes (add/remove) during compression.
    const snapshot = compressFiles.value.slice()
    runSnapshot.value = snapshot
    return snapshot
  }

  function buildBatchPayload(snapshot: FileEntry[]): {
    input: string
    output: string
    crf: number
    resolution: string
    bitrate: string
    codec: string
    audioBitrate: string
    preset: string
    nvencPreset: string
    twoPass: boolean
  }[] {
    return snapshot.map((f) => ({
      input: f.path,
      output: f.outputPath,
      crf: params.crfValue,
      resolution: params.resolution,
      bitrate: params.bitrate,
      codec: params.codec,
      audioBitrate: params.audioBitrate,
      preset: params.preset,
      nvencPreset: params.nvencPreset,
      twoPass: params.twoPass
    }))
  }

  /** 汇总成功文件的压缩前后体积对比；返回 false 表示结果已过期应中止 */
  async function applySuccesses(result: BatchResult, snapshot: FileEntry[], currentRunId: number): Promise<boolean> {
    if (result.successFiles.length === 0) {
      return true
    }
    const results = await Promise.all(
      result.successFiles.map(async (outputPath) => {
        try {
          const fileInfo = await window.electronAPI.getFileInfo(outputPath)
          return { outputPath, fileInfo }
        } catch {
          return null
        }
      })
    )
    if (currentRunId !== runId) {
      return false
    }
    for (const r of results) {
      if (!r) {
        continue
      }
      const original = snapshot.find((f) => f.outputPath === r.outputPath)
      if (original) {
        let originalSize = original.meta?.size ?? 0
        if (!original.meta) {
          try {
            const info = await window.electronAPI.getFileInfo(original.path)
            originalSize = info.size
          } catch {
            /* keep 0 */
          }
        }
        compressResult.value.push({
          fileName: getFileName(r.outputPath),
          originalSize,
          compressedSize: r.fileInfo.size
        })
        fileStatuses.value[original.path] = 'completed'
      }
    }
    return true
  }

  /** 标记失败文件并拼装失败/回退提示信息 */
  function applyFailures(result: BatchResult, snapshot: FileEntry[]): void {
    if (result.failed.length > 0) {
      for (const item of result.failed) {
        fileStatuses.value[item.input] = 'failed'
      }
      const failedDetails = result.failed
        .map((item) => {
          const f = snapshot.find((x) => x.path === item.input)
          const name = f ? getFileName(f.path) : item.input
          return `${name}: ${item.error.slice(0, 500)}`
        })
        .join('\n')
      if (result.successFiles.length > 0) {
        errorMsg.value = `部分完成：${result.successFiles.length} 个成功，${result.failed.length} 个失败:\n${failedDetails}`
      } else {
        errorMsg.value = `${result.failed.length} 个文件压缩失败:\n${failedDetails}`
      }
    }

    // NVENC driver-incompatible fallback warning
    if (result.fallbacks && result.fallbacks.length > 0) {
      const fallbackNames = result.fallbacks.map((fb) => getFileName(fb.input)).join('、')
      errorMsg.value =
        (errorMsg.value ? errorMsg.value + '\n' : '') +
        `⚠️ ${result.fallbacks.length} 个文件因 GPU 驱动不兼容已自动回退 CPU 编码: ${fallbackNames}`
    }
  }

  async function startCompress(): Promise<void> {
    errorMsg.value = ''
    compressResult.value = []

    const snapshot = prepareRun()
    if (!snapshot) {
      return
    }

    progressStore.start('compress')

    try {
      const currentRunId = ++runId
      const result = await window.electronAPI.batchCompress({ files: buildBatchPayload(snapshot) })
      if (currentRunId !== runId) {
        return
      }

      // Finalize the global progress store regardless of mount state, so the
      // ProgressPanel reflects completion even if the user navigated away and
      // came back (or is on another page).
      const allFailed = result.failed.length > 0 && result.successFiles.length === 0
      if (allFailed) {
        progressStore.reset()
      } else {
        progressStore.finish()
      }

      // 以下更新写入模块级持久状态：即使组件已卸载也照常执行，
      // 用户切回页面时能看到完整的状态与结果。
      const fresh = await applySuccesses(result, snapshot, currentRunId)
      if (!fresh) {
        return
      }
      applyFailures(result, snapshot)
    } catch (e) {
      // Failure: release the global progress state, then record the error.
      progressStore.reset()
      errorMsg.value = e instanceof Error ? e.message : String(e)
      for (const entry of compressFiles.value) {
        if (fileStatuses.value[entry.path] === 'pending') {
          fileStatuses.value[entry.path] = 'failed'
        }
      }
    }
  }

  return {
    fileStatuses,
    compressResult,
    errorMsg,
    allOutputsResolved,
    canStart,
    handleProgress,
    handleRemoveFile,
    startCompress
  }
}
