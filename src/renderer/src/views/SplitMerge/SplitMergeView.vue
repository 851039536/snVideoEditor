<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import {
  Scissors, X, ArrowUp, ArrowDown, Folder, Play, Pause,
  SkipBack, SkipForward, Video, ChevronsLeft, ChevronsRight
} from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import VideoPreview from '@/components/VideoPreview.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import ClipList from './ClipList.vue'
import { useProgressStore } from '@/stores/progress'
import { secondsToHMS } from '@/utils/time'
import { formatSize, getFileName } from '@/utils/format'
import { clamp } from '@/utils/math'
import type { VideoMeta, ClipItem } from '@/types/file'

const store = useProgressStore()

// ---- Mode ----
const mode = ref<'split' | 'merge'>('split')

// ---- Files ----
const files = ref<string[]>([])

// ---- Video metadata & player ----
const videoMeta = ref<VideoMeta | null>(null)
const videoPlayer = ref<HTMLVideoElement | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)

// ---- Timeline drag state ----
const timelineRef = ref<HTMLDivElement | null>(null)
const dragging = ref<'start' | 'end' | null>(null)
const lastDragClientX = ref(0)

// Fine-tune: how many times finer when holding Shift (higher = finer)
const FINE_DRAG_SCALE = 5

// Trim times in seconds (normalized 0..duration)
const trimStartSec = ref(0)
const trimEndSec = ref(30)
const isInitialTrimEnd = ref(true)

// ---- Manual time inputs (for fine-tuning) ----
// Derived from trim times via computed getter; setters write back with clamping + seek
function hmsFieldSetter(field: 'start' | 'end', h: string, m: string, s: string): void {
  const total = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)
  if (isNaN(total)) { return }
  if (field === 'start') {
    trimStartSec.value = clamp(total, 0, trimEndSec.value - 0.1)
    seekVideoPlayer(trimStartSec.value)
  } else {
    const max = duration.value || 99999
    isInitialTrimEnd.value = false
    trimEndSec.value = clamp(total, trimStartSec.value + 0.1, max)
    seekVideoPlayer(trimEndSec.value)
  }
}

const startHour = computed({
  get: () => secondsToHMS(trimStartSec.value).split(':')[0],
  set: (v: string) => hmsFieldSetter('start', v, startMin.value, startSec.value)
})
const startMin = computed({
  get: () => secondsToHMS(trimStartSec.value).split(':')[1],
  set: (v: string) => hmsFieldSetter('start', startHour.value, v, startSec.value)
})
const startSec = computed({
  get: () => secondsToHMS(trimStartSec.value).split(':')[2],
  set: (v: string) => hmsFieldSetter('start', startHour.value, startMin.value, v)
})

const endHour = computed({
  get: () => secondsToHMS(trimEndSec.value).split(':')[0],
  set: (v: string) => hmsFieldSetter('end', v, endMin.value, endSec.value)
})
const endMin = computed({
  get: () => secondsToHMS(trimEndSec.value).split(':')[1],
  set: (v: string) => hmsFieldSetter('end', endHour.value, v, endSec.value)
})
const endSec = computed({
  get: () => secondsToHMS(trimEndSec.value).split(':')[2],
  set: (v: string) => hmsFieldSetter('end', endHour.value, endMin.value, v)
})

// ---- Step forward/backward ----
const stepSeconds = ref(2)

// ---- Output ----
const outputName = ref('')
const outputDir = ref('')
const errorMsg = ref('')

// ---- Clip list ----
const clips = ref<ClipItem[]>([])
const cuttingInProgress = ref(false)
let clipIdCounter = 0
let loadRequestId = 0

// ---- Computed ----

const videoSrc = computed((): string => {
  if (files.value.length === 0) { return '' }
  return `file:///${files.value[0].replace(/\\/g, '/')}`
})

const startTimeStr = computed((): string => {
  return secondsToHMS(trimStartSec.value)
})

const endTimeStr = computed((): string => {
  return secondsToHMS(trimEndSec.value)
})

const clipDurationSec = computed((): number => {
  return Math.max(0, trimEndSec.value - trimStartSec.value)
})

const clipDurationStr = computed((): string => {
  return secondsToHMS(clipDurationSec.value)
})

const canMerge = computed((): boolean => {
  const selectedClips = clips.value.filter((c) => c.selected)
  return (selectedClips.length + files.value.length) >= 2
})

const selectedClipCount = computed((): number => {
  return clips.value.filter((c) => c.selected).length
})

// Timeline bar percentages
const startPercent = computed((): number => {
  if (duration.value <= 0) { return 0 }
  return (trimStartSec.value / duration.value) * 100
})

const endPercent = computed((): number => {
  if (duration.value <= 0) { return 100 }
  return (trimEndSec.value / duration.value) * 100
})

const playheadPercent = computed((): number => {
  if (duration.value <= 0) { return 0 }
  return (currentTime.value / duration.value) * 100
})

const playheadInSelectionPercent = computed((): number => {
  const range = endPercent.value - startPercent.value
  if (range <= 0) { return 50 }
  return ((playheadPercent.value - startPercent.value) / range) * 100
})

// ---- Helpers ----

function seekVideoPlayer(t: number): void {
  if (videoPlayer.value) {
    videoPlayer.value.currentTime = t
    currentTime.value = t
  }
}

function swapArrayElements<T>(arr: T[], index: number, direction: -1 | 1): boolean {
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= arr.length) { return false }
  const temp = arr[index]
  arr[index] = arr[newIndex]
  arr[newIndex] = temp
  return true
}

// Watch trimEndSec to clamp it when duration loads
watch(duration, (newDur) => {
  if (newDur > 0) {
    if (trimEndSec.value > newDur || isInitialTrimEnd.value) {
      trimEndSec.value = newDur
    }
  }
})

// ---- File operations ----

async function addFiles(newFiles: string[]): Promise<void> {
  for (const f of newFiles) {
    if (!files.value.includes(f)) {
      files.value.push(f)
    }
  }
  if (mode.value === 'split' && files.value.length > 0) {
    await loadVideoMeta(files.value[0])
  }
  if (outputName.value === '') {
    const name = newFiles[0].split(/[/\\]/).pop() || ''
    outputName.value = name.replace(/\.[^.]+$/, '') + '_output'
  }
}

async function loadVideoMeta(filePath: string): Promise<void> {
  const thisRequestId = ++loadRequestId
  try {
    const meta = await window.electronAPI.getVideoMeta(filePath)
    // Guard: discard stale metadata if a newer request was made
    if (thisRequestId !== loadRequestId) { return }
    // Guard: discard stale metadata if file has changed while loading
    if (files.value.length === 0 || files.value[0] !== filePath) {
      return
    }
    videoMeta.value = meta
    duration.value = meta.duration
    trimStartSec.value = 0
    trimEndSec.value = meta.duration
    isInitialTrimEnd.value = false
    currentTime.value = 0
    await nextTick()
    if (videoPlayer.value) {
      videoPlayer.value.load()
      videoPlayer.value.currentTime = 0
    }
  } catch (e) {
    errorMsg.value = '无法读取视频信息'
  }
}

function removeFile(index: number): void {
  files.value.splice(index, 1)
  if (mode.value === 'split' && files.value.length === 0) {
    videoMeta.value = null
    duration.value = 0
  }
}

function moveFile(index: number, direction: -1 | 1): void {
  swapArrayElements(files.value, index, direction)
}

watch(mode, (newMode) => {
  if (newMode === 'split') {
    if (files.value.length > 1) {
      files.value = [files.value[0]]
    }
    if (files.value.length > 0) {
      loadVideoMeta(files.value[0])
    }
  } else if (newMode === 'merge') {
    files.value = []
    outputName.value = ''
    outputDir.value = ''
    errorMsg.value = ''
  }
})

// ---- Video player controls ----

async function togglePlay(): Promise<void> {
  const vp = videoPlayer.value
  if (!vp) { return }
  if (vp.paused) {
    try {
      await vp.play()
    } catch (e) {
      errorMsg.value = `播放失败: ${e instanceof Error ? e.message : String(e)}`
    }
  } else {
    vp.pause()
  }
}

function onVideoPlay(): void {
  isPlaying.value = true
}

function onVideoPause(): void {
  isPlaying.value = false
}

function onTimeUpdate(): void {
  if (!videoPlayer.value) { return }
  const t = videoPlayer.value.currentTime
  // Auto-stop at end trim point
  if (t >= trimEndSec.value) {
    videoPlayer.value.pause()
    videoPlayer.value.currentTime = trimEndSec.value
    currentTime.value = trimEndSec.value
    isPlaying.value = false
  } else {
    currentTime.value = t
  }
}

function onVideoEnded(): void {
  isPlaying.value = false
}

function onVideoError(e: Event): void {
  const video = e.target as HTMLVideoElement
  errorMsg.value = `视频加载失败: ${video?.error?.message || '未知错误'}`
}

function onVideoLoaded(): void {
  seekVideoPlayer(trimStartSec.value)
}

function seekToStart(): void {
  seekVideoPlayer(trimStartSec.value)
}

function seekToEnd(): void {
  seekVideoPlayer(trimEndSec.value)
}

function stepBackward(): void {
  const t = clamp(currentTime.value - stepSeconds.value, 0, duration.value)
  seekVideoPlayer(t)
}

function stepForward(): void {
  const t = clamp(currentTime.value + stepSeconds.value, 0, duration.value)
  seekVideoPlayer(t)
}

// Snap start/end handle to current video position
function snapStartHere(): void {
  trimStartSec.value = clamp(currentTime.value, 0, trimEndSec.value - 0.1)
}

function snapEndHere(): void {
  isInitialTrimEnd.value = false
  trimEndSec.value = clamp(currentTime.value, trimStartSec.value + 0.1, duration.value)
}

// ---- Timeline drag ----

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

// Wheel on handle: fine-tune ±0.1s per tick (Shift ±0.02s)
function onHandleWheel(handle: 'start' | 'end', e: WheelEvent): void {
  const step = e.shiftKey ? 0.02 : 0.1
  const delta = e.deltaY > 0 ? step : -step

  if (handle === 'start') {
    trimStartSec.value = clamp(trimStartSec.value + delta, 0, trimEndSec.value - 0.1)
    seekVideoPlayer(trimStartSec.value)
  } else {
    isInitialTrimEnd.value = false
    trimEndSec.value = clamp(trimEndSec.value + delta, trimStartSec.value + 0.1, duration.value)
    seekVideoPlayer(trimEndSec.value)
  }
}

function onTimelineClick(e: MouseEvent): void {
  // Only seek on direct timeline click (not handle drag)
  if (dragging.value) { return }
  seekVideoPlayer(getTimelineTime(e.clientX))
}

// Maximum resolution cap: never coarser than 2 seconds per pixel (even for long videos)
const MAX_SECONDS_PER_PX = 2

// Global pointer move/up for seamless drag tracking (pointer events required for setPointerCapture)
function onGlobalPointerMove(e: PointerEvent): void {
  if (!dragging.value) { return }

  const el = timelineRef.value
  if (!el || duration.value <= 0) { return }

  const rect = el.getBoundingClientRect()
  const nativeRes = duration.value / rect.width // seconds per pixel in absolute mode
  let rawT: number // unclamped target time, will be clamped below
  let updateLastX = false

  if (e.shiftKey) {
    // Shift + drag: delta-based, FINE_DRAG_SCALE× finer than native
    const base = dragging.value === 'start' ? trimStartSec.value : trimEndSec.value
    rawT = base + (e.clientX - lastDragClientX.value) * nativeRes / FINE_DRAG_SCALE
    updateLastX = true
  } else if (nativeRes > MAX_SECONDS_PER_PX) {
    // Long video: delta mode capped at MAX_SECONDS_PER_PX for smooth control
    const base = dragging.value === 'start' ? trimStartSec.value : trimEndSec.value
    rawT = base + (e.clientX - lastDragClientX.value) * MAX_SECONDS_PER_PX
    updateLastX = true
  } else {
    // Short video: absolute position mapping is already precise enough
    rawT = getTimelineTime(e.clientX)
  }

  if (updateLastX) { lastDragClientX.value = e.clientX }

  // ---- Unified apply: clamp + assign + sync + seek ----
  if (dragging.value === 'start') {
    const clamped = clamp(rawT, 0, trimEndSec.value - 0.1)
    if (trimStartSec.value !== clamped) {
      trimStartSec.value = clamped
      seekVideoPlayer(clamped)
    }
  } else {
    const clamped = clamp(rawT, trimStartSec.value + 0.1, duration.value)
    if (trimEndSec.value !== clamped) {
      isInitialTrimEnd.value = false
      trimEndSec.value = clamped
      seekVideoPlayer(clamped)
    }
  }
}

function onGlobalPointerUp(e: PointerEvent): void {
  if (!dragging.value) { return }
  (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId)
  dragging.value = null
}

// ---- Clip list management ----

async function cutToClipList(): Promise<void> {
  if (clipDurationSec.value <= 0) {
    errorMsg.value = '请选择有效的片段范围'
    return
  }

  errorMsg.value = ''
  cuttingInProgress.value = true

  try {
    const tempDir = await window.electronAPI.getTempDir()
    clipIdCounter++
    const clipId = `clip_${Date.now()}_${clipIdCounter}`
    const outputFile = `${tempDir}/${clipId}.mp4`

    const success = await window.electronAPI.splitVideo({
      input: files.value[0],
      output: outputFile,
      startTime: startTimeStr.value,
      duration: clipDurationStr.value
    })

    if (success) {
      clips.value.push({
        id: clipId,
        sourceFile: files.value[0],
        sourceFileName: getFileName(files.value[0]),
        startSec: trimStartSec.value,
        endSec: trimEndSec.value,
        duration: clipDurationSec.value,
        outputFile,
        selected: true
      })
      // Reset trim handles to default (full video range)
      trimStartSec.value = 0
      trimEndSec.value = duration.value
      seekVideoPlayer(0)
    }
  } catch (e) {
    errorMsg.value = `裁切失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    cuttingInProgress.value = false
  }
}

function removeClip(index: number): void {
  const clip = clips.value[index]
  if (clip) {
    window.electronAPI.deleteFile(clip.outputFile).catch(() => {
      console.warn('删除临时片段文件失败:', clip.outputFile)
    })
  }
  clips.value.splice(index, 1)
}

function toggleClipSelection(index: number): void {
  clips.value[index].selected = !clips.value[index].selected
}

function moveClip(index: number, direction: -1 | 1): void {
  swapArrayElements(clips.value, index, direction)
}

// ---- Output & Process ----

function getMergeOutputName(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `SN_${ts}.mp4`
}

async function selectOutputPath(): Promise<void> {
  const fn = mode.value === 'split' ? `${outputName.value}.mp4` : getMergeOutputName()
  const dir = await window.electronAPI.selectSavePath(fn, 'mp4')
  if (dir) {
    outputDir.value = dir
  }
}

async function startProcess(): Promise<void> {
  errorMsg.value = ''
  if (!await validateOutput()) { return }

  // Collect selected clip output files + external files
  const selectedClipFiles = clips.value
    .filter((c) => c.selected)
    .map((c) => c.outputFile)
  const allInputs = [...selectedClipFiles, ...files.value]

  if (allInputs.length < 2) {
    errorMsg.value = '至少需要 2 个文件才能合并'
    return
  }

  store.start('merge')

  window.electronAPI.onProgress((info) => {
    store.update(info)
  })

  try {
    const result = await window.electronAPI.mergeVideos({
      inputs: allInputs,
      output: outputDir.value
    })
    if (result) {
      // Clean up selected clip temp files after successful merge
      for (const c of clips.value.filter((c) => c.selected)) {
        window.electronAPI.deleteFile(c.outputFile)
      }
      // Remove merged clips from list to avoid stale references
      clips.value = clips.value.filter((c) => !c.selected)
      store.finish()
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    store.reset()
  }
}

async function validateOutput(): Promise<boolean> {
  if (!outputDir.value) {
    await selectOutputPath()
    if (!outputDir.value) {
      errorMsg.value = '请选择输出目录'
      return false
    }
  }
  return true
}

// ---- Lifecycle ----

if (typeof window !== 'undefined') {
  document.addEventListener('pointermove', onGlobalPointerMove)
  document.addEventListener('pointerup', onGlobalPointerUp)
}

onUnmounted(() => {
  document.removeEventListener('pointermove', onGlobalPointerMove)
  document.removeEventListener('pointerup', onGlobalPointerUp)
  if (window.electronAPI) {
    window.electronAPI.removeProgressListener()
  }
})
</script>

<template>
  <div class="page-container">
    <!-- Header -->
    <header class="mb-4">
      <div class="flex items-center gap-3 mb-1">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
          <Scissors :size="18" class="text-accent-blue" />
        </div>
        <h1 class="text-xl font-bold text-text-primary">视频分割与合并</h1>
      </div>
    </header>

    <!-- Mode Tabs -->
    <div class="flex gap-1 mb-4 p-1 rounded-lg bg-bg-tertiary w-fit">
      <button
        @click="mode = 'split'"
        class="px-4 py-1.5 rounded-md text-sm font-medium"
        :class="mode === 'split' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary'"
      >
        裁剪
      </button>
      <button
        @click="mode = 'merge'"
        class="px-4 py-1.5 rounded-md text-sm font-medium"
        :class="mode === 'merge' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary'"
      >
        合并
      </button>
    </div>

    <!-- ========== SPLIT MODE ========== -->
    <div v-if="mode === 'split'" class="space-y-3">
      <!-- No file => drop zone -->
      <FileDropZone v-if="files.length === 0" @files-selected="addFiles" />

      <!-- Has file => full editor -->
      <template v-else>
        <!-- Video Player -->
        <div class="video-player-container glass-card">
          <video
            v-if="videoSrc"
            ref="videoPlayer"
            :src="videoSrc"
            class="w-full rounded-t-xl max-h-[360px] bg-black"
            preload="auto"
            @timeupdate="onTimeUpdate"
            @play="onVideoPlay"
            @pause="onVideoPause"
            @ended="onVideoEnded"
            @error="onVideoError"
            @loadedmetadata="onVideoLoaded"
          />
          <div v-else class="flex items-center justify-center h-48 bg-black/50 rounded-t-xl">
            <Video :size="40" class="text-text-muted opacity-30" />
          </div>

          <!-- Player Controls -->
          <div class="flex items-center justify-between px-4 py-2.5 bg-bg-secondary/80">
            <div class="flex items-center gap-2">
              <button
                @click="seekToStart"
                class="player-btn p-1.5 rounded-md"
                title="跳到开始"
              >
                <SkipBack :size="16" class="text-text-secondary" />
              </button>
              <button
                @click="togglePlay"
                class="player-btn p-2 rounded-full bg-accent-blue"
              >
                <Pause v-if="isPlaying" :size="16" class="text-white" />
                <Play v-else :size="16" class="text-white ml-0.5" />
              </button>
              <button
                @click="seekToEnd"
                class="player-btn p-1.5 rounded-md"
                title="跳到结束"
              >
                <SkipForward :size="16" class="text-text-secondary" />
              </button>
              <span class="text-xs font-mono text-text-secondary ml-2">
                {{ secondsToHMS(currentTime) }} / {{ secondsToHMS(duration) }}
              </span>
            </div>
            <!-- File info -->
            <div class="flex items-center gap-3 text-xs text-text-muted">
              <span v-if="videoMeta">{{ videoMeta.width }}×{{ videoMeta.height }}</span>
              <span v-if="videoMeta">{{ formatSize(videoMeta.size) }}</span>
              <span class="text-accent-blue font-mono">{{ getFileName(files[0]) }}</span>
              <button
                @click="removeFile(0)"
                class="p-1 rounded"
                title="移除"
              >
                <X :size="14" class="text-text-muted" />
              </button>
            </div>
          </div>
        </div>

        <!-- Timeline Bar -->
        <div class="glass-card" style="overflow: visible;">
          <div class="flex items-center justify-between mb-3 gap-2">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-sm font-semibold text-text-primary">裁剪时间轴</h3>
              <!-- Step forward/backward -->
              <div class="flex items-center gap-1">
                <button
                  @click="stepBackward"
                  class="p-1 rounded text-text-secondary"
                  title="后退"
                >
                  <SkipBack :size="14" />
                </button>
                <select
                  v-model.number="stepSeconds"
                  class="px-1 py-0.5 text-xs font-mono bg-bg-tertiary border border-border rounded text-text-primary outline-none cursor-pointer appearance-none text-center"
                  title="步进秒数"
                >
                  <option :value="1">1s</option>
                  <option :value="2">2s</option>
                  <option :value="5">5s</option>
                  <option :value="10">10s</option>
                </select>
                <button
                  @click="stepForward"
                  class="p-1 rounded text-text-secondary"
                  title="前进"
                >
                  <SkipForward :size="14" />
                </button>
                <!-- Locate to handles -->
                <span class="w-px h-4 bg-border mx-0.5" />
                <button
                  @click="snapStartHere"
                  class="p-1 rounded text-accent-blue"
                  title="前手柄定位到此"
                >
                  <ChevronsLeft :size="14" />
                </button>
                <span class="text-text-muted text-xs font-mono leading-none">|</span>
                <button
                  @click="snapEndHere"
                  class="p-1 rounded text-accent-purple"
                  title="后手柄定位到此"
                >
                  <ChevronsRight :size="14" />
                </button>
              </div>
              <!-- Fine-tuning time inputs -->
              <span class="w-px h-4 bg-border mx-0.5" />
              <div class="flex items-center gap-1">
                <span class="text-xs text-text-muted">开始</span>
                <input v-model="startHour" class="time-input" maxlength="2" />
                <span class="text-text-muted text-xs">:</span>
                <input v-model="startMin" class="time-input" maxlength="2" />
                <span class="text-text-muted text-xs">:</span>
                <input v-model="startSec" class="time-input" maxlength="2" />
                <span class="text-text-muted text-sm">→</span>
                <span class="text-xs text-text-muted">结束</span>
                <input v-model="endHour" class="time-input" maxlength="2" />
                <span class="text-text-muted text-xs">:</span>
                <input v-model="endMin" class="time-input" maxlength="2" />
                <span class="text-text-muted text-xs">:</span>
                <input v-model="endSec" class="time-input" maxlength="2" />
              </div>
            </div>
            <span class="text-xs text-text-secondary shrink-0">
              选中片段时长：
              <span class="text-sm font-mono text-accent-blue font-semibold">{{ clipDurationStr }}</span>
            </span>
          </div>

          <!-- The timeline -->
          <div
            ref="timelineRef"
            class="timeline-track"
            @click="onTimelineClick"
          >
            <!-- Left dimmed area -->
            <div class="timeline-dimmed-l" :style="{ width: startPercent + '%' }" />

            <!-- Selected area (flex item, no left offset needed) -->
            <div
              class="timeline-selected"
              :style="{ width: (endPercent - startPercent) + '%' }"
            >
              <!-- Playhead (positioned relative to selected area) -->
              <div
                class="timeline-playhead"
                :style="{ left: playheadInSelectionPercent + '%' }"
              />
              <!-- Start handle -->
              <div
                class="trim-handle trim-handle-start"
                @pointerdown="startHandleDrag('start', $event)"
                @wheel.prevent="onHandleWheel('start', $event)"
              />
              <!-- End handle -->
              <div
                class="trim-handle trim-handle-end"
                @pointerdown="startHandleDrag('end', $event)"
                @wheel.prevent="onHandleWheel('end', $event)"
              />
            </div>

            <!-- Right dimmed area -->
            <div class="timeline-dimmed-r" :style="{ width: (100 - endPercent) + '%' }" />
          </div>

          <!-- Time markers -->
          <div class="flex justify-between mt-1.5 px-1">
            <span class="text-xs font-mono text-accent-blue">{{ startTimeStr }}</span>
            <span class="text-xs font-mono text-text-muted">{{ secondsToHMS(duration) }}</span>
            <span class="text-xs font-mono text-accent-purple">{{ endTimeStr }}</span>
          </div>

        </div>


        <!-- Cut-to-list action -->
        <div class="flex items-center gap-3">
          <button
            @click="cutToClipList"
            :disabled="clipDurationSec <= 0 || cuttingInProgress"
            class="px-8 py-2.5 rounded-xl font-semibold text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            :class="clipDurationSec > 0 && !cuttingInProgress
              ? 'bg-gradient-to-r from-accent-blue to-accent-purple'
              : 'bg-bg-tertiary text-text-muted'"
          >
            <template v-if="!cuttingInProgress">
              <Scissors :size="18" class="inline mr-2 -mt-0.5" />
              裁切到列表
            </template>
            <template v-else>
              裁切中...
            </template>
          </button>
          <span class="text-xs text-text-muted">
            片段将无损添加到下方列表，可切换至合并 Tab 统一拼接
          </span>
        </div>

        <!-- Clips List -->
        <ClipList
          v-if="clips.length > 0"
          :clips="clips"
          @toggle="toggleClipSelection"
          @remove="removeClip"
        />

        <!-- Error -->
        <div v-if="errorMsg" class="alert-danger">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- Progress -->
        <ProgressPanel />
      </template>
    </div>

    <!-- ========== MERGE MODE ========== -->
    <div v-else class="space-y-3">
      <!-- Clips list (from split) -->
      <ClipList
        v-if="clips.length > 0"
        :clips="clips"
        :show-reorder="true"
        :selected-count="selectedClipCount"
        @toggle="toggleClipSelection"
        @remove="removeClip"
        @move="moveClip"
      />
      <p v-else class="text-xs text-text-muted text-center py-4 glass-card">
        暂无片段，请先在裁剪模式下添加
      </p>

      <!-- External files -->
      <FileDropZone @files-selected="addFiles" />

      <div v-if="files.length > 0" class="glass-card space-y-2 max-h-48 overflow-y-auto">
        <h3 class="text-sm font-semibold text-text-primary mb-2">外部文件（{{ files.length }} 个）</h3>
        <div
          v-for="(file, idx) in files"
          :key="file"
          class="flex items-center gap-2 p-2 rounded-lg bg-bg-tertiary/50 transition-colors group"
        >
          <VideoPreview :file-path="file" />
          <div class="flex flex-col gap-1 ml-auto">
            <button
              @click="moveFile(idx, -1)"
              :disabled="idx === 0"
              class="p-0.5 rounded disabled:opacity-30"
            >
              <ArrowUp :size="14" class="text-text-secondary" />
            </button>
            <button
              @click="moveFile(idx, 1)"
              :disabled="idx === files.length - 1"
              class="p-0.5 rounded disabled:opacity-30"
            >
              <ArrowDown :size="14" class="text-text-secondary" />
            </button>
          </div>
          <button
            @click="removeFile(idx)"
            class="p-1 rounded opacity-0 group-hover:opacity-100 ml-1"
          >
            <X :size="14" class="text-danger" />
          </button>
        </div>
      </div>

      <!-- Output settings -->
      <div class="glass-card">
        <h3 class="text-sm font-semibold text-text-primary mb-2">输出设置</h3>
        <div class="flex items-center gap-3">
          <button
            @click="selectOutputPath"
            class="btn-secondary"
          >
            <Folder :size="16" />
            选择输出位置
          </button>
          <p v-if="outputDir" class="text-xs text-accent-light truncate flex-1">
            {{ outputDir }}
          </p>
        </div>
      </div>

      <!-- Summary -->
      <div v-if="selectedClipCount > 0 || files.length > 0" class="glass-card">
        <p class="text-sm text-text-secondary">
          将合并
          <span v-if="selectedClipCount > 0" class="text-accent-blue font-semibold">{{ selectedClipCount }}</span>
          <span v-if="selectedClipCount > 0"> 个裁切片断</span>
          <span v-if="selectedClipCount > 0 && files.length > 0"> + </span>
          <span v-if="files.length > 0" class="text-accent-purple font-semibold">{{ files.length }}</span>
          <span v-if="files.length > 0"> 个外部文件</span>
        </p>
        <p class="text-xs text-text-muted mt-1">
          合并顺序：裁切片断（按列表顺序）→ 外部文件（按列表顺序）
        </p>
      </div>

      <div v-if="errorMsg" class="alert-danger">
        <p>{{ errorMsg }}</p>
      </div>

      <button
        @click="startProcess"
        :disabled="!canMerge || store.isProcessing"
        class="btn-primary"
        :class="canMerge && !store.isProcessing
          ? 'bg-gradient-to-r from-accent-blue to-accent-purple'
          : 'bg-bg-tertiary text-text-muted'"
      >
        <template v-if="!store.isProcessing">
          <Play :size="18" class="inline mr-2 -mt-0.5" />
          合并选中片段
        </template>
        <template v-else>
          处理中...
        </template>
      </button>

      <ProgressPanel />
    </div>
  </div>
</template>

<style scoped>
.player-btn {
  cursor: pointer;
}

/* ---- Timeline ---- */
.timeline-track {
  position: relative;
  width: 100%;
  height: 48px;
  background: hsl(var(--background));
  border-radius: 10px;
  display: flex;
  overflow: visible;
  cursor: pointer;
  user-select: none;
}

.timeline-dimmed-l,
.timeline-dimmed-r {
  height: 100%;
  background: hsl(var(--background) / 0.8);
  flex-shrink: 0;
}

.timeline-selected {
  position: relative;
  height: 100%;
  background: linear-gradient(90deg, rgba(91, 141, 239, 0.3), rgba(167, 139, 250, 0.35));
  border-left: 2px solid hsl(var(--primary));
  border-right: 2px solid var(--color-accent-light);
  flex-shrink: 0;
}

.timeline-playhead {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: var(--color-playhead);
  outline: 1px solid rgba(255, 107, 107, 0.3);
  z-index: 5;
  transition: left 0.1s linear;
  pointer-events: none;
}

.timeline-playhead.dragging {
  transition: none;
}

/* ---- Responsive ---- */
@media (max-width: 768px) {
  .timeline-track {
    height: 40px;
  }
}
</style>
