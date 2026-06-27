import { defineStore } from 'pinia'
import { ref, computed, onUnmounted } from 'vue'
import type { ProgressInfo } from '../../../preload/index'

export const useProgressStore = defineStore('progress', () => {
  const isProcessing = ref(false)
  const progress = ref<ProgressInfo | null>(null)
  const operationType = ref<string>('')
  const startTime = ref<number>(0)
  const elapsedSeconds = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

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

  function start(type: string): void {
    isProcessing.value = true
    operationType.value = type
    startTime.value = Date.now()
    progress.value = {
      type: 'compress',
      percent: 0,
      currentFile: 0,
      totalFiles: 0,
      speed: '准备中...',
      eta: '计算中...'
    }
    startTimer()
  }

  function update(info: ProgressInfo): void {
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
    cancel
  }
})
