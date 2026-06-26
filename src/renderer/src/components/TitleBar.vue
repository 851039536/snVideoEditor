<script setup lang="ts">
import { Minimize2, Maximize2, X, Minus } from 'lucide-vue-next'
import { ref, onMounted, onUnmounted } from 'vue'

const isMaximized = ref(false)

const handleMinimize = (): void => {
  window.electronAPI?.windowMinimize()
}

const handleMaximize = (): void => {
  window.electronAPI?.windowMaximize()
}

const handleClose = (): void => {
  window.electronAPI?.windowClose()
}

onMounted(async () => {
  if (window.electronAPI) {
    isMaximized.value = await window.electronAPI.windowIsMaximized()
    window.electronAPI.onMaximizeChange((maximized: boolean) => {
      isMaximized.value = maximized
    })
  }
})

onUnmounted(() => {
  window.electronAPI?.removeMaximizeChangeListener()
})
</script>

<template>
  <header class="title-bar drag-region flex items-center justify-between h-10 bg-bg-secondary border-b border-bg-tertiary select-none">
    <!-- App title -->
    <div class="pl-4 flex items-center gap-2">
      <span class="text-xs font-medium text-text-secondary tracking-wide">
        SN Video Editor
      </span>
    </div>

    <!-- Window controls -->
    <div class="no-drag flex items-center h-full">
      <button
        @click="handleMinimize"
        class="window-btn h-full w-11 flex items-center justify-center text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors duration-150"
        title="最小化"
      >
        <Minus :size="16" />
      </button>

      <button
        @click="handleMaximize"
        class="window-btn h-full w-11 flex items-center justify-center text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors duration-150"
        title="最大化"
      >
        <Maximize2 v-if="!isMaximized" :size="14" />
        <Minimize2 v-else :size="14" />
      </button>

      <button
        @click="handleClose"
        class="window-btn window-btn--close h-full w-11 flex items-center justify-center text-text-secondary hover:bg-red-600 hover:text-white transition-colors duration-150"
        title="关闭"
      >
        <X :size="18" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.window-btn {
  -webkit-app-region: no-drag;
}

.window-btn--close:hover {
  background-color: #E81123;
}
</style>
