<script setup lang="ts">
import { ref, computed } from 'vue'
import { Play, Clock, FileVideo } from 'lucide-vue-next'
import type { FileInfo } from '../../../preload/index'

const props = defineProps<{
  filePath: string
  fileInfo?: FileInfo | null
}>()

const isDetailOpen = ref(false)

const fileName = computed((): string => {
  return props.filePath.split(/[/\\]/).pop() || props.filePath
})

const fileSizeStr = computed((): string => {
  if (!props.fileInfo) {
    return ''
  }
  return formatSize(props.fileInfo.size)
})

const fileExt = computed((): string => {
  return props.fileInfo?.ext?.toUpperCase() || fileName.value.split('.').pop()?.toUpperCase() || ''
})

function formatSize(bytes: number): string {
  if (bytes === 0) { return '0 B' }
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
</script>

<template>
  <div class="flex items-center gap-3 p-3 rounded-lg bg-bg-tertiary/50 hover:bg-bg-tertiary transition-colors group">
    <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
      <FileVideo :size="18" class="text-accent-blue" />
    </div>

    <div class="flex-1 min-w-0">
      <p class="text-sm text-text-primary truncate" :title="fileName">
        {{ fileName }}
      </p>
      <div class="flex items-center gap-3 text-xs text-text-secondary mt-0.5">
        <span>{{ fileExt }}</span>
        <span v-if="fileSizeStr">{{ fileSizeStr }}</span>
      </div>
    </div>

    <button
      class="p-1.5 rounded-md bg-bg-primary opacity-0 group-hover:opacity-100 hover:bg-accent-blue/20 transition-all"
      title="预览"
    >
      <Play :size="14" class="text-accent-blue" />
    </button>
  </div>
</template>
