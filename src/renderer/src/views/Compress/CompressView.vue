<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { FileVideo, Folder, X, Zap } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'
import { useSettingsStore } from '@/stores/settings'
import type { VideoMeta } from '../../../preload/index'

const progressStore = useProgressStore()
const settingsStore = useSettingsStore()

// Files
interface FileEntry {
  path: string
  outputPath: string
  meta: VideoMeta | null
}

const files = ref<FileEntry[]>([])
const errorMsg = ref('')

// Compression params
const selectedPreset = ref('中等质量')
const crfValue = ref(23)
const resolution = ref('original')
const bitrate = ref('')
const codec = ref('libx264')
const customMode = ref(false)

const preset = computed(() => {
  return settingsStore.compressPresets.find((p) => p.label === selectedPreset.value)
})

function selectPreset(label: string): void {
  selectedPreset.value = label
  if (preset.value) {
    crfValue.value = preset.value.crf
  }
}

const RESOLUTION_BITRATE: Record<string, string> = {
  '1920:1080': '4000k',
  '1280:720': '500k',
  '854:480': '300k',
  '640:360': '300k'
}

watch(resolution, (res) => {
  bitrate.value = RESOLUTION_BITRATE[res] || ''
})

async function addFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    if (files.value.some((f) => f.path === p)) { continue }
    const entry: FileEntry = { path: p, outputPath: '', meta: null }
    files.value.push(entry)
    // Load metadata async
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
    entry.outputPath = `${dir}/${name}_compressed.mp4`
  }
}

function estimateOutputSize(entry: FileEntry): string {
  if (!entry.meta || entry.meta.size === 0) { return '未知' }
  const originalMB = entry.meta.size / (1024 * 1024)
  // Rough estimate based on CRF
  const ratios: Record<number, number> = { 18: 0.7, 23: 0.4, 28: 0.2, 32: 0.12 }
  const ratio = ratios[crfValue.value] || 0.4
  const estMB = originalMB * ratio
  return `${Math.round(estMB)} MB`
}

async function startCompress(): Promise<void> {
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

  progressStore.start('compress')
  window.electronAPI.onProgress((info) => {
    progressStore.update(info)
  })

  try {
    const batchFiles = files.value.map((f) => ({
      input: f.path,
      output: f.outputPath,
      crf: crfValue.value,
      resolution: resolution.value,
      bitrate: bitrate.value,
      codec: codec.value
    }))
    const result = await window.electronAPI.batchCompress({ files: batchFiles })
    if (result.failed.length === 0) {
      progressStore.finish()
    } else {
      errorMsg.value = `${result.failed.length} 个文件压缩失败`
      progressStore.reset()
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    progressStore.reset()
  }
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


function getOutputDir(path: string): string {
  return path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

const canStart = computed((): boolean => {
  return files.value.length > 0 && !progressStore.isProcessing
})

onUnmounted(() => {
  window.electronAPI?.removeProgressListener()
})
</script>

<template>
  <div class="max-w-6xl mx-auto animate-slide-up">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
          <FileVideo :size="20" class="text-accent-purple" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频压缩</h1>
      </div>
      <p class="text-text-secondary text-sm">智能压缩视频文件大小，支持 H.264 / H.265 编码</p>
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
                <th class="text-right p-3 font-medium">大小</th>
                <th class="text-right p-3 font-medium">预估</th>
                <th class="text-right p-3 font-medium w-10" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(entry, idx) in files"
                :key="entry.path"
                class="border-b border-bg-tertiary/50"
              >
                <td class="p-3">
                  <div class="flex items-center gap-2">
                    <FileVideo :size="16" class="text-accent-purple flex-shrink-0" />
                    <span class="truncate max-w-[200px]" :title="entry.path">
                      {{ entry.path.split(/[/\\]/).pop() }}
                    </span>
                  </div>
                </td>
                <td class="p-3 text-right text-text-secondary">
                  {{ entry.meta ? formatSize(entry.meta.size) : '...' }}
                </td>
                <td class="p-3 text-right text-accent-light font-mono">
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
        <!-- Compression Presets -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">压缩预设</h3>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="p in settingsStore.compressPresets"
              :key="p.label"
              @click="selectPreset(p.label); customMode = false"
              class="preset-btn p-3 rounded-lg text-left transition-all duration-200"
              :class="selectedPreset === p.label && !customMode
                ? 'bg-accent-purple/10 border-accent-purple/50'
                : 'bg-bg-tertiary/50 border-transparent'"
              style="border-width: 1px; border-style: solid;"
            >
              <span class="text-sm font-medium text-text-primary block">{{ p.label }}</span>
              <span class="text-xs text-text-muted">CRF {{ p.crf }}</span>
            </button>
          </div>

          <!-- Custom Mode Toggle -->
          <button
            @click="customMode = !customMode; if (customMode) selectedPreset = '自定义'"
            class="mt-3 w-full p-2 rounded-lg text-sm border transition-all"
            :class="customMode
              ? 'border-accent-purple/50 text-accent-purple bg-accent-purple/10'
              : 'border-dashed border-bg-tertiary text-text-secondary'"
          >
            <Zap :size="14" class="inline mr-1 -mt-0.5" />
            {{ customMode ? '自定义模式已启用' : '切换自定义参数' }}
          </button>
        </div>

        <!-- Custom Parameters -->
        <Transition name="fade">
          <div v-if="customMode" class="glass-card p-4 space-y-3">
            <h3 class="text-base font-semibold text-text-primary">自定义参数</h3>

            <!-- CRF Slider -->
            <div>
              <label class="text-sm text-text-secondary">CRF 质量 ({{ crfValue }})</label>
              <input
                v-model.number="crfValue"
                type="range"
                min="0"
                max="51"
                class="w-full mt-2 slider"
              />
              <div class="flex justify-between text-xs text-text-muted mt-1">
                <span>无损</span>
                <span>最佳</span>
                <span>默认</span>
                <span>低质量</span>
              </div>
            </div>

            <!-- Resolution -->
            <div>
              <label class="text-sm text-text-secondary mb-2 block">输出分辨率</label>
              <select v-model="resolution" class="select-input w-full">
                <option value="original">原始分辨率</option>
                <option value="1920:1080">1080p (1920×1080)</option>
                <option value="1280:720">720p (1280×720)</option>
                <option value="854:480">480p (854×480)</option>
                <option value="640:360">360p (640×360)</option>
              </select>
            </div>

            <!-- Bitrate -->
            <div>
              <label class="text-sm text-text-secondary mb-2 block">视频码率限制 (留空为自动)</label>
              <select v-model="bitrate" class="select-input w-full">
                <option value="">自动</option>
                <option value="4000k">4 Mbps</option>
                <option value="500k">500 Kbps</option>
                <option value="300k">300 Kbps</option>
              </select>
            </div>

            <!-- Codec -->
            <div>
              <label class="text-sm text-text-secondary mb-2 block">编码格式</label>
              <select v-model="codec" class="select-input w-full">
                <option value="libx264">H.264 (兼容性最好)</option>
                <option value="libx265">H.265 / HEVC (更高压缩比)</option>
                <option value="libvpx-vp9">VP9 (Web优化)</option>
              </select>
            </div>
          </div>
        </Transition>

        <!-- Output -->
        <div class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">输出设置</h3>
          <button
            @click="selectOutputDir"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary text-text-secondary text-sm border border-transparent"
          >
            <Folder :size="16" />
            选择输出目录
          </button>
          <p v-if="files.length > 0 && files[0].outputPath" class="text-xs text-accent-light mt-2 truncate">
            {{ getOutputDir(files[0].outputPath) }}
          </p>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="p-3 rounded-lg bg-danger/10 border border-danger/30">
          <p class="text-sm text-danger">{{ errorMsg }}</p>
        </div>

        <!-- Start -->
        <button
          @click="startCompress"
          :disabled="!canStart"
          class="w-full py-3 rounded-xl font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="canStart
            ? 'bg-gradient-to-r from-accent-purple to-pink-500'
            : 'bg-bg-tertiary text-text-muted'"
        >
          <Zap :size="18" />
          {{ progressStore.isProcessing ? '压缩中...' : `开始压缩 (${files.length} 个文件)` }}
        </button>

        <ProgressPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.preset-btn {
  /* hover animation removed */
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
  background: linear-gradient(to right, #3FB950, #D29922, #F85149);
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
  border: 2px solid hsl(var(--primary));
  cursor: pointer;
  box-shadow: 0 0 8px rgba(123, 92, 252, 0.4);
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
</style>
