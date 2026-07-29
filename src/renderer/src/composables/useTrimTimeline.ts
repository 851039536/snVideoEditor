import { ref, computed } from 'vue'
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
} {
  const { duration, trimStart, trimEnd, seekTo } = opts
  const minGap = opts.minGap ?? 0.1

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
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    e.preventDefault()
    e.stopPropagation()
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
    trimDurationStr
  }
}
