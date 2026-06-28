<script setup lang="ts">
import { computed } from 'vue'
import { useProgressStore } from '@/stores/progress'
import {
  Download, Check, X, AlertTriangle, Clock, Trash2, RotateCcw, ListOrdered, ListChecks
} from 'lucide-vue-next'

const store = useProgressStore()

const emit = defineEmits<{
  retry: [id: string]
  remove: [id: string]
}>()

const statusConfig = computed(() => ({
  pending: { icon: Clock, class: 'text-yellow-400', bg: 'bg-yellow-400/10', label: '等待中' },
  downloading: { icon: Download, class: 'text-accent-blue animate-pulse', bg: 'bg-accent-blue/10', label: '下载中' },
  completed: { icon: Check, class: 'text-success', bg: 'bg-success/10', label: '已完成' },
  failed: { icon: AlertTriangle, class: 'text-danger', bg: 'bg-danger/10', label: '失败' },
  cancelled: { icon: X, class: 'text-text-muted', bg: 'bg-text-muted/10', label: '已取消' }
}))

function truncateUrl(url: string, maxLen = 50): string {
  if (url.length <= maxLen) { return url }
  return url.slice(0, maxLen - 3) + '...'
}

function statusCount(status: string): number {
  return store.queueItems.filter((i) => i.status === status).length
}

const pendingCount = computed(() => statusCount('pending'))
const completedCount = computed(() => statusCount('completed'))
const failedCount = computed(() => statusCount('failed'))
</script>

<template>
  <div v-if="store.queueItems.length > 0" class="glass-card p-4 mt-4">
    <!-- Header -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <ListOrdered :size="16" class="text-accent-blue" />
        <h3 class="text-sm font-semibold text-text-primary">
          下载队列 ({{ store.queueItems.length }})
        </h3>
        <div class="flex items-center gap-2 text-xs text-text-muted ml-2">
          <span v-if="pendingCount > 0" class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-yellow-400" />
            等待 {{ pendingCount }}
          </span>
          <span v-if="completedCount > 0" class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-success" />
            完成 {{ completedCount }}
          </span>
          <span v-if="failedCount > 0" class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-danger" />
            失败 {{ failedCount }}
          </span>
        </div>
      </div>
      <ListChecks v-if="pendingCount === 0 && store.queueItems.length > 0" :size="14" class="text-success" />
    </div>

    <!-- Queue Items -->
    <div class="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
      <div
        v-for="item in store.queueItems"
        :key="item.id"
        class="queue-item p-3 rounded-lg border transition-all duration-200"
        :class="{
          'border-accent-blue/30 bg-accent-blue/5': item.status === 'downloading',
          'border-bg-tertiary bg-bg-secondary/50': item.status === 'pending',
          'border-bg-tertiary bg-bg-secondary/30 opacity-70': item.status === 'completed',
          'border-danger/40 bg-danger/5': item.status === 'failed',
          'border-bg-tertiary/50 bg-bg-secondary/20 opacity-50': item.status === 'cancelled'
        }"
      >
        <div class="flex items-start gap-3">
          <!-- Status Icon -->
          <div
            class="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
            :class="statusConfig[item.status].bg"
          >
            <component
              :is="statusConfig[item.status].icon"
              :size="14"
              :class="statusConfig[item.status].class"
            />
          </div>

          <!-- Info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-0.5">
              <span class="text-xs font-medium text-text-primary truncate">
                {{ truncateUrl(item.url, 60) }}
              </span>
              <span
                class="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                :class="[
                  statusConfig[item.status].bg,
                  statusConfig[item.status].class,
                  { 'animate-pulse': item.status === 'downloading' }
                ]"
              >
                {{ statusConfig[item.status].label }}
              </span>
            </div>
            <p class="text-[11px] text-text-muted truncate mb-1">{{ item.fileName }}</p>

            <!-- Progress bar (only for downloading) -->
            <div v-if="item.status === 'downloading'" class="relative h-1.5 bg-bg-tertiary rounded-full overflow-hidden mb-1">
              <div
                class="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-accent-blue to-accent-purple transition-all duration-300"
                :style="{ width: `${item.progress.percent}%` }"
              >
                <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
              </div>
            </div>

            <!-- Progress text -->
            <div class="flex items-center gap-3 text-[10px] text-text-muted">
              <span v-if="item.status === 'downloading'">{{ item.progress.percent }}%</span>
              <span v-if="item.status === 'downloading' && item.progress.speed">{{ item.progress.speed }}</span>
              <span v-if="item.status === 'failed' && item.error" class="text-danger truncate" :title="item.error">
                {{ item.error.slice(0, 60) }}{{ item.error.length > 60 ? '...' : '' }}
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-1 flex-shrink-0">
            <button
              v-if="item.status === 'failed'"
              @click="emit('retry', item.id)"
              class="p-1.5 rounded-md hover:bg-accent-blue/20 text-text-muted hover:text-accent-blue transition-colors"
              title="重试"
            >
              <RotateCcw :size="13" />
            </button>
            <button
              v-if="item.status === 'pending'"
              @click="emit('remove', item.id)"
              class="p-1.5 rounded-md hover:bg-danger/20 text-text-muted hover:text-danger transition-colors"
              title="移除"
            >
              <Trash2 :size="13" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 2px;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.animate-shimmer {
  animation: shimmer 1.5s infinite;
}
</style>
