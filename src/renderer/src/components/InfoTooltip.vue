<script setup lang="ts">
import { HelpCircle } from 'lucide-vue-next'
import { useInfoTooltip } from '@/composables/useInfoTooltip'

defineProps<{
  title?: string
  widthClass?: string
}>()

const tooltip = useInfoTooltip()
</script>

<template>
  <div class="relative flex items-center gap-1 mb-2">
    <slot name="label" />
    <button
      type="button"
      class="p-0.5 rounded hover:bg-bg-tertiary transition-colors"
      @click.stop="tooltip.toggle()"
      :title="title"
    >
      <HelpCircle :size="14" class="text-text-muted hover:text-text-secondary transition-colors" />
    </button>
    <transition name="tooltip-fade">
      <div
        v-if="tooltip.isOpen.value"
        :ref="tooltip.elRef"
        class="absolute left-0 bottom-full mb-2 p-3 rounded-lg bg-bg-secondary border border-bg-tertiary shadow-lg z-50 text-xs leading-relaxed text-text-secondary"
        :class="widthClass || 'w-72'"
      >
        <slot name="content" />
      </div>
    </transition>
  </div>
</template>

<style scoped>
.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity var(--transition-fast, 0.12s) ease,
              transform var(--transition-fast, 0.12s) ease;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
