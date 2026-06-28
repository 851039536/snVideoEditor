<script setup lang="ts">
import { Upload, FileVideo } from 'lucide-vue-next'
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  acceptedExtensions?: string[]
  customSelectFunc?: (() => Promise<string[]>) | null
}>(), {
  acceptedExtensions: () => ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp'],
  customSelectFunc: null
})

const emit = defineEmits<{
  filesSelected: [files: string[]]
}>()

const isDragging = ref(false)

async function handleDrop(event: DragEvent): Promise<void> {
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (!files) {
    return
  }
  await processFiles(files)
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
  isDragging.value = true
}

function handleDragLeave(): void {
  isDragging.value = false
}

async function processFiles(fileList: FileList): Promise<void> {
  const videoFiles: string[] = []
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i]
    if (file.type.startsWith('video/') || isAcceptableExtension(file.name)) {
      // @ts-ignore - Electron returns the path
      videoFiles.push(file.path || file.name)
    }
  }
  if (videoFiles.length > 0) {
    emit('filesSelected', videoFiles)
  }
}

function isAcceptableExtension(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
  return props.acceptedExtensions.includes(ext)
}

const acceptedExtsText = computed(() => {
  return props.acceptedExtensions.map(e => e.replace('.', '').toUpperCase()).join(' / ')
})

async function handleClick(): Promise<void> {
  let files: string[]
  if (props.customSelectFunc) {
    files = await props.customSelectFunc()
  } else {
    files = await window.electronAPI.selectVideoFiles()
  }
  if (files.length > 0) {
    emit('filesSelected', files)
  }
}
</script>

<template>
  <div
    class="relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300"
    :class="isDragging
      ? 'border-accent-purple bg-accent-purple/10'
      : 'border-bg-tertiary hover:border-accent-blue/50'"
    @drop.prevent="handleDrop"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @click="handleClick"
  >
    <!-- Glow overlay when dragging -->
    <div
      v-if="isDragging"
      class="absolute inset-0 rounded-xl bg-gradient-to-r from-accent-blue/10 to-accent-purple/10 animate-pulse-glow pointer-events-none"
    />

    <div class="relative z-10">
      <div class="mb-3">
        <div
          class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center transition-all duration-300"
          :class="isDragging ? 'bg-accent-purple/20 scale-110' : 'bg-bg-tertiary'"
        >
          <Upload 
            :size="32" 
            :class="isDragging ? 'text-accent-purple' : 'text-text-secondary'" 
            class="transition-colors duration-300"
          />
        </div>
      </div>
      
      <p class="text-text-primary font-medium mb-1">
        拖拽视频文件到此处
      </p>
      <p class="text-text-secondary text-sm">
        或点击选择文件 · 支持 {{ acceptedExtsText }}
      </p>
    </div>
  </div>
</template>
