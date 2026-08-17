// 分割合并共享逻辑：片段列表 CRUD、裁切与合并流程，供视频/音频两视图参数化复用
import { ref, computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { useProgressStore } from '@/stores/progress'
import type { ClipItem } from '@/types/file'
import { secondsToTimecode } from '@/utils/time'
import { getFileName, todayDateStr } from '@/utils/format'
import { swapArrayElements } from '@/utils/math'

export interface UseSplitMergeOptions {
  /** 源文件列表（视图持有，裁切与合并直接读写） */
  files: Ref<string[]>
  /** 输出目录（视图持有） */
  outputDir: Ref<string>
  /** 错误信息（视图持有，统一展示） */
  errorMsg: Ref<string>
  /** 视频/音频总时长（秒） */
  duration: Ref<number>
  /** 裁剪起点（秒） */
  trimStartSec: Ref<number>
  /** 裁剪终点（秒） */
  trimEndSec: Ref<number>
  /** 裁剪区间时长（秒，来自 useTrimTimeline） */
  trimDuration: Ref<number>
  /** 媒体元素跳转回调（屏蔽视频/音频玩家差异） */
  seekTo: (t: number) => void
  /** 裁切前暂停媒体元素（避免裁切期间持续解码） */
  pausePlayer: () => void
  /** 错误文案名词（视频 / 音频） */
  mediaNoun: string
  /** 临时片段 id 前缀（clip_ / audio_clip_） */
  clipIdPrefix: string
  /** 无片段时合并输出名前缀（SN_ / SN_audio_） */
  mergeFallbackPrefix: string
  /** 返回输出扩展名（带点，如 .mp4 或音频源扩展名） */
  getOutputExt: () => string
  /** 返回保存对话框扩展名（不带点，如 mp4） */
  getSaveExt: () => string
  /** 未选择输出目录时的提示文案（视频「请选择输出目录」/ 音频「请选择输出路径」） */
  outputDirPrompt: string
  /** 裁切成功后的回调（视频用于自动播放预览，音频不传） */
  onAfterCut?: () => void
}

export function useSplitMerge(opts: UseSplitMergeOptions): {
  clips: Ref<ClipItem[]>
  cuttingInProgress: Ref<boolean>
  selectedClipCount: ComputedRef<number>
  canMerge: ComputedRef<boolean>
  cutToClipList: () => Promise<void>
  removeClip: (index: number) => void
  toggleClipSelection: (index: number) => void
  moveClip: (index: number, direction: -1 | 1) => void
  cleanupClipFiles: () => void
  getMergeOutputName: () => string
  selectOutputPath: () => Promise<void>
  startProcess: () => Promise<void>
} {
  const {
    files, outputDir, errorMsg, duration, trimStartSec, trimEndSec, trimDuration,
    seekTo, pausePlayer, mediaNoun, clipIdPrefix, mergeFallbackPrefix,
    getOutputExt, getSaveExt, outputDirPrompt, onAfterCut
  } = opts

  const store = useProgressStore()

  const clips = ref<ClipItem[]>([])
  const cuttingInProgress = ref(false)
  let clipIdCounter = 0

  const selectedClipCount = computed((): number => {
    return clips.value.filter((c) => c.selected).length
  })

  const canMerge = computed((): boolean => {
    return selectedClipCount.value + files.value.length >= 2
  })

  // ---- 片段列表管理 ----

  /** 删除单个片段（含清理临时文件） */
  function removeClip(index: number): void {
    const clip = clips.value[index]
    if (clip) {
      window.electronAPI.deleteFile(clip.outputFile).catch(() => {
        console.warn('删除临时片段文件失败:', clip.outputFile)
      })
    }
    clips.value.splice(index, 1)
  }

  /** 切换片段选中状态 */
  function toggleClipSelection(index: number): void {
    const clip = clips.value[index]
    if (clip) {
      clip.selected = !clip.selected
    }
  }

  /** 移动片段排序位置 */
  function moveClip(index: number, direction: -1 | 1): void {
    swapArrayElements(clips.value, index, direction)
  }

  /** 清理所有片段的临时文件（切换文件/卸载时复用） */
  function cleanupClipFiles(): void {
    for (const c of clips.value) {
      window.electronAPI.deleteFile(c.outputFile).catch(() => {})
    }
  }

  // ---- 裁切流程 ----

  /** 将当前裁剪区间裁切为片段并加入列表 */
  async function cutToClipList(): Promise<void> {
    if (files.value.length === 0) {
      errorMsg.value = `请先添加${mediaNoun}文件`
      return
    }
    if (trimDuration.value <= 0) {
      errorMsg.value = '请选择有效的片段范围'
      return
    }

    errorMsg.value = ''
    cuttingInProgress.value = true
    pausePlayer()

    let outputFile = ''
    try {
      const tempDir = await window.electronAPI.getTempDir()
      clipIdCounter++
      const clipId = `${clipIdPrefix}${Date.now()}_${clipIdCounter}`
      outputFile = `${tempDir}/${clipId}${getOutputExt()}`

      const success = await window.electronAPI.splitVideo({
        input: files.value[0],
        output: outputFile,
        startTime: secondsToTimecode(trimStartSec.value),
        duration: secondsToTimecode(trimDuration.value)
      })

      if (success) {
        clips.value.push({
          id: clipId,
          sourceFile: files.value[0],
          sourceFileName: getFileName(files.value[0]),
          startSec: trimStartSec.value,
          endSec: trimEndSec.value,
          duration: trimDuration.value,
          outputFile,
          selected: true
        })
        // 前手柄重置到本次裁剪结束位置，后手柄重置到末尾，便于连续裁剪
        const clipEnd = trimEndSec.value
        trimStartSec.value = Math.min(clipEnd, Math.max(0, duration.value - 0.1))
        trimEndSec.value = duration.value
        seekTo(trimStartSec.value)
        onAfterCut?.()
      } else {
        // 裁剪取消：清理可能已部分写入的临时片段文件
        window.electronAPI.deleteFile(outputFile).catch(() => {})
      }
    } catch (e) {
      errorMsg.value = `裁切失败: ${e instanceof Error ? e.message : String(e)}`
      // 裁剪失败：清理临时片段文件（outputFile 可能为空，如 getTempDir 抛错）
      if (outputFile) {
        window.electronAPI.deleteFile(outputFile).catch(() => {})
      }
    } finally {
      cuttingInProgress.value = false
    }
  }

  // ---- 输出与合并 ----

  /** 生成合并输出文件名（优先片段原视频名，否则使用前缀 + 日期） */
  function getMergeOutputName(): string {
    const dateStr = todayDateStr()
    if (clips.value.length > 0) {
      const baseName = clips.value[0].sourceFileName.replace(/\.[^.]+$/, '')
      return `${baseName}_${dateStr}${getOutputExt()}`
    }
    return `${mergeFallbackPrefix}${dateStr}${getOutputExt()}`
  }

  /** 选择输出路径（合并模式统一使用合并输出命名） */
  async function selectOutputPath(): Promise<void> {
    const dir = await window.electronAPI.selectSavePath(getMergeOutputName(), getSaveExt())
    if (dir) {
      outputDir.value = dir
    }
  }

  /** 启动合并处理 */
  async function startProcess(): Promise<void> {
    errorMsg.value = ''
    if (!outputDir.value) {
      await selectOutputPath()
      if (!outputDir.value) {
        errorMsg.value = outputDirPrompt
        return
      }
    }

    const selectedClipFiles = clips.value
      .filter((c) => c.selected)
      .map((c) => c.outputFile)
    const allInputs = [...selectedClipFiles, ...files.value]

    if (allInputs.length < 2) {
      errorMsg.value = '至少需要 2 个文件才能合并'
      return
    }

    store.start('merge')

    try {
      const result = await window.electronAPI.mergeVideos({
        inputs: allInputs,
        output: outputDir.value
      })
      if (result) {
        // 合并成功后清理选中的片段临时文件
        const deleteResults = await Promise.allSettled(
          clips.value.filter((c) => c.selected).map((c) => window.electronAPI.deleteFile(c.outputFile))
        )
        const failedCount = deleteResults.filter((r) => r.status === 'rejected').length
        if (failedCount > 0) {
          console.warn(`合并后清理临时文件失败: ${failedCount} 个`)
        }
        clips.value = clips.value.filter((c) => !c.selected)
        store.finish()
      } else {
        store.reset()
      }
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : String(e)
      store.reset()
    }
  }

  return {
    clips,
    cuttingInProgress,
    selectedClipCount,
    canMerge,
    cutToClipList,
    removeClip,
    toggleClipSelection,
    moveClip,
    cleanupClipFiles,
    getMergeOutputName,
    selectOutputPath,
    startProcess
  }
}
