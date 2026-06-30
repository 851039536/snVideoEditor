<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { FileVideo, X } from 'lucide-vue-next'
import { formatSize, getFileName } from '@/utils/format'
import { secondsToHMS } from '@/utils/time'
import type { FileEntry } from '@/types/file'

const props = defineProps<{
  entry: FileEntry | null
}>()

const emit = defineEmits<{
  close: []
}>()

const detailLoading = ref(false)
let isUnmounted = false

function fetchMeta(entry: FileEntry): void {
  detailLoading.value = true
  window.electronAPI.getVideoMeta(entry.path).then((meta) => {
    if (!isUnmounted) {
      entry.meta = meta
      detailLoading.value = false
    }
  }).catch(() => {
    if (!isUnmounted) {
      detailLoading.value = false
    }
  })
}

// Watch for entry changes to auto-fetch meta
function onOpen(): void {
  if (props.entry && !props.entry.meta) {
    fetchMeta(props.entry)
  }
}

function close(): void {
  detailLoading.value = false
  emit('close')
}

// Expose onOpen for parent to call when modal becomes visible
defineExpose({ onOpen })

onUnmounted(() => {
  isUnmounted = true
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="entry"
        class="detail-overlay"
        @click.self="close"
        @keydown.escape="close"
      >
        <div class="detail-modal glass-card" role="dialog" aria-label="视频详细信息">
          <div class="detail-header">
            <div class="flex items-center gap-2 min-w-0">
              <FileVideo :size="18" class="text-accent-purple flex-shrink-0" />
              <h3 class="text-base font-semibold text-text-primary truncate" :title="entry.path">
                {{ getFileName(entry.path) }}
              </h3>
            </div>
            <button
              @click="close"
              class="p-1.5 rounded hover:bg-bg-tertiary transition-colors"
              title="关闭"
            >
              <X :size="18" class="text-text-secondary" />
            </button>
          </div>

          <!-- Loading -->
          <div v-if="detailLoading" class="detail-loading">
            <p class="text-text-secondary text-sm">正在获取视频信息...</p>
          </div>

          <!-- Metadata grid -->
          <div v-else-if="entry.meta" class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">文件路径</span>
              <span class="detail-value text-xs font-mono truncate" :title="entry.path">
                {{ entry.path }}
              </span>
            </div>
            <div class="detail-item">
              <span class="detail-label">视频编码</span>
              <span class="detail-value">{{ entry.meta.codec || '未知' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">分辨率</span>
              <span class="detail-value">{{ entry.meta.width }} × {{ entry.meta.height }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">时长</span>
              <span class="detail-value font-mono">{{ secondsToHMS(entry.meta.duration) }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">文件大小</span>
              <span class="detail-value font-mono">{{ formatSize(entry.meta.size) }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">视频码率</span>
              <span class="detail-value font-mono">
                {{ entry.meta.bitrate ? (entry.meta.bitrate / 1000).toFixed(0) + ' Kbps' : '未知' }}
              </span>
            </div>
          </div>

          <!-- No meta (fetch failed or never fetched) -->
          <div v-else class="detail-loading">
            <p class="text-text-muted text-sm">无法获取视频信息</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
@use "../../assets/styles/compress";
</style>
