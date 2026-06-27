<script setup lang="ts">
import { X, ArrowUp, ArrowDown } from 'lucide-vue-next'
import { secondsToHMS } from '@/lib/time'

interface ClipItem {
  id: string
  sourceFile: string
  sourceFileName: string
  startSec: number
  endSec: number
  duration: number
  outputFile: string
  selected: boolean
}

const props = withDefaults(defineProps<{
  clips: ClipItem[]
  showReorder?: boolean
  selectedCount?: number
}>(), {
  showReorder: false,
  selectedCount: 0
})

const emit = defineEmits<{
  toggle: [index: number]
  remove: [index: number]
  move: [index: number, direction: -1 | 1]
}>()
</script>

<template>
  <div class="glass-card p-4">
    <h3 class="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
      <template v-if="showReorder">
        裁切片断
        <span class="text-xs text-text-muted font-normal">
          （勾选 {{ selectedCount }} / {{ clips.length }}）
        </span>
      </template>
      <template v-else>
        已裁切片段
        <span class="text-xs text-text-muted font-normal ml-2">
          （{{ clips.length }} 个）
        </span>
      </template>
    </h3>
    <div class="space-y-2 max-h-64 overflow-y-auto">
      <div
        v-for="(clip, idx) in clips"
        :key="clip.id"
        class="flex items-center gap-3 p-2.5 rounded-lg bg-bg-tertiary/50 hover:bg-bg-tertiary transition-colors group"
      >
        <!-- Checkbox -->
        <input
          type="checkbox"
          :checked="clip.selected"
          @change="emit('toggle', idx)"
          class="w-4 h-4 rounded accent-accent-blue cursor-pointer flex-shrink-0"
        />
        <!-- Info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-xs text-text-primary font-medium truncate">{{ clip.sourceFileName }}</span>
            <span class="text-xs text-text-muted font-mono flex-shrink-0">
              {{ secondsToHMS(clip.startSec) }} → {{ secondsToHMS(clip.endSec) }}
            </span>
          </div>
          <div class="text-xs text-text-muted mt-0.5">
            时长 {{ secondsToHMS(clip.duration) }}
          </div>
        </div>
        <!-- Reorder buttons (merge mode only) -->
        <div v-if="showReorder" class="flex flex-col gap-0.5">
          <button
            @click="emit('move', idx, -1)"
            :disabled="idx === 0"
            class="p-0.5 rounded hover:bg-bg-primary disabled:opacity-30 transition-all"
          >
            <ArrowUp :size="13" class="text-text-secondary" />
          </button>
          <button
            @click="emit('move', idx, 1)"
            :disabled="idx === clips.length - 1"
            class="p-0.5 rounded hover:bg-bg-primary disabled:opacity-30 transition-all"
          >
            <ArrowDown :size="13" class="text-text-secondary" />
          </button>
        </div>
        <!-- Remove -->
        <button
          @click="emit('remove', idx)"
          class="p-1 rounded hover:bg-danger/20 transition-all opacity-0 group-hover:opacity-100 flex-shrink-0"
          title="移除"
        >
          <X :size="14" class="text-danger" />
        </button>
      </div>
    </div>
  </div>
</template>
