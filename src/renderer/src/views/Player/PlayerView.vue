<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue'
import { Play, Lock, LockKeyholeOpen, FileVideo, FolderOpen, Trash2 } from 'lucide-vue-next'
// @ts-ignore - Plyr ESM default export
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
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
const isPlaying = ref(false)
const playerKey = ref(0)

// Password modal for encrypted files
const showPasswordModal = ref(false)
const passwordInput = ref('')
const passwordError = ref('')
const decryptingFile = ref<PlayerEntry | null>(null)

// Auto-decrypt toggle (default: ON — use built-in key)
const autoDecrypt = ref(true)

// Temp dir — resolved once on mount, awaited before any decrypt
const tempDir = ref('')
let tempDirReady: Promise<void>

// Init temp dir with error handling (must resolve before any decrypt)
tempDirReady = (async (): Promise<void> => {
  try {
    tempDir.value = await window.electronAPI.getTempDir()
  } catch (_e) {
    // tempDir stays '', decryptAndPlay will check before proceeding
  }
})()

// Guard against concurrent decrypts
let decrypting = false

// Derived: how many files currently have a temp decrypted copy
const tempCount = computed((): number => {
  return files.value.filter((e) => e.tempPath).length
})

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
    files.value.push({
      path: p,
      isEncrypted: p.toLowerCase().endsWith('.enc'),
      meta: null,
      tempPath: null
    })
  }
}

async function addFilesAndLoadMeta(paths: string[]): Promise<void> {
  await addFiles(paths)
  void loadAllMeta()
}

async function removeFile(index: number): Promise<void> {
  const removed = files.value[index]
  if (!removed) { return }

  // Clean up temp file if this was an encrypted file that was decrypted
  if (removed.tempPath) {
    await cleanupTemp(removed.tempPath)
    removed.tempPath = null
  }

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

async function openTempDir(): Promise<void> {
  if (tempDir.value) {
    await window.electronAPI.openFolder(tempDir.value)
  }
}

async function clearList(): Promise<void> {
  destroyPlayer()
  await cleanupAllTemps()
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
  const path = entry.isEncrypted ? entry.tempPath! : entry.path
  const meta = await window.electronAPI.getVideoMeta(path)
  entry.meta = meta as VideoMeta
}

async function loadAllMeta(): Promise<void> {
  const nonEncrypted = files.value.filter((e) => !e.isEncrypted)
  const results = await Promise.allSettled(nonEncrypted.map((entry) => loadMeta(entry)))
  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed > 0) {
    errorMsg.value = `${failed} 个文件元数据加载失败`
  }
}

// ---- Playback ----
async function playFile(index: number): Promise<void> {
  errorMsg.value = ''
  playerKey.value++
  currentIndex.value = index
  const file = files.value[index]
  if (!file) { return }

  if (file.isEncrypted) {
    if (file.tempPath) {
      await nextTick()
      initAndPlay()
    } else if (autoDecrypt.value) {
      await decryptAndPlay(file, DEFAULT_ENCRYPT_KEY)
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let player: any = null

function destroyPlayer(): void {
  if (player) {
    try { player.destroy() } catch (_e) { /* ignore */ }
    player = null
  }
  isPlaying.value = false
}

function initAndPlay(): void {
  const el = videoPlayer.value
  if (!el || !videoSrc.value) { return }

  destroyPlayer()

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

  player.on('play', () => {
    isPlaying.value = true
  })

  player.on('pause', () => {
    isPlaying.value = false
  })

  player.on('ended', () => {
    isPlaying.value = false
    if (hasNext.value) {
      playFile(currentIndex.value + 1)
    }
  })

  player.on('error', () => {
    isPlaying.value = false
    errorMsg.value = '视频加载失败'
  })

  try {
    player.play()
  } catch (_e) {
    /* ignore autoplay restrictions */
  }
}

// ---- Encryption Decrypt for Playback ----
async function decryptAndPlay(file: PlayerEntry, password: string): Promise<void> {
  if (decrypting) { return }
  decrypting = true

  try {
    if (file.tempPath) {
      await cleanupTemp(file.tempPath)
      file.tempPath = null
    }

    // Ensure tempDir is resolved before using
    await tempDirReady
    if (!tempDir.value) {
      errorMsg.value = '无法获取临时目录，解密失败'
      return
    }

    const tempPath = await window.electronAPI.decryptForPlayback(
      file.path,
      password,
      tempDir.value
    )

    if (files.value[currentIndex.value]?.path !== file.path) {
      await cleanupTemp(tempPath)
      return
    }

    file.tempPath = tempPath

    await loadMeta(file)
    await nextTick()
    initAndPlay()
  } finally {
    decrypting = false
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
  const pwd = passwordInput.value

  showPasswordModal.value = false
  passwordInput.value = ''
  decryptingFile.value = null

  await decryptAndPlay(file, pwd)
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
  for (const entry of files.value) {
    if (entry.tempPath) {
      await cleanupTemp(entry.tempPath)
      entry.tempPath = null
    }
  }
}

// ---- Lifecycle ----
onUnmounted(async () => {
  destroyPlayer()
  await cleanupAllTemps()
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

        <!-- Header Actions -->
        <div class="ml-auto flex items-center gap-1.5">
          <!-- Open temp folder -->
          <button
            v-if="tempDir"
            @click="openTempDir"
            class="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors border border-bg-tertiary text-text-muted hover:text-text-primary hover:border-accent-blue/20"
            title="打开临时文件目录"
          >
            <FolderOpen :size="13" />
            <span class="hidden sm:inline">临时目录</span>
          </button>

          <!-- Clean temp files -->
          <button
            v-if="tempCount > 0"
            @click="cleanupAllTemps()"
            class="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors border border-bg-tertiary text-text-muted hover:text-danger hover:border-danger/30"
            title="清理所有解密临时文件"
          >
            <Trash2 :size="13" />
            <span class="hidden sm:inline">清理 ({{ tempCount }})</span>
          </button>

          <!-- Auto-decrypt toggle -->
          <button
            @click="autoDecrypt = !autoDecrypt"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border"
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
      </div>
    </header>

    <!-- Error Banner -->
    <div v-if="errorMsg" class="alert-danger mb-3 flex items-center justify-between">
      <p>{{ errorMsg }}</p>
      <button @click="errorMsg = ''" class="p-0.5 rounded hover:bg-danger/10 transition-colors flex-shrink-0">
        <X :size="14" />
      </button>
    </div>

    <!-- Main Layout -->
    <div class="player-layout grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- Left: Playlist -->
      <div class="player-sidebar lg:col-span-1">
        <PlaylistPanel
          :files="files"
          :current-index="currentIndex"
          :is-playing="isPlaying"
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
        <div v-else>
          <!-- Single-line info bar above video -->
          <div
            v-if="currentFile?.meta"
            class="flex items-center gap-3 px-3 py-1.5 mb-1 rounded-lg text-xs text-text-muted bg-bg-tertiary/40 border border-bg-tertiary"
          >
            <span class="truncate max-w-[200px]" :title="currentFileName">{{ currentFileName }}</span>
            <span class="w-px h-3 bg-bg-tertiary flex-shrink-0" />
            <span class="flex-shrink-0">{{ currentResolution || '--' }}</span>
            <span class="w-px h-3 bg-bg-tertiary flex-shrink-0" />
            <span class="flex-shrink-0">{{ secondsToHMS(currentFile.meta.duration) }}</span>
            <span class="w-px h-3 bg-bg-tertiary flex-shrink-0" />
            <span class="flex-shrink-0">{{ currentFileSize || '--' }}</span>
            <span class="w-px h-3 bg-bg-tertiary flex-shrink-0 hidden sm:block" />
            <span class="hidden sm:inline flex-shrink-0">{{ currentFile.meta.codec?.toUpperCase() || '--' }}</span>
            <span class="w-px h-3 bg-bg-tertiary flex-shrink-0 hidden sm:block" />
            <span class="hidden sm:inline flex-shrink-0">{{ currentFile.meta.bitrate ? (currentFile.meta.bitrate / 1000).toFixed(0) + ' kbps' : '--' }}</span>
          </div>

          <div :key="playerKey" class="video-player-wrapper glass-card overflow-hidden">
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

<style>
/* Plyr CSS variables — must be unscoped to affect Plyr's global DOM */
:root {
  --plyr-color-main: hsl(220, 70%, 55%);
  --plyr-video-background: #000;
  --plyr-menu-background: hsl(var(--card));
  --plyr-menu-color: hsl(var(--foreground));
  --plyr-menu-border-color: hsl(var(--border));
  --plyr-tooltip-background: hsl(var(--card));
  --plyr-tooltip-color: hsl(var(--foreground));
  --plyr-badge-background: hsl(var(--muted));
  --plyr-badge-text-color: hsl(var(--foreground));
  --plyr-range-fill-background: var(--plyr-color-main);
  --plyr-range-track-background: hsl(var(--border));
  --plyr-control-radius: var(--radius-base, 6px);
  --plyr-control-icon-size: 18px;
  --plyr-font-size-large: 22px;
  --plyr-font-size-xlarge: 26px;
  --plyr-font-size-time: 13px;
  --plyr-font-size-menu: 14px;
  --plyr-font-size-badge: 11px;
  --plyr-font-family: var(--font-sans);
}
</style>

<style scoped>
@use "./_player";
</style>
