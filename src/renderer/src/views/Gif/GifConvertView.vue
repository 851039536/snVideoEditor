<!-- 视频转GIF页面：参数配置、裁剪预览与批量转换 -->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Image, Folder, X, Zap, Clock, Play, Pause } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'
import { secondsToHMS, formatDuration } from '@/utils/time'
import { clamp } from '@/utils/math'
import { getFileName, toFileUrl, getDirName } from '@/utils/format'
import { useFileList } from '@/composables/useFileList'
import { useVideoPlayer } from '@/composables/useVideoPlayer'
import { useTrimTimeline } from '@/composables/useTrimTimeline'
import type { FileEntry } from '@/types/file'
import type { QualityPreset, WidthOption } from './types'

const progressStore = useProgressStore()
const { files, addFiles, removeFile, selectOutputDir } = useFileList('.gif')

// 质量预设
const QUALITY_PRESETS: QualityPreset[] = [
  { value: 'high', label: '高质量', description: '最佳画质，文件较大' },
  { value: 'medium', label: '中等质量', description: '画质与大小平衡' },
  { value: 'low', label: '低质量', description: '最小文件，快速生成' }
]
const selectedQuality = ref<'high' | 'medium' | 'low'>('medium')

// 参数配置
const fps = ref(10)
const selectedWidth = ref('480')
const WIDTH_OPTIONS: WidthOption[] = [
  { label: '原始尺寸', value: '0' },
  { label: '320px', value: '320' },
  { label: '480px (推荐)', value: '480' },
  { label: '640px', value: '640' },
  { label: '800px', value: '800' }
]

// 片段截取 — 时间轴与精确输入（HH:MM:SS）
const DEFAULT_TRIM_DURATION = 5       // 默认截取时长（秒）
const FALLBACK_WIDTH = 640            // 元数据缺失时的回退宽度
const SIZE_ESTIMATE_FACTOR = 0.3      // GIF 体积估算压缩系数
const QUALITY_SIZE_FACTORS: Record<string, number> = { high: 0.6, medium: 0.4, low: 0.2 }
const LOOP_OPTIONS = [
  { label: '无限', val: 0 },
  { label: '1次', val: 1 },
  { label: '3次', val: 3 },
  { label: '5次', val: 5 }
] as const
const enableTrim = ref(false)
const trimStartSec = ref(0)
const trimEndSec = ref(DEFAULT_TRIM_DURATION)
const maxDuration = ref(0)
const MIN_TRIM_GAP = 0.1

// ---- 视频播放器 ----
const { videoPlayer, isPlaying, currentTime, togglePlay, onVideoPlay, onVideoStop, onTimeUpdate, onVideoError, onVideoLoaded, seekVideoPlayer } = useVideoPlayer({
  onTimeUpdate: (t, vp) => {
    // 启用截取时，播放到结束点自动暂停
    if (enableTrim.value && t >= trimEndSec.value) {
      vp.pause()
      vp.currentTime = trimEndSec.value
      currentTime.value = trimEndSec.value
    }
  },
  onLoaded: (vp) => {
    vp.currentTime = enableTrim.value ? trimStartSec.value : 0
    currentTime.value = enableTrim.value ? trimStartSec.value : 0
  }
})

// ---- 截取时间轴 ----
const {
  timelineRef,
  startHour, startMin, startSec, endHour, endMin, endSec,
  startPercent, endPercent, playheadPercent: playheadPercentFn,
  startHandleDrag,
  trimDuration, trimDurationStr,
  startScrub, onGlobalPointerMove, onGlobalPointerUp
} = useTrimTimeline({
  duration: maxDuration,
  trimStart: trimStartSec,
  trimEnd: trimEndSec,
  seekTo: seekVideoPlayer,
  minGap: MIN_TRIM_GAP,
  currentTime,
  videoPlayer
})
const playheadPercent = playheadPercentFn(currentTime)

const playheadInTrim = computed((): number => {
  const range = endPercent.value - startPercent.value
  if (range <= 0) { return 0 }
  return clamp(((playheadPercent.value - startPercent.value) / range) * 100, 0, 100)
})

// 循环次数
const loopCount = ref(0)

// 首个文件元数据加载后自动设置截取终点
watch(() => files.value[0]?.meta, (meta) => {
  if (!meta || meta.duration <= 0) {
    maxDuration.value = 0
    return
  }
  maxDuration.value = meta.duration
  // 仅在用户未手动设置时自动调整终点
  if (trimDuration.value <= 0 || trimEndSec.value > meta.duration) {
    trimEndSec.value = Math.min(DEFAULT_TRIM_DURATION, meta.duration)
  }
})

// 切换截取开关时重置播放位置
watch(enableTrim, (enabled) => {
  seekVideoPlayer(enabled ? trimStartSec.value : 0)
})
const errorMsg = ref('')

const videoSrc = computed((): string => {
  if (files.value.length === 0) { return '' }
  return toFileUrl(files.value[0].path)
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
  const w = computedWidth.value > 0 ? computedWidth.value : (entry.meta.width || FALLBACK_WIDTH)
  const h = (entry.meta.height && entry.meta.width > 0)
    ? Math.round(w * (entry.meta.height / entry.meta.width))
    : Math.round(w * 9 / 16)
  const pixels = w * h
  const frames = duration * fps.value
  const factor = QUALITY_SIZE_FACTORS[selectedQuality.value]
  const estBytes = frames * pixels * factor * SIZE_ESTIMATE_FACTOR
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
      // 用户已取消（progressStore.cancel() 已 reset），不再更新状态
      if (!progressStore.isProcessing) { return }
      if (result) {
        progressStore.finish()
      } else {
        progressStore.reset()
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
      // 用户已取消（progressStore.cancel() 已 reset），不再更新状态
      if (!progressStore.isProcessing) { return }
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

onMounted(() => {
  window.electronAPI.onProgress((info) => {
    progressStore.update(info)
  })
  document.addEventListener('pointermove', onGlobalPointerMove)
  document.addEventListener('pointerup', onGlobalPointerUp)
})

onUnmounted(() => {
  document.removeEventListener('pointermove', onGlobalPointerMove)
  document.removeEventListener('pointerup', onGlobalPointerUp)
  window.electronAPI?.removeProgressListener()
})
</script>

<template>
  <div class="page-container">
    <!-- 头部 -->
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
      <!-- 左侧：文件列表 -->
      <div class="space-y-3">
        <FileDropZone @files-selected="addFiles" />

        <!-- 视频播放器 -->
        <div v-if="files.length > 0" class="video-player-container glass-card">
          <video
            v-if="videoSrc"
            ref="videoPlayer"
            :src="videoSrc"
            class="w-full max-h-[260px] bg-black"
            preload="auto"
            @timeupdate="onTimeUpdate"
            @play="onVideoPlay"
            @pause="onVideoStop"
            @ended="onVideoStop"
            @error="onVideoError"
            @loadedmetadata="onVideoLoaded"
          />
          <div v-else class="flex items-center justify-center h-32 bg-black rounded-t-xl">
            <Image :size="28" class="text-text-muted opacity-30" />
          </div>

          <!-- 播放器控制栏 -->
          <div class="flex items-center justify-between px-3 py-2 bg-bg-secondary/80">
            <div class="flex items-center gap-2">
              <button
                @click="togglePlay"
                class="p-1.5 rounded-full"
                :class="isPlaying ? 'bg-accent-purple' : 'bg-accent-blue'"
              >
                <Pause v-if="isPlaying" :size="14" class="text-white" />
                <Play v-else :size="14" class="text-white ml-0.5" />
              </button>
              <span class="text-xs font-mono text-text-secondary">
                {{ secondsToHMS(currentTime) }} / {{ secondsToHMS(maxDuration) }}
              </span>
            </div>
            <span v-if="files[0]?.meta" class="text-xs text-text-muted truncate ml-2 max-w-[160px]">
              {{ getFileName(files[0].path) }}
            </span>
          </div>
        </div>

        <!-- 片段截取 — 时间轴 + 精确输入 -->
        <div v-if="files.length > 0" class="glass-card">
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
              {{ enableTrim ? '已启用' : '启用截取' }}
            </button>
          </div>

          <p v-if="!enableTrim" class="text-xs text-text-muted mb-3">
            拖拽下方摇杆选取范围，点击「启用截取」按钮启用截取
          </p>

          <!-- 时间轴与拖拽手柄 -->
          <div class="mb-3">
            <div
              ref="timelineRef"
              class="timeline-track"
              @pointerdown="startScrub"
            >
              <div class="timeline-dimmed-l" :style="{ width: startPercent + '%' }" />
              <div class="timeline-selected" :style="{ width: (endPercent - startPercent) + '%' }">
                <div class="timeline-playhead" :style="{ left: playheadInTrim + '%' }" />
                <div class="trim-handle trim-handle-start" @pointerdown="startHandleDrag('start', $event)" />
                <div class="trim-handle trim-handle-end" @pointerdown="startHandleDrag('end', $event)" />
              </div>
              <div class="timeline-dimmed-r" :style="{ width: (100 - endPercent) + '%' }" />
            </div>
            <div class="flex justify-between mt-1.5 px-1">
              <span class="text-xs font-mono text-accent-blue">{{ secondsToHMS(trimStartSec) }}</span>
              <span class="text-xs font-mono text-text-muted">{{ secondsToHMS(maxDuration) }}</span>
              <span class="text-xs font-mono text-accent-purple">{{ secondsToHMS(trimEndSec) }}</span>
            </div>
          </div>

          <!-- HH:MM:SS 精确调整 -->
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

        <!-- 文件列表 -->
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
                      {{ getFileName(entry.path) }}
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

      <!-- 右侧：参数配置 -->
      <div class="space-y-3">
        <!-- 质量预设 -->
        <div class="glass-card">
          <h3 class="section-title">质量预设</h3>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="p in QUALITY_PRESETS"
              :key="p.value"
              @click="selectedQuality = p.value"
              class="quality-preset-btn p-3 rounded-lg text-left transition-all duration-200 border"
              :class="selectedQuality === p.value
                ? 'bg-warning/10 border-warning/50'
                : 'bg-bg-tertiary/50 border-transparent'"
            >
              <span class="text-sm font-medium text-text-primary block">{{ p.label }}</span>
              <span class="text-xs text-text-muted">{{ p.description }}</span>
            </button>
          </div>
        </div>

        <!-- 帧率滑块 -->
        <div class="glass-card">
          <h3 class="section-title">帧率: {{ fps }} FPS</h3>
          <input
            v-model.number="fps"
            type="range"
            min="5"
            max="30"
            step="1"
            class="w-full slider-base slider"
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

        <!-- 宽度选择 -->
        <div class="glass-card">
          <h3 class="section-title">输出分辨率</h3>
          <select v-model="selectedWidth" class="select-input w-full">
            <option
              v-for="opt in WIDTH_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- 循环设置 -->
        <div class="glass-card">
          <h3 class="section-title">循环设置</h3>
          <div class="flex gap-2">
            <button
              v-for="opt in LOOP_OPTIONS"
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

        <!-- 输出设置 -->
        <div class="glass-card">
          <h3 class="section-title">输出设置</h3>
          <button
            @click="selectOutputDir('.gif')"
            class="btn-secondary"
          >
            <Folder :size="16" />
            选择输出目录
          </button>
          <p v-if="files.length > 0 && files[0].outputPath" class="text-xs text-warning mt-2 truncate">
            {{ getDirName(files[0].outputPath) }}
          </p>
        </div>

        <!-- 错误提示 -->
        <div v-if="errorMsg" class="alert-danger">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- 开始按钮 -->
        <button
          @click="startConvert"
          :disabled="!canStart"
          class="btn-primary"
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

<style scoped lang="scss">
@use "../../assets/styles/gif";
</style>
