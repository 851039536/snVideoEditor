<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import {
  Scissors, X, ArrowUp, ArrowDown, Folder, Play, Pause,
  SkipBack, SkipForward, Video
} from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import VideoPreview from '@/components/VideoPreview.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'

interface VideoMeta {
  duration: number
  width: number
  height: number
  bitrate: number
  codec: string
  size: number
}

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
const dragging = ref<'start' | 'end' | 'playhead' | null>(null)

// Trim times in seconds (normalized 0..duration)
const trimStartSec = ref(0)
const trimEndSec = ref(30)

// ---- Manual time inputs (for fine-tuning) ----
const startHour = ref('00')
const startMin = ref('00')
const startSec = ref('00')
const endHour = ref('00')
const endMin = ref('00')
const endSec = ref('30')

// ---- Output ----
const outputName = ref('')
const outputDir = ref('')
const errorMsg = ref('')

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

const canStart = computed((): boolean => {
  if (mode.value === 'split') {
    if (files.value.length === 0) { return false }
    if (clipDurationSec.value <= 0) { return false }
    return true
  }
  return files.value.length >= 2
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

// ---- Helpers ----

function secondsToHMS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.floor(totalSec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function hmsToSeconds(h: string, m: string, s: string): number {
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

// ---- Sync trim times <-> manual inputs ----

function syncManualToTrim(): void {
  startHour.value = String(Math.floor(trimStartSec.value / 3600)).padStart(2, '0')
  startMin.value = String(Math.floor((trimStartSec.value % 3600) / 60)).padStart(2, '0')
  startSec.value = String(Math.floor(trimStartSec.value % 60)).padStart(2, '0')
  endHour.value = String(Math.floor(trimEndSec.value / 3600)).padStart(2, '0')
  endMin.value = String(Math.floor((trimEndSec.value % 3600) / 60)).padStart(2, '0')
  endSec.value = String(Math.floor(trimEndSec.value % 60)).padStart(2, '0')
}

function syncTrimFromInputs(): void {
  const s = hmsToSeconds(startHour.value, startMin.value, startSec.value)
  const e = hmsToSeconds(endHour.value, endMin.value, endSec.value)
  const max = duration.value || 99999
  trimStartSec.value = clamp(s, 0, trimEndSec.value - 0.5)
  trimEndSec.value = clamp(e, trimStartSec.value + 0.5, max)
  syncManualToTrim()
  if (videoPlayer.value) {
    videoPlayer.value.currentTime = trimStartSec.value
    currentTime.value = trimStartSec.value
  }
}

watch([startHour, startMin, startSec], () => {
  syncTrimFromInputs()
})

watch([endHour, endMin, endSec], () => {
  syncTrimFromInputs()
})

// Watch trimEndSec to clamp it when duration loads
watch(duration, (newDur) => {
  if (newDur > 0) {
    if (trimEndSec.value > newDur || trimEndSec.value === 30) {
      trimEndSec.value = newDur
    }
    syncManualToTrim()
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

function loadFirstFileOnly(): void {
  if (files.value.length > 1) {
    const first = files.value[0]
    files.value = [first]
  }
}

async function loadVideoMeta(filePath: string): Promise<void> {
  try {
    videoMeta.value = await window.electronAPI.getVideoMeta(filePath)
    duration.value = videoMeta.value.duration
    trimStartSec.value = 0
    trimEndSec.value = videoMeta.value.duration
    currentTime.value = 0
    syncManualToTrim()
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
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= files.value.length) { return }
  const temp = files.value[index]
  files.value[index] = files.value[newIndex]
  files.value[newIndex] = temp
}

function switchToSplit(): void {
  mode.value = 'split'
  loadFirstFileOnly()
  if (files.value.length > 0) {
    loadVideoMeta(files.value[0])
  }
}

watch(mode, (newMode) => {
  if (newMode === 'split') {
    loadFirstFileOnly()
    if (files.value.length > 0) {
      loadVideoMeta(files.value[0])
    }
  }
})

// ---- Video player controls ----

function togglePlay(): void {
  const vp = videoPlayer.value
  if (!vp) { return }
  if (vp.paused) {
    vp.play()
    isPlaying.value = true
  } else {
    vp.pause()
    isPlaying.value = false
  }
}

function onTimeUpdate(): void {
  if (!videoPlayer.value) { return }
  currentTime.value = videoPlayer.value.currentTime
  // Auto-stop at end trim point
  if (currentTime.value >= trimEndSec.value) {
    videoPlayer.value.pause()
    videoPlayer.value.currentTime = trimEndSec.value
    currentTime.value = trimEndSec.value
    isPlaying.value = false
  }
}

function onVideoEnded(): void {
  isPlaying.value = false
}

function seekToStart(): void {
  if (!videoPlayer.value) { return }
  videoPlayer.value.currentTime = trimStartSec.value
  currentTime.value = trimStartSec.value
}

function seekToEnd(): void {
  if (!videoPlayer.value) { return }
  videoPlayer.value.currentTime = trimEndSec.value
  currentTime.value = trimEndSec.value
}

// ---- Timeline drag ----

function getTimelineTime(clientX: number): number {
  const el = timelineRef.value
  if (!el || duration.value <= 0) { return 0 }
  const rect = el.getBoundingClientRect()
  const pct = clamp((clientX - rect.left) / rect.width, 0, 1)
  return pct * duration.value
}

function onTimelineMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (target.classList.contains('trim-handle-start')) {
    dragging.value = 'start'
    e.preventDefault()
  } else if (target.classList.contains('trim-handle-end')) {
    dragging.value = 'end'
    e.preventDefault()
  } else {
    // Click on timeline bar => seek to position
    const t = getTimelineTime(e.clientX)
    if (videoPlayer.value) {
      videoPlayer.value.currentTime = t
      currentTime.value = t
    }
  }
}

function onTimelineMouseMove(e: MouseEvent): void {
  if (!dragging.value) { return }
  const t = getTimelineTime(e.clientX)
  if (dragging.value === 'start') {
    trimStartSec.value = clamp(t, 0, trimEndSec.value - 0.1)
    syncManualToTrim()
    if (videoPlayer.value) {
      videoPlayer.value.currentTime = trimStartSec.value
      currentTime.value = trimStartSec.value
    }
  } else if (dragging.value === 'end') {
    trimEndSec.value = clamp(t, trimStartSec.value + 0.1, duration.value)
    syncManualToTrim()
  }
}

// Global mouse up / move for timeline dragging outside the element
function onGlobalMouseMove(e: MouseEvent): void {
  if (dragging.value) {
    onTimelineMouseMove(e)
  }
}

function onGlobalMouseUp(): void {
  dragging.value = null
}

// ---- Output & Process ----

async function selectOutputPath(): Promise<void> {
  const fn = mode.value === 'split' ? `${outputName.value}.mp4` : 'merged_output.mp4'
  const dir = await window.electronAPI.selectSavePath(fn, 'mp4')
  if (dir) {
    outputDir.value = dir
  }
}

async function startProcess(): Promise<void> {
  errorMsg.value = ''
  if (!await validateOutput()) { return }

  store.start(mode.value === 'split' ? 'split' : 'merge')

  window.electronAPI.onProgress((info) => {
    store.update(info)
  })

  try {
    let result = false
    if (mode.value === 'split') {
      result = await window.electronAPI.splitVideo({
        input: files.value[0],
        output: outputDir.value,
        startTime: startTimeStr.value,
        duration: clipDurationStr.value
      })
    } else {
      result = await window.electronAPI.mergeVideos({
        inputs: files.value,
        output: outputDir.value
      })
    }
    if (result) {
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

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

function getSizeStr(bytes: number): string {
  if (!bytes || bytes === 0) { return '' }
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

// ---- Lifecycle ----

if (typeof window !== 'undefined') {
  document.addEventListener('mousemove', onGlobalMouseMove)
  document.addEventListener('mouseup', onGlobalMouseUp)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onGlobalMouseMove)
  document.removeEventListener('mouseup', onGlobalMouseUp)
  window.electronAPI?.removeProgressListener()
})
</script>

<template>
  <div class="split-merge-page max-w-6xl mx-auto animate-slide-up">
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
        @click="switchToSplit"
        class="px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200"
        :class="mode === 'split' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'"
      >
        裁剪
      </button>
      <button
        @click="mode = 'merge'"
        class="px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200"
        :class="mode === 'merge' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'"
      >
        合并
      </button>
    </div>

    <!-- ========== SPLIT MODE ========== -->
    <div v-if="mode === 'split'" class="space-y-4">
      <!-- No file => drop zone -->
      <FileDropZone v-if="files.length === 0" @files-selected="addFiles" />

      <!-- Has file => full editor -->
      <template v-else>
        <!-- Video Player -->
        <div class="video-player-container glass-card overflow-hidden">
          <video
            v-if="videoSrc"
            ref="videoPlayer"
            :src="videoSrc"
            class="w-full rounded-t-xl"
            style="max-height: 360px; background: #000;"
            @timeupdate="onTimeUpdate"
            @ended="onVideoEnded"
            @loadedmetadata="() => { if (videoPlayer) { videoPlayer.currentTime = trimStartSec } }"
          />
          <div v-else class="flex items-center justify-center h-48 bg-black/50 rounded-t-xl">
            <Video :size="40" class="text-text-muted opacity-30" />
          </div>

          <!-- Player Controls -->
          <div class="flex items-center justify-between px-4 py-2.5 bg-bg-secondary/80">
            <div class="flex items-center gap-2">
              <button
                @click="seekToStart"
                class="player-btn p-1.5 rounded-md hover:bg-bg-tertiary transition-colors"
                title="跳到开始"
              >
                <SkipBack :size="16" class="text-text-secondary" />
              </button>
              <button
                @click="togglePlay"
                class="player-btn p-2 rounded-full bg-accent-blue hover:bg-accent-blue/80 transition-all"
              >
                <Pause v-if="isPlaying" :size="16" class="text-white" />
                <Play v-else :size="16" class="text-white ml-0.5" />
              </button>
              <button
                @click="seekToEnd"
                class="player-btn p-1.5 rounded-md hover:bg-bg-tertiary transition-colors"
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
              <span v-if="videoMeta">{{ getSizeStr(videoMeta.size) }}</span>
              <span class="text-accent-blue font-mono">{{ getFileName(files[0]) }}</span>
              <button
                @click="removeFile(0)"
                class="p-1 rounded hover:bg-danger/20 transition-colors"
                title="移除"
              >
                <X :size="14" class="text-text-muted hover:text-danger" />
              </button>
            </div>
          </div>
        </div>

        <!-- Timeline Bar -->
        <div class="glass-card p-5">
          <h3 class="text-sm font-semibold text-text-primary mb-4">裁剪时间轴</h3>

          <!-- The timeline -->
          <div
            ref="timelineRef"
            class="timeline-track"
            @mousedown="onTimelineMouseDown"
          >
            <!-- Left dimmed area -->
            <div class="timeline-dimmed-l" :style="{ width: startPercent + '%' }" />

            <!-- Selected area -->
            <div
              class="timeline-selected"
              :style="{ left: startPercent + '%', width: (endPercent - startPercent) + '%' }"
            >
              <!-- Playhead -->
              <div
                class="timeline-playhead"
                :style="{ left: ((playheadPercent - startPercent) / (endPercent - startPercent) * 100) + '%' }"
                :class="{ 'dragging': dragging === 'playhead' }"
              />
              <!-- Start handle -->
              <div
                class="trim-handle trim-handle-start"
                :style="{ left: '-2px' }"
              />
              <!-- End handle -->
              <div
                class="trim-handle trim-handle-end"
                :style="{ right: '-2px' }"
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

          <!-- Duration label -->
          <div class="flex justify-center mt-3">
            <span class="text-xs text-text-secondary">
              选中片段时长：
              <span class="text-sm font-mono text-accent-blue font-semibold">{{ clipDurationStr }}</span>
            </span>
          </div>
        </div>

        <!-- Fine-tuning inputs -->
        <div class="glass-card p-5">
          <h3 class="text-sm font-semibold text-text-primary mb-3">精确调整（可选）</h3>
          <div class="flex items-center gap-4 flex-wrap">
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-text-secondary w-12">开始</span>
              <input v-model="startHour" class="time-input" maxlength="2" />
              <span class="text-text-muted text-xs">:</span>
              <input v-model="startMin" class="time-input" maxlength="2" />
              <span class="text-text-muted text-xs">:</span>
              <input v-model="startSec" class="time-input" maxlength="2" />
            </div>
            <span class="text-text-muted text-lg">→</span>
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-text-secondary w-12">结束</span>
              <input v-model="endHour" class="time-input" maxlength="2" />
              <span class="text-text-muted text-xs">:</span>
              <input v-model="endMin" class="time-input" maxlength="2" />
              <span class="text-text-muted text-xs">:</span>
              <input v-model="endSec" class="time-input" maxlength="2" />
            </div>
          </div>
        </div>

        <!-- Output + Action -->
        <div class="flex items-start gap-4">
          <div class="flex-1 glass-card p-4">
            <div class="flex items-center gap-3">
              <button
                @click="selectOutputPath"
                class="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary hover:bg-bg-primary text-text-secondary hover:text-text-primary transition-all text-sm border border-transparent hover:border-accent-blue/30"
              >
                <Folder :size="16" />
                选择输出位置
              </button>
              <p v-if="outputDir" class="text-xs text-accent-light truncate flex-1">
                {{ outputDir }}
              </p>
            </div>
          </div>

          <button
            @click="startProcess"
            :disabled="!canStart || store.isProcessing"
            class="px-8 py-2.5 rounded-xl font-semibold text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            :class="canStart && !store.isProcessing
              ? 'bg-gradient-to-r from-accent-blue to-accent-purple hover:shadow-lg hover:shadow-purple-500/25'
              : 'bg-bg-tertiary text-text-muted'"
          >
            <template v-if="!store.isProcessing">
              <Play :size="18" class="inline mr-2 -mt-0.5" />
              开始裁剪
            </template>
            <template v-else>
              处理中...
            </template>
          </button>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="p-3 rounded-lg bg-danger/10 border border-danger/30">
          <p class="text-sm text-danger">{{ errorMsg }}</p>
        </div>

        <!-- Progress -->
        <ProgressPanel />
      </template>
    </div>

    <!-- ========== MERGE MODE ========== -->
    <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Left: Files -->
      <div class="space-y-4">
        <FileDropZone @files-selected="addFiles" />

        <div v-if="files.length > 0" class="glass-card p-4 space-y-2 max-h-80 overflow-y-auto">
          <div
            v-for="(file, idx) in files"
            :key="file"
            class="flex items-center gap-2 p-2 rounded-lg bg-bg-tertiary/50 hover:bg-bg-tertiary transition-colors group"
          >
            <VideoPreview :file-path="file" />
            <div class="flex flex-col gap-1 ml-auto">
              <button
                @click="moveFile(idx, -1)"
                :disabled="idx === 0"
                class="p-0.5 rounded hover:bg-bg-primary disabled:opacity-30 transition-all"
              >
                <ArrowUp :size="14" class="text-text-secondary" />
              </button>
              <button
                @click="moveFile(idx, 1)"
                :disabled="idx === files.length - 1"
                class="p-0.5 rounded hover:bg-bg-primary disabled:opacity-30 transition-all"
              >
                <ArrowDown :size="14" class="text-text-secondary" />
              </button>
            </div>
            <button
              @click="removeFile(idx)"
              class="p-1 rounded hover:bg-danger/20 transition-all opacity-0 group-hover:opacity-100 ml-1"
            >
              <X :size="14" class="text-danger" />
            </button>
          </div>
        </div>
      </div>

      <!-- Right: Actions -->
      <div class="space-y-4">
        <div class="glass-card p-5">
          <h3 class="text-base font-semibold text-text-primary mb-3">合并文件列表</h3>
          <p class="text-sm text-text-secondary">
            当前已添加 <span class="text-accent-blue font-semibold">{{ files.length }}</span> 个文件
          </p>
          <p class="text-xs text-text-muted mt-2">
            使用箭头调整顺序，合并时按列表顺序拼接
          </p>
        </div>

        <div class="glass-card p-5">
          <h3 class="text-base font-semibold text-text-primary mb-3">输出设置</h3>
          <button
            @click="selectOutputPath"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary hover:bg-bg-primary text-text-secondary hover:text-text-primary transition-all text-sm border border-transparent hover:border-accent-blue/30"
          >
            <Folder :size="16" />
            选择输出位置
          </button>
          <p v-if="outputDir" class="text-xs text-accent-light mt-2 truncate">
            {{ outputDir }}
          </p>
        </div>

        <div v-if="errorMsg" class="p-3 rounded-lg bg-danger/10 border border-danger/30">
          <p class="text-sm text-danger">{{ errorMsg }}</p>
        </div>

        <button
          @click="startProcess"
          :disabled="!canStart || store.isProcessing"
          class="w-full py-3 rounded-xl font-semibold text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="canStart && !store.isProcessing
            ? 'bg-gradient-to-r from-accent-blue to-accent-purple hover:shadow-lg hover:shadow-purple-500/25'
            : 'bg-bg-tertiary text-text-muted'"
        >
          <template v-if="!store.isProcessing">
            <Play :size="18" class="inline mr-2 -mt-0.5" />
            开始合并
          </template>
          <template v-else>
            处理中...
          </template>
        </button>

        <ProgressPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.split-merge-page {
  padding-bottom: 24px;
}

/* ---- Video Player ---- */
.video-player-container {
  overflow: hidden;
}

.player-btn {
  cursor: pointer;
}

/* ---- Timeline ---- */
.timeline-track {
  position: relative;
  width: 100%;
  height: 48px;
  background: #161B22;
  border-radius: 10px;
  display: flex;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
}

.timeline-dimmed-l,
.timeline-dimmed-r {
  height: 100%;
  background: rgba(22, 27, 34, 0.8);
  flex-shrink: 0;
}

.timeline-selected {
  position: relative;
  height: 100%;
  background: linear-gradient(90deg, rgba(91, 141, 239, 0.3), rgba(167, 139, 250, 0.35));
  border-left: 2px solid #5B8DEF;
  border-right: 2px solid #A78BFA;
  flex-shrink: 0;
}

.timeline-playhead {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: #FF6B6B;
  box-shadow: 0 0 6px rgba(255, 107, 107, 0.7);
  z-index: 5;
  transition: left 0.1s linear;
  pointer-events: none;
}

.timeline-playhead.dragging {
  transition: none;
}

/* ---- Trim Handles ---- */
.trim-handle {
  position: absolute;
  top: 0;
  width: 10px;
  height: 100%;
  cursor: ew-resize;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}

.trim-handle-start {
  border-radius: 2px 0 0 2px;
}

.trim-handle-end {
  border-radius: 0 2px 2px 0;
}

.trim-handle::after {
  content: '';
  position: absolute;
  width: 3px;
  height: 60%;
  border-radius: 2px;
  background: #E6EDF3;
  opacity: 0.8;
  transition: opacity 0.15s, background 0.15s;
}

.trim-handle:hover::after {
  opacity: 1;
  background: #FFF;
}

.trim-handle-start::before,
.trim-handle-end::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(91, 141, 239, 0.15);
  opacity: 0;
  transition: opacity 0.15s;
}

.trim-handle:hover::before {
  opacity: 1;
}

/* ---- Time Input ---- */
.time-input {
  width: 38px;
  padding: 5px 6px;
  text-align: center;
  font-size: 13px;
  font-family: monospace;
  background: #21262D;
  border: 1px solid #30363D;
  border-radius: 6px;
  color: #E6EDF3;
  outline: none;
  transition: border-color 0.2s;
}

.time-input:focus {
  border-color: #5B8DEF;
}

/* ---- Responsive ---- */
@media (max-width: 768px) {
  .timeline-track {
    height: 40px;
  }
}
</style>
