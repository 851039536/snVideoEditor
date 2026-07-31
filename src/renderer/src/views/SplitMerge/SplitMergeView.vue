<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import {
  Scissors, X, ArrowUp, ArrowDown, Folder, Play, Pause,
  SkipBack, SkipForward, Video, ChevronsLeft, ChevronsRight, RefreshCw
} from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import VideoPreview from '@/components/VideoPreview.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import ClipList from './ClipList.vue'
import SpeedPanel from './SpeedPanel.vue'
import { useProgressStore } from '@/stores/progress'
import { useVideoPlayer } from '@/composables/useVideoPlayer'
import { useTrimTimeline } from '@/composables/useTrimTimeline'
import { secondsToHMS } from '@/utils/time'
import { formatSize, getFileName, toFileUrl } from '@/utils/format'
import { clamp } from '@/utils/math'
import type { VideoMeta, ClipItem } from '@/types/file'

const store = useProgressStore()

// ---- Mode ----
const mode = ref<'split' | 'merge' | 'speed'>('split')

// ---- Files ----
const files = ref<string[]>([])

// ---- Video metadata & player ----
const videoMeta = ref<VideoMeta | null>(null)
const { videoPlayer, isPlaying, currentTime, onVideoPlay, onVideoStop, onTimeUpdate, onVideoError, onVideoLoaded, seekVideoPlayer } = useVideoPlayer({
  onTimeUpdate: (t, vp) => {
    // Auto-stop at end trim point
    if (t >= trimEndSec.value) {
      vp.pause()
      vp.currentTime = trimEndSec.value
      currentTime.value = trimEndSec.value
      isPlaying.value = false
    }
  },
  onLoaded: (vp) => {
    vp.currentTime = trimStartSec.value
    currentTime.value = trimStartSec.value
  },
  onError: (e) => {
    const video = e.target as HTMLVideoElement
    errorMsg.value = `视频加载失败: ${video?.error?.message || '未知错误'}`
  }
})
const duration = ref(0)

// Trim times in seconds (normalized 0..duration)
const trimStartSec = ref(0)
const trimEndSec = ref(30)

// ---- Trim Timeline composable ----
const {
  timelineRef, dragging,
  startHour, startMin, startSec, endHour, endMin, endSec,
  startPercent, endPercent, playheadPercent: playheadPercentFn,
  getTimelineTime,
  trimDuration, trimDurationStr
} = useTrimTimeline({
  duration,
  trimStart: trimStartSec,
  trimEnd: trimEndSec,
  seekTo: seekVideoPlayer
})
const playheadPercent = playheadPercentFn(currentTime)

const playheadInSelectionPercent = computed((): number => {
  const range = endPercent.value - startPercent.value
  if (range <= 0) { return 50 }
  return ((playheadPercent.value - startPercent.value) / range) * 100
})

// ---- Timeline drag state (advanced) ----
const scrubbing = ref(false)
const lastDragClientX = ref(0)

// Fine-tune: absolute seconds per pixel when holding Shift (lower = finer)
const FINE_SECONDS_PER_PX = 0.1

// Whether to pause video while scrubbing the timeline (persisted)
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

// ---- Step forward/backward ----
const stepSeconds = ref(2)

// ---- Output ----
const outputName = ref('')
const outputDir = ref('')
const errorMsg = ref('')

// ---- Replace video (split mode) ----
const isDraggingReplace = ref(false)
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp']

// ---- Clip list ----
const clips = ref<ClipItem[]>([])
const cuttingInProgress = ref(false)
let clipIdCounter = 0
let loadRequestId = 0

// ---- Computed ----

const videoSrc = computed((): string => {
  if (files.value.length === 0) { return '' }
  return toFileUrl(files.value[0])
})

const clipDurationSec = trimDuration
const clipDurationStr = trimDurationStr

const selectedClipCount = computed((): number => {
  return clips.value.filter((c) => c.selected).length
})

const canMerge = computed((): boolean => {
  return selectedClipCount.value + files.value.length >= 2
})

// ---- Helpers ----

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

/** 显式释放 video 元素资源（文件句柄 + 解码线程），避免 file:/// 延迟释放导致线程残留占用 */
function releaseVideoResource(): void {
  const vp = videoPlayer.value
  if (vp) {
    vp.pause()
    vp.removeAttribute('src')
    vp.load()
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
    currentTime.value = 0
    await nextTick()
    if (videoPlayer.value) {
      videoPlayer.value.load()
    }
  } catch (e) {
    errorMsg.value = '无法读取视频信息'
  }
}

function removeFile(index: number): void {
  files.value.splice(index, 1)
  if (mode.value === 'split' && files.value.length === 0) {
    releaseVideoResource()
    videoMeta.value = null
    duration.value = 0
  }
}

async function replaceVideo(newPath: string): Promise<void> {
  releaseVideoResource()
  // Clean up old clip temp files
  for (const c of clips.value) {
    window.electronAPI.deleteFile(c.outputFile).catch(() => {})
  }
  clips.value = []
  // Reset state
  videoMeta.value = null
  duration.value = 0
  trimStartSec.value = 0
  trimEndSec.value = 30
  currentTime.value = 0
  isPlaying.value = false
  errorMsg.value = ''
  // Replace file
  files.value = [newPath]
  // Reset output name
  const name = newPath.split(/[/\\]/).pop() || ''
  outputName.value = name.replace(/\.[^.]+$/, '') + '_output'
  // Load new meta
  await loadVideoMeta(newPath)
}

async function pickReplaceVideo(): Promise<void> {
  const selected = await window.electronAPI.selectVideoFiles()
  if (selected.length > 0) {
    await replaceVideo(selected[0])
  }
}

function isVideoExtension(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
  return VIDEO_EXTENSIONS.includes(ext)
}

function onReplaceDragOver(event: DragEvent): void {
  event.preventDefault()
  isDraggingReplace.value = true
}

function onReplaceDragLeave(event: DragEvent): void {
  // Only set false if relatedTarget is not inside the container
  const container = event.currentTarget as HTMLElement
  if (!event.relatedTarget || !container.contains(event.relatedTarget as HTMLElement)) {
    isDraggingReplace.value = false
  }
}

async function onReplaceDrop(event: DragEvent): Promise<void> {
  isDraggingReplace.value = false
  const fileList = event.dataTransfer?.files
  if (!fileList) { return }
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i]
    if (file.type.startsWith('video/') || isVideoExtension(file.name)) {
      // @ts-ignore - Electron returns the path
      const path = file.path || file.name
      if (path) {
        await replaceVideo(path)
        return
      }
    }
  }
}

function moveFile(index: number, direction: -1 | 1): void {
  swapArrayElements(files.value, index, direction)
}

watch(mode, (newMode) => {
  if (newMode === 'split' || newMode === 'speed') {
    if (files.value.length > 1) {
      files.value = [files.value[0]]
    }
    if (files.value.length > 0) {
      loadVideoMeta(files.value[0])
    }
  } else if (newMode === 'merge') {
    releaseVideoResource()
    videoMeta.value = null
    duration.value = 0
    trimStartSec.value = 0
    trimEndSec.value = 30
    currentTime.value = 0
    isPlaying.value = false
    outputName.value = ''
    outputDir.value = ''
    errorMsg.value = ''
    files.value = []
  }
})

// ---- Video player controls ----

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
  trimEndSec.value = clamp(currentTime.value, trimStartSec.value + 0.1, duration.value)
}

// ---- Timeline drag ----

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
    trimEndSec.value = clamp(trimEndSec.value + delta, trimStartSec.value + 0.1, duration.value)
    seekVideoPlayer(trimEndSec.value)
  }
}

function startScrub(e: PointerEvent): void {
  if (duration.value <= 0) { return }
  scrubbing.value = true
  lastDragClientX.value = e.clientX
  const el = timelineRef.value
  if (el) { el.setPointerCapture(e.pointerId) }
  // Pause video during scrub (unless user opted to keep playing)
  if (pauseOnScrub.value) {
    videoPlayer.value?.pause()
    isPlaying.value = false
  }
  // Seek immediately to click position
  seekVideoPlayer(getTimelineTime(e.clientX))
}

// Maximum resolution cap: never coarser than 2 seconds per pixel (even for long videos)
const MAX_SECONDS_PER_PX = 2

// Global pointer move/up for seamless drag tracking (pointer events required for setPointerCapture)
function onGlobalPointerMove(e: PointerEvent): void {
  if (scrubbing.value) {
    if (e.shiftKey) {
      // Fine mode: absolute 0.1s per pixel, independent of video duration
      if (duration.value <= 0) { return }
      const delta = (e.clientX - lastDragClientX.value) * FINE_SECONDS_PER_PX
      lastDragClientX.value = e.clientX
      seekVideoPlayer(clamp(currentTime.value + delta, 0, duration.value))
    } else {
      // Normal mode: absolute position, playhead follows mouse
      seekVideoPlayer(getTimelineTime(e.clientX))
    }
    return
  }

  if (!dragging.value) { return }

  const el = timelineRef.value
  if (!el || duration.value <= 0) { return }

  const rect = el.getBoundingClientRect()
  const nativeRes = duration.value / rect.width // seconds per pixel in absolute mode
  let rawT: number // unclamped target time, will be clamped below
  let updateLastX = false

  if (e.shiftKey) {
    // Shift + drag: absolute fine resolution, independent of video duration
    const base = dragging.value === 'start' ? trimStartSec.value : trimEndSec.value
    rawT = base + (e.clientX - lastDragClientX.value) * FINE_SECONDS_PER_PX
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
      trimEndSec.value = clamped
      seekVideoPlayer(clamped)
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

// ---- Clip list management ----

async function cutToClipList(): Promise<void> {
  if (files.value.length === 0) {
    errorMsg.value = '请先添加视频文件'
    return
  }
  if (clipDurationSec.value <= 0) {
    errorMsg.value = '请选择有效的片段范围'
    return
  }

  errorMsg.value = ''
  cuttingInProgress.value = true
  // 暂停视频播放器，避免裁剪期间及完成后 video 持续解码占用渲染线程
  videoPlayer.value?.pause()

  let outputFile = ''
  try {
    const tempDir = await window.electronAPI.getTempDir()
    clipIdCounter++
    const clipId = `clip_${Date.now()}_${clipIdCounter}`
    outputFile = `${tempDir}/${clipId}.mp4`

    const success = await window.electronAPI.splitVideo({
      input: files.value[0],
      output: outputFile,
      startTime: secondsToHMS(trimStartSec.value),
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
      // 前手柄重置到本次裁剪结束位置，后手柄重置到视频末尾，便于连续裁剪后续片段
      const clipEnd = trimEndSec.value
      trimStartSec.value = Math.min(clipEnd, Math.max(0, duration.value - 0.1))
      trimEndSec.value = duration.value
      seekVideoPlayer(trimStartSec.value)
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
  const clip = clips.value[index]
  if (clip) {
    clip.selected = !clip.selected
  }
}

function moveClip(index: number, direction: -1 | 1): void {
  swapArrayElements(clips.value, index, direction)
}

// ---- Output & Process ----

function getMergeOutputName(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`

  // 优先使用裁剪片段对应的原视频名称
  if (clips.value.length > 0) {
    const baseName = clips.value[0].sourceFileName.replace(/\.[^.]+$/, '')
    return `${baseName}_${dateStr}.mp4`
  }

  return `SN_${dateStr}.mp4`
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

  try {
    const result = await window.electronAPI.mergeVideos({
      inputs: allInputs,
      output: outputDir.value
    })
    if (result) {
      // Clean up selected clip temp files after successful merge
      const deleteResults = await Promise.allSettled(
        clips.value.filter((c) => c.selected).map((c) => window.electronAPI.deleteFile(c.outputFile))
      )
      const failedCount = deleteResults.filter((r) => r.status === 'rejected').length
      if (failedCount > 0) {
        console.warn(`合并后清理临时文件失败: ${failedCount} 个`)
      }
      // Remove merged clips from list to avoid stale references
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

onMounted(() => {
  window.electronAPI.onProgress((info) => {
    store.update(info)
  })
})

if (typeof window !== 'undefined') {
  document.addEventListener('pointermove', onGlobalPointerMove)
  document.addEventListener('pointerup', onGlobalPointerUp)
}

onUnmounted(() => {
  document.removeEventListener('pointermove', onGlobalPointerMove)
  document.removeEventListener('pointerup', onGlobalPointerUp)
  releaseVideoResource()
  // Clean up temporary clip files
  for (const c of clips.value) {
    window.electronAPI.deleteFile(c.outputFile).catch(() => {})
  }
  if (window.electronAPI) {
    window.electronAPI.removeProgressListener()
  }
  // Stop progress store timer to prevent memory leak
  store.reset()
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
      <button
        @click="mode = 'speed'"
        class="px-4 py-1.5 rounded-md text-sm font-medium"
        :class="mode === 'speed' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary'"
      >
        变速
      </button>
    </div>

    <!-- ========== SPLIT / SPEED MODE ========== -->
    <div v-if="mode !== 'merge'" class="space-y-3">
      <!-- No file => drop zone -->
      <FileDropZone v-if="files.length === 0" @files-selected="addFiles" />

      <!-- Has file => full editor -->
      <template v-else>
        <!-- Video Player -->
        <div
          class="video-player-container glass-card relative"
          @drop.prevent="onReplaceDrop"
          @dragover.prevent="onReplaceDragOver"
          @dragleave="onReplaceDragLeave"
        >
          <!-- Replace overlay when dragging -->
          <div
            v-if="isDraggingReplace"
            class="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-gradient-to-r from-accent-blue/20 to-accent-purple/20 animate-pulse-glow pointer-events-none"
          >
            <div class="text-center">
              <RefreshCw :size="40" class="text-accent-purple mx-auto mb-2 animate-spin" />
              <p class="text-accent-purple font-semibold text-sm">松开以替换视频</p>
            </div>
          </div>

          <video
            v-if="videoSrc"
            ref="videoPlayer"
            :src="videoSrc"
            class="w-full rounded-t-xl max-h-[360px] bg-black"
            preload="auto"
            @timeupdate="onTimeUpdate"
            @play="onVideoPlay"
            @pause="onVideoStop"
            @ended="onVideoStop"
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
                @click="pickReplaceVideo"
                class="p-1 rounded hover:bg-accent-blue/10"
                title="替换视频"
              >
                <RefreshCw :size="14" class="text-accent-blue" />
              </button>
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
              <label class="flex items-center gap-1 cursor-pointer select-none" title="开启时拖动时间轴会暂停播放；关闭时拖动时视频继续播放">
                <input
                  type="checkbox"
                  v-model="pauseOnScrub"
                  class="w-3 h-3 accent-blue-500 cursor-pointer"
                />
                <span class="text-xs text-text-secondary">拖动时暂停</span>
              </label>
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
            @pointerdown="startScrub"
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
            <span class="text-xs font-mono text-accent-blue">{{ secondsToHMS(trimStartSec) }}</span>
            <span class="text-xs font-mono text-text-muted">{{ secondsToHMS(duration) }}</span>
            <span class="text-xs font-mono text-accent-purple">{{ secondsToHMS(trimEndSec) }}</span>
          </div>

        </div>


        <!-- Cut-to-list action (split mode only) -->
        <div v-if="mode === 'split'" class="flex items-center gap-3">
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

        <!-- Clips List (split mode only) -->
        <ClipList
          v-if="mode === 'split' && clips.length > 0"
          :clips="clips"
          @toggle="toggleClipSelection"
          @remove="removeClip"
        />

        <!-- Speed Panel (speed mode only) -->
        <SpeedPanel
          v-if="mode === 'speed'"
          :input-file="files[0]"
          :trim-start-sec="trimStartSec"
          :trim-duration="clipDurationSec"
          @error="errorMsg = $event"
        />

        <!-- Error -->
        <div v-if="errorMsg" class="alert-danger">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- Progress (split mode only; speed mode has its own in SpeedPanel) -->
        <ProgressPanel v-if="mode === 'split'" />
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

<style scoped lang="scss">
@use '../../assets/styles/timeline';

.player-btn {
  cursor: pointer;
}

/* ---- Timeline SplitMerge theme ---- */
.timeline-track {
  height: 48px;
  border-radius: 10px;
}

.timeline-selected {
  background: linear-gradient(90deg, rgba(91, 141, 239, 0.3), rgba(167, 139, 250, 0.35));
  border-left: 2px solid hsl(var(--primary));
  border-right: 2px solid var(--color-accent-light);
}

.timeline-playhead {
  outline: 1px solid rgba(255, 107, 107, 0.3);
}

.timeline-playhead.dragging {
  transition: none;
}

.trim-handle {
  background: hsl(var(--primary));
}

/* ---- Responsive ---- */
@media (max-width: 768px) {
  .timeline-track {
    height: 40px;
  }
}
</style>
