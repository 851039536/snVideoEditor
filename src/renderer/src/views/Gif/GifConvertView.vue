<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { Image, Folder, X, Zap, Clock, ChevronDown, ChevronUp } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'
import type { VideoMeta } from '../../../preload/index'

const progressStore = useProgressStore()

// Quality presets
interface QualityPreset {
  value: 'high' | 'medium' | 'low'
  label: string
  description: string
}

const qualityPresets: QualityPreset[] = [
  { value: 'high', label: '高质量', description: '最佳画质，文件较大' },
  { value: 'medium', label: '中等质量', description: '画质与大小平衡' },
  { value: 'low', label: '低质量', description: '最小文件，快速生成' }
]
const selectedQuality = ref<'high' | 'medium' | 'low'>('medium')

// Parameters
const fps = ref(10)
const selectedWidth = ref('480')
const widthOptions = [
  { label: '原始尺寸', value: '0' },
  { label: '320px', value: '320' },
  { label: '480px (推荐)', value: '480' },
  { label: '640px', value: '640' },
  { label: '800px', value: '800' }
]

// Segment trimming
const enableTrim = ref(false)
const startTime = ref(0)
const segmentDuration = ref(5)

// Loop
const loopCount = ref(0)

// Files
interface FileEntry {
  path: string
  outputPath: string
  meta: VideoMeta | null
}

const files = ref<FileEntry[]>([])
const errorMsg = ref('')

const computedWidth = computed((): number => {
  return parseInt(selectedWidth.value)
})

const canStart = computed((): boolean => {
  return files.value.length > 0 && !progressStore.isProcessing
})

async function addFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    if (files.value.some((f) => f.path === p)) { continue }
    const entry: FileEntry = { path: p, outputPath: '', meta: null }
    files.value.push(entry)
    getMeta(entry)
  }
}

async function getMeta(entry: FileEntry): Promise<void> {
  try {
    entry.meta = await window.electronAPI.getVideoMeta(entry.path)
  } catch (e) {
    console.error('Failed to get meta:', e)
  }
}

function removeFile(index: number): void {
  files.value.splice(index, 1)
}

async function selectOutputDir(): Promise<void> {
  const dir = await window.electronAPI.selectDirectory()
  if (!dir) { return }

  for (const entry of files.value) {
    const name = entry.path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'output'
    entry.outputPath = `${dir}/${name}.gif`
  }
}

function estimateOutputSize(entry: FileEntry): string {
  if (!entry.meta || entry.meta.duration === 0) { return '未知' }
  const duration = enableTrim.value ? segmentDuration.value : entry.meta.duration
  const w = computedWidth.value > 0 ? computedWidth.value : (entry.meta.width || 640)
  const pixels = w * (w * 9 / 16)
  const frames = duration * fps.value
  const qualityFactors: Record<string, number> = { high: 0.6, medium: 0.4, low: 0.2 }
  const factor = qualityFactors[selectedQuality.value] || 0.4
  const estBytes = frames * pixels * factor * 0.3
  const estMB = estBytes / (1024 * 1024)
  if (estMB < 0.1) { return '< 0.1 MB' }
  return `~${estMB.toFixed(1)} MB`
}

function formatSize(bytes: number): string {
  if (bytes === 0) { return '0 B' }
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

async function startConvert(): Promise<void> {
  errorMsg.value = ''
  if (files.value.length === 0) { return }

  for (const entry of files.value) {
    if (!entry.outputPath) {
      await selectOutputDir()
      break
    }
  }

  const unresolved = files.value.filter((f) => !f.outputPath)
  if (unresolved.length > 0) {
    errorMsg.value = '请为所有文件选择输出目录'
    return
  }

  progressStore.start('gif')
  window.electronAPI.onProgress((info) => {
    progressStore.update(info)
  })

  try {
    const trimmedStart = enableTrim.value ? startTime.value : undefined
    const trimmedDuration = enableTrim.value ? segmentDuration.value : undefined

    if (files.value.length === 1) {
      const f = files.value[0]
      const result = await window.electronAPI.convertToGif({
        input: f.path,
        output: f.outputPath,
        fps: fps.value,
        width: computedWidth.value,
        quality: selectedQuality.value,
        startTime: trimmedStart,
        duration: trimmedDuration,
        loop: loopCount.value
      })
      if (result) {
        progressStore.finish()
      }
    } else {
      const batchFiles = files.value.map((f) => ({
        input: f.path,
        output: f.outputPath,
        fps: fps.value,
        width: computedWidth.value,
        quality: selectedQuality.value,
        startTime: trimmedStart,
        duration: trimmedDuration,
        loop: loopCount.value
      }))
      const result = await window.electronAPI.batchConvertToGif({ files: batchFiles })
      if (result.failed.length === 0) {
        progressStore.finish()
      } else {
        errorMsg.value = `${result.failed.length} 个文件转换失败`
        progressStore.reset()
      }
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    progressStore.reset()
  }
}

onUnmounted(() => {
  window.electronAPI?.removeProgressListener()
})
</script>

<template>
  <div class="max-w-6xl mx-auto animate-slide-up">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500/20 to-yellow-500/20 flex items-center justify-center">
          <Image :size="20" class="text-warning" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频转GIF</h1>
      </div>
      <p class="text-text-secondary text-sm">将视频片段转换为高质量 GIF 动图，双通道调色板优化</p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Left: File List -->
      <div class="space-y-3">
        <FileDropZone @files-selected="addFiles" />

        <!-- File Table -->
        <div v-if="files.length > 0" class="glass-card overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-bg-tertiary text-text-secondary text-xs">
                <th class="text-left p-3 font-medium">文件名</th>
                <th class="text-right p-3 font-medium">时长</th>
                <th class="text-right p-3 font-medium">预估</th>
                <th class="text-right p-3 font-medium w-10" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(entry, idx) in files"
                :key="entry.path"
                class="border-b border-bg-tertiary/50 group"
              >
                <td class="p-3">
                  <div class="flex items-center gap-2">
                    <Image :size="16" class="text-warning flex-shrink-0" />
                    <span class="truncate max-w-[200px]" :title="entry.path">
                      {{ entry.path.split(/[/\\]/).pop() }}
                    </span>
                  </div>
                </td>
                <td class="p-3 text-right text-text-secondary">
                  {{ entry.meta ? formatDuration(entry.meta.duration) : '...' }}
                </td>
                <td class="p-3 text-right text-warning font-mono">
                  {{ entry.meta ? estimateOutputSize(entry) : '...' }}
                </td>
                <td class="p-3 text-right">
                  <button
                    @click="removeFile(idx)"
                    class="p-1 rounded"
                  >
                    <X :size="14" class="text-danger" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right: Parameters -->
      <div class="space-y-3">
        <!-- Quality Presets -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">质量预设</h3>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="p in qualityPresets"
              :key="p.value"
              @click="selectedQuality = p.value"
              class="preset-btn p-3 rounded-lg text-left transition-all duration-200"
              :class="selectedQuality === p.value
                ? 'bg-warning/10 border-warning/50'
                : 'bg-bg-tertiary/50 border-transparent'"
              style="border-width: 1px; border-style: solid;"
            >
              <span class="text-sm font-medium text-text-primary block">{{ p.label }}</span>
              <span class="text-xs text-text-muted">{{ p.description }}</span>
            </button>
          </div>
        </div>

        <!-- FPS Slider -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">帧率: {{ fps }} FPS</h3>
          <input
            v-model.number="fps"
            type="range"
            min="5"
            max="30"
            step="1"
            class="w-full slider"
          />
          <div class="flex justify-between text-xs text-text-muted mt-1">
            <span>5</span>
            <span>10 (推荐)</span>
            <span>15</span>
            <span>20</span>
            <span>25</span>
            <span>30</span>
          </div>
        </div>

        <!-- Width Selector -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">输出分辨率</h3>
          <select v-model="selectedWidth" class="select-input w-full">
            <option
              v-for="opt in widthOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- Loop Setting -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">循环设置</h3>
          <div class="flex gap-2">
            <button
              v-for="opt in [{ label: '无限', val: 0 }, { label: '1次', val: 1 }, { label: '3次', val: 3 }, { label: '5次', val: 5 }]"
              :key="opt.val"
              @click="loopCount = opt.val"
              class="flex-1 py-2 rounded-lg text-sm transition-all border"
              :class="loopCount === opt.val
                ? 'bg-warning/10 border-warning/50 text-text-primary'
                : 'bg-bg-tertiary/50 border-transparent text-text-secondary'"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- Segment Trimming (optional) -->
        <div class="glass-card p-4">
          <button
            @click="enableTrim = !enableTrim"
            class="w-full flex items-center justify-between"
          >
            <div class="flex items-center gap-2">
              <Clock :size="16" class="text-text-secondary" />
              <h3 class="text-base font-semibold text-text-primary">截取片段 (可选)</h3>
            </div>
            <component
              :is="enableTrim ? ChevronUp : ChevronDown"
              :size="16"
              class="text-text-secondary"
            />
          </button>

          <Transition name="fade">
            <div v-if="enableTrim" class="mt-3 space-y-3">
              <div>
                <label class="text-sm text-text-secondary mb-1 block">起始时间 (秒)</label>
                <input
                  v-model.number="startTime"
                  type="number"
                  min="0"
                  step="0.1"
                  class="input-field w-full"
                  placeholder="0"
                />
              </div>
              <div>
                <label class="text-sm text-text-secondary mb-1 block">持续时长 (秒)</label>
                <input
                  v-model.number="segmentDuration"
                  type="number"
                  min="0.1"
                  step="0.1"
                  class="input-field w-full"
                  placeholder="5"
                />
              </div>
            </div>
          </Transition>
        </div>

        <!-- Output Settings -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">输出设置</h3>
          <button
            @click="selectOutputDir"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary text-text-secondary text-sm border border-transparent"
          >
            <Folder :size="16" />
            选择输出目录
          </button>
          <p v-if="files.length > 0 && files[0].outputPath" class="text-xs text-warning mt-2 truncate">
            {{ files[0].outputPath.split('/').slice(0, -1).join('/') }}
          </p>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="p-3 rounded-lg bg-danger/10 border border-danger/30">
          <p class="text-sm text-danger">{{ errorMsg }}</p>
        </div>

        <!-- Start Button -->
        <button
          @click="startConvert"
          :disabled="!canStart"
          class="w-full py-3 rounded-xl font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="canStart
            ? 'bg-gradient-to-r from-orange-500 to-yellow-500'
            : 'bg-bg-tertiary text-text-muted'"
        >
          <Zap :size="18" />
          {{ progressStore.isProcessing ? '转换中...' : `开始转换 (${files.length} 个文件)` }}
        </button>

        <ProgressPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.preset-btn {
  /* no hover animation */
}

.select-input {
  padding: 8px 12px;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-md, 8px);
  color: hsl(var(--foreground));
  outline: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%238B949E' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 20px;
  padding-right: 32px;
}

.slider {
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  background: linear-gradient(to right, #F0A050, #D29922);
  border-radius: 3px;
  outline: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: hsl(var(--foreground));
  border: 2px solid #F0A050;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(240, 160, 80, 0.4);
}

.input-field {
  padding: 10px 14px;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-md, 8px);
  color: hsl(var(--foreground));
  outline: none;
}

.input-field::placeholder {
  color: hsl(var(--muted-foreground));
}

.fade-enter-active,
.fade-leave-active {
  transition: all 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

@media (max-width: 768px) {
  .slider {
    height: 8px;
  }
}
</style>
