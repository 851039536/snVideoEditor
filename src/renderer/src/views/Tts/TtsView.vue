<!-- TTS 语音合成页面：文本批量转 MP3，语音选择与试听 -->
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { AudioLines, Folder, FolderOpen, X, FileText, Volume2, Square, Play, Music } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'
import { formatSize, getFileName, toFileUrl } from '@/utils/format'
import type { TtsFileEntry, TtsVoiceOption } from './types'

const progressStore = useProgressStore()

const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma']

function isAudioFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'))
  return AUDIO_EXTS.includes(ext)
}

// Files
const files = ref<TtsFileEntry[]>([])
const errorMsg = ref('')

// Voice settings
const voices = ref<TtsVoiceOption[]>([])
const selectedVoice = ref('')
const rate = ref(0)

// Preview
const isPreviewing = ref(false)
const previewAudioPath = ref('')
const previewAudio = ref<HTMLAudioElement | null>(null)

// Output audio playback
const outputAudio = ref<HTMLAudioElement | null>(null)
const playingOutputPath = ref('')

// Output
const outputDir = ref('')

const selectedVoiceInfo = computed((): TtsVoiceOption | undefined => {
  return voices.value.find((v) => v.id === selectedVoice.value)
})

const femaleVoices = computed((): TtsVoiceOption[] => {
  return voices.value.filter((v) => v.gender === '女' && !v.id.includes('-TW-') && !v.id.includes('-HK-') && !v.id.includes('liaoning'))
})

const maleVoices = computed((): TtsVoiceOption[] => {
  return voices.value.filter((v) => v.gender === '男')
})

const dialectVoices = computed((): TtsVoiceOption[] => {
  return voices.value.filter((v) => v.id.includes('-TW-') || v.id.includes('-HK-') || v.id.includes('liaoning'))
})

const canStart = computed((): boolean => {
  return files.value.some((f) => f.status === 'pending') && selectedVoice.value !== '' && !progressStore.isProcessing
})

// ---- File select wrapper ----
async function selectTextFilesWrapper(): Promise<string[]> {
  return window.electronAPI.selectTextFiles()
}

// ---- File helpers ----
async function addFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    if (files.value.some((f) => f.path === p)) {
      continue
    }
    const info = await window.electronAPI.getFileInfo(p)
    const audio = isAudioFile(p)
    files.value.push({
      path: p,
      fileName: info.name,
      size: info.size,
      status: audio ? 'done' : 'pending',
      outputPath: audio ? p : undefined
    })
  }
}

async function selectDir(): Promise<void> {
  const dir = await window.electronAPI.selectDirectory()
  if (!dir) {
    return
  }
  const scannedFiles = await window.electronAPI.scanTextFiles(dir)
  if (scannedFiles.length === 0) {
    errorMsg.value = '未找到文本文件（.txt, .md）'
    return
  }
  await addFiles(scannedFiles)
}

function removeFile(index: number): void {
  const removed = files.value[index]
  if (removed && playingOutputPath.value === removed.outputPath) {
    stopOutput()
  }
  files.value.splice(index, 1)
}

function clearFiles(): void {
  stopOutput()
  files.value = []
}

// ---- Output directory ----
async function selectOutputDir(): Promise<void> {
  const dir = await window.electronAPI.selectDirectory()
  if (dir) {
    outputDir.value = dir
  }
}

// ---- Output audio playback ----
function playOutput(file: TtsFileEntry): void {
  if (!file.outputPath || !outputAudio.value) {
    return
  }
  if (playingOutputPath.value === file.outputPath) {
    stopOutput()
    return
  }
  stopPreview()
  playingOutputPath.value = file.outputPath
  outputAudio.value.src = toFileUrl(file.outputPath)
  outputAudio.value.play()
}

function stopOutput(): void {
  if (outputAudio.value) {
    outputAudio.value.pause()
    outputAudio.value.currentTime = 0
  }
  playingOutputPath.value = ''
}

// ---- Voice preview ----
async function previewCurrentVoice(): Promise<void> {
  if (!selectedVoice.value) {
    return
  }
  stopOutput()
  if (isPreviewing.value) {
    stopPreview()
    return
  }

  isPreviewing.value = true
  errorMsg.value = ''
  try {
    const path = await window.electronAPI.ttsPreview({
      text: '你好，这是一个声音测试。欢迎来到文本转语音的世界。',
      voice: selectedVoice.value,
      rate: rate.value
    })
    previewAudioPath.value = path
    if (previewAudio.value) {
      previewAudio.value.src = toFileUrl(path)
      previewAudio.value.play()
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '试听失败，请检查网络连接'
  } finally {
    isPreviewing.value = false
  }
}

function stopPreview(): void {
  if (previewAudio.value) {
    previewAudio.value.pause()
    previewAudio.value.currentTime = 0
  }
  isPreviewing.value = false
}

async function cleanupPreview(): Promise<void> {
  stopPreview()
  if (previewAudioPath.value) {
    await window.electronAPI.deleteFile(previewAudioPath.value)
    previewAudioPath.value = ''
  }
}

// ---- Batch conversion ----
async function startConvert(): Promise<void> {
  errorMsg.value = ''

  if (!outputDir.value) {
    await selectOutputDir()
    if (!outputDir.value) {
      errorMsg.value = '请选择输出目录'
      return
    }
  }

  progressStore.start('tts')

  try {
    const pendingFiles = files.value.filter((f) => f.status === 'pending')
    const batchFiles = pendingFiles.map((f) => {
      const baseName = getFileName(f.path).replace(/\.(txt|md|markdown)$/i, '')
      const output = `${outputDir.value}/${baseName}.mp3`
      f.outputPath = output
      return { input: f.path, output }
    })

    const result = await window.electronAPI.ttsBatchConvert({
      files: batchFiles,
      voice: selectedVoice.value,
      rate: rate.value
    })

    const failedSet = new Set(result.failed)
    pendingFiles.forEach((f) => {
      f.status = failedSet.has(f.path) ? 'error' : 'done'
    })

    if (result.failed.length === 0) {
      progressStore.finish()
    } else {
      errorMsg.value = `${result.failed.length} 个文件转换失败`
      progressStore.reset()
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    progressStore.reset()
  }
}

// ---- Lifecycle ----
onMounted(async () => {
  window.electronAPI.onProgress((info) => {
    progressStore.update(info)
  })

  // Load voices
  try {
    voices.value = await window.electronAPI.ttsGetVoices()
    if (voices.value.length > 0) {
      selectedVoice.value = voices.value[0].id
    }
  } catch (_e) {
    errorMsg.value = '加载语音列表失败'
  }
})

onUnmounted(() => {
  window.electronAPI?.removeProgressListener()
  stopOutput()
  cleanupPreview()
})
</script>

<template>
  <div class="page-container">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center">
          <AudioLines :size="20" class="text-accent-purple" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">文字转语音</h1>
      </div>
      <p class="text-text-secondary text-sm">使用 Microsoft Edge TTS 将文本转换为自然语音 MP3</p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Left: File Area -->
      <div class="space-y-3">
        <FileDropZone
          @files-selected="addFiles"
          :accepted-extensions="['.txt', '.md', '.markdown', '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma']"
          :custom-select-func="selectTextFilesWrapper"
        />

        <!-- Directory Scan Button -->
        <button
          @click="selectDir"
          class="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-bg-tertiary text-text-secondary text-sm hover:border-accent-purple/50 transition-colors"
        >
          <FolderOpen :size="16" />
          扫描文本文件夹
        </button>

        <!-- File List -->
        <div v-if="files.length > 0" class="glass-card space-y-2 max-h-72 overflow-y-auto">
          <div class="flex items-center justify-between px-2 pb-1">
            <span class="text-xs text-text-muted">已添加 {{ files.length }} 个文件</span>
            <button @click="clearFiles" class="text-xs text-danger hover:underline">清空</button>
          </div>
          <div
            v-for="(file, idx) in files"
            :key="file.path"
            class="flex items-center gap-2 p-2 rounded-lg bg-bg-tertiary/50 transition-colors"
            :class="{ 'ring-1 ring-accent-purple/40': playingOutputPath === file.outputPath }"
          >
            <Music v-if="file.outputPath === file.path" :size="16" class="text-accent-blue flex-shrink-0" />
            <FileText v-else :size="16" class="text-accent-purple flex-shrink-0" />
            <span class="text-sm text-text-primary truncate flex-1">{{ file.fileName }}</span>
            <span class="text-xs text-text-muted">{{ formatSize(file.size) }}</span>
            <button
              v-if="file.status === 'done'"
              @click="playOutput(file)"
              class="p-1 rounded hover:bg-accent-purple/10"
              :title="playingOutputPath === file.outputPath ? '停止播放' : '播放'"
            >
              <Square v-if="playingOutputPath === file.outputPath" :size="14" class="text-danger" />
              <Play v-else :size="14" class="text-accent-purple" />
            </button>
            <button @click="removeFile(idx)" class="p-1 rounded hover:bg-danger/10">
              <X :size="14" class="text-danger" />
            </button>
          </div>
        </div>
      </div>

      <!-- Right: Settings -->
      <div class="space-y-3">
        <!-- Voice Selection -->
        <div class="glass-card">
          <h3 class="section-title">语音选择</h3>
          <select
            v-model="selectedVoice"
            class="w-full p-2.5 rounded-lg bg-bg-tertiary border border-bg-tertiary text-text-primary text-sm focus:border-accent-purple/50 focus:outline-none"
          >
            <optgroup label="女声">
              <option v-for="voice in femaleVoices" :key="voice.id" :value="voice.id">
                {{ voice.label }}
              </option>
            </optgroup>
            <optgroup label="男声">
              <option v-for="voice in maleVoices" :key="voice.id" :value="voice.id">
                {{ voice.label }}
              </option>
            </optgroup>
            <optgroup label="方言/地区">
              <option v-for="voice in dialectVoices" :key="voice.id" :value="voice.id">
                {{ voice.label }}
              </option>
            </optgroup>
          </select>
          <p v-if="selectedVoiceInfo" class="mt-2 text-xs text-text-secondary">
            {{ selectedVoiceInfo.style }}
          </p>

          <!-- Rate Slider -->
          <div class="mt-4">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm text-text-secondary">语速调节</span>
              <span class="text-sm font-mono text-accent-purple">{{ rate > 0 ? '+' : '' }}{{ rate }}%</span>
            </div>
            <input
              v-model.number="rate"
              type="range"
              min="-50"
              max="50"
              step="5"
              class="w-full h-2 rounded-lg appearance-none cursor-pointer bg-bg-tertiary accent-violet-500"
            />
            <div class="flex justify-between text-xs text-text-muted mt-1">
              <span>-50%</span>
              <span>0</span>
              <span>+50%</span>
            </div>
          </div>

          <!-- Preview Button -->
          <button
            @click="previewCurrentVoice"
            :disabled="!selectedVoice"
            class="mt-4 w-full flex items-center justify-center gap-2 p-2.5 rounded-lg text-sm font-medium transition-colors"
            :class="isPreviewing
              ? 'bg-danger/10 border border-danger/30 text-danger'
              : 'bg-accent-purple/10 border border-accent-purple/20 text-accent-purple hover:bg-accent-purple/20'"
          >
            <Square v-if="isPreviewing" :size="16" />
            <Volume2 v-else :size="16" />
            {{ isPreviewing ? '停止试听' : '试听当前声音' }}
          </button>
          <audio ref="previewAudio" class="hidden" @ended="isPreviewing = false" />
          <audio ref="outputAudio" class="hidden" @ended="playingOutputPath = ''" @error="playingOutputPath = ''" />
        </div>

        <!-- Output Settings -->
        <div class="glass-card">
          <h3 class="section-title">输出设置</h3>
          <button @click="selectOutputDir" class="btn-secondary">
            <Folder :size="16" />
            {{ outputDir ? '更改输出目录' : '选择输出目录' }}
          </button>
          <p v-if="outputDir" class="mt-2 text-xs text-text-secondary truncate">
            {{ outputDir }}
          </p>
          <p class="mt-2 text-xs text-text-muted">
            输出文件格式：原文件名.mp3
          </p>
        </div>

        <!-- Info Card -->
        <div class="glass-card border border-accent-purple/20 bg-accent-purple/5">
          <div class="flex items-start gap-2">
            <AudioLines :size="16" class="text-accent-purple mt-0.5 flex-shrink-0" />
            <div class="text-xs text-text-secondary leading-relaxed">
              <p class="font-medium text-text-primary mb-1">使用说明</p>
              <p>需要网络连接。支持 .txt 和 .md 文件，Markdown 文件会自动清洗格式标记。</p>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="alert-danger">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- Start Button -->
        <button
          @click="startConvert"
          :disabled="!canStart"
          class="btn-primary"
          :class="canStart
            ? 'bg-gradient-to-r from-indigo-500 to-violet-500'
            : 'bg-bg-tertiary text-text-muted'"
        >
          <AudioLines :size="18" />
          {{ progressStore.isProcessing ? '转换中...' : '开始转换' }}
        </button>

        <ProgressPanel />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
// TTS 页面使用全局样式即可
</style>
