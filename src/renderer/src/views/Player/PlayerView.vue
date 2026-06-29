<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue'
import { Play, Lock, LockKeyholeOpen, FileVideo } from 'lucide-vue-next'
import { formatSize, getFileName } from '@/utils/format'
import { secondsToHMS } from '@/utils/time'
import type { VideoMeta } from '@/types/file'
import { DEFAULT_ENCRYPT_KEY } from '@/config/crypto'
import type { PlayerEntry } from './types'
import PlaylistPanel from './PlaylistPanel.vue'

// ---- State ----
const files = ref<PlayerEntry[]>([])
const currentIndex = ref(-1)
const videoPlayer = ref<HTMLVideoElement | null>(null)

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

function handleReorder(payload: { from: number; to: number }): void {
  const list = files.value
  const item = list.splice(payload.from, 1)[0]
  if (!item) { return }
  list.splice(payload.to, 0, item)

  // Update currentIndex if the playing item moved
  if (currentIndex.value === payload.from) {
    currentIndex.value = payload.to
  } else if (payload.from < currentIndex.value && payload.to >= currentIndex.value) {
    currentIndex.value--
  } else if (payload.from > currentIndex.value && payload.to <= currentIndex.value) {
    currentIndex.value++
  }
}

function clearList(): void {
  files.value = []
  currentIndex.value = -1
  errorMsg.value = ''
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
  if (entry.isEncrypted && !entry.tempPath) { return }
  const path = entry.isEncrypted && entry.tempPath ? entry.tempPath : entry.path
  const meta = await window.electronAPI.getVideoMeta(path)
  entry.meta = meta as VideoMeta
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
      await nextTick()
      initAndPlay()
    } else if (autoDecrypt.value) {
      await decryptWithDefaultKey(file)
    } else {
      decryptingFile.value = file
      passwordInput.value = ''
      passwordError.value = ''
      showPasswordModal.value = true
    }
  } else {
    if (!file.meta) {
      await loadMeta(file)
    }
    await nextTick()
    initAndPlay()
  }
}

// ---- Plyr ----
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'

let player: Plyr | null = null

function initAndPlay(): void {
  const el = videoPlayer.value
  if (!el || !videoSrc.value) { return }

  if (player) {
    player.destroy()
    player = null
  }

  player = new Plyr(el, {
    controls: [
      'play-large',
      'play',
      'progress',
      'current-time',
      'mute',
      'volume',
      'settings',
      'fullscreen'
    ],
    settings: ['speed'],
    speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
    tooltips: { controls: true, seek: true },
    keyboard: { focused: true, global: true },
    fullscreen: { enabled: true, fallback: true },
    hideControls: true,
    resetOnEnd: false
  })

  player.on('ended', () => {
    if (hasNext.value) {
      playFile(currentIndex.value + 1)
    }
  })

  player.on('error', () => {
    errorMsg.value = '视频加载失败'
  })

  try {
    player.play()
  } catch (_e) {
    /* ignore autoplay restrictions */
  }
}

// ---- Encryption Decrypt for Playback ----
async function decryptWithDefaultKey(file: PlayerEntry): Promise<void> {
  const tempDir = await window.electronAPI.getTempDir()
  const tempPath = await window.electronAPI.decryptForPlayback(
    file.path,
    DEFAULT_ENCRYPT_KEY,
    tempDir
  )

  if (files.value[currentIndex.value]?.path !== file.path) {
    await cleanupTemp(tempPath)
    return
  }

  file.tempPath = tempPath
  tempPaths.value.set(file.path, tempPath)

  await loadMeta(file)
  await nextTick()
  initAndPlay()
}

async function confirmDecrypt(): Promise<void> {
  if (!decryptingFile.value) { return }
  if (passwordInput.value.length < 4) {
    passwordError.value = '密码至少需要4个字符'
    return
  }

  passwordError.value = ''
  const file = decryptingFile.value

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

  if (files.value[currentIndex.value]?.path !== file.path) {
    await cleanupTemp(tempPath)
    return
  }

  file.tempPath = tempPath
  tempPaths.value.set(file.path, tempPath)

  await loadMeta(file)

  showPasswordModal.value = false
  passwordInput.value = ''
  decryptingFile.value = null

  await nextTick()
  initAndPlay()
}

function cancelDecrypt(): void {
  showPasswordModal.value = false
  passwordInput.value = ''
  passwordError.value = ''
  decryptingFile.value = null
}

// ---- Temp Cleanup ----
async function cleanupTemp(tempPath: string): Promise<void> {
  await window.electronAPI.deleteFile(tempPath)
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

// ---- Lifecycle ----
onUnmounted(() => {
  if (player) {
    player.destroy()
    player = null
  }
  cleanupAllTemps()
})
</script>

<template>
  <div class="page-container">
    <!-- Header -->
    <header class="mb-4">
      <div class="flex items-center gap-3 mb-1">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center">
          <Play :size="18" class="text-accent-blue" />
        </div>
        <h1 class="text-xl font-bold text-text-primary">视频播放器</h1>

        <!-- Auto-decrypt toggle -->
        <button
          @click="autoDecrypt = !autoDecrypt"
          class="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border"
          :class="autoDecrypt
            ? 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue hover:bg-accent-blue/20'
            : 'bg-bg-tertiary/60 border-bg-tertiary text-text-muted hover:bg-bg-tertiary'"
          :title="autoDecrypt ? '加密视频自动使用内置密钥解密' : '加密视频需手动输入密码'"
        >
          <LockKeyholeOpen v-if="autoDecrypt" :size="13" />
          <Lock v-else :size="13" />
          <span>{{ autoDecrypt ? '自动解密' : '手动解密' }}</span>
        </button>
      </div>
    </header>

    <!-- Error Banner -->
    <div v-if="errorMsg" class="alert-danger mb-3">
      <p>{{ errorMsg }}</p>
    </div>

    <!-- Main Layout -->
    <div class="player-layout grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- Left: Playlist -->
      <div class="player-sidebar lg:col-span-1">
        <PlaylistPanel
          :files="files"
          :current-index="currentIndex"
          :is-playing="false"
          @select-file="playFile"
          @remove-file="removeFile"
          @add-files="addFilesAndLoadMeta"
          @scan-dir="selectDir"
          @clear-list="clearList"
          @reorder="handleReorder"
        />
      </div>

      <!-- Right: Video Player -->
      <div class="player-main lg:col-span-2 space-y-3">
        <!-- No file selected -->
        <div v-if="!currentFile" class="glass-card player-empty">
          <Play :size="40" class="mb-3 opacity-15" />
          <p class="text-base text-text-muted">从左侧列表选择视频开始播放</p>
        </div>

        <!-- Player Area -->
        <div v-else class="video-player-wrapper glass-card overflow-hidden">
          <div class="relative bg-black">
            <video
              v-if="videoSrc"
              ref="videoPlayer"
              :src="videoSrc"
              class="w-full"
              style="max-height: 55vh; min-height: 240px;"
              preload="auto"
              crossorigin="anonymous"
            />
            <div v-else class="flex items-center justify-center" style="min-height: 240px;">
              <div class="text-center text-text-muted">
                <Lock v-if="currentFile.isEncrypted" :size="28" class="mx-auto mb-2 opacity-30" />
                <FileVideo v-else :size="28" class="mx-auto mb-2 opacity-30" />
                <p class="text-sm">
                  {{ currentFile.isEncrypted
                    ? (autoDecrypt ? '正在自动解密...' : '加密视频需输入密码')
                    : '准备播放...' }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Video Info Card -->
        <div v-if="currentFile?.meta" class="video-info-card">
          <h3 class="text-sm font-semibold text-text-primary mb-3">视频信息</h3>
          <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <span class="text-text-muted text-xs">文件名</span>
              <p class="text-text-primary truncate text-xs">{{ currentFileName }}</p>
            </div>
            <div>
              <span class="text-text-muted text-xs">分辨率</span>
              <p class="text-text-primary text-xs">{{ currentResolution || '未知' }}</p>
            </div>
            <div>
              <span class="text-text-muted text-xs">时长</span>
              <p class="text-text-primary text-xs">{{ secondsToHMS(currentFile.meta.duration) }}</p>
            </div>
            <div>
              <span class="text-text-muted text-xs">文件大小</span>
              <p class="text-text-primary text-xs">{{ currentFileSize || '未知' }}</p>
            </div>
            <div>
              <span class="text-text-muted text-xs">编码格式</span>
              <p class="text-text-primary text-xs">{{ currentFile.meta.codec?.toUpperCase() || '未知' }}</p>
            </div>
            <div>
              <span class="text-text-muted text-xs">码率</span>
              <p class="text-text-primary text-xs">{{ currentFile.meta.bitrate ? (currentFile.meta.bitrate / 1000).toFixed(0) + ' kbps' : '未知' }}</p>
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
        <div class="glass-card w-full max-w-sm mx-4" @click.stop>
          <h3 class="text-lg font-semibold text-text-primary mb-2 flex items-center gap-2">
            <Lock :size="18" class="text-warning" />
            输入解密密码
          </h3>
          <p class="text-sm text-text-secondary mb-4">
            播放加密视频需要输入密码进行解密。
            <span class="text-xs text-text-muted truncate block mt-1">
              {{ decryptingFile ? getFileName(decryptingFile.path) : '' }}
            </span>
          </p>

          <input
            v-model="passwordInput"
            type="password"
            placeholder="输入解密密码（至少4位）"
            class="input-base w-full mb-2"
            @keyup.enter="confirmDecrypt"
          />

          <p v-if="passwordError" class="text-xs text-danger mb-2">{{ passwordError }}</p>

          <div class="flex justify-end gap-2 mt-4">
            <button @click="cancelDecrypt" class="btn-secondary text-xs">取消</button>
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
@use "./_player";
</style>
