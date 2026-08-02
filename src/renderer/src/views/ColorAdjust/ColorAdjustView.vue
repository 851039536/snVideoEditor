<!-- 视频色彩调整页面：亮度/对比度/饱和度/色温调节 -->
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Palette, Folder, X, RotateCcw, Play, Pause } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'
import { getFileName, toFileUrl } from '@/utils/format'
import { useFileList } from '@/composables/useFileList'
import { useColorParams } from '@/composables/useColorParams'
import { useVideoPlayer } from '@/composables/useVideoPlayer'
import type { ColorPreset } from './types'

const progressStore = useProgressStore()
const { files, addFiles, removeFile, selectOutputDir } = useFileList('.mp4')
const { params, presets, applyPreset, resetParams, toFfmpegParams, previewFilterStyle, isDefault } = useColorParams()

const errorMsg = ref('')
const activePreset = ref('原始')
const { videoPlayer, isPlaying, togglePlay, onVideoPlay, onVideoStop } = useVideoPlayer()

const videoSrc = computed((): string => {
  if (files.value.length === 0) { return '' }
  return toFileUrl(files.value[0].path)
})

function onSelectPreset(preset: ColorPreset): void {
  applyPreset(preset)
  activePreset.value = preset.name
}

function onResetParams(): void {
  resetParams()
  activePreset.value = '原始'
}

const canStart = computed((): boolean => {
  return files.value.length > 0 && !progressStore.isProcessing && !isDefault.value
})

async function startAdjust(): Promise<void> {
  errorMsg.value = ''
  if (files.value.length === 0 || isDefault.value) { return }

  // 确保输出目录已设置
  for (const entry of files.value) {
    if (!entry.outputPath) {
      await selectOutputDir('.mp4')
      break
    }
  }

  const unresolved = files.value.filter((f) => !f.outputPath)
  if (unresolved.length > 0) {
    errorMsg.value = '请为所有文件选择输出目录'
    return
  }

  // 暂停预览视频释放资源
  if (videoPlayer.value && !videoPlayer.value.paused) {
    videoPlayer.value.pause()
    isPlaying.value = false
  }

  progressStore.start('color')
  const ffmpegParams = toFfmpegParams()
  const batchFiles = files.value.map((f) => ({
    input: f.path,
    output: f.outputPath,
    ...ffmpegParams
  }))

  try {
    const result = await window.electronAPI.batchAdjustColor({ files: batchFiles })
    if (result.failed.length === 0) {
      progressStore.finish()
    } else {
      errorMsg.value = `${result.failed.length} 个文件处理失败`
      progressStore.reset()
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
})

onUnmounted(() => {
  window.electronAPI?.removeProgressListener()
})
</script>

<template>
  <div class="page-container">
    <!-- 头部 -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/20 to-rose-500/20 flex items-center justify-center">
          <Palette :size="20" class="text-warning" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">色彩调整</h1>
      </div>
      <p class="text-text-secondary text-sm">调节视频亮度、对比度、饱和度与色温，实时预览效果</p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- 左侧：文件 + 预览 -->
      <div class="lg:col-span-2 space-y-4">
        <FileDropZone @files-selected="addFiles" />

        <!-- 视频预览 -->
        <div v-if="videoSrc" class="glass-card p-4">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-text-primary">效果预览</span>
            <span class="text-xs text-text-muted">预览为近似效果，以实际输出为准</span>
          </div>
          <div class="relative rounded-lg overflow-hidden bg-black">
            <video
              ref="videoPlayer"
              :src="videoSrc"
              class="w-full max-h-[360px] object-contain"
              :style="{ filter: previewFilterStyle }"
              @play="onVideoPlay"
              @pause="onVideoStop"
              @ended="onVideoStop"
            />
            <!-- 播放控制 -->
            <button
              class="absolute bottom-3 left-3 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors"
              @click="togglePlay"
            >
              <Pause v-if="isPlaying" :size="14" />
              <Play v-else :size="14" />
            </button>
          </div>
        </div>

        <!-- 文件列表 -->
        <div v-if="files.length > 0" class="glass-card p-4">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-text-primary">文件列表 ({{ files.length }})</span>
            <button
              class="text-xs text-accent-blue hover:underline flex items-center gap-1"
              @click="selectOutputDir('.mp4')"
            >
              <Folder :size="12" /> 设置输出目录
            </button>
          </div>
          <div class="space-y-2 max-h-48 overflow-y-auto">
            <div
              v-for="(file, idx) in files"
              :key="file.path"
              class="flex items-center gap-3 px-3 py-2 rounded-lg bg-bg-tertiary/50"
            >
              <div class="flex-1 min-w-0">
                <p class="text-sm text-text-primary truncate">{{ getFileName(file.path) }}</p>
                <p v-if="file.meta" class="text-xs text-text-muted">
                  {{ file.meta.width }}×{{ file.meta.height }}
                </p>
              </div>
              <button
                class="text-text-muted hover:text-red-400 transition-colors"
                @click="removeFile(idx)"
              >
                <X :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：参数面板 -->
      <div class="space-y-4">
        <!-- 预设 -->
        <div class="glass-card p-4">
          <h3 class="text-sm font-medium text-text-primary mb-3">预设</h3>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="preset in presets"
              :key="preset.name"
              class="px-2 py-1.5 rounded-lg text-xs transition-all"
              :class="activePreset === preset.name
                ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/40'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary border border-transparent'"
              @click="onSelectPreset(preset)"
            >
              {{ preset.name }}
            </button>
          </div>
        </div>

        <!-- 滑块参数 -->
        <div class="glass-card p-4 space-y-5">
          <h3 class="text-sm font-medium text-text-primary">参数调节</h3>

          <!-- 亮度 -->
          <div>
            <div class="flex justify-between text-xs mb-1.5">
              <span class="text-text-secondary">亮度</span>
              <span class="text-text-primary font-mono">{{ params.brightness > 0 ? '+' : '' }}{{ params.brightness }}</span>
            </div>
            <input
              v-model.number="params.brightness"
              type="range" min="-100" max="100" step="1"
              class="w-full slider"
            />
          </div>

          <!-- 对比度 -->
          <div>
            <div class="flex justify-between text-xs mb-1.5">
              <span class="text-text-secondary">对比度</span>
              <span class="text-text-primary font-mono">{{ params.contrast }}%</span>
            </div>
            <input
              v-model.number="params.contrast"
              type="range" min="0" max="200" step="1"
              class="w-full slider"
            />
          </div>

          <!-- 饱和度 -->
          <div>
            <div class="flex justify-between text-xs mb-1.5">
              <span class="text-text-secondary">饱和度</span>
              <span class="text-text-primary font-mono">{{ params.saturation }}%</span>
            </div>
            <input
              v-model.number="params.saturation"
              type="range" min="0" max="300" step="1"
              class="w-full slider"
            />
          </div>

          <!-- 色温 -->
          <div>
            <div class="flex justify-between text-xs mb-1.5">
              <span class="text-text-secondary">色温</span>
              <span class="text-text-primary font-mono">
                {{ params.temperature > 0 ? '暖 +' : params.temperature < 0 ? '冷 ' : '' }}{{ params.temperature }}
              </span>
            </div>
            <input
              v-model.number="params.temperature"
              type="range" min="-100" max="100" step="1"
              class="w-full slider"
            />
          </div>

          <!-- 重置 -->
          <button
            class="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs text-text-secondary hover:text-text-primary bg-bg-tertiary hover:bg-bg-tertiary/80 transition-colors"
            :disabled="isDefault"
            @click="onResetParams"
          >
            <RotateCcw :size="12" /> 重置参数
          </button>
        </div>

        <!-- 操作按钮 -->
        <button
          class="w-full py-3 rounded-xl font-medium text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          :class="canStart
            ? 'bg-gradient-to-r from-accent-blue to-accent-purple hover:shadow-lg hover:shadow-purple-500/25'
            : 'bg-bg-tertiary'"
          :disabled="!canStart"
          @click="startAdjust"
        >
          {{ progressStore.isProcessing ? '处理中...' : `开始调整 (${files.length})` }}
        </button>

        <!-- 错误信息 -->
        <p v-if="errorMsg" class="text-xs text-red-400 text-center">{{ errorMsg }}</p>

        <!-- 进度面板 -->
        <ProgressPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.slider {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: var(--color-bg-tertiary);
  outline: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-accent-blue);
  cursor: pointer;
  transition: transform 0.15s;
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.slider:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
