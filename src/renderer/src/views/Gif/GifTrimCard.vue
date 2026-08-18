<!-- GIF 截取预览卡片：播放器与截取时间轴 -->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Image, Clock, Play, Pause } from 'lucide-vue-next'
import { useVideoPlayer } from '@/composables/useVideoPlayer'
import { useTrimTimeline } from '@/composables/useTrimTimeline'
import { secondsToHMS } from '@/utils/time'
import { clamp } from '@/utils/math'
import { getFileName, toFileUrl } from '@/utils/format'
import type { FileEntry } from '@/types/file'

const props = defineProps<{ file: FileEntry }>()

// 父组件保留截取状态所有权，供转换与体积估算使用
const enableTrim = defineModel<boolean>('enableTrim', { default: false })
const trimStartSec = defineModel<number>('trimStart', { default: 0 })
const trimEndSec = defineModel<number>('trimEnd', { default: 0 })
const maxDuration = defineModel<number>('maxDuration', { default: 0 })

// 默认截取时长（秒）
const DEFAULT_TRIM_DURATION = 5
const MIN_TRIM_GAP = 0.1

const videoSrc = computed((): string => toFileUrl(props.file.path))

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
  startPercent, endPercent,
  startHandleDrag,
  trimDuration, trimDurationStr,
  pauseOnScrub, startScrub, onHandleWheel, onGlobalPointerMove, onGlobalPointerUp
} = useTrimTimeline({
  duration: maxDuration,
  trimStart: trimStartSec,
  trimEnd: trimEndSec,
  seekTo: seekVideoPlayer,
  minGap: MIN_TRIM_GAP,
  currentTime,
  videoPlayer,
  onScrubPause: () => {
    isPlaying.value = false
  }
})

const playheadInTrim = computed((): number => {
  if (maxDuration.value <= 0) { return 0 }
  const range = endPercent.value - startPercent.value
  if (range <= 0) { return 0 }
  return clamp(((currentTime.value / maxDuration.value) * 100 - startPercent.value) / range * 100, 0, 100)
})

// 首个文件元数据加载后自动设置截取终点
watch(() => props.file.meta, (meta) => {
  if (!meta || meta.duration <= 0) {
    maxDuration.value = 0
    return
  }
  maxDuration.value = meta.duration
  // 仅在用户未手动设置时自动调整终点
  if (trimDuration.value <= 0 || trimEndSec.value > meta.duration) {
    trimEndSec.value = Math.min(DEFAULT_TRIM_DURATION, meta.duration)
  }
}, { immediate: true })

// 切换截取开关时重置播放位置
watch(enableTrim, (enabled) => {
  seekVideoPlayer(enabled ? trimStartSec.value : 0)
})

onMounted(() => {
  document.addEventListener('pointermove', onGlobalPointerMove)
  document.addEventListener('pointerup', onGlobalPointerUp)
})

onUnmounted(() => {
  document.removeEventListener('pointermove', onGlobalPointerMove)
  document.removeEventListener('pointerup', onGlobalPointerUp)
})
</script>

<template>
  <!-- 视频播放器 -->
  <div class="video-player-container glass-card">
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
      <span v-if="file.meta" class="text-xs text-text-muted truncate ml-2 max-w-[160px]">
        {{ getFileName(file.path) }}
      </span>
    </div>
  </div>

  <!-- 片段截取 — 时间轴 + 精确输入 -->
  <div class="glass-card">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <Clock :size="16" class="text-text-secondary" />
        <h3 class="text-sm font-semibold text-text-primary">截取片段</h3>
        <label class="flex items-center gap-1 cursor-pointer select-none" title="开启时拖动时间轴会暂停播放；关闭时拖动时视频继续播放">
          <input
            type="checkbox"
            v-model="pauseOnScrub"
            class="w-3 h-3 accent-blue-500 cursor-pointer"
          />
          <span class="text-xs text-text-secondary">拖动时暂停</span>
        </label>
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
          <div
            class="trim-handle trim-handle-start"
            @pointerdown="startHandleDrag('start', $event)"
            @wheel.prevent="onHandleWheel('start', $event)"
          />
          <div
            class="trim-handle trim-handle-end"
            @pointerdown="startHandleDrag('end', $event)"
            @wheel.prevent="onHandleWheel('end', $event)"
          />
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
</template>

<style scoped lang="scss">
@use "../../assets/styles/gif";
</style>
