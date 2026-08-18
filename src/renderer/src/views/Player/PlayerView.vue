<!-- 视频播放器页面：播放列表、解密播放调度、持久化与生命周期接线 -->
<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, onUnmounted, watch } from 'vue';
import { Play, Lock, LockKeyholeOpen, FileVideo, FolderOpen, Trash2, Camera, X } from 'lucide-vue-next';
import { formatSize, getFileName, toFileUrl } from '@/utils/format';
import { secondsToHMS } from '@/utils/time';
import type { VideoMeta } from '@/types/file';
import { DEFAULT_ENCRYPT_KEY } from '@/config/crypto';
import type { PlayerEntry, ScreenshotMarker } from './types';
import { resolvePlayablePath } from './types';
import { useSettingsStore } from '@/stores/settings';
import { useScreenshot } from '@/composables/useScreenshot';
import { usePlayerThumbnails } from '@/composables/usePlayerThumbnails';
import { usePlayerDecrypt } from '@/composables/usePlayerDecrypt';
import { usePlyrPlayer } from '@/composables/usePlyrPlayer';
import { usePlaybackQueue } from '@/composables/usePlaybackQueue';
import { pLimit } from '@/utils/concurrency';
import PlaylistPanel from './PlaylistPanel.vue';
import PlayerToolbar from './PlayerToolbar.vue';
import PasswordModal from './PasswordModal.vue';
import ScreenshotModal from './ScreenshotModal.vue';

// Constants
const ERR_NO_VIDEO = '未找到视频文件或加密文件';
const DEFAULT_FPS = 25;
const MAX_SAVED_TIMES = 50;

// ---- State ----
const files = ref<PlayerEntry[]>([]);
const currentIndex = ref(-1);
const videoPlayer = ref<HTMLVideoElement | null>(null);
const isPlaying = ref(false);
const playerKey = ref(0);

// Temp dir — resolved once on mount, awaited before any decrypt
const tempDir = ref('');
const tempDirReady = (async (): Promise<void> => {
  try {
    tempDir.value = await window.electronAPI.getTempDir();
  } catch (_e) {
    // tempDir stays '', decryptAndPlay will check before proceeding
  }
})();

// Error display
const errorMsg = ref('');

// ---- Markers (screenshot positions on progress bar, shared with useScreenshot) ----
const screenshotMarkers = ref<ScreenshotMarker[]>([]);

// Persisted settings store
const settingsStore = useSettingsStore();

// Last scanned folder (for quick re-scan button)
const lastFolder = ref(settingsStore.playerData.lastFolder);

// ---- Computed ----
const currentFile = computed((): PlayerEntry | null => {
  if (currentIndex.value < 0 || currentIndex.value >= files.value.length) {
    return null;
  }
  return files.value[currentIndex.value];
});

const videoSrc = computed((): string => {
  const p = resolvePlayablePath(currentFile.value);
  if (!p) {
    return '';
  }
  return toFileUrl(p);
});

const currentFileName = computed((): string => {
  return currentFile.value ? getFileName(currentFile.value.path) : '';
});

const currentFileSize = computed((): string => {
  if (!currentFile.value?.meta) {
    return '';
  }
  return formatSize(currentFile.value.meta.size);
});

const currentResolution = computed((): string => {
  const meta = currentFile.value?.meta;
  if (!meta || !meta.width || !meta.height) {
    return '';
  }
  return `${meta.width}×${meta.height}`;
});

// ---- Thumbnails (composable) ----
const { thumbnailData, generateThumbnailsIfNeeded, cancelThumbnailGeneration } = usePlayerThumbnails({
  currentFile,
  tempDir
});

// ---- Playback queue (composable) ----
const {
  playMode,
  playModeLabel,
  playModeIcon,
  canNext,
  canPrev,
  cyclePlayMode,
  playNext,
  playPrev,
  handleEnded
} = usePlaybackQueue({
  files,
  currentIndex,
  playFile: (index: number): void => {
    void playFile(index);
  },
  replayCurrent
});

// ---- Plyr player (composable) ----
const {
  player,
  currentPlayingPath,
  reactiveCurrentTime,
  currentSpeed,
  speedOptions,
  showControlsOverlay,
  autoHideControls,
  loopStart,
  loopEnd,
  initAndPlay,
  destroyPlayer,
  releaseVideoSource,
  setSpeed,
  toggleControlsOverlay,
  toggleAutoHide,
  setLoopA,
  setLoopB,
  clearLoop
} = usePlyrPlayer({
  videoPlayer,
  videoSrc,
  currentFile,
  thumbnailData,
  isPlaying,
  errorMsg,
  shouldTrackTime: (): boolean => showScreenshotModal.value,
  onPause: scheduleSave,
  onEnded: (): void => {
    flushSave();
    handleEnded();
  },
  onInit: (): void => {
    renderMarkers();
  },
  getSavedTime: (): number => {
    return settingsStore.playerData.playbackTimes[currentFile.value?.path || ''] || 0;
  }
});

// ---- Screenshot & markers (composable) ----
const {
  showScreenshotModal,
  screenshotTimeInput,
  batchInterval,
  capturing,
  captureProgress,
  screenshotMode,
  openScreenshotModal,
  closeScreenshotModal,
  captureCurrentFrame,
  captureByTime,
  batchCapture,
  addCurrentMarker,
  clearAllMarkers,
  renderMarkers
} = useScreenshot({
  currentFile,
  currentFileName,
  playerRef: player,
  errorMsg,
  screenshotMarkers,
  saveToStore,
  generateThumbnailsIfNeeded,
  thumbnailData
});

// ---- Encrypted playback (composable) ----
const {
  showPasswordModal,
  decryptingFile,
  autoDecrypt,
  tempCount,
  decryptAndPlay,
  openPasswordModal,
  confirmDecrypt,
  cancelDecrypt,
  cleanupTemp,
  cleanupAllTemps
} = usePlayerDecrypt({
  files,
  currentIndex,
  errorMsg,
  tempDir,
  tempDirReady,
  loadMeta,
  onDecrypted: async (): Promise<void> => {
    await startPlayback();
  }
});

// ---- Persistence -----
function saveToStore(): void {
  const times: Record<string, number> = { ...settingsStore.playerData.playbackTimes };
  const key = currentPlayingPath.value;
  if (key && player.value) {
    times[key] = player.value.currentTime || 0;
  }
  // Cap map size — drop oldest entries by insertion order
  const keys = Object.keys(times);
  if (keys.length > MAX_SAVED_TIMES) {
    for (const k of keys.slice(0, keys.length - MAX_SAVED_TIMES)) {
      delete times[k];
    }
  }
  settingsStore.setPlayerData({
    filePaths: files.value.map((e) => e.path),
    lastFolder: lastFolder.value,
    autoDecrypt: autoDecrypt.value,
    lastIndex: currentIndex.value,
    playbackTimes: times,
    screenshotMarkers: screenshotMarkers.value,
    playMode: playMode.value
  });
}

// Debounced persistence to avoid frequent localStorage writes
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout((): void => {
    saveTimer = null;
    saveToStore();
  }, 600);
}
function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveToStore();
}

// Restore saved playlist on mount
onMounted(async (): Promise<void> => {
  const pd = settingsStore.playerData;

  autoDecrypt.value = pd.autoDecrypt;
  lastFolder.value = pd.lastFolder;
  playMode.value = pd.playMode || 'sequential';

  if (pd.screenshotMarkers?.length > 0) {
    screenshotMarkers.value = pd.screenshotMarkers;
  }

  if (pd.filePaths.length > 0) {
    addFilesAndLoadMeta(pd.filePaths);
    // 恢复上次播放索引（钳制到有效范围）——不自动播放
    if (pd.lastIndex >= 0 && pd.lastIndex < files.value.length) {
      currentIndex.value = pd.lastIndex;
    }
  }

  window.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', flushSave);
});

// 播放列表增删、索引、自动解密、播放模式变化时自动保存
watch(
  [() => files.value.length, currentIndex, autoDecrypt, playMode],
  () => {
    scheduleSave();
  }
);

// ---- File Management ----
function addFiles(paths: string[]): void {
  const existing = new Set(files.value.map((f) => f.path));
  const toAdd: PlayerEntry[] = [];
  for (const p of paths) {
    if (existing.has(p)) {
      continue;
    }
    existing.add(p);
    toAdd.push({ path: p, isEncrypted: p.toLowerCase().endsWith('.enc'), meta: null, tempPath: null });
  }
  if (toAdd.length > 0) {
    files.value.push(...toAdd);
  }
}

function addFilesAndLoadMeta(paths: string[]): void {
  addFiles(paths);
  void loadAllMeta();
}

async function removeFile(index: number): Promise<void> {
  const removed = files.value[index];
  if (!removed) {
    return;
  }

  const wasCurrent = index === currentIndex.value;
  if (wasCurrent) {
    // 移除的是正在播放的文件：先释放播放器文件句柄并终止缩略图 ffmpeg，否则文件删除会失败
    await releasePlaybackResources();
  }

  if (removed.tempPath) {
    await cleanupTemp(removed.tempPath);
    removed.tempPath = null;
  }

  files.value.splice(index, 1);
  if (wasCurrent) {
    if (files.value.length > 0) {
      const newIdx = Math.min(index, files.value.length - 1);
      playFile(newIdx);
    } else {
      currentIndex.value = -1;
    }
  } else if (index < currentIndex.value) {
    currentIndex.value--;
  }
}

function handleReorder(payload: { from: number; to: number }): void {
  const list = files.value;
  const item = list.splice(payload.from, 1)[0];
  if (!item) {
    return;
  }
  list.splice(payload.to, 0, item);

  if (currentIndex.value === payload.from) {
    currentIndex.value = payload.to;
  } else if (payload.from < currentIndex.value && payload.to >= currentIndex.value) {
    currentIndex.value--;
  } else if (payload.from > currentIndex.value && payload.to <= currentIndex.value) {
    currentIndex.value++;
  }
  scheduleSave();
}

async function openTempDir(): Promise<void> {
  if (tempDir.value) {
    await window.electronAPI.openFolder(tempDir.value);
  }
}

/** 释放播放器与缩略图资源：销毁 Plyr、释放 video 句柄并终止缩略图 ffmpeg（多个流程共用） */
async function releasePlaybackResources(): Promise<void> {
  destroyPlayer();
  releaseVideoSource();
  await cancelThumbnailGeneration();
}

/** 重置播放状态并清理临时文件（clearList / rescanLastFolder 共用） */
async function resetPlayback(): Promise<void> {
  await releasePlaybackResources();
  currentIndex.value = -1;
  await nextTick();
  await cleanupAllTemps();
  files.value = [];
}

async function clearList(): Promise<void> {
  await resetPlayback();
  errorMsg.value = '';
}

async function selectDir(): Promise<void> {
  const dir = await window.electronAPI.selectDirectory();
  if (!dir) {
    return;
  }

  lastFolder.value = dir;

  const scanned = await window.electronAPI.scanPlayerFiles(dir);
  if (scanned.length === 0) {
    errorMsg.value = ERR_NO_VIDEO;
    return;
  }
  addFilesAndLoadMeta(scanned);
}

/** 重新扫描上次记住的文件夹 */
async function rescanLastFolder(): Promise<void> {
  if (!lastFolder.value) {
    return;
  }
  errorMsg.value = '';
  const scanned = await window.electronAPI.scanPlayerFiles(lastFolder.value);
  if (scanned.length === 0) {
    errorMsg.value = ERR_NO_VIDEO;
    return;
  }
  await resetPlayback();
  addFilesAndLoadMeta(scanned);
}

// ---- Meta loading (concurrency-limited to avoid ffprobe process storms) ----
async function loadMeta(entry: PlayerEntry): Promise<void> {
  if (entry.isEncrypted && !entry.tempPath) {
    return;
  }
  const path = entry.isEncrypted ? entry.tempPath! : entry.path;
  const meta = await window.electronAPI.getVideoMeta(path);
  entry.meta = meta as VideoMeta;
}

async function loadAllMeta(): Promise<void> {
  const pending = files.value.filter((e) => !e.isEncrypted && !e.meta);
  if (pending.length === 0) {
    return;
  }
  const limit = pLimit(4);
  const results = await Promise.allSettled(pending.map((entry) => limit(() => loadMeta(entry))));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    errorMsg.value = `${failed} 个文件元数据加载失败`;
  }
}

// ---- Playback ----
/** 等待 video 元素重建后初始化 Plyr 播放并生成缩略图（解密完成/直接播放共用） */
async function startPlayback(): Promise<void> {
  await nextTick();
  initAndPlay();
  void generateThumbnailsIfNeeded();
}

async function playFile(index: number): Promise<void> {
  // 切换前先落盘旧文件进度：player 实例即将被销毁，pause 事件时机不可靠
  flushSave();
  errorMsg.value = '';
  clearLoop();
  // 释放上一个 video 元素的文件句柄（playerKey 重建元素不会自动释放），并终止上一个文件的缩略图生成
  await releasePlaybackResources();
  playerKey.value++;
  currentIndex.value = index;
  const file = files.value[index];
  if (!file) {
    return;
  }

  if (file.isEncrypted) {
    if (file.tempPath) {
      await startPlayback();
    } else if (autoDecrypt.value) {
      await decryptAndPlay(file, DEFAULT_ENCRYPT_KEY);
    } else {
      openPasswordModal(file);
    }
  } else {
    if (!file.meta) {
      try {
        await loadMeta(file);
      } catch (_e) {
        errorMsg.value = `文件元数据加载失败: ${getFileName(file.path)}`;
        return;
      }
    }
    await startPlayback();
  }
}

/** 单曲循环：从头重播当前文件（供 usePlaybackQueue 回调） */
function replayCurrent(): void {
  if (player.value) {
    player.value.currentTime = 0;
    void player.value.play().catch((): void => {});
  }
}

// ---- Frame step / Picture-in-Picture ----
function stepFrame(dir: number): void {
  if (!player.value) {
    return;
  }
  player.value.pause();
  const t = (player.value.currentTime || 0) + dir / DEFAULT_FPS;
  player.value.currentTime = Math.max(0, t);
}
function stepForward(): void {
  stepFrame(1);
}
function stepBackward(): void {
  stepFrame(-1);
}

async function togglePip(): Promise<void> {
  const el = videoPlayer.value;
  if (!el) {
    return;
  }
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await el.requestPictureInPicture();
    }
  } catch (_e) {
    // PiP unsupported / blocked — ignore silently
  }
}

// ---- Keyboard shortcuts (avoid Plyr's built-in space/arrows/M/F) ----
function onKeydown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return;
  }
  if (!currentFile.value) {
    return;
  }
  switch (e.key.toLowerCase()) {
    case 'n':
      playNext();
      break;
    case 'p':
      playPrev();
      break;
    case 'l':
      cyclePlayMode();
      break;
    case ',':
      stepBackward();
      break;
    case '.':
      stepForward();
      break;
    case 'i':
      void togglePip();
      break;
    default:
      return;
  }
}

/** 清理全部解密临时文件；若正在播放解密视频，先释放句柄再删除，否则删除会静默失败 */
async function handleCleanupTemps(): Promise<void> {
  const cf = currentFile.value;
  if (cf?.isEncrypted && cf.tempPath) {
    await releasePlaybackResources();
  }
  await cleanupAllTemps();
}

// ---- Lifecycle ----
// 卸载前释放（onUnmounted 时模板 ref 已为 null，无法再清除 src）
onBeforeUnmount((): void => {
  flushSave();
  destroyPlayer();
  releaseVideoSource();
});

onUnmounted(async (): Promise<void> => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('beforeunload', flushSave);
  // 终止后台缩略图 ffmpeg，否则离开页面后源文件仍被占用
  await cancelThumbnailGeneration();
  await cleanupAllTemps();
});
</script>

<template>
  <div class="page-container">
    <!-- Header -->
    <header class="mb-4">
      <div class="flex items-center gap-3 mb-1">
        <div
          class="w-9 h-9 rounded-lg bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center"
        >
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
            @click="handleCleanupTemps"
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
            :class="
              autoDecrypt
                ? 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue hover:bg-accent-blue/20'
                : 'bg-bg-tertiary/60 border-bg-tertiary text-text-muted hover:bg-bg-tertiary'
            "
            :title="autoDecrypt ? '加密视频自动使用内置密钥解密' : '加密视频需手动输入密码'"
          >
            <LockKeyholeOpen v-if="autoDecrypt" :size="13" />
            <Lock v-else :size="13" />
            <span>{{ autoDecrypt ? '自动解密' : '手动解密' }}</span>
          </button>

          <!-- Screenshot -->
          <button
            v-if="currentFile"
            @click="openScreenshotModal"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border border-bg-tertiary text-text-secondary hover:text-accent-purple hover:border-accent-purple/20"
            title="视频截图"
          >
            <Camera :size="13" />
            <span class="hidden sm:inline">截图</span>
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
          :last-folder="lastFolder"
          @select-file="playFile"
          @remove-file="removeFile"
          @add-files="addFilesAndLoadMeta"
          @scan-dir="selectDir"
          @clear-list="clearList"
          @reorder="handleReorder"
          @rescan-last-folder="rescanLastFolder"
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
            <span class="hidden sm:inline flex-shrink-0">{{
              currentFile.meta.bitrate ? (currentFile.meta.bitrate / 1000).toFixed(0) + ' kbps' : '--'
            }}</span>
          </div>

          <div :key="playerKey" class="video-player-wrapper glass-card overflow-hidden">
            <div class="relative bg-black">
              <video
                v-if="videoSrc"
                ref="videoPlayer"
                :src="videoSrc"
                class="w-full"
                style="max-height: 55vh; min-height: 240px"
                preload="auto"
                crossorigin="anonymous"
              />
              <div v-else class="flex items-center justify-center" style="min-height: 240px">
                <div class="text-center text-text-muted">
                  <Lock v-if="currentFile.isEncrypted" :size="28" class="mx-auto mb-2 opacity-30" />
                  <FileVideo v-else :size="28" class="mx-auto mb-2 opacity-30" />
                  <p class="text-sm">
                    {{
                      currentFile.isEncrypted ? (autoDecrypt ? '正在自动解密...' : '加密视频需输入密码') : '准备播放...'
                    }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Player Toolbar (below video) -->
            <PlayerToolbar
              v-if="videoSrc"
              :can-prev="canPrev"
              :can-next="canNext"
              :play-mode="playMode"
              :play-mode-label="playModeLabel"
              :play-mode-icon="playModeIcon"
              :show-controls-overlay="showControlsOverlay"
              :auto-hide-controls="autoHideControls"
              :loop-start="loopStart"
              :loop-end="loopEnd"
              :current-speed="currentSpeed"
              :speed-options="speedOptions"
              :marker-count="screenshotMarkers.length"
              @prev="playPrev"
              @next="playNext"
              @cycle-mode="cyclePlayMode"
              @toggle-overlay="toggleControlsOverlay"
              @toggle-auto-hide="toggleAutoHide"
              @add-marker="addCurrentMarker"
              @clear-markers="clearAllMarkers"
              @set-loop-a="setLoopA"
              @set-loop-b="setLoopB"
              @clear-loop="clearLoop"
              @step-backward="stepBackward"
              @step-forward="stepForward"
              @toggle-pip="togglePip"
              @set-speed="setSpeed"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Password Modal -->
    <PasswordModal
      :show="showPasswordModal"
      :file-name="decryptingFile ? getFileName(decryptingFile.path) : ''"
      @confirm="confirmDecrypt"
      @cancel="cancelDecrypt"
    />

    <!-- Screenshot Modal -->
    <ScreenshotModal
      :show="showScreenshotModal"
      :capturing="capturing"
      :capture-progress="captureProgress"
      :current-file-name="currentFileName"
      :duration="currentFile?.meta?.duration || 0"
      :current-time="reactiveCurrentTime"
      v-model:screenshot-mode="screenshotMode"
      v-model:screenshot-time-input="screenshotTimeInput"
      v-model:batch-interval="batchInterval"
      @close="closeScreenshotModal"
      @capture-current="captureCurrentFrame"
      @capture-by-time="captureByTime"
      @batch-capture="batchCapture"
    />
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

<style scoped lang="scss">
@use './_player';
</style>
