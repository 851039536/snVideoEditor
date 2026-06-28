<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Image, Folder, X, Zap, Clock } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'
import { secondsToHMS, hmsToSeconds, formatDuration } from '@/utils/time'
import { clamp } from '@/utils/math'
import { useFileList } from '@/composables/useFileList'
import type { FileEntry } from '@/types/file'

const progressStore = useProgressStore()
const { files, addFiles, removeFile, selectOutputDir } = useFileList()

// Quality presets
interface QualityPreset {
  value: 'high' | 'medium' | 'low'
  label: string
  description: string
}

const qualityPresets: QualityPreset[] = [
  { value: 'high', label: '高质量', description: '最佳画质，文件较大' },
  { value: 'medium', label: '中等质量', description: '画质与大小平衡' },
  { value: 'low', label: '低质量', description: '最小文件，快速生成' }
]
const selectedQuality = ref<'high' | 'medium' | 'low'>('medium')

// Parameters
const fps = ref(10)
const selectedWidth = ref('480')
const widthOptions = [
  { label: '原始尺寸', value: '0' },
  { label: '320px', value: '320' },
  { label: '480px (推荐)', value: '480' },
  { label: '640px', value: '640' },
  { label: '800px', value: '800' }
]

// Segment trimming — always visible, HH:MM:SS like SplitMerge
const enableTrim = ref(false)
const startHour = ref('00')
const startMin = ref('00')
const startSec = ref('00')
const endHour = ref('00')
const endMin = ref('00')
const endSec = ref('05')
const maxDuration = ref(0)

// Video player
const videoPlayer = ref<HTMLVideoElement | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)

const trimStartSec = computed((): number => {
  return hmsToSeconds(startHour.value, startMin.value, startSec.value)
})

const trimEndSec = computed((): number => {
  return hmsToSeconds(endHour.value, endMin.value, endSec.value)
})

const trimDuration = computed((): number => {
  return Math.max(0, trimEndSec.value - trimStartSec.value)
})

const trimDurationStr = computed((): string => {
  return secondsToHMS(trimDuration.value)
})

const MIN_TRIM_GAP = 0.1
let syncing = false

function syncTrimFromInputs(): void {
  if (syncing) { return }
  syncing = true
  try {
    const s = hmsToSeconds(startHour.value, startMin.value, startSec.value)
    const e = hmsToSeconds(endHour.value, endMin.value, endSec.value)
    const max = maxDuration.value || 99999
    const clampedStart = clamp(s, 0, max)
    const clampedEnd = clamp(e, clampedStart + MIN_TRIM_GAP, max)
    if (clampedStart !== s) {
      const hms = secondsToHMS(clampedStart).split(':')
      startHour.value = hms[0]; startMin.value = hms[1]; startSec.value = hms[2]
    }
    if (clampedEnd !== e) {
      const hms = secondsToHMS(clampedEnd).split(':')
      endHour.value = hms[0]; endMin.value = hms[1]; endSec.value = hms[2]
    }
  } finally {
    syncing = false
  }
}

watch([startHour, startMin, startSec, endHour, endMin, endSec], () => {
  syncTrimFromInputs()
})

// Loop
const loopCount = ref(0)

// Auto-set end time when first file metadata loads
watch(() => files.value[0]?.meta, (meta) => {
  if (!meta || meta.duration <= 0) { return }
  maxDuration.value = meta.duration
  // Only auto-set end if not yet set by user (keep visible selection range)
  if (trimDuration.value <= 0 || trimEndSec.value > meta.duration) {
    const clampEnd = Math.min(5, meta.duration)
    const hms = secondsToHMS(clampEnd).split(':')
    endHour.value = hms[0]
    endMin.value = hms[1]
    endSec.value = hms[2]
  }
})
const errorMsg = ref('')

const videoSrc = computed((): string => {
  if (files.value.length === 0) { return '' }
  return `file:///${files.value[0].path.replace(/\\/g, '/')}`
})

// ---- Video player controls ----

async function togglePlay(): Promise<void> {
  const vp = videoPlayer.value
  if (!vp) { return }
  if (vp.paused) {
    try { await vp.play() } catch (_e) { /* ignore */ }
  } else {
    vp.pause()
  }
}

function onVideoPlay(): void { isPlaying.value = true }
function onVideoPause(): void { isPlaying.value = false }
function onVideoEnded(): void { isPlaying.value = false }

function onTimeUpdate(): void {
  if (!videoPlayer.value) { return }
  currentTime.value = videoPlayer.value.currentTime
  // Auto-stop at end trim point when trim is enabled
  if (enableTrim.value && currentTime.value >= trimEndSec.value) {
    videoPlayer.value.pause()
    videoPlayer.value.currentTime = trimEndSec.value
    currentTime.value = trimEndSec.value
  }
}

function onVideoLoaded(): void {
  if (videoPlayer.value) {
    videoPlayer.value.currentTime = enableTrim.value ? trimStartSec.value : 0
    currentTime.value = enableTrim.value ? trimStartSec.value : 0
  }
}

function onVideoError(e: Event): void {
  const v = e.target as HTMLVideoElement
  console.error('视频加载失败:', v?.error?.message)
}

// Seek video when trim start changes (from drag or manual input)
watch(trimStartSec, (start) => {
  if (!videoPlayer.value) { return }
  videoPlayer.value.currentTime = start
  currentTime.value = start
})

// ---- Timeline drag handles ----

const timelineRef = ref<HTMLDivElement | null>(null)
const dragging = ref<'start' | 'end' | null>(null)

const startPercent = computed((): number => {
  if (maxDuration.value <= 0) { return 0 }
  return (trimStartSec.value / maxDuration.value) * 100
})

const endPercent = computed((): number => {
  if (maxDuration.value <= 0) { return 100 }
  return (trimEndSec.value / maxDuration.value) * 100
})

const playheadPercent = computed((): number => {
  if (maxDuration.value <= 0) { return 0 }
  return (currentTime.value / maxDuration.value) * 100
})

function getTimelineTime(clientX: number): number {
  const el = timelineRef.value
  if (!el || maxDuration.value <= 0) { return 0 }
  const rect = el.getBoundingClientRect()
  const pct = clamp((clientX - rect.left) / rect.width, 0, 1)
  return pct * maxDuration.value
}

function startHandleDrag(handle: 'start' | 'end', e: MouseEvent): void {
  dragging.value = handle
  e.preventDefault()
  e.stopPropagation()
}

function onTimelineClick(e: MouseEvent): void {
  if (dragging.value) { return }
  const t = getTimelineTime(e.clientX)
  if (videoPlayer.value) {
    videoPlayer.value.currentTime = t
    currentTime.value = t
  }
}

function onTimelineMove(e: MouseEvent): void {
  if (!dragging.value) { return }
  const t = getTimelineTime(e.clientX)
  if (dragging.value === 'start') {
    const clamped = clamp(t, 0, trimEndSec.value - MIN_TRIM_GAP)
    const hms = secondsToHMS(clamped).split(':')
    startHour.value = hms[0]; startMin.value = hms[1]; startSec.value = hms[2]
    if (videoPlayer.value) {
      videoPlayer.value.currentTime = clamped
      currentTime.value = clamped
    }
  } else {
    const clamped = clamp(t, trimStartSec.value + MIN_TRIM_GAP, maxDuration.value)
    const hms = secondsToHMS(clamped).split(':')
    endHour.value = hms[0]; endMin.value = hms[1]; endSec.value = hms[2]
  }
}

function onGlobalMouseMove(e: MouseEvent): void { onTimelineMove(e) }
function onGlobalMouseUp(): void { dragging.value = null }

onMounted(() => {
  document.addEventListener('mousemove', onGlobalMouseMove)
  document.addEventListener('mouseup', onGlobalMouseUp)
})

onUnmounted(() => {
  document.removeEventListener('mousemove', onGlobalMouseMove)
  document.removeEventListener('mouseup', onGlobalMouseUp)
})

const computedWidth = computed((): number => {
  return parseInt(selectedWidth.value)
})

const canStart = computed((): boolean => {
  return files.value.length > 0 && !progressStore.isProcessing
})

function estimateOutputSize(entry: FileEntry): string {
  if (!entry.meta || entry.meta.duration === 0) { return '未知' }
  const duration = enableTrim.value ? trimDuration.value : entry.meta.duration
  const w = computedWidth.value > 0 ? computedWidth.value : (entry.meta.width || 640)
  const pixels = w * (w * 9 / 16)
  const frames = duration * fps.value
  const qualityFactors: Record<string, number> = { high: 0.6, medium: 0.4, low: 0.2 }
  const factor = qualityFactors[selectedQuality.value] || 0.4
  const estBytes = frames * pixels * factor * 0.3
  const estMB = estBytes / (1024 * 1024)
  if (estMB < 0.1) { return '< 0.1 MB' }
  return `~${estMB.toFixed(1)} MB`
}

async function startConvert(): Promise<void> {
  errorMsg.value = ''
  if (files.value.length === 0) { return }

  for (const entry of files.value) {
    if (!entry.outputPath) {
      await selectOutputDir('.gif')
      break
    }
  }

  const unresolved = files.value.filter((f) => !f.outputPath)
  if (unresolved.length > 0) {
    errorMsg.value = '请为所有文件选择输出目录'
    return
  }

  progressStore.start('gif')
  window.electronAPI.onProgress((info) => {
    progressStore.update(info)
  })

  try {
    const trimmedStart = enableTrim.value ? trimStartSec.value : undefined
    const trimmedDuration = enableTrim.value ? trimDuration.value : undefined

    if (files.value.length === 1) {
      const f = files.value[0]
      const result = await window.electronAPI.convertToGif({
        input: f.path,
        output: f.outputPath,
        fps: fps.value,
        width: computedWidth.value,
        quality: selectedQuality.value,
        startTime: trimmedStart,
        duration: trimmedDuration,
        loop: loopCount.value
      })
      if (result) {
        progressStore.finish()
      }
    } else {
      const batchFiles = files.value.map((f) => ({
        input: f.path,
        output: f.outputPath,
        fps: fps.value,
        width: computedWidth.value,
        quality: selectedQuality.value,
        startTime: trimmedStart,
        duration: trimmedDuration,
        loop: loopCount.value
      }))
      const result = await window.electronAPI.batchConvertToGif({ files: batchFiles })
      if (result.failed.length === 0) {
        progressStore.finish()
      } else {
        errorMsg.value = `${result.failed.length} 个文件转换失败`
        progressStore.reset()
      }
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    progressStore.reset()
  }
}

onUnmounted(() => {
  window.electronAPI?.removeProgressListener()
})
</script>

<template>
  <div class="max-w-6xl mx-auto animate-slide-up">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500/20 to-yellow-500/20 flex items-center justify-center">
          <Image :size="20" class="text-warning" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频转GIF</h1>
      </div>
      <p class="text-text-secondary text-sm">将视频片段转换为高质量 GIF 动图，双通道调色板优化</p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Left: File List -->
      <div class="space-y-3">
        <FileDropZone @files-selected="addFiles" />

        <!-- Video Player -->
        <div v-if="files.length > 0" class="video-player-container glass-card">
          <video
            v-if="videoSrc"
            ref="videoPlayer"
            :src="videoSrc"
            class="w-full"
            style="max-height: 260px; background: #000;"
            preload="auto"
            @timeupdate="onTimeUpdate"
            @play="onVideoPlay"
            @pause="onVideoPause"
            @ended="onVideoEnded"
            @error="onVideoError"
            @loadedmetadata="onVideoLoaded"
          />
          <div v-else class="flex items-center justify-center h-32 bg-black rounded-t-xl">
            <Image :size="28" class="text-text-muted opacity-30" />
          </div>

          <!-- Player Controls -->
          <div class="flex items-center justify-between px-3 py-2 bg-bg-secondary/80">
            <div class="flex items-center gap-2">
              <button
                @click="togglePlay"
                class="p-1.5 rounded-full"
                :class="isPlaying ? 'bg-accent-purple' : 'bg-accent-blue'"
              >
                <svg v-if="isPlaying" class="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
                <svg v-else class="w-3.5 h-3.5 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              </button>
              <span class="text-xs font-mono text-text-secondary">
                {{ secondsToHMS(currentTime) }} / {{ secondsToHMS(maxDuration) }}
              </span>
            </div>
            <span v-if="files[0]?.meta" class="text-xs text-text-muted truncate ml-2 max-w-[160px]">
              {{ files[0].path.split(/[/\\]/).pop() }}
            </span>
          </div>
        </div>

        <!-- Segment Trimming — Timeline + Time Inputs -->
        <div v-if="files.length > 0" class="glass-card p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <Clock :size="16" class="text-text-secondary" />
              <h3 class="text-sm font-semibold text-text-primary">截取片段</h3>
            </div>
            <button
              @click="enableTrim = !enableTrim"
              class="text-xs px-3 py-1 rounded-md border transition-colors font-medium"
              :class="enableTrim
                ? 'border-warning/50 text-warning bg-warning/10'
                : 'border-bg-tertiary text-text-secondary'"
            >
              {{ enableTrim ? '已启用' : '关闭' }}
            </button>
          </div>

          <p v-if="!enableTrim" class="text-xs text-text-muted mb-3">
            拖拽下方摇杆选取范围，点击「关闭」按钮启用截取
          </p>

          <!-- Timeline Bar with Drag Handles -->
          <div class="mb-3">
            <div
              ref="timelineRef"
              class="timeline-track"
              @click="onTimelineClick"
            >
              <div class="timeline-dimmed-l" :style="{ width: startPercent + '%' }" />
              <div class="timeline-selected" :style="{ width: (endPercent - startPercent) + '%' }">
                <div class="timeline-playhead" :style="{ left: ((playheadPercent - startPercent) / (endPercent - startPercent) * 100) + '%' }" />
                <div class="trim-handle trim-handle-start" @mousedown="startHandleDrag('start', $event)" />
                <div class="trim-handle trim-handle-end" @mousedown="startHandleDrag('end', $event)" />
              </div>
              <div class="timeline-dimmed-r" :style="{ width: (100 - endPercent) + '%' }" />
            </div>
            <div class="flex justify-between mt-1.5 px-1">
              <span class="text-xs font-mono text-accent-blue">{{ secondsToHMS(trimStartSec) }}</span>
              <span class="text-xs font-mono text-text-muted">{{ secondsToHMS(maxDuration) }}</span>
              <span class="text-xs font-mono text-accent-purple">{{ secondsToHMS(trimEndSec) }}</span>
            </div>
          </div>

          <!-- HH:MM:SS fine-tuning -->
          <div class="flex items-center justify-center gap-2 flex-wrap">
            <div class="flex items-center gap-1">
              <span class="text-xs text-text-muted w-8">起始</span>
              <input v-model="startHour" class="time-input" maxlength="2" />
              <span class="text-text-muted text-xs">:</span>
              <input v-model="startMin" class="time-input" maxlength="2" />
              <span class="text-text-muted text-xs">:</span>
              <input v-model="startSec" class="time-input" maxlength="2" />
            </div>
            <span class="text-text-muted text-sm">→</span>
            <div class="flex items-center gap-1">
              <span class="text-xs text-text-muted w-8">结束</span>
              <input v-model="endHour" class="time-input" maxlength="2" />
              <span class="text-text-muted text-xs">:</span>
              <input v-model="endMin" class="time-input" maxlength="2" />
              <span class="text-text-muted text-xs">:</span>
              <input v-model="endSec" class="time-input" maxlength="2" />
            </div>
          </div>
          <p class="text-center text-xs text-warning mt-2">
            截取时长: <span class="font-mono font-semibold">{{ trimDurationStr }}</span>
          </p>
        </div>

        <!-- File Table -->
        <div v-if="files.length > 0" class="glass-card overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-bg-tertiary text-text-secondary text-xs">
                <th class="text-left p-3 font-medium">文件名</th>
                <th class="text-right p-3 font-medium">时长</th>
                <th class="text-right p-3 font-medium">预估</th>
                <th class="text-right p-3 font-medium w-10" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(entry, idx) in files"
                :key="entry.path"
                class="border-b border-bg-tertiary/50 group"
              >
                <td class="p-3">
                  <div class="flex items-center gap-2">
                    <Image :size="16" class="text-warning flex-shrink-0" />
                    <span class="truncate max-w-[200px]" :title="entry.path">
                      {{ entry.path.split(/[/\\]/).pop() }}
                    </span>
                  </div>
                </td>
                <td class="p-3 text-right text-text-secondary">
                  {{ entry.meta ? formatDuration(entry.meta.duration) : '...' }}
                </td>
                <td class="p-3 text-right text-warning font-mono">
                  {{ entry.meta ? estimateOutputSize(entry) : '...' }}
                </td>
                <td class="p-3 text-right">
                  <button
                    @click="removeFile(idx)"
                    class="p-1 rounded"
                  >
                    <X :size="14" class="text-danger" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right: Parameters -->
      <div class="space-y-3">
        <!-- Quality Presets -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">质量预设</h3>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="p in qualityPresets"
              :key="p.value"
              @click="selectedQuality = p.value"
              class="preset-btn p-3 rounded-lg text-left transition-all duration-200"
              :class="selectedQuality === p.value
                ? 'bg-warning/10 border-warning/50'
                : 'bg-bg-tertiary/50 border-transparent'"
              style="border-width: 1px; border-style: solid;"
            >
              <span class="text-sm font-medium text-text-primary block">{{ p.label }}</span>
              <span class="text-xs text-text-muted">{{ p.description }}</span>
            </button>
          </div>
        </div>

        <!-- FPS Slider -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">帧率: {{ fps }} FPS</h3>
          <input
            v-model.number="fps"
            type="range"
            min="5"
            max="30"
            step="1"
            class="w-full slider"
          />
          <div class="flex justify-between text-xs text-text-muted mt-1">
            <span>5</span>
            <span>10 (推荐)</span>
            <span>15</span>
            <span>20</span>
            <span>25</span>
            <span>30</span>
          </div>
        </div>

        <!-- Width Selector -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">输出分辨率</h3>
          <select v-model="selectedWidth" class="select-input w-full">
            <option
              v-for="opt in widthOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- Loop Setting -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">循环设置</h3>
          <div class="flex gap-2">
            <button
              v-for="opt in [{ label: '无限', val: 0 }, { label: '1次', val: 1 }, { label: '3次', val: 3 }, { label: '5次', val: 5 }]"
              :key="opt.val"
              @click="loopCount = opt.val"
              class="flex-1 py-2 rounded-lg text-sm transition-all border"
              :class="loopCount === opt.val
                ? 'bg-warning/10 border-warning/50 text-text-primary'
                : 'bg-bg-tertiary/50 border-transparent text-text-secondary'"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- Output Settings -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">输出设置</h3>
          <button
            @click="selectOutputDir('.gif')"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary text-text-secondary text-sm border border-transparent"
          >
            <Folder :size="16" />
            选择输出目录
          </button>
          <p v-if="files.length > 0 && files[0].outputPath" class="text-xs text-warning mt-2 truncate">
            {{ files[0].outputPath.split('/').slice(0, -1).join('/') }}
          </p>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="p-3 rounded-lg bg-danger/10 border border-danger/30">
          <p class="text-sm text-danger">{{ errorMsg }}</p>
        </div>

        <!-- Start Button -->
        <button
          @click="startConvert"
          :disabled="!canStart"
          class="w-full py-3 rounded-xl font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="canStart
            ? 'bg-gradient-to-r from-orange-500 to-yellow-500'
            : 'bg-bg-tertiary text-text-muted'"
        >
          <Zap :size="18" />
          {{ progressStore.isProcessing ? '转换中...' : `开始转换 (${files.length} 个文件)` }}
        </button>

        <ProgressPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.video-player-container {
  overflow: hidden;
}

.slider {
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  background: linear-gradient(to right, #F0A050, #D29922);
  border-radius: 3px;
  outline: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: hsl(var(--foreground));
  border: 2px solid #F0A050;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(240, 160, 80, 0.4);
}

.time-input {
  width: 2rem;
  padding: 3px 4px;
  text-align: center;
  font-size: 0.6875rem;
  font-family: monospace;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-base, 6px);
  color: hsl(var(--foreground));
  outline: none;
}

/* ---- Timeline ---- */
.timeline-track {
  position: relative;
  width: 100%;
  height: 40px;
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
  background: rgba(22, 27, 34, 0.8);
  flex-shrink: 0;
}

.timeline-selected {
  position: relative;
  height: 100%;
  background: linear-gradient(90deg, rgba(240, 160, 80, 0.3), rgba(210, 153, 34, 0.35));
  border-left: 2px solid #F0A050;
  border-right: 2px solid #D29922;
  flex-shrink: 0;
}

.timeline-playhead {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: #FF6B6B;
  outline: 1px solid rgba(255, 107, 107, 0.3);
  z-index: 5;
  transition: left 0.1s linear;
  pointer-events: none;
}

/* ---- Trim Handles ---- */
.trim-handle {
  position: absolute;
  top: -4px;
  width: 16px;
  height: calc(100% + 8px);
  cursor: ew-resize;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}

.trim-handle-start {
  left: -8px;
  border-radius: 2px 0 0 2px;
}

.trim-handle-end {
  right: -8px;
  border-radius: 0 2px 2px 0;
}

.trim-handle::after {
  content: '';
  position: absolute;
  width: 3px;
  height: 60%;
  border-radius: 2px;
  background: hsl(var(--foreground));
  opacity: 0.8;
}

@media (max-width: 768px) {
  .slider {
    height: 8px;
  }
}
</style>
