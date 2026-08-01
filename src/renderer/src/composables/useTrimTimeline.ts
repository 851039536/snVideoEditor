// 时间轴裁剪 UI 状态与拖拽/微调交互
import { ref, computed, watch } from 'vue'
import type { Ref } from 'vue'
import { secondsToHMS, hmsToSeconds } from '@/utils/time'
import { clamp } from '@/utils/math'

export interface UseTrimTimelineOptions {
  /** Total duration of the video in seconds. */
  duration: Ref<number>
  /** Trim start time in seconds. */
  trimStart: Ref<number>
  /** Trim end time in seconds. */
  trimEnd: Ref<number>
  /** Seek the video player to a given time. */
  seekTo: (t: number) => void
  /** Minimum gap between start and end handles (default 0.1s). */
  minGap?: number
  /** 当前播放时间（精细拖动定位基准） */
  currentTime?: Ref<number>
  /** 拖动时间轴时用于暂停播放的 video 元素 */
  videoPlayer?: Ref<HTMLVideoElement | null>
  /** 拖动时间轴暂停播放后的回调（同步 isPlaying 等 UI 状态） */
  onScrubPause?: () => void
}

export function useTrimTimeline(opts: UseTrimTimelineOptions): {
  timelineRef: Ref<HTMLDivElement | null>
  dragging: Ref<'start' | 'end' | null>
  startHour: Ref<string>
  startMin: Ref<string>
  startSec: Ref<string>
  endHour: Ref<string>
  endMin: Ref<string>
  endSec: Ref<string>
  startPercent: Ref<number>
  endPercent: Ref<number>
  playheadPercent: (currentTime: Ref<number>) => Ref<number>
  getTimelineTime: (clientX: number) => number
  startHandleDrag: (handle: 'start' | 'end', e: PointerEvent) => void
  trimDuration: Ref<number>
  trimDurationStr: Ref<string>
  /** 拖动时间轴时是否暂停播放（持久化到 localStorage） */
  pauseOnScrub: Ref<boolean>
  /** 是否正在拖拽播放头（scrub） */
  scrubbing: Ref<boolean>
  /** 时间轴点击/拖拽播放头 */
  startScrub: (e: PointerEvent) => void
  /** 手柄滚轮微调 */
  onHandleWheel: (handle: 'start' | 'end', e: WheelEvent) => void
  /** 全局 pointermove（需视图注册 document 监听） */
  onGlobalPointerMove: (e: PointerEvent) => void
  /** 全局 pointerup（需视图注册 document 监听） */
  onGlobalPointerUp: (e: PointerEvent) => void
} {
  const { duration, trimStart, trimEnd, seekTo } = opts
  const minGap = opts.minGap ?? 0.1
  const currentTime = opts.currentTime
  const videoPlayer = opts.videoPlayer
  const onScrubPause = opts.onScrubPause

  const timelineRef = ref<HTMLDivElement | null>(null)
  const dragging = ref<'start' | 'end' | null>(null)

  // ---- HH:MM:SS computed fields ----

  function hmsFieldSetter(field: 'start' | 'end', h: string, m: string, s: string): void {
    const total = hmsToSeconds(h, m, s)
    if (isNaN(total)) { return }
    if (field === 'start') {
      trimStart.value = clamp(total, 0, trimEnd.value - minGap)
      seekTo(trimStart.value)
    } else {
      const max = duration.value || 99999
      trimEnd.value = clamp(total, trimStart.value + minGap, max)
      seekTo(trimEnd.value)
    }
  }

  const startParts = computed((): string[] => secondsToHMS(trimStart.value).split(':'))
  const endParts = computed((): string[] => secondsToHMS(trimEnd.value).split(':'))

  const startHour = computed({
    get: () => startParts.value[0],
    set: (v: string) => hmsFieldSetter('start', v, startMin.value, startSec.value)
  })
  const startMin = computed({
    get: () => startParts.value[1],
    set: (v: string) => hmsFieldSetter('start', startHour.value, v, startSec.value)
  })
  const startSec = computed({
    get: () => startParts.value[2],
    set: (v: string) => hmsFieldSetter('start', startHour.value, startMin.value, v)
  })
  const endHour = computed({
    get: () => endParts.value[0],
    set: (v: string) => hmsFieldSetter('end', v, endMin.value, endSec.value)
  })
  const endMin = computed({
    get: () => endParts.value[1],
    set: (v: string) => hmsFieldSetter('end', endHour.value, v, endSec.value)
  })
  const endSec = computed({
    get: () => endParts.value[2],
    set: (v: string) => hmsFieldSetter('end', endHour.value, endMin.value, v)
  })

  // ---- Timeline percentages ----

  const startPercent = computed((): number => {
    if (duration.value <= 0) { return 0 }
    return (trimStart.value / duration.value) * 100
  })

  const endPercent = computed((): number => {
    if (duration.value <= 0) { return 100 }
    return (trimEnd.value / duration.value) * 100
  })

  function playheadPercent(currentTime: Ref<number>): Ref<number> {
    return computed((): number => {
      if (duration.value <= 0) { return 0 }
      return (currentTime.value / duration.value) * 100
    })
  }

  // ---- Trim duration ----

  const trimDuration = computed((): number => {
    return Math.max(0, trimEnd.value - trimStart.value)
  })

  const trimDurationStr = computed((): string => {
    return secondsToHMS(trimDuration.value)
  })

  // ---- 时间轴交互辅助 ----

  function getTimelineTime(clientX: number): number {
    const el = timelineRef.value
    if (!el || duration.value <= 0) { return 0 }
    const rect = el.getBoundingClientRect()
    const pct = clamp((clientX - rect.left) / rect.width, 0, 1)
    return pct * duration.value
  }

  function startHandleDrag(handle: 'start' | 'end', e: PointerEvent): void {
    dragging.value = handle
    lastDragClientX.value = e.clientX
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    e.preventDefault()
    e.stopPropagation()
  }

  // ---- 时间轴拖拽/微调交互（跨视图共享） ----

  // 精细微调：按住 Shift 时的绝对分辨率（秒/像素）
  const FINE_SECONDS_PER_PX = 0.1
  // 长视频分辨率上限：即使超长视频也不粗于该值（秒/像素）
  const MAX_SECONDS_PER_PX = 2

  const scrubbing = ref(false)
  const lastDragClientX = ref(0)

  // 拖动时间轴时是否暂停播放（持久化到 localStorage）
  const SCRUB_PAUSE_KEY = 'snve-scrub-pause'
  function loadScrubPause(): boolean {
    try {
      const saved = localStorage.getItem(SCRUB_PAUSE_KEY)
      if (saved !== null) { return saved !== 'false' }
    } catch { /* ignore */ }
    return true
  }
  const pauseOnScrub = ref<boolean>(loadScrubPause())
  watch(pauseOnScrub, (val) => {
    try { localStorage.setItem(SCRUB_PAUSE_KEY, String(val)) } catch { /* ignore */ }
  })

  // 手柄滚轮微调：每格 ±0.1s，按住 Shift ±0.02s
  function onHandleWheel(handle: 'start' | 'end', e: WheelEvent): void {
    const step = e.shiftKey ? 0.02 : 0.1
    const delta = e.deltaY > 0 ? step : -step

    if (handle === 'start') {
      trimStart.value = clamp(trimStart.value + delta, 0, trimEnd.value - minGap)
      seekTo(trimStart.value)
    } else {
      trimEnd.value = clamp(trimEnd.value + delta, trimStart.value + minGap, duration.value)
      seekTo(trimEnd.value)
    }
  }

  function startScrub(e: PointerEvent): void {
    if (duration.value <= 0) { return }
    scrubbing.value = true
    lastDragClientX.value = e.clientX
    const el = timelineRef.value
    if (el) { el.setPointerCapture(e.pointerId) }
    // 拖动时间轴时暂停播放（除非用户关闭了该选项）
    if (pauseOnScrub.value) {
      videoPlayer?.value?.pause()
      onScrubPause?.()
    }
    // 立即跳转到点击位置
    seekTo(getTimelineTime(e.clientX))
  }

  // 全局 pointermove/pointerup：配合 setPointerCapture 实现顺滑拖拽
  function onGlobalPointerMove(e: PointerEvent): void {
    if (scrubbing.value) {
      if (e.shiftKey) {
        // 精细模式：绝对 0.1s/像素，与视频时长无关
        if (duration.value <= 0) { return }
        const delta = (e.clientX - lastDragClientX.value) * FINE_SECONDS_PER_PX
        lastDragClientX.value = e.clientX
        seekTo(clamp((currentTime?.value ?? 0) + delta, 0, duration.value))
      } else {
        // 普通模式：绝对定位，播放头跟随鼠标
        seekTo(getTimelineTime(e.clientX))
      }
      return
    }

    if (!dragging.value) { return }

    const el = timelineRef.value
    if (!el || duration.value <= 0) { return }

    const rect = el.getBoundingClientRect()
    const nativeRes = duration.value / rect.width // 绝对模式下的秒/像素
    let rawT: number // 未钳制目标时间，随后统一钳制
    let updateLastX = false

    if (e.shiftKey) {
      // Shift + 拖拽：绝对精细分辨率，与视频时长无关
      const base = dragging.value === 'start' ? trimStart.value : trimEnd.value
      rawT = base + (e.clientX - lastDragClientX.value) * FINE_SECONDS_PER_PX
      updateLastX = true
    } else if (nativeRes > MAX_SECONDS_PER_PX) {
      // 长视频：增量模式，上限 MAX_SECONDS_PER_PX 保证顺滑控制
      const base = dragging.value === 'start' ? trimStart.value : trimEnd.value
      rawT = base + (e.clientX - lastDragClientX.value) * MAX_SECONDS_PER_PX
      updateLastX = true
    } else {
      // 短视频：绝对定位映射已足够精确
      rawT = getTimelineTime(e.clientX)
    }

    if (updateLastX) { lastDragClientX.value = e.clientX }

    // ---- 统一应用：钳制 + 赋值 + 同步 + 跳转 ----
    if (dragging.value === 'start') {
      const clamped = clamp(rawT, 0, trimEnd.value - minGap)
      if (trimStart.value !== clamped) {
        trimStart.value = clamped
        seekTo(clamped)
      }
    } else {
      const clamped = clamp(rawT, trimStart.value + minGap, duration.value)
      if (trimEnd.value !== clamped) {
        trimEnd.value = clamped
        seekTo(clamped)
      }
    }
  }

  function onGlobalPointerUp(e: PointerEvent): void {
    if (scrubbing.value) {
      scrubbing.value = false
      return
    }

    if (!dragging.value) { return }
    (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId)
    dragging.value = null
  }

  return {
    timelineRef,
    dragging,
    startHour,
    startMin,
    startSec,
    endHour,
    endMin,
    endSec,
    startPercent,
    endPercent,
    playheadPercent,
    getTimelineTime,
    startHandleDrag,
    trimDuration,
    trimDurationStr,
    pauseOnScrub,
    scrubbing,
    startScrub,
    onHandleWheel,
    onGlobalPointerMove,
    onGlobalPointerUp
  }
}
