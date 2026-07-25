<script setup lang="ts">
import { ref, shallowRef, computed, nextTick, onMounted, onBeforeUnmount, onUnmounted, watch } from 'vue';
import {
  Play,
  Lock,
  LockKeyholeOpen,
  FileVideo,
  FolderOpen,
  Trash2,
  Camera,
  Loader,
  Image,
  X,
  Eye,
  EyeOff,
  Gauge,
  Bookmark,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Repeat,
  Repeat1,
  Shuffle,
  PictureInPicture
} from 'lucide-vue-next';
// @ts-ignore - Plyr ESM default export
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { formatSize, getFileName, toFileUrl } from '@/utils/format';
import { secondsToHMS } from '@/utils/time';
import type { VideoMeta } from '@/types/file';
import { DEFAULT_ENCRYPT_KEY } from '@/config/crypto';
import type { PlayerEntry, ScreenshotMarker, ThumbnailData, PlayMode } from './types';
import { resolvePlayablePath } from './types';
import { useSettingsStore } from '@/stores/settings';
import { useScreenshot } from '@/composables/useScreenshot';
import { pLimit } from '@/utils/concurrency';
import PlaylistPanel from './PlaylistPanel.vue';

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

// Plyr instance (shallowRef so it can be passed into composables)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const player = shallowRef<any>(null);
// Path of the file the current player instance is actually playing (persistence key)
const currentPlayingPath = ref('');

// Password modal for encrypted files
const showPasswordModal = ref(false);
const passwordInput = ref('');
const passwordError = ref('');
const decryptingFile = ref<PlayerEntry | null>(null);

// Auto-decrypt toggle (default: ON — use built-in key)
const autoDecrypt = ref(true);

// Temp dir — resolved once on mount, awaited before any decrypt
const tempDir = ref('');
let tempDirReady: Promise<void>;
tempDirReady = (async (): Promise<void> => {
  try {
    tempDir.value = await window.electronAPI.getTempDir();
  } catch (_e) {
    // tempDir stays '', decryptAndPlay will check before proceeding
  }
})();

// Guard against concurrent decrypts
let decrypting = false;

// Derived: how many files currently have a temp decrypted copy
const tempCount = computed((): number => {
  return files.value.filter((e) => e.tempPath).length;
});

// Error display
const errorMsg = ref('');

// ---- Markers (screenshot positions on progress bar, shared with useScreenshot) ----
const screenshotMarkers = ref<ScreenshotMarker[]>([]);

// ---- Toolbar controls ----
const showControlsOverlay = ref(false); // force-show controls bar
const autoHideControls = ref(true); // auto-hide toggle
const currentSpeed = ref(1); // synced with Plyr speed
const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];

function setSpeed(speed: number): void {
  if (!player.value) {
    return;
  }
  currentSpeed.value = speed;
  player.value.speed = speed;
}

function toggleControlsOverlay(): void {
  if (!player.value) {
    return;
  }
  showControlsOverlay.value = !showControlsOverlay.value;
  player.value.toggleControls(showControlsOverlay.value);
}

function toggleAutoHide(): void {
  autoHideControls.value = !autoHideControls.value;
}

// ---- Play mode (sequential / repeat-all / repeat-one / shuffle) ----
const playMode = ref<PlayMode>('sequential');
const PLAY_MODES: PlayMode[] = ['sequential', 'repeat-all', 'repeat-one', 'shuffle'];

function cyclePlayMode(): void {
  const idx = PLAY_MODES.indexOf(playMode.value);
  playMode.value = PLAY_MODES[(idx + 1) % PLAY_MODES.length];
}

const playModeLabel = computed((): string => {
  switch (playMode.value) {
    case 'repeat-all':
      return '列表循环';
    case 'repeat-one':
      return '单曲循环';
    case 'shuffle':
      return '随机播放';
    default:
      return '顺序播放';
  }
});

const playModeIcon = computed(() => {
  switch (playMode.value) {
    case 'repeat-one':
      return Repeat1;
    case 'shuffle':
      return Shuffle;
    default:
      return Repeat;
  }
});

// ---- A-B loop ----
const loopStart = ref<number | null>(null);
const loopEnd = ref<number | null>(null);

function setLoopA(): void {
  if (!player.value) {
    return;
  }
  const start = player.value.currentTime || 0;
  loopStart.value = start;
  if (loopEnd.value !== null && loopEnd.value <= start) {
    loopEnd.value = null;
  }
}

function setLoopB(): void {
  if (!player.value) {
    return;
  }
  const t = player.value.currentTime || 0;
  if (loopStart.value !== null && t > loopStart.value) {
    loopEnd.value = t;
  }
}

function clearLoop(): void {
  loopStart.value = null;
  loopEnd.value = null;
}

// ---- Thumbnails ----
const thumbnailGenerating = ref(false);
const thumbnailData = ref<ThumbnailData | null>(null);
// Session-level cache: video path -> sprite/vtt, avoids regenerating on re-select
const thumbnailCache = new Map<string, ThumbnailData>();
let thumbGenId = 0;

function hashPath(p: string): string {
  let hash = 0;
  for (let i = 0; i < p.length; i++) {
    const ch = p.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

function getThumbnailCacheDir(): string {
  if (!tempDir.value) {
    return '';
  }
  const hash = hashPath(currentFile.value?.path || '');
  return tempDir.value + '/thumbnails_' + hash;
}

async function generateThumbnailsIfNeeded(): Promise<void> {
  const cf = currentFile.value;
  if (!cf || !tempDir.value) {
    return;
  }

  const input = resolvePlayablePath(cf);
  if (!input) {
    return;
  }

  // Session cache reuse — skip ffmpeg if we already generated for this file
  const cached = thumbnailCache.get(cf.path);
  if (cached) {
    thumbnailData.value = cached;
    return;
  }

  const dur = cf.meta?.duration || 0;
  if (dur < 5) {
    return;
  } // Too short, skip

  const myGen = ++thumbGenId;
  thumbnailData.value = null;
  thumbnailGenerating.value = true;
  try {
    const result = await window.electronAPI.generateThumbnails({
      input,
      outputDir: getThumbnailCacheDir(),
      thumbWidth: 160,
      thumbHeight: 90,
      interval: Math.max(5, Math.ceil(dur / 100)), // ~100 thumbnails total
      cols: 10
    });
    // Dropped if user switched to another file meanwhile
    if (myGen !== thumbGenId) {
      return;
    }
    if (result.vttUrl) {
      const data: ThumbnailData = { spriteUrl: result.spriteUrl, vttUrl: result.vttUrl };
      thumbnailData.value = data;
      thumbnailCache.set(cf.path, data);
    }
  } catch (_e) {
    // Silently skip — thumbnail generation is best-effort
    if (myGen === thumbGenId) {
      console.warn('Thumbnail generation failed:', _e);
    }
  } finally {
    if (myGen === thumbGenId) {
      thumbnailGenerating.value = false;
    }
  }
}

/** 终止进行中的缩略图生成：ffmpeg 全程持有源文件句柄，不终止会导致清空/删除后文件仍被占用 */
async function cancelThumbnailGeneration(): Promise<void> {
  if (!thumbnailGenerating.value) {
    return;
  }
  thumbGenId++; // 使进行中的结果失效
  thumbnailGenerating.value = false;
  try {
    await window.electronAPI.cancelOperation();
    // taskkill 异步生效，稍候片刻确保 ffmpeg 退出并释放文件句柄
    await new Promise((resolve) => setTimeout(resolve, 300));
  } catch (_e) {
    /* ignore */
  }
}

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

const hasNext = computed((): boolean => {
  return currentIndex.value < files.value.length - 1;
});

const hasPrev = computed((): boolean => {
  return currentIndex.value > 0;
});

const canNext = computed((): boolean => {
  if (files.value.length <= 1) {
    return hasNext.value;
  }
  if (playMode.value === 'repeat-all' || playMode.value === 'shuffle') {
    return true;
  }
  return hasNext.value;
});

const canPrev = computed((): boolean => {
  if (files.value.length <= 1) {
    return hasPrev.value;
  }
  if (playMode.value === 'repeat-all') {
    return true;
  }
  return hasPrev.value;
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
    await addFilesAndLoadMeta(pd.filePaths);
    // Restore last index (clamp to valid range) — no autoplay
    if (pd.lastIndex >= 0 && pd.lastIndex < files.value.length) {
      currentIndex.value = pd.lastIndex;
    }
  }

  window.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', flushSave);
});

// Auto-save playlist, index, autoDecrypt, playMode on changes
watch(
  [() => files.value.map((e) => e.path), currentIndex, autoDecrypt, playMode],
  () => {
    scheduleSave();
  },
  { deep: true }
);

// Reactively toggle Plyr auto-hide when user changes the switch
watch(autoHideControls, (val): void => {
  if (!player.value) {
    return;
  }
  player.value.toggleControls(!val);
});

// ---- File Management ----
async function addFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    if (files.value.some((f) => f.path === p)) {
      continue;
    }
    files.value.push({
      path: p,
      isEncrypted: p.toLowerCase().endsWith('.enc'),
      meta: null,
      tempPath: null
    });
  }
}

async function addFilesAndLoadMeta(paths: string[]): Promise<void> {
  await addFiles(paths);
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
    destroyPlayer();
    releaseVideoSource();
    await cancelThumbnailGeneration();
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
}

async function openTempDir(): Promise<void> {
  if (tempDir.value) {
    await window.electronAPI.openFolder(tempDir.value);
  }
}

async function clearList(): Promise<void> {
  destroyPlayer();
  // 先释放 video 元素持有的文件句柄，再删除临时文件，否则 Windows 下删除会因占用失败
  releaseVideoSource();
  await cancelThumbnailGeneration();
  currentIndex.value = -1;
  await nextTick();
  await cleanupAllTemps();
  files.value = [];
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
  await addFilesAndLoadMeta(scanned);
}

/** Re-scan the last remembered folder */
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
  destroyPlayer();
  releaseVideoSource();
  await cancelThumbnailGeneration();
  currentIndex.value = -1;
  await nextTick();
  await cleanupAllTemps();
  files.value = [];
  await addFilesAndLoadMeta(scanned);
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
async function playFile(index: number): Promise<void> {
  errorMsg.value = '';
  clearLoop();
  // 切换前释放上一个 video 元素的文件句柄（playerKey 重建元素不会自动释放）
  destroyPlayer();
  releaseVideoSource();
  // 终止上一个文件的缩略图生成：释放其文件句柄，同时避免新任务因 thumbnail 锁冲突失败
  await cancelThumbnailGeneration();
  playerKey.value++;
  currentIndex.value = index;
  const file = files.value[index];
  if (!file) {
    return;
  }

  if (file.isEncrypted) {
    if (file.tempPath) {
      await nextTick();
      initAndPlay();
      void generateThumbnailsIfNeeded();
    } else if (autoDecrypt.value) {
      await decryptAndPlay(file, DEFAULT_ENCRYPT_KEY);
    } else {
      decryptingFile.value = file;
      passwordInput.value = '';
      passwordError.value = '';
      showPasswordModal.value = true;
    }
  } else {
    if (!file.meta) {
      await loadMeta(file);
    }
    await nextTick();
    initAndPlay();
    void generateThumbnailsIfNeeded();
  }
}

function playNext(): void {
  if (playMode.value === 'shuffle') {
    const idx = pickShuffleIndex();
    if (idx >= 0) {
      playFile(idx);
    }
    return;
  }
  if (hasNext.value) {
    playFile(currentIndex.value + 1);
  } else if (playMode.value === 'repeat-all' && files.value.length > 0) {
    playFile(0);
  }
}

function playPrev(): void {
  if (hasPrev.value) {
    playFile(currentIndex.value - 1);
  } else if (playMode.value === 'repeat-all' && files.value.length > 0) {
    playFile(files.value.length - 1);
  }
}

function pickShuffleIndex(): number {
  const n = files.value.length;
  if (n <= 1) {
    return n === 1 ? 0 : -1;
  }
  let idx = currentIndex.value;
  while (idx === currentIndex.value) {
    idx = Math.floor(Math.random() * n);
  }
  return idx;
}

function handleEnded(): void {
  if (playMode.value === 'repeat-one') {
    if (player.value) {
      player.value.currentTime = 0;
      void player.value.play();
    }
    return;
  }
  if (playMode.value === 'shuffle') {
    const idx = pickShuffleIndex();
    if (idx >= 0) {
      playFile(idx);
    }
    return;
  }
  if (hasNext.value) {
    playFile(currentIndex.value + 1);
  } else if (playMode.value === 'repeat-all' && files.value.length > 0) {
    playFile(0);
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

// ---- Plyr ----
function destroyPlayer(): void {
  if (player.value) {
    try {
      player.value.destroy();
    } catch (_e) {
      /* ignore */
    }
    player.value = null;
  }
  isPlaying.value = false;
}

/** 显式释放 video 元素资源（文件句柄 + 解码线程），避免 file:/// 延迟释放导致文件被线程占用无法删除 */
function releaseVideoSource(): void {
  const el = videoPlayer.value;
  if (!el) {
    return;
  }
  try {
    el.pause();
    el.removeAttribute('src');
    el.load();
  } catch (_e) {
    /* ignore */
  }
}

function initAndPlay(): void {
  const el = videoPlayer.value;
  if (!el || !videoSrc.value) {
    return;
  }

  destroyPlayer();

  player.value = new Plyr(el, {
    controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'settings', 'fullscreen'],
    settings: ['speed'],
    speed: { selected: currentSpeed.value, options: speedOptions },
    tooltips: { controls: true, seek: true },
    keyboard: { focused: true, global: true },
    fullscreen: { enabled: true, fallback: true },
    hideControls: autoHideControls.value,
    resetOnEnd: false,
    previewThumbnails: thumbnailData.value
      ? { enabled: true, src: thumbnailData.value.vttUrl }
      : { enabled: false, src: '' }
  });

  currentPlayingPath.value = currentFile.value?.path || '';

  // Manually render markers (Plyr only reads them at init — we handle updates ourselves)
  renderMarkers();

  player.value.on('ratechange', (): void => {
    if (player.value) {
      currentSpeed.value = player.value.speed;
    }
  });

  // Keep controls visible when auto-hide is disabled (single registration point)
  if (!autoHideControls.value) {
    player.value.on('controlshidden', (): void => {
      if (!autoHideControls.value && player.value) {
        player.value.toggleControls(true);
      }
    });
  }

  player.value.on('play', (): void => {
    isPlaying.value = true;
  });

  player.value.on('pause', (): void => {
    isPlaying.value = false;
    scheduleSave();
  });

  // A-B loop enforcement
  player.value.on('timeupdate', (): void => {
    if (loopStart.value !== null && loopEnd.value !== null && player.value) {
      if (player.value.currentTime >= loopEnd.value) {
        player.value.currentTime = loopStart.value;
      }
    }
  });

  player.value.on('ended', (): void => {
    isPlaying.value = false;
    flushSave();
    handleEnded();
  });

  player.value.on('error', (): void => {
    isPlaying.value = false;
    errorMsg.value = '视频加载失败';
  });

  // Resume per-file playback position (once, on first canplay)
  const savedTime = settingsStore.playerData.playbackTimes[currentFile.value?.path || ''] || 0;
  let didResume = false;
  player.value.on('canplay', (): void => {
    if (didResume) {
      return;
    }
    didResume = true;
    if (savedTime > 1 && player.value && player.value.currentTime < 1) {
      player.value.currentTime = savedTime;
    }
  });

  try {
    player.value.play();
  } catch (_e) {
    /* ignore autoplay restrictions */
  }
}

// ---- Encryption Decrypt for Playback ----
async function decryptAndPlay(file: PlayerEntry, password: string): Promise<void> {
  if (decrypting) {
    return;
  }
  decrypting = true;

  try {
    if (file.tempPath) {
      await cleanupTemp(file.tempPath);
      file.tempPath = null;
    }

    await tempDirReady;
    if (!tempDir.value) {
      errorMsg.value = '无法获取临时目录，解密失败';
      return;
    }

    const tempPath = await window.electronAPI.decryptForPlayback(file.path, password, tempDir.value);

    if (files.value[currentIndex.value]?.path !== file.path) {
      await cleanupTemp(tempPath);
      return;
    }

    file.tempPath = tempPath;

    await loadMeta(file);
    await nextTick();
    initAndPlay();
    void generateThumbnailsIfNeeded();
  } finally {
    decrypting = false;
  }
}

async function confirmDecrypt(): Promise<void> {
  if (!decryptingFile.value) {
    return;
  }
  if (passwordInput.value.length < 4) {
    passwordError.value = '密码至少需要4个字符';
    return;
  }

  passwordError.value = '';
  const file = decryptingFile.value;
  const pwd = passwordInput.value;

  showPasswordModal.value = false;
  passwordInput.value = '';
  decryptingFile.value = null;

  await decryptAndPlay(file, pwd);
}

function cancelDecrypt(): void {
  showPasswordModal.value = false;
  passwordInput.value = '';
  passwordError.value = '';
  decryptingFile.value = null;
}

// ---- Temp Cleanup ----
async function cleanupTemp(tempPath: string): Promise<void> {
  await window.electronAPI.deleteFile(tempPath);
}

async function cleanupAllTemps(): Promise<void> {
  for (const entry of files.value) {
    if (entry.tempPath) {
      await cleanupTemp(entry.tempPath);
      entry.tempPath = null;
    }
  }
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
            <div
              v-if="videoSrc"
              class="player-toolbar flex flex-wrap items-center gap-1 px-3 py-2 border-t border-bg-tertiary/60"
            >
              <!-- Previous -->
              <button
                @click="playPrev"
                :disabled="!canPrev"
                class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-text-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                title="上一首 (P)"
              >
                <SkipBack :size="13" />
              </button>

              <!-- Next -->
              <button
                @click="playNext"
                :disabled="!canNext"
                class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-text-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                title="下一首 (N)"
              >
                <SkipForward :size="13" />
              </button>

              <!-- Play mode -->
              <button
                @click="cyclePlayMode"
                :class="
                  playMode !== 'sequential'
                    ? 'text-accent-blue bg-accent-blue/10'
                    : 'text-text-muted hover:text-text-secondary'
                "
                class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
                :title="'播放模式：' + playModeLabel + ' (L)'"
              >
                <component :is="playModeIcon" :size="13" />
                <span class="hidden sm:inline">{{ playModeLabel }}</span>
              </button>

              <span class="w-px h-4 bg-bg-tertiary" />

              <!-- Controls Overlay Toggle -->
              <button
                @click="toggleControlsOverlay"
                :class="
                  showControlsOverlay
                    ? 'text-accent-blue bg-accent-blue/10'
                    : 'text-text-muted hover:text-text-secondary'
                "
                class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
                :title="showControlsOverlay ? '隐藏控件栏' : '显示控件栏'"
              >
                <Eye v-if="!showControlsOverlay" :size="13" />
                <EyeOff v-else :size="13" />
                <span class="hidden sm:inline">控件栏</span>
              </button>

              <span class="w-px h-4 bg-bg-tertiary" />

              <!-- Add Marker -->
              <button
                @click="addCurrentMarker"
                class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-accent-purple hover:bg-accent-purple/10"
                title="在当前播放位置添加标记"
              >
                <Bookmark :size="13" />
                <span class="hidden sm:inline">标记</span>
              </button>

              <!-- Clear All Markers -->
              <button
                v-if="screenshotMarkers.length > 0"
                @click="clearAllMarkers"
                class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-danger hover:bg-danger/10"
                title="清除全部标记（右键单个标记可单独删除）"
              >
                <X :size="13" />
                <span class="hidden sm:inline">清除 ({{ screenshotMarkers.length }})</span>
              </button>

              <span class="w-px h-4 bg-bg-tertiary" />

              <!-- A-B Loop -->
              <button
                @click="setLoopA"
                :class="
                  loopStart !== null
                    ? 'text-accent-blue bg-accent-blue/10'
                    : 'text-text-muted hover:text-text-secondary'
                "
                class="px-1.5 py-1 rounded text-xs font-mono font-semibold transition-colors"
                :title="loopStart !== null ? 'A 点：' + secondsToHMS(loopStart) : '设置循环起点 A'"
              >
                A
              </button>
              <button
                @click="setLoopB"
                :disabled="loopStart === null"
                :class="
                  loopEnd !== null ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-secondary'
                "
                class="px-1.5 py-1 rounded text-xs font-mono font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                :title="loopEnd !== null ? 'B 点：' + secondsToHMS(loopEnd) : '设置循环终点 B'"
              >
                B
              </button>
              <button
                v-if="loopStart !== null || loopEnd !== null"
                @click="clearLoop"
                class="flex items-center px-1.5 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-danger hover:bg-danger/10"
                title="清除 A-B 循环"
              >
                <X :size="13" />
              </button>

              <span class="w-px h-4 bg-bg-tertiary" />

              <!-- Frame step -->
              <button
                @click="stepBackward"
                class="flex items-center px-1.5 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-text-secondary"
                title="上一帧 (,)"
              >
                <StepBack :size="13" />
              </button>
              <button
                @click="stepForward"
                class="flex items-center px-1.5 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-text-secondary"
                title="下一帧 (.)"
              >
                <StepForward :size="13" />
              </button>

              <!-- Picture in Picture -->
              <button
                @click="togglePip"
                class="flex items-center px-1.5 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-text-secondary"
                title="画中画 (I)"
              >
                <PictureInPicture :size="13" />
              </button>

              <span class="w-px h-4 bg-bg-tertiary ml-auto" />

              <!-- Speed Quick Selector -->
              <div class="flex items-center gap-0.5">
                <Gauge :size="12" class="text-text-muted mr-1" />
                <button
                  v-for="s in speedOptions"
                  :key="s"
                  @click="setSpeed(s)"
                  :class="
                    currentSpeed === s
                      ? 'text-accent-blue bg-accent-blue/10 border-accent-blue/30'
                      : 'text-text-muted border-transparent hover:text-text-secondary'
                  "
                  class="px-1.5 py-0.5 rounded text-xs font-mono font-medium transition-all border"
                >
                  {{ s }}×
                </button>
              </div>

              <span class="w-px h-4 bg-bg-tertiary" />

              <!-- Auto-Hide Controls Toggle -->
              <button
                @click="toggleAutoHide"
                :class="autoHideControls ? 'text-text-muted' : 'text-accent-blue bg-accent-blue/10'"
                class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors hover:bg-bg-tertiary/40"
                :title="autoHideControls ? '自动隐藏控件：开' : '自动隐藏控件：关'"
              >
                <span>{{ autoHideControls ? '自动隐藏：开' : '自动隐藏：关' }}</span>
              </button>
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

    <!-- Screenshot Modal -->
    <Teleport to="body">
      <div
        v-if="showScreenshotModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="closeScreenshotModal"
      >
        <div class="glass-card w-full max-w-md mx-4" @click.stop>
          <h3 class="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Camera :size="18" class="text-accent-purple" />
            视频截图
            <span class="text-xs text-text-muted ml-auto">{{ currentFileName }}</span>
          </h3>

          <!-- Mode Tabs -->
          <div class="flex border-b border-bg-tertiary mb-4">
            <button
              v-for="mode in ['current', 'custom', 'batch'] as const"
              :key="mode"
              @click="screenshotMode = mode"
              class="flex-1 pb-2 text-xs font-medium border-b-2 transition-colors"
              :class="
                screenshotMode === mode
                  ? 'border-accent-purple text-accent-purple'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              "
            >
              {{ mode === 'current' ? '当前画面' : mode === 'custom' ? '指定时间' : '批量截图' }}
            </button>
          </div>

          <!-- Current Frame -->
          <div v-if="screenshotMode === 'current'" class="space-y-3">
            <div class="flex items-center gap-3 p-3 rounded-lg bg-bg-tertiary/40">
              <Image :size="32" class="text-text-muted" />
              <div>
                <p class="text-sm text-text-primary">截取当前播放画面</p>
                <p class="text-xs text-text-muted">时间点：{{ secondsToHMS(player?.currentTime || 0) }}</p>
              </div>
            </div>
            <button
              @click="captureCurrentFrame"
              :disabled="capturing"
              class="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-accent-purple to-pink-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Loader v-if="capturing" :size="14" class="animate-spin" />
              <Camera v-else :size="14" />
              {{ capturing ? '截图中...' : '截取当前画面' }}
            </button>
          </div>

          <!-- Custom Time -->
          <div v-if="screenshotMode === 'custom'" class="space-y-3">
            <div>
              <label class="text-xs text-text-secondary mb-1 block">截图时间点</label>
              <input
                v-model="screenshotTimeInput"
                type="text"
                placeholder="秒数，如 30 或 1:30"
                class="input-base w-full"
                :disabled="capturing"
                @keyup.enter="captureByTime"
              />
              <p class="text-xs text-text-muted mt-1">支持格式：秒数（30）、分:秒（1:30）、时:分:秒（0:01:30）</p>
            </div>
            <button
              @click="captureByTime"
              :disabled="!screenshotTimeInput || capturing"
              class="w-full px-4 py-2.5 rounded-lg bg-accent-purple text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Loader v-if="capturing" :size="14" class="animate-spin" />
              截图
            </button>
          </div>

          <!-- Batch -->
          <div v-if="screenshotMode === 'batch'" class="space-y-3">
            <div v-if="!capturing">
              <label class="text-xs text-text-secondary mb-1 block">截图间隔（秒）</label>
              <input v-model.number="batchInterval" type="number" min="1" step="1" class="input-base w-full" />
              <p class="text-xs text-text-muted mt-1">
                预计 {{ Math.floor((currentFile?.meta?.duration || 0) / (batchInterval || 1)) }} 帧， 每
                {{ batchInterval }} 秒一帧
              </p>
            </div>

            <!-- Progress bar (batch only) -->
            <div v-if="capturing" class="space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-text-secondary">批量截图进度</span>
                <span class="text-text-primary font-mono">
                  {{ captureProgress.current }} / {{ captureProgress.total }}
                </span>
              </div>
              <div class="w-full h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                <div
                  class="h-full rounded-full bg-gradient-to-r from-accent-purple to-pink-500 transition-all duration-300"
                  :style="{
                    width:
                      (captureProgress.total > 0 ? (captureProgress.current / captureProgress.total) * 100 : 0) + '%'
                  }"
                />
              </div>
            </div>

            <button
              @click="batchCapture"
              :disabled="capturing || !batchInterval || batchInterval < 1"
              class="w-full px-4 py-2.5 rounded-lg bg-accent-purple text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Loader v-if="capturing" :size="14" class="animate-spin" />
              {{ capturing ? '批量截图中...' : '开始批量截图' }}
            </button>
          </div>

          <!-- Output hint -->
          <p class="text-xs text-text-muted mt-4 pt-3 border-t border-bg-tertiary">保存位置：视频文件同目录</p>
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
@use './_player';
</style>
