<script setup lang="ts">
import { computed } from 'vue'
import { useProgressStore } from '@/stores/progress'
import { X, Loader } from 'lucide-vue-next'

const store = useProgressStore()

const typeLabel = computed((): string => {
  const labels: Record<string, string> = {
    split: '分割',
    merge: '合并',
    compress: '压缩',
    encrypt: '加密',
    decrypt: '解密'
  }
  return labels[store.operationType] || '处理'
})

const statusText = computed((): string => {
  if (store.isProcessing) {
    return `正在${typeLabel.value}...`
  }
  if (store.percent === 100) {
    return `${typeLabel.value}完成`
  }
  return '准备中...'
})
</script>

<template>
  <Transition name="slide-up">
    <div
      v-if="store.progress"
      class="glass-card p-4 mt-4"
    >
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <Loader 
            v-if="store.isProcessing"
            :size="16" 
            class="text-accent-blue animate-spin"
          />
          <span class="text-sm font-medium text-text-primary">{{ statusText }}</span>
        </div>
        <button
          @click="store.reset()"
          class="p-1 rounded-md hover:bg-bg-tertiary transition-colors"
        >
          <X :size="14" class="text-text-secondary" />
        </button>
      </div>

      <!-- Progress Bar -->
      <div class="relative h-2 bg-bg-tertiary rounded-full overflow-hidden mb-3">
        <div
          class="absolute top-0 left-0 h-full rounded-full transition-all duration-500 ease-out"
          :class="store.isProcessing
            ? 'bg-gradient-to-r from-accent-blue to-accent-purple'
            : 'bg-success'"
          :style="{ width: `${store.percent}%` }"
        >
          <div
            v-if="store.isProcessing"
            class="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer"
          />
        </div>
      </div>

      <!-- Details -->
      <div class="flex items-center justify-between text-xs text-text-secondary">
        <span>{{ store.percent }}%</span>
        <div class="flex items-center gap-4">
          <span v-if="store.totalFiles > 1">
            文件 {{ store.currentFile }}/{{ store.totalFiles }}
          </span>
          <span>{{ store.progress.speed }}</span>
          <span>{{ store.progress.eta }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.2s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.animate-shimmer {
  animation: shimmer 1.5s infinite;
}
</style>
