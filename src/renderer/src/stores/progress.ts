import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProgressInfo } from '../../../preload/index'

type OperationType = ProgressInfo['type']

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

export const useProgressStore = defineStore('progress', () => {
  const isProcessing = ref(false)
  const progress = ref<ProgressInfo | null>(null)
  const operationType = ref<string>('')
  const startTime = ref<number>(0)
  const elapsedSeconds = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  // ─── Download queue state ──────────────────────────────────────────────────
  const queueItems = ref<QueueItem[]>([])
  const queueActiveIds = ref<string[]>([])
  const queueIsProcessing = ref(false)
  const queueConcurrency = ref(2)

  function updateQueueItems(items: QueueItem[]): void {
    queueItems.value = items
  }

  function updateQueueItemProgress(
    id: string,
    data: { percent: number; speed: string; eta: string }
  ): void {
    const item = queueItems.value.find((i) => i.id === id)
    if (item) {
      item.progress = data
    }
  }

  function queueHasPending(): boolean {
    return queueItems.value.some((i) => i.status === 'pending')
  }

  // ─── Timer ─────────────────────────────────────────────────────────────────

  const elapsed = computed((): string => {
    if (elapsedSeconds.value === 0) {
      return '00:00'
    }
    const m = Math.floor(elapsedSeconds.value / 60)
    const s = elapsedSeconds.value % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  })

  const percent = computed((): number => {
    return progress.value?.percent || 0
  })

  const currentFile = computed((): number => {
    return progress.value?.currentFile || 0
  })

  const totalFiles = computed((): number => {
    return progress.value?.totalFiles || 0
  })

  function startTimer(): void {
    stopTimer()
    elapsedSeconds.value = 0
    timer = setInterval(() => {
      elapsedSeconds.value++
    }, 1000)
  }

  function stopTimer(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function start(type: OperationType): void {
    isProcessing.value = true
    operationType.value = type
    startTime.value = Date.now()
    progress.value = {
      type: type,
      percent: 0,
      currentFile: 0,
      totalFiles: 0,
      speed: '准备中...',
      eta: '计算中...'
    }
    startTimer()
  }

  function update(info: ProgressInfo): void {
    if (!isProcessing.value) { return }
    progress.value = info
  }

  function finish(): void {
    if (progress.value) {
      progress.value.percent = 100
      progress.value.speed = '完成'
      progress.value.eta = '0s'
    }
    isProcessing.value = false
    stopTimer()
  }

  function reset(): void {
    isProcessing.value = false
    progress.value = null
    operationType.value = ''
    startTime.value = 0
    stopTimer()
  }

  function cancel(): void {
    window.electronAPI.cancelOperation()
    reset()
  }

  return {
    isProcessing,
    progress,
    operationType,
    startTime,
    elapsed,
    percent,
    currentFile,
    totalFiles,
    start,
    update,
    finish,
    reset,
    cancel,
    // Queue
    queueItems,
    queueActiveIds,
    queueIsProcessing,
    queueConcurrency,
    updateQueueItems,
    updateQueueItemProgress,
    queueHasPending
  }
})
