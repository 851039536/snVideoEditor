<script setup lang="ts">
import { ref, computed } from 'vue'
import { Scissors, Plus, X, GripVertical, ArrowUp, ArrowDown, Folder, Play, Trash2 } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import VideoPreview from '@/components/VideoPreview.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'

const store = useProgressStore()

// Mode: 'split' | 'merge'
const mode = ref<'split' | 'merge'>('split')

// Selected files
const files = ref<string[]>([])

// Split parameters
const splitStartHour = ref('00')
const splitStartMin = ref('00')
const splitStartSec = ref('00')
const splitEndHour = ref('00')
const splitEndMin = ref('00')
const splitEndSec = ref('05')

// Output
const outputName = ref('')
const outputDir = ref('')

// Error message
const errorMsg = ref('')

const startTimeStr = computed((): string => {
  return `${splitStartHour.value}:${splitStartMin.value}:${splitStartSec.value}`
})

const durationStr = computed((): string => {
  const startSec = parseInt(splitStartHour.value) * 3600 + parseInt(splitStartMin.value) * 60 + parseInt(splitStartSec.value)
  const endSec = parseInt(splitEndHour.value) * 3600 + parseInt(splitEndMin.value) * 60 + parseInt(splitEndSec.value)
  const diff = Math.max(0, endSec - startSec)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const canStart = computed((): boolean => {
  if (mode.value === 'split') {
    if (files.value.length === 0) { return false }
    const startSec = parseInt(splitStartHour.value) * 3600 + parseInt(splitStartMin.value) * 60 + parseInt(splitStartSec.value)
    const endSec = parseInt(splitEndHour.value) * 3600 + parseInt(splitEndMin.value) * 60 + parseInt(splitEndSec.value)
    if (endSec <= startSec) { return false }
    return true
  }
  return files.value.length >= 2
})

function addFiles(newFiles: string[]): void {
  for (const f of newFiles) {
    if (!files.value.includes(f)) {
      files.value.push(f)
    }
  }
  if (outputName.value === '') {
    const name = newFiles[0].split(/[/\\]/).pop() || ''
    outputName.value = name.replace(/\.[^.]+$/, '') + '_output'
  }
}

function removeFile(index: number): void {
  files.value.splice(index, 1)
}

function moveFile(index: number, direction: -1 | 1): void {
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= files.value.length) { return }
  const temp = files.value[index]
  files.value[index] = files.value[newIndex]
  files.value[newIndex] = temp
}

async function selectOutputPath(): Promise<void> {
  const fn = mode.value === 'split' ? `${outputName.value}.mp4` : 'merged_output.mp4'
  const dir = await window.electronAPI.selectSavePath(fn, 'mp4')
  if (dir) {
    outputDir.value = dir
  }
}

async function startProcess(): Promise<void> {
  errorMsg.value = ''
  if (!await validateOutput()) { return }

  store.start(mode.value === 'split' ? 'split' : 'merge')

  window.electronAPI.onProgress((info) => {
    store.update(info)
  })

  try {
    let result = false
    if (mode.value === 'split') {
      result = await window.electronAPI.splitVideo({
        input: files.value[0],
        output: outputDir.value,
        startTime: startTimeStr.value,
        duration: durationStr.value
      })
    } else {
      result = await window.electronAPI.mergeVideos({
        inputs: files.value,
        output: outputDir.value
      })
    }
    if (result) {
      store.finish()
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    store.reset()
  }
}

async function validateOutput(): Promise<boolean> {
  if (!outputDir.value) {
    await selectOutputPath()
    if (!outputDir.value) {
      errorMsg.value = '请选择输出目录'
      return false
    }
  }
  return true
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}
</script>

<template>
  <div class="max-w-5xl mx-auto animate-slide-up">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
          <Scissors :size="20" class="text-accent-blue" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频分割与合并</h1>
      </div>
      <p class="text-text-secondary text-sm">精确切割视频片段，或无缝拼接多个视频</p>
    </header>

    <!-- Mode Tabs -->
    <div class="flex gap-1 mb-6 p-1 rounded-lg bg-bg-tertiary w-fit">
      <button
        @click="mode = 'split'"
        class="px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200"
        :class="mode === 'split' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'"
      >
        分割
      </button>
      <button
        @click="mode = 'merge'"
        class="px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200"
        :class="mode === 'merge' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'"
      >
        合并
      </button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Left: File Area -->
      <div class="space-y-4">
        <FileDropZone @files-selected="addFiles" />

        <!-- File List -->
        <div v-if="files.length > 0" class="glass-card p-4 space-y-2 max-h-80 overflow-y-auto">
          <div
            v-for="(file, idx) in files"
            :key="file"
            class="flex items-center gap-2 p-2 rounded-lg bg-bg-tertiary/50 hover:bg-bg-tertiary transition-colors group"
          >
            <VideoPreview :file-path="file" />
            <div v-if="mode === 'merge'" class="flex flex-col gap-1 ml-auto">
              <button
                @click="moveFile(idx, -1)"
                :disabled="idx === 0"
                class="p-0.5 rounded hover:bg-bg-primary disabled:opacity-30 transition-all"
              >
                <ArrowUp :size="14" class="text-text-secondary" />
              </button>
              <button
                @click="moveFile(idx, 1)"
                :disabled="idx === files.length - 1"
                class="p-0.5 rounded hover:bg-bg-primary disabled:opacity-30 transition-all"
              >
                <ArrowDown :size="14" class="text-text-secondary" />
              </button>
            </div>
            <button
              @click="removeFile(idx)"
              class="p-1 rounded hover:bg-danger/20 transition-all opacity-0 group-hover:opacity-100"
              :class="mode === 'merge' ? 'ml-1' : 'ml-auto'"
            >
              <X :size="14" class="text-danger" />
            </button>
          </div>
        </div>
      </div>

      <!-- Right: Parameters & Actions -->
      <div class="space-y-4">
        <div class="glass-card p-5">
          <h3 class="text-base font-semibold text-text-primary mb-4">
            {{ mode === 'split' ? '分割参数' : '合并文件列表' }}
          </h3>

          <!-- Split Parameters -->
          <div v-if="mode === 'split'" class="space-y-4">
            <div>
              <label class="block text-sm text-text-secondary mb-2">开始时间</label>
              <div class="flex items-center gap-2">
                <input v-model="splitStartHour" class="time-input" maxlength="2" placeholder="00" />
                <span class="text-text-muted">:</span>
                <input v-model="splitStartMin" class="time-input" maxlength="2" placeholder="00" />
                <span class="text-text-muted">:</span>
                <input v-model="splitStartSec" class="time-input" maxlength="2" placeholder="00" />
              </div>
            </div>
            <div>
              <label class="block text-sm text-text-secondary mb-2">结束时间</label>
              <div class="flex items-center gap-2">
                <input v-model="splitEndHour" class="time-input" maxlength="2" placeholder="00" />
                <span class="text-text-muted">:</span>
                <input v-model="splitEndMin" class="time-input" maxlength="2" placeholder="00" />
                <span class="text-text-muted">:</span>
                <input v-model="splitEndSec" class="time-input" maxlength="2" placeholder="05" />
              </div>
            </div>
            <div class="p-3 rounded-lg bg-bg-tertiary/50">
              <span class="text-xs text-text-secondary">将分割出 </span>
              <span class="text-sm font-mono text-accent-blue">{{ durationStr }}</span>
              <span class="text-xs text-text-secondary"> 的视频片段</span>
            </div>
          </div>

          <!-- Merge File Count -->
          <div v-else>
            <p class="text-sm text-text-secondary">
              当前已添加 <span class="text-accent-blue font-semibold">{{ files.length }}</span> 个文件
            </p>
            <p class="text-xs text-text-muted mt-2">
              拖拽调整文件顺序，合并时按列表顺序拼接
            </p>
          </div>
        </div>

        <!-- Output Path -->
        <div class="glass-card p-5">
          <h3 class="text-base font-semibold text-text-primary mb-3">输出设置</h3>
          <div class="flex items-center gap-2">
            <button
              @click="selectOutputPath"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary hover:bg-bg-primary text-text-secondary hover:text-text-primary transition-all text-sm border border-transparent hover:border-accent-blue/30"
            >
              <Folder :size="16" />
              选择输出位置
            </button>
          </div>
          <p v-if="outputDir" class="text-xs text-accent-light mt-2 truncate">
            {{ outputDir }}
          </p>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="p-3 rounded-lg bg-danger/10 border border-danger/30">
          <p class="text-sm text-danger">{{ errorMsg }}</p>
        </div>

        <!-- Start Button -->
        <button
          @click="startProcess"
          :disabled="!canStart || store.isProcessing"
          class="w-full py-3 rounded-xl font-semibold text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="canStart && !store.isProcessing
            ? 'bg-gradient-to-r from-accent-blue to-accent-purple hover:shadow-lg hover:shadow-purple-500/25'
            : 'bg-bg-tertiary text-text-muted'"
        >
          <template v-if="!store.isProcessing">
            <Play :size="18" class="inline mr-2 -mt-0.5" />
            开始{{ mode === 'split' ? '分割' : '合并' }}
          </template>
          <template v-else>
            处理中...
          </template>
        </button>

        <!-- Progress -->
        <ProgressPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.time-input {
  width: 48px;
  padding: 6px 8px;
  text-align: center;
  font-size: 14px;
  font-family: monospace;
  background: #21262D;
  border: 1px solid #30363D;
  border-radius: 8px;
  color: #E6EDF3;
  outline: none;
  transition: border-color 0.2s;
}

.time-input:focus {
  border-color: #5B8DEF;
}

.time-input::placeholder {
  color: #484F58;
}
</style>
