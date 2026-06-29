<script setup lang="ts">
import { ref } from 'vue'
import { Lock, FileVideo, X, GripVertical } from 'lucide-vue-next'
import { formatSize, getFileName } from '@/utils/format'
import type { PlayerEntry } from './types'
import FileDropZone from '@/components/FileDropZone.vue'

const props = defineProps<{
  files: PlayerEntry[]
  currentIndex: number
  isPlaying: boolean
}>()

const emit = defineEmits<{
  selectFile: [index: number]
  removeFile: [index: number]
  addFiles: [paths: string[]]
  scanDir: []
  clearList: []
  reorder: [payload: { from: number; to: number }]
}>()

// ---- Drag reorder ----
const dragSrcIdx = ref(-1)
const dragOverIdx = ref(-1)

function onDragStart(index: number, event: DragEvent): void {
  dragSrcIdx.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(index: number, event: DragEvent): void {
  event.preventDefault()
  if (dragSrcIdx.value !== index) {
    dragOverIdx.value = index
  }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onDragLeave(): void {
  dragOverIdx.value = -1
}

function onDrop(index: number): void {
  const from = dragSrcIdx.value
  dragSrcIdx.value = -1
  dragOverIdx.value = -1
  if (from >= 0 && from !== index && from < props.files.length && index < props.files.length) {
    emit('reorder', { from, to: index })
  }
}

function onDragEnd(): void {
  dragSrcIdx.value = -1
  dragOverIdx.value = -1
}

function onConfirmClear(): void {
  emit('clearList')
}
</script>

<template>
  <div class="space-y-3">
    <!-- File Drop -->
    <FileDropZone
      :accepted-extensions="['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.enc']"
      :custom-select-func="async () => await window.electronAPI.selectPlayerFiles()"
      @files-selected="(p: string[]) => emit('addFiles', p)"
    />

    <!-- Scan Directory -->
    <button
      @click="emit('scanDir')"
      class="w-full flex items-center justify-center gap-2 p-2.5 rounded-lg border border-dashed border-bg-tertiary text-text-secondary text-sm hover:border-accent-blue/30 hover:text-text-primary transition-colors"
    >
      <span>📁</span>
      扫描文件夹
    </button>

    <!-- File List -->
    <div v-if="files.length > 0" class="glass-card max-h-[calc(100vh-360px)] overflow-y-auto playlist-scroll p-3">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          播放列表（{{ files.length }}）
        </h3>
        <button
          @click="onConfirmClear"
          class="text-xs text-text-muted hover:text-danger transition-colors"
        >
          清空
        </button>
      </div>

      <div class="space-y-0.5">
        <div
          v-for="(file, idx) in files"
          :key="file.path"
          class="playlist-item group flex items-center gap-1.5 p-2 rounded-lg transition-colors cursor-pointer border border-transparent"
          :class="[
            idx === currentIndex
              ? 'bg-accent-blue/10 border-accent-blue/30'
              : 'hover:bg-bg-tertiary/50',
            idx === dragOverIdx ? 'drag-over' : '',
            idx === dragSrcIdx ? 'is-dragging' : ''
          ]"
          draggable="true"
          @click="emit('selectFile', idx)"
          @dragstart="onDragStart(idx, $event)"
          @dragover.prevent="onDragOver(idx, $event)"
          @dragleave="onDragLeave()"
          @drop="onDrop(idx)"
          @dragend="onDragEnd"
        >
          <!-- Drag Handle -->
          <span class="opacity-0 group-hover:opacity-50 cursor-grab flex-shrink-0 p-0.5 flex items-center">
            <GripVertical :size="14" />
          </span>

          <!-- Index / Indicator -->
          <div
            class="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 text-xs font-mono font-semibold"
            :class="idx === currentIndex
              ? 'bg-accent-blue/20 text-accent-blue'
              : 'bg-bg-primary text-text-muted'"
          >
            <template v-if="idx === currentIndex && isPlaying">
              <span class="flex items-center gap-px">
                <span class="w-0.5 h-2.5 bg-accent-blue rounded-full animate-pulse" />
                <span class="w-0.5 h-2 bg-accent-blue rounded-full animate-pulse" style="animation-delay: 0.15s" />
                <span class="w-0.5 h-3 bg-accent-blue rounded-full animate-pulse" style="animation-delay: 0.3s" />
              </span>
            </template>
            <template v-else>
              {{ idx + 1 }}
            </template>
          </div>

          <!-- Info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1">
              <Lock v-if="file.isEncrypted" :size="10" class="text-warning flex-shrink-0" />
              <FileVideo v-else :size="10" class="text-accent-blue flex-shrink-0" />
              <p
                class="text-xs truncate font-medium"
                :class="idx === currentIndex ? 'text-accent-blue' : 'text-text-primary'"
              >
                {{ getFileName(file.path) }}
              </p>
            </div>
            <p class="text-[10px] text-text-muted mt-0.5 truncate">
              <template v-if="file.isEncrypted">
                加密视频{{ file.tempPath ? ' · 已解密' : '' }}
              </template>
              <template v-else-if="file.meta">
                {{ file.meta.codec?.toUpperCase() || '未知' }}
                {{ file.meta.width }}×{{ file.meta.height }}
                · {{ formatSize(file.meta.size) }}
              </template>
              <template v-else>加载中...</template>
            </p>
          </div>

          <!-- Remove -->
          <button
            @click.stop="emit('removeFile', idx)"
            class="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-danger/10 transition-all flex-shrink-0"
            title="从列表中移除"
          >
            <X :size="12" class="text-danger" />
          </button>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="glass-card player-empty">
      <FileVideo :size="36" class="mb-2 opacity-20" />
      <p class="text-sm">暂无视频文件</p>
      <p class="text-xs mt-1 opacity-60">拖拽、选择文件或扫描文件夹</p>
    </div>
  </div>
</template>

<style scoped>
@use "./_player";
</style>
