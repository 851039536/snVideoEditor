<!-- 视频详情弹窗：展示编码/分辨率/码率等元信息 -->
<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
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

/** 拉取视频元信息，完成后写入 entry.meta 缓存 */
function fetchMeta(entry: FileEntry): void {
  detailLoading.value = true
  window.electronAPI
    .getVideoMeta(entry.path)
    .then((meta) => {
      entry.meta = meta
    })
    .catch(() => {
      // 静默失败：UI 展示"无法获取视频信息"
    })
    .finally(() => {
      // 仅当弹窗仍显示同一文件时才清除 loading，避免旧请求覆盖新弹窗状态
      if (!isUnmounted && props.entry === entry) {
        detailLoading.value = false
      }
    })
}

function close(): void {
  detailLoading.value = false
  emit('close')
}

// Escape 键关闭弹窗
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    close()
  }
}

// 监听 entry 变化：非 null 时自动拉取元信息并注册 Esc 监听，null 时移除
watch(() => props.entry, (entry) => {
  // 复位 loading：entry 置空（关闭）或有 meta 时不残留加载态；无 meta 时由 fetchMeta 重新置 true
  detailLoading.value = false
  if (entry) {
    if (!entry.meta) {
      fetchMeta(entry)
    }
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('keydown', onKeydown)
  }
})

onUnmounted(() => {
  isUnmounted = true
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="entry"
        class="detail-overlay"
        @click.self="close"
      >
        <div class="detail-modal glass-card" role="dialog" aria-modal="true" aria-label="视频详细信息">
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

          <!-- 元信息网格 -->
          <div v-else-if="entry.meta" class="detail-grid">
            <div class="detail-item detail-item--full">
              <span class="detail-label">文件路径</span>
              <span class="detail-value text-xs font-mono break-all" :title="entry.path">
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

<style scoped lang="scss">
@use "../../assets/styles/compress";
</style>
