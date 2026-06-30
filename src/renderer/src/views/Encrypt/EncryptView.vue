<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { Shield, Lock, Unlock, Folder, Play, Pause, X, FileVideo, FolderOpen, Key, Copy, Check } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'
import { formatSize, getFileName } from '@/utils/format'
import { secondsToHMS } from '@/utils/time'
import type { VideoMeta } from '@/types/file'
import { DEFAULT_ENCRYPT_KEY, KEY_MASK_PREFIX_LENGTH } from '@/config/crypto'
import type { CryptoEntry } from './types'

const progressStore = useProgressStore()

// Mode
const mode = ref<'encrypt' | 'decrypt'>('encrypt')

// Files
const files = ref<CryptoEntry[]>([])
const errorMsg = ref('')

// ---- Video Player ----
const videoPlayer = ref<HTMLVideoElement | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const videoMeta = ref<VideoMeta | null>(null)
const previewTempPath = ref('')
const previewPreparing = ref(false)

const videoSrc = computed((): string => {
  if (files.value.length === 0) { return '' }
  if (mode.value === 'encrypt') {
    return `file:///${files.value[0].path.replace(/\\/g, '/')}`
  }
  // decrypt mode: use temp decrypted file
  if (previewTempPath.value) {
    return `file:///${previewTempPath.value.replace(/\\/g, '/')}`
  }
  return ''
})

const canPlayVideo = computed((): boolean => {
  return files.value.length > 0
})

// ---- Key management ----
const keyCopied = ref(false)

async function copyKeyToClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText(DEFAULT_ENCRYPT_KEY)
    keyCopied.value = true
    setTimeout(() => { keyCopied.value = false }, 2000)
  } catch (_e) {
    // clipboard not available
  }
}

const maskedKey = computed((): string => {
  if (DEFAULT_ENCRYPT_KEY.length <= KEY_MASK_PREFIX_LENGTH) { return DEFAULT_ENCRYPT_KEY }
  return DEFAULT_ENCRYPT_KEY.slice(0, KEY_MASK_PREFIX_LENGTH) + '*'.repeat(12)
})


// ---- File helpers ----

async function addFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    if (files.value.some((f) => f.path === p)) { continue }
    const output = await window.electronAPI.generateCryptoOutputPath(p, mode.value === 'encrypt')
    files.value.push({
      path: p,
      outputPath: output
    })
  }
}

async function selectDir(): Promise<void> {
  const dir = await window.electronAPI.selectDirectory()
  if (!dir) { return }

  const scannedFiles = await window.electronAPI.scanVideoFiles(dir)
  if (scannedFiles.length === 0) {
    errorMsg.value = '未找到视频文件'
    return
  }

  await addFiles(scannedFiles)
}

function removeFile(index: number): void {
  files.value.splice(index, 1)
  if (index === 0) {
    resetPlayer()
  }
}

// ---- Video playback helpers ----

async function cleanupPreviewTemp(): Promise<void> {
  if (previewTempPath.value) {
    await window.electronAPI.deleteFile(previewTempPath.value)
    previewTempPath.value = ''
  }
}

async function resetPlayer(): Promise<void> {
  if (videoPlayer.value) {
    videoPlayer.value.pause()
  }
  isPlaying.value = false
  currentTime.value = 0
  duration.value = 0
  videoMeta.value = null
  await cleanupPreviewTemp()
}

async function prepareDecryptPreview(): Promise<void> {
  if (mode.value !== 'decrypt') { return }
  const firstFile = files.value[0]
  if (!firstFile) { return }

  // Clean up old temp first
  await cleanupPreviewTemp()

  previewPreparing.value = true
  try {
    const tempDir = await window.electronAPI.getTempDir()
    const tempName = `sn_preview_${Date.now()}.mp4`
    const tempPath = `${tempDir}/${tempName}`

    const success = await window.electronAPI.decryptFile({
      input: firstFile.path,
      output: tempPath,
      password: DEFAULT_ENCRYPT_KEY
    })

    if (!success) {
      errorMsg.value = '预览解密失败，请检查密码是否正确'
      previewPreparing.value = false
      return
    }

    // Verify it's still the current file (not switched during async)
    if (files.value[0]?.path !== firstFile.path) {
      await window.electronAPI.deleteFile(tempPath)
      previewPreparing.value = false
      return
    }

    previewTempPath.value = tempPath
    await nextTick()
    if (videoPlayer.value) {
      videoPlayer.value.load()
      videoPlayer.value.currentTime = 0
    }

    // Load meta from decrypted temp
    try {
      const meta = await window.electronAPI.getVideoMeta(tempPath)
      if (files.value[0]?.path === firstFile.path) {
        videoMeta.value = meta as VideoMeta
        duration.value = (meta as VideoMeta).duration
      }
    } catch (_e) {
      // ignore
    }
  } catch (_e) {
    // ignore
  } finally {
    previewPreparing.value = false
  }
}

async function loadVideoMeta(filePath: string): Promise<void> {
  try {
    const meta = await window.electronAPI.getVideoMeta(filePath)
    if (files.value.length === 0 || files.value[0]?.path !== filePath) { return }
    videoMeta.value = meta as VideoMeta
    duration.value = (meta as VideoMeta).duration
    await nextTick()
    if (videoPlayer.value) {
      videoPlayer.value.load()
      videoPlayer.value.currentTime = 0
    }
  } catch (_e) {
    // ignore meta load errors
  }
}

async function togglePlay(): Promise<void> {
  const vp = videoPlayer.value
  if (!vp) { return }
  if (vp.paused) {
    try { await vp.play() } catch (_e) { /* ignore */ }
  } else {
    vp.pause()
  }
}

function onVideoPlay(): void { isPlaying.value = true }
function onVideoPause(): void { isPlaying.value = false }
function onVideoEnded(): void { isPlaying.value = false }

function onTimeUpdate(): void {
  if (!videoPlayer.value) { return }
  currentTime.value = videoPlayer.value.currentTime
}

function onVideoLoaded(): void {
  if (videoPlayer.value) {
    videoPlayer.value.currentTime = 0
    currentTime.value = 0
  }
}

function onVideoError(e: Event): void {
  const video = e.target as HTMLVideoElement
  console.error('视频加载失败:', video?.error?.message)
}

// Auto-load meta / prepare preview when first file changes
watch(() => files.value[0]?.path, (newPath) => {
  if (!newPath) {
    resetPlayer()
    return
  }
  if (mode.value === 'encrypt') {
    loadVideoMeta(newPath)
  } else if (mode.value === 'decrypt') {
    prepareDecryptPreview()
  }
})

// Reset player when switching mode
watch(mode, () => {
  resetPlayer()
})

async function selectOutputDirForAll(): Promise<void> {
  const dir = await window.electronAPI.selectDirectory()
  if (!dir) { return }
  for (const entry of files.value) {
    const name = getFileName(entry.path)
    const ext = mode.value === 'encrypt' ? `${name}.enc` : name.replace('.enc', '')
    entry.outputPath = `${dir}/${ext}`
  }
}

const canStart = computed((): boolean => {
  if (files.value.length === 0) { return false }
  return true
})

async function startProcess(): Promise<void> {
  errorMsg.value = ''

  // Ensure output paths
  for (const entry of files.value) {
    if (!entry.outputPath) {
      await selectOutputDirForAll()
      break
    }
  }

  const unresolved = files.value.filter((f) => !f.outputPath)
  if (unresolved.length > 0) {
    errorMsg.value = '请为所有文件选择输出目录'
    return
  }

  progressStore.start(mode.value === 'encrypt' ? 'encrypt' : 'decrypt')
  window.electronAPI.onProgress((info) => {
    progressStore.update(info)
  })

  try {
    const batchFiles = files.value.map((f) => ({ input: f.path, output: f.outputPath }))
    let result: { success: number; failed: string[] }
    if (mode.value === 'encrypt') {
      result = await window.electronAPI.batchEncrypt({ files: batchFiles, password: DEFAULT_ENCRYPT_KEY })
    } else {
      result = await window.electronAPI.batchDecrypt({ files: batchFiles, password: DEFAULT_ENCRYPT_KEY })
    }

    if (result.failed.length === 0) {
      progressStore.finish()
    } else {
      errorMsg.value = `${result.failed.length} 个文件处理失败`
      progressStore.reset()
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    progressStore.reset()
  }
}

function switchMode(newMode: 'encrypt' | 'decrypt'): void {
  mode.value = newMode
  files.value = []
  errorMsg.value = ''
}

onUnmounted(() => {
  window.electronAPI?.removeProgressListener()
  cleanupPreviewTemp()
})
</script>

<template>
  <div class="page-container">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
          <Shield :size="20" class="text-success" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频加密与解密</h1>
      </div>
      <p class="text-text-secondary text-sm">AES-256-CTR 加密，流式处理大文件无压力</p>
    </header>

    <!-- Mode Tabs -->
    <div class="flex gap-1 mb-6 p-1 rounded-lg bg-bg-tertiary w-fit">
      <button
        @click="switchMode('encrypt')"
        class="px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-2"
        :class="mode === 'encrypt' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary'"
      >
        <Lock :size="14" />
        加密
      </button>
      <button
        @click="switchMode('decrypt')"
        class="px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-2"
        :class="mode === 'decrypt' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary'"
      >
        <Unlock :size="14" />
        解密
      </button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Left: File Area -->
      <div class="space-y-3">
        <FileDropZone @files-selected="addFiles" :accepted-extensions="['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.enc']" />

        <!-- Directory Scan Button -->
        <button
          @click="selectDir"
          class="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-bg-tertiary text-text-secondary text-sm"
        >
          <FolderOpen :size="16" />
          {{ mode === 'encrypt' ? '扫描视频文件夹' : '扫描加密文件夹' }}
        </button>

        <!-- Video Preview -->
        <div v-if="canPlayVideo" class="video-player-container glass-card">
          <!-- Preparing decrypt preview -->
          <div v-if="previewPreparing" class="flex items-center justify-center h-36 bg-black/50 rounded-t-xl">
            <div class="text-center">
              <div class="w-6 h-6 mx-auto mb-2 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
              <p class="text-sm text-text-secondary">正在准备预览...</p>
            </div>
          </div>
          <!-- Video element -->
          <video
            v-else-if="videoSrc"
            ref="videoPlayer"
            :src="videoSrc"
            class="w-full rounded-t-xl max-h-[280px] bg-black"
            preload="auto"
            @timeupdate="onTimeUpdate"
            @play="onVideoPlay"
            @pause="onVideoPause"
            @ended="onVideoEnded"
            @error="onVideoError"
            @loadedmetadata="onVideoLoaded"
          />
          <div v-else class="flex items-center justify-center h-36 bg-black/50 rounded-t-xl">
            <FileVideo :size="32" class="text-text-muted opacity-30" />
          </div>

          <!-- Player Controls -->
          <div class="flex items-center justify-between px-3 py-2 bg-bg-secondary/80">
            <div class="flex items-center gap-2">
              <button
                @click="togglePlay"
                class="p-1.5 rounded-full bg-accent-blue"
              >
                <Pause v-if="isPlaying" :size="14" class="text-white" />
                <Play v-else :size="14" class="text-white ml-0.5" />
              </button>
              <span class="text-xs font-mono text-text-secondary">
                {{ secondsToHMS(currentTime) }} / {{ secondsToHMS(duration) }}
              </span>
            </div>
            <div class="flex items-center gap-3 text-xs text-text-muted">
              <span v-if="videoMeta">{{ videoMeta.width }}×{{ videoMeta.height }}</span>
              <span v-if="videoMeta">{{ formatSize(videoMeta.size) }}</span>
              <span class="text-accent-blue font-mono truncate max-w-[140px]">
                {{ getFileName(files[0]?.path || '') }}
              </span>
            </div>
          </div>
        </div>

        <!-- File List -->
        <div v-if="files.length > 0" class="glass-card space-y-2 max-h-72 overflow-y-auto">
          <div
            v-for="(file, idx) in files"
            :key="file.path"
            class="flex items-center gap-2 p-2 rounded-lg bg-bg-tertiary/50 transition-colors group"
          >
            <FileVideo :size="16" class="text-accent-blue flex-shrink-0" />
            <span class="text-sm text-text-primary truncate flex-1">{{ getFileName(file.path) }}</span>
            <button
              @click="removeFile(idx)"
              class="p-1 rounded"
            >
              <X :size="14" class="text-danger" />
            </button>
          </div>
        </div>
      </div>

      <!-- Right: Parameters -->
      <div class="space-y-3">
        <!-- Key Info -->
        <div class="glass-card">
          <h3 class="section-title">加密密钥</h3>

          <div class="space-y-3">
            <!-- Key display -->
            <div class="flex items-center gap-2 p-3 rounded-lg bg-bg-tertiary/50 border border-bg-tertiary">
              <Key :size="16" class="text-accent-blue flex-shrink-0" />
              <code class="text-sm text-text-primary flex-1 font-mono truncate">
                {{ maskedKey }}
              </code>
            </div>

            <p class="text-xs text-text-muted">
              加密和解密均使用内置默认密钥，无需手动输入。
              如需在第三方程序中解密文件，请点击下方按钮获取完整密钥。
            </p>

            <!-- Copy button -->
            <button
              @click="copyKeyToClipboard"
              class="w-full flex items-center justify-center gap-2 p-2.5 rounded-lg text-sm font-medium transition-colors"
              :class="keyCopied
                ? 'bg-success/10 border border-success/30 text-success'
                : 'bg-accent-blue/10 border border-accent-blue/20 text-accent-blue hover:bg-accent-blue/20'"
            >
              <Check v-if="keyCopied" :size="16" />
              <Copy v-else :size="16" />
              {{ keyCopied ? '已复制到剪贴板' : '获取密钥' }}
            </button>
          </div>
        </div>

        <!-- Output -->
        <div class="glass-card">
          <h3 class="section-title">输出设置</h3>
          <button
            @click="selectOutputDirForAll"
            class="btn-secondary"
          >
            <Folder :size="16" />
            选择输出目录
          </button>
        </div>

        <!-- Info Card -->
        <div class="glass-card border border-accent-blue/20 bg-accent-blue/5">
          <div class="flex items-start gap-2">
            <Shield :size="16" class="text-accent-blue mt-0.5 flex-shrink-0" />
            <div class="text-xs text-text-secondary leading-relaxed">
              <p class="font-medium text-text-primary mb-1">加密说明</p>
              <p v-if="mode === 'encrypt'">
                使用 AES-256-CTR 算法加密视频文件。加密后的文件将以 <code class="text-accent-blue">.enc</code> 扩展名保存。
                使用内置默认密钥，可通过上方"获取密钥"按钮导出给第三方程序使用。
              </p>
              <p v-else>
                解密使用 AES-256-CTR 加密的视频文件，自动使用内置默认密钥。
                如需在其他设备解密，请通过加密页面的"获取密钥"按钮复制密钥。
              </p>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="alert-danger">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- Start -->
        <button
          @click="startProcess"
          :disabled="!canStart || progressStore.isProcessing"
          class="btn-primary"
          :class="canStart && !progressStore.isProcessing
            ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
            : 'bg-bg-tertiary text-text-muted'"
        >
          <Lock v-if="mode === 'encrypt'" :size="18" />
          <Unlock v-else :size="18" />
          {{ progressStore.isProcessing ? '处理中...' : mode === 'encrypt' ? '开始加密' : '开始解密' }}
        </button>

        <ProgressPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
@use "../../assets/styles/encrypt";
</style>
