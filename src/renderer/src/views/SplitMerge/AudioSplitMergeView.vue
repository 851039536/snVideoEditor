<!-- 音频分割合并页面 -->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  Music, X, ArrowUp, ArrowDown, Folder, Play, Pause,
  SkipBack, SkipForward, Scissors, RefreshCw
} from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import ClipList from './ClipList.vue'
import { useProgressStore } from '@/stores/progress'
import { useAudioPlayer } from '@/composables/useAudioPlayer'
import { useTrimTimeline } from '@/composables/useTrimTimeline'
import { secondsToHMS } from '@/utils/time'
import { formatSize, getFileName, toFileUrl, todayDateStr } from '@/utils/format'
import { clamp } from '@/utils/math'
import type { ClipItem } from '@/types/file'
import type { AudioMeta } from '../../../../preload/index'

const store = useProgressStore()

// ---- 模式 ----
const mode = ref<'split' | 'merge'>('split')

// ---- 文件 ----
const files = ref<string[]>([])
const AUDIO_EXTENSIONS = ['.mp3', '.aac', '.flac', '.wav', '.ogg', '.m4a', '.wma', '.opus']

// ---- 音频元数据与播放器 ----
const audioMeta = ref<AudioMeta | null>(null)
const { audioPlayer, isPlaying, currentTime, onAudioPlay, onAudioStop, onTimeUpdate, onAudioError, onAudioLoaded, seekAudioPlayer } = useAudioPlayer({
  onTimeUpdate: (t, ap) => {
    if (t >= trimEndSec.value) {
      ap.pause()
      ap.currentTime = trimEndSec.value
      currentTime.value = trimEndSec.value
      isPlaying.value = false
    }
  },
  onLoaded: (ap) => {
    ap.currentTime = trimStartSec.value
    currentTime.value = trimStartSec.value
  },
  onError: (e) => {
    const audio = e.target as HTMLAudioElement
    errorMsg.value = `音频加载失败: ${audio?.error?.message || '未知错误'}`
  }
})
const duration = ref(0)

// ---- 裁切时间（秒） ----
const trimStartSec = ref(0)
const trimEndSec = ref(30)

// ---- 时间轴 composable ----
const {
  timelineRef,
  startHour, startMin, startSec, endHour, endMin, endSec,
  startPercent, endPercent, playheadPercent: playheadPercentFn,
  startHandleDrag,
  trimDuration, trimDurationStr,
  startScrub, onGlobalPointerMove, onGlobalPointerUp
} = useTrimTimeline({
  duration,
  trimStart: trimStartSec,
  trimEnd: trimEndSec,
  seekTo: seekAudioPlayer,
  currentTime,
  videoPlayer: audioPlayer
})
const playheadPercent = playheadPercentFn(currentTime)

// ---- 步进 ----
const stepSeconds = ref(2)

// ---- 输出 ----
const outputDir = ref('')
const errorMsg = ref('')

// ---- 替换拖拽 ----
const isDraggingReplace = ref(false)

// ---- 片段列表 ----
const clips = ref<ClipItem[]>([])
const cuttingInProgress = ref(false)
let clipIdCounter = 0

// ---- 计算属性 ----
const audioSrc = computed((): string => {
  if (files.value.length === 0) { return '' }
  return toFileUrl(files.value[0])
})

const selectedClipCount = computed((): number => {
  return clips.value.filter((c) => c.selected).length
})

const canMerge = computed((): boolean => {
  return selectedClipCount.value + files.value.length >= 2
})

/** 获取源文件扩展名（用于输出文件） */
const sourceExt = computed((): string => {
  if (files.value.length === 0) { return '.mp3' }
  const ext = files.value[0].slice(files.value[0].lastIndexOf('.'))
  return ext || '.mp3'
})

// ---- 文件选择 ----

function selectAudioFiles(): Promise<string[]> {
  return window.electronAPI.selectAudioFiles()
}

// ---- 文件操作 ----

async function addFiles(newFiles: string[]): Promise<void> {
  for (const f of newFiles) {
    if (!files.value.includes(f)) {
      files.value.push(f)
    }
  }
  if (mode.value === 'split' && files.value.length > 0) {
    await loadAudioMeta(files.value[0])
  }
}

async function loadAudioMeta(filePath: string): Promise<void> {
  try {
    errorMsg.value = ''
    const meta = await window.electronAPI.getAudioMeta(filePath)
    audioMeta.value = meta
    duration.value = meta.duration
    trimStartSec.value = 0
    trimEndSec.value = Math.min(30, meta.duration)
  } catch (e) {
    errorMsg.value = `获取音频信息失败: ${e instanceof Error ? e.message : String(e)}`
  }
}

function removeFile(index: number): void {
  files.value.splice(index, 1)
  if (files.value.length === 0) {
    audioMeta.value = null
    duration.value = 0
    clips.value = []
  }
}

function moveFile(index: number, direction: -1 | 1): void {
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= files.value.length) { return }
  const temp = files.value[index]
  files.value[index] = files.value[newIndex]
  files.value[newIndex] = temp
}

// ---- 替换音频（拖拽） ----

function onReplaceDragOver(e: DragEvent): void {
  e.preventDefault()
  isDraggingReplace.value = true
}

function onReplaceDragLeave(): void {
  isDraggingReplace.value = false
}

async function onReplaceDrop(e: DragEvent): Promise<void> {
  isDraggingReplace.value = false
  const droppedFiles = e.dataTransfer?.files
  if (!droppedFiles || droppedFiles.length === 0) { return }
  const first = droppedFiles[0]
  const ext = first.name.toLowerCase().slice(first.name.lastIndexOf('.'))
  if (!AUDIO_EXTENSIONS.includes(ext)) {
    errorMsg.value = '请拖入音频文件'
    return
  }
  // @ts-ignore - Electron 返回 path
  const filePath = first.path || first.name
  files.value = [filePath]
  clips.value = []
  await loadAudioMeta(filePath)
}

// ---- 播放控制 ----

function stepForward(): void {
  const t = clamp(currentTime.value + stepSeconds.value, 0, duration.value)
  seekAudioPlayer(t)
}

function stepBackward(): void {
  const t = clamp(currentTime.value - stepSeconds.value, 0, duration.value)
  seekAudioPlayer(t)
}

// ---- 片段列表管理 ----

async function cutToClipList(): Promise<void> {
  if (files.value.length === 0) {
    errorMsg.value = '请先添加音频文件'
    return
  }
  if (trimDuration.value <= 0) {
    errorMsg.value = '请选择有效的片段范围'
    return
  }

  errorMsg.value = ''
  cuttingInProgress.value = true
  audioPlayer.value?.pause()

  let outputFile = ''
  try {
    const tempDir = await window.electronAPI.getTempDir()
    clipIdCounter++
    const clipId = `audio_clip_${Date.now()}_${clipIdCounter}`
    outputFile = `${tempDir}/${clipId}${sourceExt.value}`

    const success = await window.electronAPI.splitVideo({
      input: files.value[0],
      output: outputFile,
      startTime: secondsToHMS(trimStartSec.value),
      duration: trimDurationStr.value
    })

    if (success) {
      clips.value.push({
        id: clipId,
        sourceFile: files.value[0],
        sourceFileName: getFileName(files.value[0]),
        startSec: trimStartSec.value,
        endSec: trimEndSec.value,
        duration: trimDuration.value,
        outputFile,
        selected: true
      })
      const clipEnd = trimEndSec.value
      trimStartSec.value = Math.min(clipEnd, Math.max(0, duration.value - 0.1))
      trimEndSec.value = duration.value
      seekAudioPlayer(trimStartSec.value)
    } else {
      window.electronAPI.deleteFile(outputFile).catch(() => {})
    }
  } catch (e) {
    errorMsg.value = `裁切失败: ${e instanceof Error ? e.message : String(e)}`
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
    window.electronAPI.deleteFile(clip.outputFile).catch(() => {})
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
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= clips.value.length) { return }
  const temp = clips.value[index]
  clips.value[index] = clips.value[newIndex]
  clips.value[newIndex] = temp
}

// ---- 输出与合并 ----

function getMergeOutputName(): string {
  const dateStr = todayDateStr()
  if (clips.value.length > 0) {
    const baseName = clips.value[0].sourceFileName.replace(/\.[^.]+$/, '')
    return `${baseName}_${dateStr}${sourceExt.value}`
  }
  return `SN_audio_${dateStr}${sourceExt.value}`
}

async function selectOutputPath(): Promise<void> {
  const ext = sourceExt.value.replace('.', '')
  const fn = mode.value === 'split' ? `audio_output${sourceExt.value}` : getMergeOutputName()
  const dir = await window.electronAPI.selectSavePath(fn, ext)
  if (dir) {
    outputDir.value = dir
  }
}

async function startProcess(): Promise<void> {
  errorMsg.value = ''
  if (!outputDir.value) {
    await selectOutputPath()
    if (!outputDir.value) {
      errorMsg.value = '请选择输出路径'
      return
    }
  }

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
      const deleteResults = await Promise.allSettled(
        clips.value.filter((c) => c.selected).map((c) => window.electronAPI.deleteFile(c.outputFile))
      )
      const failedCount = deleteResults.filter((r) => r.status === 'rejected').length
      if (failedCount > 0) {
        console.warn(`合并后清理临时文件失败: ${failedCount} 个`)
      }
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

// ---- 模式切换 ----

watch(mode, (newMode) => {
  errorMsg.value = ''
  outputDir.value = ''
  if (newMode === 'split' && files.value.length > 0 && !audioMeta.value) {
    loadAudioMeta(files.value[0])
  }
})

// ---- 生命周期 ----

onMounted(() => {
  window.electronAPI.onProgress((info) => {
    store.update(info)
  })
  document.addEventListener('pointermove', onGlobalPointerMove)
  document.addEventListener('pointerup', onGlobalPointerUp)
})

onUnmounted(() => {
  document.removeEventListener('pointermove', onGlobalPointerMove)
  document.removeEventListener('pointerup', onGlobalPointerUp)
  // 释放音频资源
  const ap = audioPlayer.value
  if (ap) {
    ap.pause()
    ap.removeAttribute('src')
    ap.load()
  }
  // 清理临时片段
  for (const c of clips.value) {
    window.electronAPI.deleteFile(c.outputFile).catch(() => {})
  }
  if (window.electronAPI) {
    window.electronAPI.removeProgressListener()
  }
  store.reset()
})
</script>

<template>
  <div class="page-container">
    <!-- 页头 -->
    <header class="mb-4">
      <div class="flex items-center gap-3 mb-1">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
          <Music :size="18" class="text-accent-light" />
        </div>
        <h1 class="text-xl font-bold text-text-primary">音频分割与合并</h1>
      </div>
    </header>

    <!-- 模式切换 -->
    <div class="flex gap-1 mb-4 p-1 rounded-lg bg-bg-tertiary w-fit">
      <button
        @click="mode = 'split'"
        class="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
        :class="mode === 'split' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary'"
      >
        裁剪
      </button>
      <button
        @click="mode = 'merge'"
        class="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
        :class="mode === 'merge' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary'"
      >
        合并
      </button>
    </div>

    <!-- ========== 裁剪模式 ========== -->
    <div v-if="mode === 'split'" class="space-y-3">
      <FileDropZone
        v-if="files.length === 0"
        :accepted-extensions="AUDIO_EXTENSIONS"
        :custom-select-func="selectAudioFiles"
        @files-selected="addFiles"
      />

      <template v-else>
        <!-- 音频播放器 -->
        <div
          class="glass-card relative p-4"
          @drop.prevent="onReplaceDrop"
          @dragover.prevent="onReplaceDragOver"
          @dragleave="onReplaceDragLeave"
        >
          <div
            v-if="isDraggingReplace"
            class="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-gradient-to-r from-green-500/20 to-emerald-500/20 animate-pulse-glow pointer-events-none"
          >
            <div class="text-center">
              <RefreshCw :size="32" class="text-accent-light mx-auto mb-2 animate-spin" />
              <p class="text-accent-light font-semibold text-sm">松开以替换音频</p>
            </div>
          </div>

          <audio
            v-if="audioSrc"
            ref="audioPlayer"
            :src="audioSrc"
            @play="onAudioPlay"
            @pause="onAudioStop"
            @ended="onAudioStop"
            @timeupdate="onTimeUpdate"
            @error="onAudioError"
            @loadedmetadata="onAudioLoaded"
            class="hidden"
          />

          <!-- 文件信息 -->
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Music :size="20" class="text-accent-light" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-text-primary truncate">{{ getFileName(files[0]) }}</p>
              <p v-if="audioMeta" class="text-xs text-text-muted">
                {{ audioMeta.codec.toUpperCase() }} · {{ audioMeta.sampleRate }}Hz · {{ audioMeta.channels }}ch · {{ formatSize(audioMeta.size) }}
              </p>
            </div>
          </div>

          <!-- 播放控制 -->
          <div class="flex items-center justify-center gap-4 mb-3">
            <button @click="stepBackward" class="player-btn p-2 rounded-full hover:bg-bg-tertiary transition-colors" title="后退">
              <SkipBack :size="18" class="text-text-secondary" />
            </button>
            <button
              @click="() => { const ap = audioPlayer; if (ap) { ap.paused ? ap.play() : ap.pause() } }"
              class="p-3 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 hover:opacity-90 transition-opacity"
            >
              <Pause v-if="isPlaying" :size="20" class="text-white" />
              <Play v-else :size="20" class="text-white ml-0.5" />
            </button>
            <button @click="stepForward" class="player-btn p-2 rounded-full hover:bg-bg-tertiary transition-colors" title="前进">
              <SkipForward :size="18" class="text-text-secondary" />
            </button>
            <span class="text-xs text-text-muted font-mono ml-2">
              {{ secondsToHMS(currentTime) }} / {{ secondsToHMS(duration) }}
            </span>
          </div>

          <!-- 时间轴 -->
          <div
            ref="timelineRef"
            class="timeline-track"
            @pointerdown="startScrub"
          >
            <div class="timeline-dimmed-l" :style="{ width: startPercent + '%' }" />
            <div class="timeline-selected">
              <div
                class="trim-handle trim-handle-start"
                @pointerdown="startHandleDrag('start', $event)"
              />
              <div
                class="trim-handle trim-handle-end"
                @pointerdown="startHandleDrag('end', $event)"
              />
            </div>
            <div class="timeline-dimmed-r" :style="{ width: (100 - endPercent) + '%' }" />
            <div
              class="timeline-playhead"
              :style="{ left: playheadPercent + '%' }"
            />
          </div>

          <!-- 时间输入 -->
          <div class="flex items-center justify-between mt-3 text-xs">
            <div class="flex items-center gap-1">
              <span class="text-text-muted">开始:</span>
              <input v-model="startHour" class="time-input" maxlength="2" />
              <span class="text-text-muted">:</span>
              <input v-model="startMin" class="time-input" maxlength="2" />
              <span class="text-text-muted">:</span>
              <input v-model="startSec" class="time-input" maxlength="2" />
            </div>
            <span class="text-accent-light font-mono">{{ trimDurationStr }}</span>
            <div class="flex items-center gap-1">
              <span class="text-text-muted">结束:</span>
              <input v-model="endHour" class="time-input" maxlength="2" />
              <span class="text-text-muted">:</span>
              <input v-model="endMin" class="time-input" maxlength="2" />
              <span class="text-text-muted">:</span>
              <input v-model="endSec" class="time-input" maxlength="2" />
            </div>
          </div>
        </div>

        <!-- 裁切按钮 -->
        <div class="flex items-center gap-3">
          <button
            @click="cutToClipList"
            :disabled="cuttingInProgress || trimDuration <= 0"
            class="btn-primary"
            :class="!cuttingInProgress && trimDuration > 0
              ? 'bg-gradient-to-r from-green-500 to-emerald-500'
              : 'bg-bg-tertiary text-text-muted'"
          >
            <template v-if="!cuttingInProgress">
              <Scissors :size="18" class="inline mr-2 -mt-0.5" />
              裁切到列表
            </template>
            <template v-else>裁切中...</template>
          </button>
          <span class="text-xs text-text-muted">
            无损裁切，片段添加到下方列表后可合并
          </span>
        </div>

        <!-- 片段列表 -->
        <ClipList
          v-if="clips.length > 0"
          :clips="clips"
          @toggle="toggleClipSelection"
          @remove="removeClip"
        />

        <div v-if="errorMsg" class="alert-danger">
          <p>{{ errorMsg }}</p>
        </div>

        <ProgressPanel />
      </template>
    </div>

    <!-- ========== 合并模式 ========== -->
    <div v-else class="space-y-3">
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

      <!-- 外部文件 -->
      <FileDropZone
        :accepted-extensions="AUDIO_EXTENSIONS"
        :custom-select-func="selectAudioFiles"
        @files-selected="addFiles"
      />

      <div v-if="files.length > 0" class="glass-card space-y-2 max-h-48 overflow-y-auto p-4">
        <h3 class="text-sm font-semibold text-text-primary mb-2">外部文件（{{ files.length }} 个）</h3>
        <div
          v-for="(file, idx) in files"
          :key="file"
          class="flex items-center gap-2 p-2 rounded-lg bg-bg-tertiary/50 transition-colors group"
        >
          <Music :size="16" class="text-accent-light flex-shrink-0" />
          <span class="text-xs text-text-primary truncate flex-1">{{ getFileName(file) }}</span>
          <div class="flex flex-col gap-0.5">
            <button @click="moveFile(idx, -1)" :disabled="idx === 0" class="p-0.5 rounded disabled:opacity-30">
              <ArrowUp :size="14" class="text-text-secondary" />
            </button>
            <button @click="moveFile(idx, 1)" :disabled="idx === files.length - 1" class="p-0.5 rounded disabled:opacity-30">
              <ArrowDown :size="14" class="text-text-secondary" />
            </button>
          </div>
          <button @click="removeFile(idx)" class="p-1 rounded opacity-0 group-hover:opacity-100 ml-1">
            <X :size="14" class="text-danger" />
          </button>
        </div>
      </div>

      <!-- 输出设置 -->
      <div class="glass-card p-4">
        <h3 class="text-sm font-semibold text-text-primary mb-2">输出设置</h3>
        <div class="flex items-center gap-3">
          <button @click="selectOutputPath" class="btn-secondary">
            <Folder :size="16" />
            选择输出位置
          </button>
          <p v-if="outputDir" class="text-xs text-accent-light truncate flex-1 break-all">
            {{ outputDir }}
          </p>
        </div>
        <p class="text-xs text-text-muted mt-2">建议合并相同格式的音频文件，不同格式可能导致合并失败</p>
      </div>

      <!-- 合并摘要 -->
      <div v-if="selectedClipCount > 0 || files.length > 0" class="glass-card p-4">
        <p class="text-sm text-text-secondary">
          将合并
          <span v-if="selectedClipCount > 0" class="text-accent-light font-semibold">{{ selectedClipCount }}</span>
          <span v-if="selectedClipCount > 0"> 个裁切片段</span>
          <span v-if="selectedClipCount > 0 && files.length > 0"> + </span>
          <span v-if="files.length > 0" class="text-accent-purple font-semibold">{{ files.length }}</span>
          <span v-if="files.length > 0"> 个外部文件</span>
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
          ? 'bg-gradient-to-r from-green-500 to-emerald-500'
          : 'bg-bg-tertiary text-text-muted'"
      >
        <template v-if="!store.isProcessing">
          <Play :size="18" class="inline mr-2 -mt-0.5" />
          合并选中片段
        </template>
        <template v-else>处理中...</template>
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

.timeline-track {
  height: 40px;
  border-radius: 10px;
}

.timeline-selected {
  background: linear-gradient(90deg, rgba(74, 222, 128, 0.3), rgba(16, 185, 129, 0.35));
  border-left: 2px solid var(--color-accent-light);
  border-right: 2px solid var(--color-accent-light);
}

.timeline-playhead {
  outline: 1px solid rgba(255, 107, 107, 0.3);
}

.trim-handle {
  background: var(--color-accent-light);
}

.time-input {
  width: 2rem;
  text-align: center;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 2px 4px;
  color: var(--color-text-primary);
  font-family: monospace;
}

@media (max-width: 768px) {
  .timeline-track {
    height: 32px;
  }
}
</style>
