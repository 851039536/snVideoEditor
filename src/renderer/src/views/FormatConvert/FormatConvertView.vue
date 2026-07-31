<!-- 格式转换页面：视频/音频格式互转 -->
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Repeat, Folder, X, Zap, RefreshCw } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'
import { getFileName, formatSize } from '@/utils/format'
import { useFileList } from '@/composables/useFileList'
import { VIDEO_FORMATS, AUDIO_FORMATS } from './types'
import type { MediaKind, FormatOption } from './types'

const progressStore = useProgressStore()
const { files, addFiles, removeFile, selectOutputDir } = useFileList('.mp4')

const errorMsg = ref('')

// 媒体类型与目标格式
const mediaKind = ref<MediaKind>('video')
const targetFormat = ref('mkv')
const useCopy = ref(false)

const formatOptions = computed((): FormatOption[] => {
  return mediaKind.value === 'video' ? VIDEO_FORMATS : AUDIO_FORMATS
})

function onSelectKind(kind: MediaKind): void {
  mediaKind.value = kind
  // 切换类型时重置目标格式为该类型第一个
  const options = kind === 'video' ? VIDEO_FORMATS : AUDIO_FORMATS
  targetFormat.value = options[0].value
}

function onSelectFormat(fmt: FormatOption): void {
  targetFormat.value = fmt.value
}

const canStart = computed((): boolean => {
  return files.value.length > 0 && !progressStore.isProcessing
})

async function startConvert(): Promise<void> {
  errorMsg.value = ''
  if (files.value.length === 0) { return }

  // 确保输出目录已设置
  const ext = '.' + targetFormat.value
  for (const entry of files.value) {
    if (!entry.outputPath) {
      await selectOutputDir(ext)
      break
    }
  }

  const unresolved = files.value.filter((f) => !f.outputPath)
  if (unresolved.length > 0) {
    errorMsg.value = '请为所有文件选择输出目录'
    return
  }

  progressStore.start('convert')

  try {
    if (files.value.length === 1) {
      const f = files.value[0]
      const result = await window.electronAPI.convertFormat({
        input: f.path,
        output: f.outputPath,
        targetFormat: targetFormat.value,
        copy: useCopy.value
      })
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
        targetFormat: targetFormat.value,
        copy: useCopy.value
      }))
      const result = await window.electronAPI.batchConvertFormat({ files: batchFiles })
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
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500/20 to-cyan-500/20 flex items-center justify-center">
          <Repeat :size="20" class="text-accent-blue" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">格式转换</h1>
      </div>
      <p class="text-text-secondary text-sm">视频/音频格式互转，支持快速复制与重编码两种模式</p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- 左侧：文件列表 -->
      <div class="lg:col-span-2 space-y-4">
        <FileDropZone @files-selected="addFiles" />

        <!-- 文件列表 -->
        <div v-if="files.length > 0" class="glass-card p-4">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-text-primary">文件列表 ({{ files.length }})</span>
            <button
              class="text-xs text-accent-blue hover:underline flex items-center gap-1"
              @click="selectOutputDir('.' + targetFormat)"
            >
              <Folder :size="12" /> 设置输出目录
            </button>
          </div>
          <div class="space-y-2 max-h-72 overflow-y-auto">
            <div
              v-for="(file, idx) in files"
              :key="file.path"
              class="flex items-center gap-3 px-3 py-2 rounded-lg bg-bg-tertiary/50"
            >
              <div class="flex-1 min-w-0">
                <p class="text-sm text-text-primary truncate">{{ getFileName(file.path) }}</p>
                <p v-if="file.meta" class="text-xs text-text-muted">
                  {{ file.meta.width }}×{{ file.meta.height }} · {{ formatSize(file.meta.size) }}
                </p>
              </div>
              <span class="text-xs text-text-muted px-2 py-0.5 rounded bg-bg-tertiary">
                → {{ targetFormat.toUpperCase() }}
              </span>
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
        <!-- 媒体类型 -->
        <div class="glass-card p-4">
          <h3 class="text-sm font-medium text-text-primary mb-3">媒体类型</h3>
          <div class="grid grid-cols-2 gap-2">
            <button
              class="px-3 py-2 rounded-lg text-sm transition-all"
              :class="mediaKind === 'video'
                ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/40'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary border border-transparent'"
              @click="onSelectKind('video')"
            >
              视频
            </button>
            <button
              class="px-3 py-2 rounded-lg text-sm transition-all"
              :class="mediaKind === 'audio'
                ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/40'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary border border-transparent'"
              @click="onSelectKind('audio')"
            >
              音频
            </button>
          </div>
        </div>

        <!-- 目标格式 -->
        <div class="glass-card p-4">
          <h3 class="text-sm font-medium text-text-primary mb-3">目标格式</h3>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="fmt in formatOptions"
              :key="fmt.value"
              class="px-2 py-2 rounded-lg text-xs font-medium transition-all"
              :class="targetFormat === fmt.value
                ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/40'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary border border-transparent'"
              @click="onSelectFormat(fmt)"
            >
              {{ fmt.label }}
            </button>
          </div>
        </div>

        <!-- 转换模式 -->
        <div class="glass-card p-4">
          <h3 class="text-sm font-medium text-text-primary mb-3">转换模式</h3>
          <div class="space-y-2">
            <button
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all"
              :class="useCopy
                ? 'bg-accent-blue/10 border border-accent-blue/40'
                : 'bg-bg-tertiary border border-transparent hover:border-bg-tertiary'"
              @click="useCopy = true"
            >
              <Zap :size="16" :class="useCopy ? 'text-accent-blue' : 'text-text-muted'" />
              <div>
                <p class="text-xs font-medium" :class="useCopy ? 'text-accent-blue' : 'text-text-primary'">快速复制</p>
                <p class="text-xs text-text-muted mt-0.5">直接复制流，秒级完成，无损</p>
              </div>
            </button>
            <button
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all"
              :class="!useCopy
                ? 'bg-accent-blue/10 border border-accent-blue/40'
                : 'bg-bg-tertiary border border-transparent hover:border-bg-tertiary'"
              @click="useCopy = false"
            >
              <RefreshCw :size="16" :class="!useCopy ? 'text-accent-blue' : 'text-text-muted'" />
              <div>
                <p class="text-xs font-medium" :class="!useCopy ? 'text-accent-blue' : 'text-text-primary'">重编码</p>
                <p class="text-xs text-text-muted mt-0.5">重新编码，兼容所有格式组合</p>
              </div>
            </button>
          </div>
          <p v-if="useCopy" class="text-xs text-text-muted mt-3 leading-relaxed">
            提示：快速复制仅在源编码与目标容器兼容时有效，失败时请切换为重编码模式。
          </p>
        </div>

        <!-- 操作按钮 -->
        <button
          class="w-full py-3 rounded-xl font-medium text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          :class="canStart
            ? 'bg-gradient-to-r from-accent-blue to-accent-purple hover:shadow-lg hover:shadow-purple-500/25'
            : 'bg-bg-tertiary'"
          :disabled="!canStart"
          @click="startConvert"
        >
          {{ progressStore.isProcessing ? '转换中...' : `开始转换 (${files.length})` }}
        </button>

        <!-- 错误信息 -->
        <p v-if="errorMsg" class="text-xs text-red-400 text-center">{{ errorMsg }}</p>

        <!-- 进度面板 -->
        <ProgressPanel />
      </div>
    </div>
  </div>
</template>
