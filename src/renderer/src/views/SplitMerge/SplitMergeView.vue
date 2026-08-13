<!-- 视频分割/合并/变速页面 -->
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
import { useSpeedBatch, speedSegments } from '@/composables/useSpeedBatch'
import { useSpeedPreview, registerSpeedPreviewController, unregisterSpeedPreviewController, checkSpeedPreviewStop } from '@/composables/useSpeedPreview'
import { secondsToHMS, secondsToTimecode } from '@/utils/time'
import { formatSize, getFileName, toFileUrl, todayDateStr } from '@/utils/format'
import { clamp, swapArrayElements } from '@/utils/math'
import type { VideoMeta, ClipItem } from '@/types/file'

const store = useProgressStore()
const { clearSegments } = useSpeedBatch()
const { isPreviewing: isSpeedPreviewing, stopSpeedPreview } = useSpeedPreview()

// ---- 模式 ----
const mode = ref<'split' | 'merge' | 'speed'>('split')
const modeTabs: Array<{ key: 'split' | 'merge' | 'speed'; label: string }> = [
  { key: 'split', label: '裁剪' },
  { key: 'merge', label: '合并' },
  { key: 'speed', label: '变速' }
]

// ---- 文件列表 ----
const files = ref<string[]>([])

// ---- 视频元数据与播放器 ----
const videoMeta = ref<VideoMeta | null>(null)
const { videoPlayer, isPlaying, currentTime, togglePlay, onVideoPlay, onVideoStop, onTimeUpdate, onVideoError, onVideoLoaded, seekVideoPlayer } = useVideoPlayer({
  onTimeUpdate: (t, vp) => {
    // 变速预览中跳过 trim 自动停止逻辑
    if (checkSpeedPreviewStop(t)) { return }
    // 到达裁切终点时自动停止
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

// 裁切时间（秒，归一化到 0..duration）
const trimStartSec = ref(0)
const trimEndSec = ref(30)

// ---- 时间轴 composable ----
const {
  timelineRef,
  startHour, startMin, startSec, endHour, endMin, endSec,
  startPercent, endPercent, playheadPercent: playheadPercentFn,
  startHandleDrag,
  trimDuration, trimDurationStr,
  pauseOnScrub, startScrub, onHandleWheel, onGlobalPointerMove, onGlobalPointerUp
} = useTrimTimeline({
  duration,
  trimStart: trimStartSec,
  trimEnd: trimEndSec,
  seekTo: seekVideoPlayer,
  currentTime,
  videoPlayer,
  onScrubPause: () => {
    isPlaying.value = false
  }
})
const playheadPercent = playheadPercentFn(currentTime)

const playheadInSelectionPercent = computed((): number => {
  const range = endPercent.value - startPercent.value
  if (range <= 0) { return 50 }
  return ((playheadPercent.value - startPercent.value) / range) * 100
})

/** 时间轴上的待变速区段浮层（仅 speed 模式显示）：基于 speedSegments 与总时长计算百分比 */
const speedSegmentOverlays = computed((): { id: string; leftPercent: number; widthPercent: number; speed: number }[] => {
  if (duration.value <= 0) { return [] }
  return speedSegments.value.map((seg) => ({
    id: seg.id,
    leftPercent: (seg.startSec / duration.value) * 100,
    widthPercent: Math.max((seg.duration / duration.value) * 100, 1),
    speed: seg.speed
  }))
})

// ---- 步进 ----
const stepSeconds = ref(10)

// ---- 输出 ----
const outputName = ref('')
const outputDir = ref('')
const errorMsg = ref('')

// ---- 替换视频（裁剪模式） ----
const isDraggingReplace = ref(false)
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp']

// ---- 片段列表 ----
const clips = ref<ClipItem[]>([])
const cuttingInProgress = ref(false)
let clipIdCounter = 0
let loadRequestId = 0

// ---- 计算属性 ----

const videoSrc = computed((): string => {
  if (files.value.length === 0) { return '' }
  return toFileUrl(files.value[0])
})

const selectedClipCount = computed((): number => {
  return clips.value.filter((c) => c.selected).length
})

const canMerge = computed((): boolean => {
  return selectedClipCount.value + files.value.length >= 2
})

// ---- 辅助函数 ----

/** 显式释放 video 元素资源（文件句柄 + 解码线程），避免 file:/// 延迟释放导致线程残留占用 */
function releaseVideoResource(): void {
  const vp = videoPlayer.value
  if (vp) {
    vp.pause()
    vp.removeAttribute('src')
    vp.load()
  }
}

/** 重置视频状态（元数据/时长/裁剪区间/播放进度/错误），供替换视频与切换模式复用 */
function resetVideoState(): void {
  videoMeta.value = null
  duration.value = 0
  trimStartSec.value = 0
  trimEndSec.value = 30
  currentTime.value = 0
  isPlaying.value = false
  errorMsg.value = ''
}

// ---- 文件操作 ----

async function addFiles(newFiles: string[]): Promise<void> {
  for (const f of newFiles) {
    if (!files.value.includes(f)) {
      files.value.push(f)
    }
  }
  if ((mode.value === 'split' || mode.value === 'speed') && files.value.length > 0) {
    await loadVideoMeta(files.value[0])
  }
  if (outputName.value === '') {
    outputName.value = getFileName(newFiles[0]).replace(/\.[^.]+$/, '') + '_output'
  }
}

async function loadVideoMeta(filePath: string): Promise<void> {
  const thisRequestId = ++loadRequestId
  try {
    const meta = await window.electronAPI.getVideoMeta(filePath)
    // 守卫：有更新的请求时丢弃过期元数据
    if (thisRequestId !== loadRequestId) { return }
    // 守卫：加载期间文件已变更则丢弃过期元数据
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
  stopSpeedPreview()
  releaseVideoResource()
  // 清理旧的片段临时文件
  for (const c of clips.value) {
    window.electronAPI.deleteFile(c.outputFile).catch(() => {})
  }
  clips.value = []
  resetVideoState()
  // 替换文件
  files.value = [newPath]
  // 重置输出名称
  outputName.value = getFileName(newPath).replace(/\.[^.]+$/, '') + '_output'
  // 加载新元数据
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
  // 仅当 relatedTarget 不在容器内时才置 false，避免拖拽经过子元素时遮罩闪烁
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
  errorMsg.value = ''
  if (newMode !== 'speed') {
    stopSpeedPreview()
    clearSegments()
  }
  if (newMode === 'split' || newMode === 'speed') {
    if (files.value.length > 1) {
      files.value = [files.value[0]]
    }
    if (files.value.length > 0) {
      loadVideoMeta(files.value[0])
    }
  } else if (newMode === 'merge') {
    releaseVideoResource()
    resetVideoState()
    outputName.value = ''
    outputDir.value = ''
    files.value = []
  }
})

// ---- 播放器控制 ----

/** 预览中点击播放/暂停时先停止预览，避免 playbackRate 残留 */
function onTogglePlay(): void {
  if (isSpeedPreviewing.value) { stopSpeedPreview(); return }
  togglePlay()
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

/** 键盘左右方向键触发步进前进/后退（跳过输入类元素聚焦场景，避免误操作） */
function onKeydown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return
  }
  if (!videoPlayer.value) {
    return
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    stepBackward()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    stepForward()
  }
}

// 将前后手柄定位到当前播放位置
function snapStartHere(): void {
  trimStartSec.value = clamp(currentTime.value, 0, trimEndSec.value - 0.1)
}

function snapEndHere(): void {
  trimEndSec.value = clamp(currentTime.value, trimStartSec.value + 0.1, duration.value)
}

// ---- 片段列表管理 ----

async function cutToClipList(): Promise<void> {
  if (files.value.length === 0) {
    errorMsg.value = '请先添加视频文件'
    return
  }
  if (trimDuration.value <= 0) {
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
      startTime: secondsToTimecode(trimStartSec.value),
      duration: secondsToTimecode(trimDuration.value)
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
      // 前手柄重置到本次裁剪结束位置，后手柄重置到视频末尾，便于连续裁剪后续片段
      const clipEnd = trimEndSec.value
      trimStartSec.value = Math.min(clipEnd, Math.max(0, duration.value - 0.1))
      trimEndSec.value = duration.value
      seekVideoPlayer(trimStartSec.value)
      // 自动播放预览刚裁剪的片段（play 被自动播放策略拒绝时忽略）
      videoPlayer.value?.play().catch(() => {})
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

/** 变速段添加后推进时间轴手柄到段尾，便于连续添加后续片段 */
function onSpeedSegmentAdded(): void {
  const segEnd = trimStartSec.value + trimDuration.value
  if (segEnd < duration.value - 0.1) {
    trimStartSec.value = segEnd
    trimEndSec.value = duration.value
    seekVideoPlayer(segEnd)
  }
}

// ---- 输出与处理 ----

function getMergeOutputName(): string {
  const dateStr = todayDateStr()

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

  // 收集选中的片段输出文件与外部文件
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
      // 合并成功后清理选中的片段临时文件
      const deleteResults = await Promise.allSettled(
        clips.value.filter((c) => c.selected).map((c) => window.electronAPI.deleteFile(c.outputFile))
      )
      const failedCount = deleteResults.filter((r) => r.status === 'rejected').length
      if (failedCount > 0) {
        console.warn(`合并后清理临时文件失败: ${failedCount} 个`)
      }
      // 从列表移除已合并的片段，避免残留引用
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

// ---- 生命周期 ----

onMounted(() => {
  // 注册变速预览控制器，提供 videoPlayer 引用
  registerSpeedPreviewController({
    getVideoPlayer: () => videoPlayer.value,
    setCurrentTime: (t: number) => { currentTime.value = t }
  })
  window.electronAPI.onProgress((info) => {
    store.update(info)
  })
  document.addEventListener('pointermove', onGlobalPointerMove)
  document.addEventListener('pointerup', onGlobalPointerUp)
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('pointermove', onGlobalPointerMove)
  document.removeEventListener('pointerup', onGlobalPointerUp)
  document.removeEventListener('keydown', onKeydown)
  // 注销变速预览控制器（内部先停止预览恢复 playbackRate）
  unregisterSpeedPreviewController()
  // 卸载时若操作仍在运行，先取消主进程 ffmpeg，避免锁超时自动释放后新操作并发覆盖
  if (store.isProcessing) {
    window.electronAPI.cancelOperation().catch(() => {})
  }
  releaseVideoResource()
  // 清理临时片段文件
  for (const c of clips.value) {
    window.electronAPI.deleteFile(c.outputFile).catch(() => {})
  }
  if (window.electronAPI) {
    window.electronAPI.removeProgressListener()
  }
  // 停止进度 store 计时器，防止内存泄漏
  store.reset()
})
</script>

<template>
  <div class="page-container">
    <!-- 页头 -->
    <header class="mb-4">
      <div class="flex items-center gap-3 mb-1">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
          <Scissors :size="18" class="text-accent-blue" />
        </div>
        <h1 class="text-xl font-bold text-text-primary">视频分割与合并</h1>
      </div>
    </header>

    <!-- 模式切换 -->
    <div class="flex gap-1 mb-4 p-1 rounded-lg bg-bg-tertiary w-fit">
      <button
        v-for="tab in modeTabs"
        :key="tab.key"
        @click="mode = tab.key"
        class="px-4 py-1.5 rounded-md text-sm font-medium"
        :class="mode === tab.key ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary'"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ========== 裁剪 / 变速模式 ========== -->
    <div v-if="mode !== 'merge'" class="space-y-3">
      <!-- 无文件时展示拖放区 -->
      <FileDropZone v-if="files.length === 0" @files-selected="addFiles" />

      <!-- 有文件时展示完整编辑器 -->
      <template v-else>
        <!-- 视频播放器 -->
        <div
          class="video-player-container glass-card relative"
          @drop.prevent="onReplaceDrop"
          @dragover.prevent="onReplaceDragOver"
          @dragleave="onReplaceDragLeave"
        >
          <!-- 拖拽时的替换遮罩 -->
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

          <!-- 播放控制 -->
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
                @click="onTogglePlay"
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
            <!-- 文件信息 -->
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

        <!-- 时间轴 -->
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
              <!-- 步进前进/后退 -->
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
                  <option :value="15">15s</option>
                  <option :value="20">20s</option>
                </select>
                <button
                  @click="stepForward"
                  class="p-1 rounded text-text-secondary"
                  title="前进"
                >
                  <SkipForward :size="14" />
                </button>
                <!-- 手柄定位 -->
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
              <!-- 微调时间输入 -->
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
              <span class="text-sm font-mono text-accent-blue font-semibold">{{ trimDurationStr }}</span>
            </span>
          </div>

          <!-- 时间轴轨道 -->
          <div
            ref="timelineRef"
            class="timeline-track"
            @pointerdown="startScrub"
          >
            <!-- 左侧变暗区 -->
            <div class="timeline-dimmed-l" :style="{ width: startPercent + '%' }" />

            <!-- 选中区域（flex 子项，无需左侧偏移） -->
            <div
              class="timeline-selected"
              :style="{ width: (endPercent - startPercent) + '%' }"
            >
              <!-- 播放头（相对选中区域定位） -->
              <div
                class="timeline-playhead"
                :style="{ left: playheadInSelectionPercent + '%' }"
              />
              <!-- 前手柄 -->
              <div
                class="trim-handle trim-handle-start"
                @pointerdown="startHandleDrag('start', $event)"
                @wheel.prevent="onHandleWheel('start', $event)"
              />
              <!-- 后手柄 -->
              <div
                class="trim-handle trim-handle-end"
                @pointerdown="startHandleDrag('end', $event)"
                @wheel.prevent="onHandleWheel('end', $event)"
              />
            </div>

            <!-- 待变速区段浮层（仅变速模式） -->
            <div
              v-if="mode === 'speed'"
              v-for="seg in speedSegmentOverlays"
              :key="seg.id"
              class="speed-segment-overlay"
              :style="{ left: seg.leftPercent + '%', width: seg.widthPercent + '%' }"
            >
              <span class="speed-segment-label">{{ seg.speed }}x</span>
            </div>

            <!-- 右侧变暗区 -->
            <div class="timeline-dimmed-r" :style="{ width: (100 - endPercent) + '%' }" />
          </div>

          <!-- 时间标记 -->
          <div class="flex justify-between mt-1.5 px-1">
            <span class="text-xs font-mono text-accent-blue">{{ secondsToHMS(trimStartSec) }}</span>
            <span class="text-xs font-mono text-text-muted">{{ secondsToHMS(duration) }}</span>
            <span class="text-xs font-mono text-accent-purple">{{ secondsToHMS(trimEndSec) }}</span>
          </div>

        </div>


        <!-- 裁切到列表操作（仅裁剪模式） -->
        <div v-if="mode === 'split'" class="flex items-center gap-3">
          <button
            @click="cutToClipList"
            :disabled="trimDuration <= 0 || cuttingInProgress"
            class="px-8 py-2.5 rounded-xl font-semibold text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            :class="trimDuration > 0 && !cuttingInProgress
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

        <!-- 片段列表（仅裁剪模式） -->
        <ClipList
          v-if="mode === 'split' && clips.length > 0"
          :clips="clips"
          @toggle="toggleClipSelection"
          @remove="removeClip"
        />

        <!-- 变速面板（仅变速模式） -->
        <SpeedPanel
          v-if="mode === 'speed'"
          :input-file="files[0]"
          :trim-start-sec="trimStartSec"
          :trim-duration="trimDuration"
          :duration="duration"
          :source-codec="videoMeta?.codec"
          @error="errorMsg = $event"
          @added="onSpeedSegmentAdded"
        />

        <!-- 错误提示 -->
        <div v-if="errorMsg" class="alert-danger">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- 进度面板（仅裁剪模式；变速模式由 SpeedPanel 内自带 ProgressPanel 显示） -->
        <ProgressPanel v-if="mode === 'split'" />
      </template>
    </div>

    <!-- ========== 合并模式 ========== -->
    <div v-else class="space-y-3">
      <!-- 片段列表（来自裁剪） -->
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

      <!-- 输出设置 -->
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

      <!-- 合并摘要 -->
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

/* ---- 待变速区段浮层（琥珀色，与裁剪选中区区分） ---- */
.speed-segment-overlay {
  position: absolute;
  top: 2px;
  bottom: 2px;
  background: rgba(245, 158, 11, 0.28);
  border: 1px solid rgba(245, 158, 11, 0.5);
  border-radius: var(--radius-sm, 4px);
  pointer-events: none;
  z-index: 3;
}

.speed-segment-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--color-text-primary);
  background: rgba(0, 0, 0, 0.4);
  padding: 0 4px;
  border-radius: 2px;
  white-space: nowrap;
}

/* ---- Responsive ---- */
@media (max-width: 768px) {
  .timeline-track {
    height: 40px;
  }
}
</style>
