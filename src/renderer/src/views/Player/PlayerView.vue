<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import {
  Play, Pause, Lock, LockKeyholeOpen, FolderOpen, X, FileVideo, Volume2, VolumeX,
  SkipBack, SkipForward
} from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import { formatSize, getFileName } from '@/utils/format'
import { secondsToHMS } from '@/utils/time'
import type { VideoMeta } from '@/types/file'
import { DEFAULT_ENCRYPT_KEY } from '@/config/crypto'

// ---- Types ----
interface PlayerEntry {
  path: string
  isEncrypted: boolean
  meta: VideoMeta | null
  tempPath: string | null
}

// ---- State ----
const files = ref<PlayerEntry[]>([])
const currentIndex = ref(-1)
const videoPlayer = ref<HTMLVideoElement | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const isMuted = ref(false)

// Password modal for encrypted files
const showPasswordModal = ref(false)
const passwordInput = ref('')
const passwordError = ref('')
const decryptingFile = ref<PlayerEntry | null>(null)

// Auto-decrypt toggle (default: ON — use built-in key)
const autoDecrypt = ref(true)

// Track temp paths for cleanup
const tempPaths = ref<Map<string, string>>(new Map())

// Error display
const errorMsg = ref('')

// ---- Computed ----
const currentFile = computed((): PlayerEntry | null => {
  if (currentIndex.value < 0 || currentIndex.value >= files.value.length) {
    return null
  }
  return files.value[currentIndex.value]
})

const videoSrc = computed((): string => {
  if (!currentFile.value) { return '' }
  if (currentFile.value.isEncrypted && currentFile.value.tempPath) {
    return `file:///${currentFile.value.tempPath.replace(/\\/g, '/')}`
  }
  if (!currentFile.value.isEncrypted) {
    return `file:///${currentFile.value.path.replace(/\\/g, '/')}`
  }
  return ''
})

const currentFileName = computed((): string => {
  return currentFile.value ? getFileName(currentFile.value.path) : ''
})

const currentFileSize = computed((): string => {
  if (!currentFile.value?.meta) { return '' }
  return formatSize(currentFile.value.meta.size)
})

const currentResolution = computed((): string => {
  const meta = currentFile.value?.meta
  if (!meta || !meta.width || !meta.height) { return '' }
  return `${meta.width}×${meta.height}`
})

const hasPrev = computed((): boolean => {
  return currentIndex.value > 0
})

const hasNext = computed((): boolean => {
  return currentIndex.value < files.value.length - 1
})

// ---- File Management ----
async function addFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    if (files.value.some((f) => f.path === p)) { continue }
    const ext = p.split('.').pop()?.toLowerCase()
    files.value.push({
      path: p,
      isEncrypted: ext === 'enc',
      meta: null,
      tempPath: null
    })
  }
}

async function addFilesAndLoadMeta(paths: string[]): Promise<void> {
  await addFiles(paths)
  loadAllMeta()
}

function removeFile(index: number): void {
  const wasCurrent = index === currentIndex.value
  files.value.splice(index, 1)
  if (wasCurrent) {
    stopPlayback()
    if (files.value.length > 0) {
      const newIdx = Math.min(index, files.value.length - 1)
      playFile(newIdx)
    } else {
      currentIndex.value = -1
    }
  } else if (index < currentIndex.value) {
    currentIndex.value--
  }
}

async function selectDir(): Promise<void> {
  const dir = await window.electronAPI.selectDirectory()
  if (!dir) { return }

  const scanned = await window.electronAPI.scanPlayerFiles(dir)
  if (scanned.length === 0) {
    errorMsg.value = '未找到视频文件或加密文件'
    return
  }
  await addFilesAndLoadMeta(scanned)
}

// ---- Meta loading ----
async function loadMeta(entry: PlayerEntry): Promise<void> {
  try {
    // For encrypted files without temp, skip meta
    if (entry.isEncrypted && !entry.tempPath) { return }
    const path = entry.isEncrypted && entry.tempPath ? entry.tempPath : entry.path
    const meta = await window.electronAPI.getVideoMeta(path)
    entry.meta = meta as VideoMeta
  } catch (_e) {
    // ignore meta load errors
  }
}

async function loadAllMeta(): Promise<void> {
  for (const entry of files.value) {
    if (!entry.isEncrypted) {
      loadMeta(entry)
    }
  }
}

// ---- Playback ----
async function playFile(index: number): Promise<void> {
  errorMsg.value = ''
  currentIndex.value = index
  const file = files.value[index]
  if (!file) { return }

  if (file.isEncrypted) {
    if (file.tempPath) {
      // Already decrypted, just play
      await nextTick()
      startPlayback()
    } else if (autoDecrypt.value) {
      // Auto-decrypt with built-in key
      await decryptWithDefaultKey(file)
    } else {
      // Manual password
      decryptingFile.value = file
      passwordInput.value = ''
      passwordError.value = ''
      showPasswordModal.value = true
    }
  } else {
    // Normal video
    if (!file.meta) {
      await loadMeta(file)
    }
    await nextTick()
    startPlayback()
  }
}

async function startPlayback(): Promise<void> {
  await nextTick()
  if (videoPlayer.value) {
    videoPlayer.value.load()
    videoPlayer.value.currentTime = 0
    try { await videoPlayer.value.play() } catch (_e) { /* ignore */ }
  }
}

async function stopPlayback(): Promise<void> {
  if (videoPlayer.value) {
    videoPlayer.value.pause()
  }
  isPlaying.value = false
  currentTime.value = 0
  duration.value = 0
}

function prevFile(): void {
  if (hasPrev.value) {
    playFile(currentIndex.value - 1)
  }
}

function nextFile(): void {
  if (hasNext.value) {
    playFile(currentIndex.value + 1)
  }
}

// ---- Encryption Decrypt for Playback ----

/** Auto-decrypt using the built-in default key */
async function decryptWithDefaultKey(file: PlayerEntry): Promise<void> {
  try {
    const tempDir = await window.electronAPI.getTempDir()
    const tempPath = await window.electronAPI.decryptForPlayback(
      file.path,
      DEFAULT_ENCRYPT_KEY,
      tempDir
    )

    // Verify still the current file
    if (files.value[currentIndex.value]?.path !== file.path) {
      await cleanupTemp(tempPath)
      return
    }

    file.tempPath = tempPath
    tempPaths.value.set(file.path, tempPath)

    await loadMeta(file)
    await nextTick()
    startPlayback()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '自动解密失败'
  }
}

async function confirmDecrypt(): Promise<void> {
  if (!decryptingFile.value) { return }
  if (passwordInput.value.length < 4) {
    passwordError.value = '密码至少需要4个字符'
    return
  }

  passwordError.value = ''
  const file = decryptingFile.value

  try {
    // Clean up old temp for this file if exists
    if (file.tempPath) {
      await cleanupTemp(file.tempPath)
      file.tempPath = null
    }

    const tempDir = await window.electronAPI.getTempDir()
    const tempPath = await window.electronAPI.decryptForPlayback(
      file.path,
      passwordInput.value,
      tempDir
    )

    // Verify still the current file
    if (files.value[currentIndex.value]?.path !== file.path) {
      await cleanupTemp(tempPath)
      return
    }

    file.tempPath = tempPath
    tempPaths.value.set(file.path, tempPath)

    // Load meta from temp
    await loadMeta(file)

    showPasswordModal.value = false
    passwordInput.value = ''
    decryptingFile.value = null

    await nextTick()
    startPlayback()
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : '解密失败，请检查密码是否正确'
  }
}

function cancelDecrypt(): void {
  showPasswordModal.value = false
  passwordInput.value = ''
  passwordError.value = ''
  decryptingFile.value = null
}

// ---- Temp Cleanup ----
async function cleanupTemp(tempPath: string): Promise<void> {
  try {
    await window.electronAPI.deleteFile(tempPath)
  } catch {
    // ignore cleanup errors
  }
}

async function cleanupAllTemps(): Promise<void> {
  for (const tempPath of tempPaths.value.values()) {
    await cleanupTemp(tempPath)
  }
  tempPaths.value.clear()
  for (const entry of files.value) {
    entry.tempPath = null
  }
}

// ---- Video Events ----
function onTimeUpdate(): void {
  if (videoPlayer.value) {
    currentTime.value = videoPlayer.value.currentTime
  }
}

function onVideoPlay(): void { isPlaying.value = true }
function onVideoPause(): void { isPlaying.value = false }
function onVideoEnded(): void {
  isPlaying.value = false
  // Auto-play next
  if (hasNext.value) {
    playFile(currentIndex.value + 1)
  }
}

function onVideoLoaded(): void {
  if (videoPlayer.value && currentFile.value?.meta) {
    duration.value = currentFile.value.meta.duration
  } else if (videoPlayer.value) {
    duration.value = videoPlayer.value.duration || 0
  }
  if (videoPlayer.value) {
    videoPlayer.value.currentTime = 0
    currentTime.value = 0
  }
}

function onVideoError(e: Event): void {
  const video = e.target as HTMLVideoElement
  console.error('视频加载失败:', video?.error?.message)
  errorMsg.value = '视频加载失败'
}

// ---- Player Controls ----
async function togglePlay(): Promise<void> {
  const vp = videoPlayer.value
  if (!vp) { return }
  if (vp.paused) {
    try { await vp.play() } catch (_e) { /* ignore */ }
  } else {
    vp.pause()
  }
}

function toggleMute(): void {
  if (videoPlayer.value) {
    videoPlayer.value.muted = !videoPlayer.value.muted
    isMuted.value = videoPlayer.value.muted
  }
}

function onSeek(event: Event): void {
  const input = event.target as HTMLInputElement
  const seekTime = parseFloat(input.value)
  if (videoPlayer.value && !isNaN(seekTime)) {
    videoPlayer.value.currentTime = seekTime
    currentTime.value = seekTime
  }
}

// Progress percentage
const progressPercent = computed((): number => {
  if (duration.value <= 0) { return 0 }
  return Math.min((currentTime.value / duration.value) * 100, 100)
})

// ---- Lifecycle ----
onUnmounted(() => {
  cleanupAllTemps()
})
</script>

<template>
  <div class="page-container">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center">
          <Play :size="20" class="text-accent-blue" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频播放器</h1>

        <!-- Auto-decrypt toggle -->
        <button
          @click="autoDecrypt = !autoDecrypt"
          class="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border"
          :class="autoDecrypt
            ? 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue hover:bg-accent-blue/20'
            : 'bg-bg-tertiary/60 border-bg-tertiary text-text-muted hover:bg-bg-tertiary'"
          :title="autoDecrypt ? '加密视频自动使用内置密钥解密' : '加密视频需手动输入密码'"
        >
          <LockKeyholeOpen v-if="autoDecrypt" :size="15" />
          <Lock v-else :size="15" />
          <span>{{ autoDecrypt ? '自动解密' : '手动解密' }}</span>
        </button>
      </div>
      <p class="text-text-secondary text-sm">
        <template v-if="autoDecrypt">
          加密视频（.enc）将自动使用内置密钥解密播放，无需手动输入密码。关闭开关可切换为手动密码模式。
        </template>
        <template v-else>
          支持播放普通视频和加密视频（.enc），加密视频需手动输入密码。开启自动解密可免除输入。
        </template>
      </p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- Left: File List -->
      <div class="lg:col-span-1 space-y-3">
        <!-- File Import -->
        <FileDropZone
          :accepted-extensions="['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.enc']"
          :custom-select-func="async () => await window.electronAPI.selectPlayerFiles()"
          @files-selected="addFilesAndLoadMeta"
        />

        <!-- Scan Directory -->
        <button
          @click="selectDir"
          class="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-bg-tertiary text-text-secondary text-sm hover:border-accent-blue/30 transition-colors"
        >
          <FolderOpen :size="16" />
          扫描文件夹（含加密文件）
        </button>

        <!-- Error -->
        <div v-if="errorMsg" class="alert-danger">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- File List -->
        <div v-if="files.length > 0" class="glass-card max-h-[calc(100vh-320px)] overflow-y-auto">
          <div class="flex items-center justify-between mb-3 px-1">
            <h3 class="text-sm font-semibold text-text-primary">
              播放列表（{{ files.length }} 个文件）
            </h3>
            <button
              v-if="files.length > 0"
              @click="files = []; stopPlayback(); currentIndex = -1; errorMsg = ''"
              class="text-xs text-text-muted hover:text-danger transition-colors"
            >
              清空列表
            </button>
          </div>

          <div class="space-y-1">
            <button
              v-for="(file, idx) in files"
              :key="file.path"
              @click="playFile(idx)"
              class="w-full flex items-center gap-2.5 p-2.5 rounded-lg transition-colors text-left group"
              :class="idx === currentIndex
                ? 'bg-accent-blue/10 border border-accent-blue/30'
                : 'bg-bg-tertiary/40 hover:bg-bg-tertiary border border-transparent'"
            >
              <!-- Index / Icon -->
              <div
                class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-mono"
                :class="idx === currentIndex
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : 'bg-bg-primary text-text-muted'"
              >
                <template v-if="idx === currentIndex && isPlaying">
                  <span class="w-1 h-3 bg-accent-blue rounded-full animate-pulse" />
                </template>
                <template v-else>
                  {{ idx + 1 }}
                </template>
              </div>

              <!-- File Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <Lock
                    v-if="file.isEncrypted"
                    :size="12"
                    class="text-warning flex-shrink-0"
                  />
                  <FileVideo
                    v-else
                    :size="12"
                    class="text-accent-blue flex-shrink-0"
                  />
                  <p
                    class="text-sm truncate"
                    :class="idx === currentIndex ? 'text-accent-blue' : 'text-text-primary'"
                  >
                    {{ getFileName(file.path) }}
                  </p>
                </div>
                <p class="text-xs text-text-muted mt-0.5">
                  <template v-if="file.isEncrypted">
                    加密视频{{ file.tempPath ? ' · 已解密' : '' }}
                  </template>
                  <template v-else-if="file.meta">
                    {{ file.meta.codec?.toUpperCase() || '未知编码' }}
                    {{ file.meta.width }}×{{ file.meta.height }}
                    · {{ formatSize(file.meta.size) }}
                  </template>
                  <template v-else>
                    加载中...
                  </template>
                </p>
              </div>

              <!-- Remove -->
              <span
                role="button"
                tabindex="0"
                @click.stop="removeFile(idx)"
                @keydown.enter.prevent="removeFile(idx)"
                @keydown.space.prevent="removeFile(idx)"
                class="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-danger/10 transition-all flex-shrink-0 cursor-pointer"
              >
                <X :size="14" class="text-danger" />
              </span>
            </button>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="glass-card flex flex-col items-center justify-center py-12 text-text-muted">
          <FileVideo :size="40" class="mb-3 opacity-30" />
          <p class="text-sm">暂无视频文件</p>
          <p class="text-xs mt-1">拖拽、选择文件或扫描文件夹添加视频</p>
        </div>
      </div>

      <!-- Right: Video Player -->
      <div class="lg:col-span-2 space-y-3">
        <!-- No file selected -->
        <div v-if="!currentFile" class="glass-card flex flex-col items-center justify-center py-24 text-text-muted">
          <Play :size="48" class="mb-4 opacity-20" />
          <p class="text-base">从左侧列表选择视频开始播放</p>
          <p class="text-sm mt-1">支持 MP4、MKV、AVI、MOV 等格式及加密视频</p>
        </div>

        <!-- Player -->
        <div v-else class="glass-card overflow-hidden">
          <!-- Video Element -->
          <div class="relative bg-black">
            <video
              v-if="videoSrc"
              ref="videoPlayer"
              :src="videoSrc"
              class="w-full"
              style="max-height: 55vh; min-height: 240px;"
              preload="auto"
              @timeupdate="onTimeUpdate"
              @play="onVideoPlay"
              @pause="onVideoPause"
              @ended="onVideoEnded"
              @error="onVideoError"
              @loadedmetadata="onVideoLoaded"
            />
            <div v-else class="flex items-center justify-center" style="min-height: 240px;">
              <div class="text-center text-text-muted">
                <Lock v-if="currentFile.isEncrypted" :size="32" class="mx-auto mb-2 opacity-40" />
                <FileVideo v-else :size="32" class="mx-auto mb-2 opacity-40" />
                <p class="text-sm">
                  {{ currentFile.isEncrypted
                    ? (autoDecrypt ? '正在自动解密...' : '加密视频需输入密码')
                    : '准备播放...' }}
                </p>
              </div>
            </div>
          </div>

          <!-- Player Controls -->
          <div class="p-3 space-y-2 bg-bg-secondary/80">
            <!-- Progress Bar -->
            <div class="flex items-center gap-3">
              <span class="text-xs font-mono text-text-secondary w-16 text-right">
                {{ secondsToHMS(currentTime) }}
              </span>
              <div class="flex-1 relative">
                <input
                  type="range"
                  :min="0"
                  :max="duration || 100"
                  :value="currentTime"
                  :step="0.1"
                  @input="onSeek"
                  class="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                  :style="{
                    background: `linear-gradient(to right, var(--accent-blue) 0%, var(--accent-blue) ${progressPercent}%, hsl(var(--border)) ${progressPercent}%, hsl(var(--border)) 100%)`,
                    outline: 'none'
                  }"
                />
              </div>
              <span class="text-xs font-mono text-text-secondary w-16">
                {{ secondsToHMS(duration) }}
              </span>
            </div>

            <!-- Controls Row -->
            <div class="flex items-center justify-between">
              <!-- Left: Playback Controls -->
              <div class="flex items-center gap-1">
                <button
                  @click="prevFile"
                  :disabled="!hasPrev"
                  class="p-1.5 rounded-lg transition-colors"
                  :class="hasPrev ? 'hover:bg-bg-tertiary text-text-secondary' : 'text-text-muted opacity-40 cursor-not-allowed'"
                >
                  <SkipBack :size="18" />
                </button>
                <button
                  @click="togglePlay"
                  class="p-2 rounded-full bg-accent-blue hover:bg-accent-blue/80 transition-colors"
                >
                  <Pause v-if="isPlaying" :size="16" class="text-white" />
                  <Play v-else :size="16" class="text-white ml-0.5" />
                </button>
                <button
                  @click="nextFile"
                  :disabled="!hasNext"
                  class="p-1.5 rounded-lg transition-colors"
                  :class="hasNext ? 'hover:bg-bg-tertiary text-text-secondary' : 'text-text-muted opacity-40 cursor-not-allowed'"
                >
                  <SkipForward :size="18" />
                </button>
                <button
                  @click="toggleMute"
                  class="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-secondary transition-colors ml-2"
                >
                  <VolumeX v-if="isMuted" :size="16" />
                  <Volume2 v-else :size="16" />
                </button>
              </div>

              <!-- Right: File Info -->
              <div class="flex items-center gap-3 text-xs text-text-muted">
                <span v-if="currentResolution" class="font-mono">{{ currentResolution }}</span>
                <span v-if="currentFileSize" class="font-mono">{{ currentFileSize }}</span>
                <span
                  class="font-mono truncate max-w-[200px]"
                  :class="currentFile.isEncrypted ? 'text-warning' : 'text-accent-blue'"
                >
                  {{ currentFileName }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Video Info Card -->
        <div v-if="currentFile?.meta" class="glass-card border border-accent-blue/10">
          <h3 class="text-sm font-semibold text-text-primary mb-3">视频信息</h3>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span class="text-text-muted">文件名</span>
              <p class="text-text-primary truncate">{{ currentFileName }}</p>
            </div>
            <div>
              <span class="text-text-muted">分辨率</span>
              <p class="text-text-primary">{{ currentResolution || '未知' }}</p>
            </div>
            <div>
              <span class="text-text-muted">时长</span>
              <p class="text-text-primary">{{ secondsToHMS(currentFile.meta.duration) }}</p>
            </div>
            <div>
              <span class="text-text-muted">文件大小</span>
              <p class="text-text-primary">{{ currentFileSize || '未知' }}</p>
            </div>
            <div>
              <span class="text-text-muted">编码格式</span>
              <p class="text-text-primary">{{ currentFile.meta.codec?.toUpperCase() || '未知' }}</p>
            </div>
            <div>
              <span class="text-text-muted">码率</span>
              <p class="text-text-primary">{{ currentFile.meta.bitrate ? (currentFile.meta.bitrate / 1000).toFixed(0) + ' kbps' : '未知' }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Password Modal -->
    <Teleport to="body">
      <div
        v-if="showPasswordModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="cancelDecrypt"
      >
        <div class="glass-card w-full max-w-sm mx-4 animate-slide-up" @click.stop>
          <h3 class="text-lg font-semibold text-text-primary mb-2 flex items-center gap-2">
            <Lock :size="18" class="text-warning" />
            输入解密密码
          </h3>
          <p class="text-sm text-text-secondary mb-4">
            播放加密视频需要输入密码进行解密。
            <br />
            <span class="text-xs text-text-muted truncate block mt-1">
              {{ decryptingFile ? getFileName(decryptingFile.path) : '' }}
            </span>
          </p>

          <input
            v-model="passwordInput"
            type="password"
            placeholder="输入解密密码（至少4位）"
            class="input-field w-full mb-2"
            @keyup.enter="confirmDecrypt"
          />

          <p v-if="passwordError" class="text-xs text-danger mb-2">{{ passwordError }}</p>

          <div class="flex justify-end gap-2 mt-4">
            <button @click="cancelDecrypt" class="btn-secondary">
              取消
            </button>
            <button
              @click="confirmDecrypt"
              :disabled="passwordInput.length < 4"
              class="px-4 py-2 rounded-lg bg-gradient-to-r from-accent-blue to-accent-purple text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              解密并播放
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.input-field {
  padding: 0.625rem 0.875rem;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-md, 8px);
  color: hsl(var(--foreground));
  outline: none;
}

.input-field::placeholder {
  color: hsl(var(--muted-foreground));
}

input[type="range"] {
  -webkit-appearance: none;
  height: 0.375rem;
  cursor: pointer;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 50%;
  background: var(--accent-blue);
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.3);
}

input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}
</style>
