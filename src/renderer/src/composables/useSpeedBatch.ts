// 批量变速状态管理与执行：片段列表、增删改查与批量/单段执行（模块级状态跨页面持久）
import { ref, computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { useProgressStore } from '@/stores/progress'
import type { SpeedSegment } from '@/types/file'

// ─── 模块级持久状态：切换页面再返回时，待变速片段列表仍然可见 ────────

/** 待变速片段列表（按 startSec 排序） */
export const speedSegments = ref<SpeedSegment[]>([])

const errorMsg = ref('')
let runId = 0
let segmentIdCounter = 0

/** 生成片段 id：时间戳 + 自增计数器，避免刷新间隔内重复 */
function createSegmentId(): string {
  segmentIdCounter++
  return `speed_${Date.now()}_${segmentIdCounter}`
}

export function useSpeedBatch(): {
  speedSegments: Ref<SpeedSegment[]>
  errorMsg: Ref<string>
  canBatch: ComputedRef<boolean>
  addSegment: (trimStart: number, trimEnd: number, speed: number) => void
  removeSegment: (id: string) => void
  updateSegmentSpeed: (id: string, speed: number) => void
  clearSegments: () => void
  startBatchSpeed: (input: string, outputDir: string, sourceDuration: number, sourceCodec: string) => Promise<void>
  startSingle: (input: string, output: string, startTime: number, duration: number, speed: number) => Promise<void>
} {
  const progressStore = useProgressStore()

  const canBatch = computed((): boolean => {
    return speedSegments.value.length > 0 && !progressStore.isProcessing
  })

  /** 添加变速段，插入后按 startSec 排序 */
  function addSegment(trimStart: number, trimEnd: number, speed: number): void {
    const duration = trimEnd - trimStart
    if (duration <= 0) {
      errorMsg.value = '请选择有效的片段范围'
      return
    }
    speedSegments.value.push({
      id: createSegmentId(),
      startSec: trimStart,
      endSec: trimEnd,
      duration,
      speed
    })
    speedSegments.value.sort((a, b) => a.startSec - b.startSec)
  }

  function removeSegment(id: string): void {
    speedSegments.value = speedSegments.value.filter((s) => s.id !== id)
  }

  function updateSegmentSpeed(id: string, speed: number): void {
    const seg = speedSegments.value.find((s) => s.id === id)
    if (seg) {
      seg.speed = speed
    }
  }

  function clearSegments(): void {
    speedSegments.value = []
  }

  /** 批量变速并合并回完整视频 */
  async function startBatchSpeed(input: string, outputDir: string, sourceDuration: number, sourceCodec: string): Promise<void> {
    errorMsg.value = ''
    const thisRunId = ++runId
    progressStore.start('speed')
    try {
      // 映射为纯对象数组，避免 Vue reactive proxy 无法被 Electron IPC 序列化
      const segmentsPayload = speedSegments.value.map((s) => ({
        id: s.id,
        startSec: s.startSec,
        endSec: s.endSec,
        duration: s.duration,
        speed: s.speed
      }))
      const result = await window.electronAPI.batchSpeedMerge({
        input,
        output: outputDir,
        segments: segmentsPayload,
        sourceDuration,
        sourceCodec
      })
      if (thisRunId !== runId) {
        return
      }
      if (result) {
        progressStore.finish()
        clearSegments()
      } else {
        progressStore.reset()
        errorMsg.value = '批量变速已取消或失败'
      }
    } catch (e) {
      if (thisRunId !== runId) {
        return
      }
      progressStore.reset()
      errorMsg.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** 单段快捷变速：直接走 changeSpeed（speed=1 时流拷贝快路径，不重编码） */
  async function startSingle(input: string, output: string, startTime: number, duration: number, speed: number): Promise<void> {
    errorMsg.value = ''
    const thisRunId = ++runId
    progressStore.start('speed')
    try {
      const result = await window.electronAPI.changeSpeed({
        input,
        output,
        startTime,
        duration,
        speed
      })
      if (thisRunId !== runId) {
        return
      }
      if (result) {
        progressStore.finish()
      } else {
        progressStore.reset()
      }
    } catch (e) {
      if (thisRunId !== runId) {
        return
      }
      progressStore.reset()
      errorMsg.value = e instanceof Error ? e.message : String(e)
    }
  }

  return {
    speedSegments,
    errorMsg,
    canBatch,
    addSegment,
    removeSegment,
    updateSegmentSpeed,
    clearSegments,
    startBatchSpeed,
    startSingle
  }
}
