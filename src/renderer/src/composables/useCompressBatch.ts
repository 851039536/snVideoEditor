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

// 批量文件状态跟踪
const fileStatuses = ref<Record<string, BatchFileStatus>>({})

// 压缩结果对比
const compressResult = ref<CompressResultItem[]>([])

const errorMsg = ref('')
let runId = 0

// 当前运行批次的文件快照——进度监听器通过索引映射文件状态
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

  function handleRemoveFile(index: number): void {
    const entry = compressFiles.value[index]
    if (entry) {
      delete fileStatuses.value[entry.path]
    }
    removeFile(index)
  }

  function handleProgress(info: ProgressInfo): void {
    progressStore.update(info)
    // 根据 currentFile 索引在运行快照中定位当前文件，仅在状态变化时写入
    if (info.currentFile > 0 && info.currentFile <= runSnapshot.value.length) {
      const entry = runSnapshot.value[info.currentFile - 1]
      if (fileStatuses.value[entry.path] !== 'processing') {
        fileStatuses.value[entry.path] = 'processing'
      }
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

    // 整体重建状态表：清除过期条目 + 初始化全部为 pending（单次响应式更新）
    const statuses: Record<string, BatchFileStatus> = {}
    for (const entry of compressFiles.value) {
      statuses[entry.path] = 'pending'
    }
    fileStatuses.value = statuses

    // 快照当前文件列表，确保进度索引和结果匹配不受运行中增删影响
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
    // 构建 outputPath → FileEntry 映射，将查找从 O(n) 降为 O(1)
    const outputPathMap = new Map(snapshot.map((f) => [f.outputPath, f]))
    for (const r of results) {
      if (!r) {
        continue
      }
      const original = outputPathMap.get(r.outputPath)
      if (original) {
        let originalSize = original.meta?.size ?? 0
        if (!original.meta) {
          try {
            const info = await window.electronAPI.getFileInfo(original.path)
            originalSize = info.size
          } catch {
            /* 保持 0 */
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
      // 构建 path → FileEntry 映射，将查找从 O(n) 降为 O(1)
      const pathMap = new Map(snapshot.map((f) => [f.path, f]))
      for (const item of result.failed) {
        fileStatuses.value[item.input] = 'failed'
      }
      const failedDetails = result.failed
        .map((item) => {
          const f = pathMap.get(item.input)
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

    // NVENC 驱动不兼容自动回退警告
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

      // 无论组件是否仍挂载，都终结全局进度状态，
      // 确保 ProgressPanel 在用户切走再切回时也能正确显示完成态。
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
      // 失败：释放全局进度状态，记录错误信息
      progressStore.reset()
      errorMsg.value = e instanceof Error ? e.message : String(e)
      // 仅标记本次运行参与的文件，运行中新增的文件不受影响
      for (const entry of snapshot) {
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
