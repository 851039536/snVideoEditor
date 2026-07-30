<!-- 视频下载页面：m3u8 解析、网页提取、清晰度选择与下载队列管理 -->
<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  Globe,
  Download,
  Folder,
  FolderOpen,
  Monitor,
  X,
  Search,
  Link,
  AlertTriangle,
  MonitorPlay,
  Check,
  ExternalLink
} from 'lucide-vue-next';
import ProgressPanel from '@/components/ProgressPanel.vue';
import DownloadQueue from '@/views/Download/DownloadQueue.vue';
import WebPagePanel from '@/views/Download/WebPagePanel.vue';
import { useProgressStore } from '@/stores/progress';
import { todayDateStr, sanitizeFileName } from '@/utils/format';
import { buildCookieHeader } from '@/utils/cookies';
import { isValidUrl } from '@/utils/url';
import type { QualityVariant, RawCookie, QueueStatus } from '@/types/file';

const progressStore = useProgressStore();

// ─── URL input ───────────────────────────────────────────────────────────────

const m3u8Url = ref('');
const errorMsg = ref('');
const hintMsg = ref('');

// ─── Page fetch ──────────────────────────────────────────────────────────────

const isFetching = ref(false);
const fetchedUrls = ref<string[]>([]);
const fetchedTitle = ref('');
const showFetchedUrls = ref(false);

/** Raw cookies extracted from browser session, keyed by (domain, name). */
const rawCookies = ref<RawCookie[]>([]);

/** Update the Cookie request header based on a target URL. */
function syncCookiesForUrl(url: string): void {
  const cookieStr = buildCookieHeader(url, rawCookies.value);
  if (cookieStr) {
    headers['Cookie'] = cookieStr;
  } else {
    delete headers['Cookie'];
  }
}

// ─── Quality (m3u8 variants) ─────────────────────────────────────────────────

const variants = ref<QualityVariant[]>([]);
const selectedVariantIndex = ref(-1); // -1 = use original URL (direct download)
const isFetchingVariants = ref(false);
const showQualitySelector = ref(false);
let fetchVariantsVersion = 0; // 防止竞态条件：每次新请求递增，旧请求结果被丢弃

/** The actual URL to download — could be a variant URL or the original */
const effectiveUrl = computed((): string => {
  if (variants.value.length > 0 && selectedVariantIndex.value >= 0) {
    return variants.value[selectedVariantIndex.value].url;
  }
  return m3u8Url.value.trim();
});

/** Auto-select 480p variant */
function autoSelect480p(variantList: QualityVariant[]): void {
  if (variantList.length === 0) {
    selectedVariantIndex.value = -1;
    return;
  }
  // Exact 480p match
  const idx480 = variantList.findIndex((v) => v.height === 480);
  if (idx480 >= 0) {
    selectedVariantIndex.value = idx480;
    return;
  }
  // Closest to 480p (prefer slightly lower)
  let bestIdx = 0;
  let bestDiff = Math.abs(variantList[0].height - 480);
  for (let i = 1; i < variantList.length; i++) {
    const diff = Math.abs(variantList[i].height - 480);
    if (diff < bestDiff || (diff === bestDiff && variantList[i].height < variantList[bestIdx].height)) {
      bestIdx = i;
      bestDiff = diff;
    }
  }
  selectedVariantIndex.value = bestIdx;
}

/** Fetch quality variants for the current m3u8 URL */
async function fetchQualityVariants(): Promise<void> {
  const url = m3u8Url.value.trim();
  if (!isValidUrl(url)) {
    return;
  }

  const version = ++fetchVariantsVersion;
  isFetchingVariants.value = true;
  try {
    const result = await window.electronAPI.fetchM3u8Variants(url, { ...headers });
    // 竞态保护：如果 URL 已变化（新版本号已递增），丢弃过时结果
    if (version !== fetchVariantsVersion) {
      return;
    }
    variants.value = result;
    if (result.length > 0) {
      autoSelect480p(result);
      showQualitySelector.value = true;
    } else {
      selectedVariantIndex.value = -1;
      showQualitySelector.value = false;
    }
  } catch {
    if (version !== fetchVariantsVersion) {
      return;
    }
    variants.value = [];
    selectedVariantIndex.value = -1;
    showQualitySelector.value = false;
  } finally {
    if (version === fetchVariantsVersion) {
      isFetchingVariants.value = false;
    }
  }
}

// ─── Headers (auto-managed, not shown in UI) ──────────────────────────────────

const headers = reactive<Record<string, string>>({
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
});

// ─── Output ──────────────────────────────────────────────────────────────────

const commonPaths = ref<{ desktop: string; downloads: string }>({ desktop: '', downloads: '' });
const outputDir = ref('');
const fileName = ref('');
// True once the user manually edits the filename, to avoid the URL watcher
// overwriting their input on subsequent URL changes.
const fileNameEdited = ref(false);
const loadingPath = ref('');
const historyJsonPath = ref('');

async function openHistoryFolder(): Promise<void> {
  if (!historyJsonPath.value) {
    return;
  }
  const dir = historyJsonPath.value.replace(/[/\\][^/\\]+$/, '');
  await window.electronAPI.openFolder(dir);
}

async function fetchCommonPaths(): Promise<void> {
  try {
    commonPaths.value = await window.electronAPI.getCommonPaths();
  } catch (_e) {
    /* leave defaults */
  }
}

async function selectQuickDir(type: 'desktop' | 'downloads'): Promise<void> {
  loadingPath.value = type;
  try {
    if (!commonPaths.value[type]) {
      await fetchCommonPaths();
    }
    const dir = commonPaths.value[type];
    if (dir) {
      outputDir.value = dir;
    } else {
      errorMsg.value = '无法获取系统路径，请使用自定义目录';
    }
  } finally {
    loadingPath.value = '';
  }
}

async function selectCustomDir(): Promise<void> {
  const dir = await window.electronAPI.selectDirectory();
  if (dir) {
    outputDir.value = dir;
  }
}

const autoFileName = computed((): string => {
  const ts = todayDateStr();
  // Priority 1: use page title if available (from "从网页提取")
  if (fetchedTitle.value) {
    const safe = sanitizeFileName(fetchedTitle.value);
    return `${safe || 'video'}_${ts}.mp4`;
  }
  // Priority 2: derive from URL path
  try {
    const urlPath = new URL(m3u8Url.value).pathname;
    const segments = urlPath.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || 'video';
    const name = last.replace(/\.(m3u8|ts|mp4|mkv|webm|avi)$/i, '');
    return `${name}_${ts}.mp4`;
  } catch {
    return `download_${ts}.mp4`;
  }
});

// 清晰度探测防抖定时器
let variantFetchTimer: ReturnType<typeof setTimeout> | null = null;

// Auto-detect quality + auto-fill filename when m3u8 URL changes
watch(m3u8Url, (url) => {
  // 手动输入的新地址与提取结果无关时，清除旧页面标题，避免污染自动文件名
  if (url && !fetchedUrls.value.includes(url)) {
    fetchedTitle.value = '';
  }
  // Only auto-fill when the user hasn't manually edited the filename
  if (!fileNameEdited.value) {
    fileName.value = autoFileName.value;
  }
  // Sync cookies for the new URL domain (if we have raw cookies from page fetch)
  syncCookiesForUrl(url);
  if (url && isValidUrl(url) && url.includes('.m3u8')) {
    if (variantFetchTimer) { clearTimeout(variantFetchTimer); }
    variantFetchTimer = setTimeout(() => { fetchQualityVariants(); }, 400);
  } else {
    showQualitySelector.value = false;
    variants.value = [];
    selectedVariantIndex.value = -1;
  }
});

// Keep Cookie header in sync when effective URL changes (e.g. quality variant selection)
watch(effectiveUrl, (url) => {
  syncCookiesForUrl(url);
});

const outputPath = computed((): string => {
  if (!outputDir.value || !fileName.value) {
    return '';
  }
  return outputDir.value.replace(/\\/g, '/') + '/' + fileName.value;
});

// ─── Validation ──────────────────────────────────────────────────────────────

const canStart = computed((): boolean => {
  return effectiveUrl.value.length > 0 && outputDir.value.length > 0 && fileName.value.trim().length > 0;
});

// Whether the queue has any active items (pending, downloading, or paused)
const hasActiveQueue = computed((): boolean => {
  return progressStore.queueItems.some(
    (i) => i.status === 'pending' || i.status === 'downloading' || i.status === 'merging' || i.status === 'paused'
  );
});

const downloadingCount = computed((): number => {
  return progressStore.queueItems.filter((i) => i.status === 'downloading' || i.status === 'merging').length;
});

function setConcurrency(n: number): void {
  progressStore.queueConcurrency = n;
  window.electronAPI.setDownloadConcurrency(n);
}

const isInputUrlValid = computed(() => isValidUrl(m3u8Url.value));

function looksLikeWebPage(url: string): boolean {
  if (!url) {
    return false;
  }
  const lower = url.toLowerCase();
  // Definitely a streaming URL, not a webpage
  if (lower.includes('.m3u8') || lower.includes('.ts') || lower.includes('/hls/') || lower.includes('/dash/')) {
    return false;
  }
  // Known video platforms that serve HTML pages
  const videoHosts = [
    'vimeo.com',
    'dailymotion.com',
    'bilibili.com',
    'youtube.com',
    'youku.com',
    'iqiyi.com',
    'netflix.com'
  ];
  if (videoHosts.some((h) => lower.includes(h))) {
    return true;
  }
  // Common webpage extensions
  if (lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.php')) {
    return true;
  }
  // Generic heuristic: if no media extension, treat as webpage
  return !/\.(mp4|mkv|webm|avi|mov|flv|wmv|m4v|3gp)(\?|$)/i.test(lower);
}

// ─── Fetch m3u8 from page ────────────────────────────────────────────────────

async function fetchM3u8FromPage(): Promise<void> {
  errorMsg.value = '';
  hintMsg.value = '';
  const pageUrl = m3u8Url.value.trim();

  if (!isValidUrl(pageUrl)) {
    errorMsg.value = '请输入有效的网页 URL 地址';
    return;
  }

  isFetching.value = true;
  try {
    const result = await window.electronAPI.fetchPageM3u8(pageUrl);
    fetchedTitle.value = result.pageTitle;
    fetchedUrls.value = result.m3u8Urls;

    if (result.m3u8Urls.length === 0) {
      hintMsg.value = `未能从页面 "${result.pageTitle}" 中提取到 m3u8 地址。请尝试直接在浏览器中打开页面，按 F12 → Network → 筛选 m3u8 查找真实播放地址。`;
      showFetchedUrls.value = false;
    } else {
      showFetchedUrls.value = true;
      // Store raw cookies for later domain-filtered use
      rawCookies.value = result.cookies || [];
      // Auto-fill Referer/Origin from page URL
      try {
        const parsed = new URL(pageUrl);
        headers['Referer'] = `${parsed.protocol}//${parsed.hostname}/`;
        headers['Origin'] = `${parsed.protocol}//${parsed.hostname}`;
      } catch {
        /* ignore */
      }
      // Don't auto-fill Cookie yet — wait for user to select a specific m3u8 URL
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
    showFetchedUrls.value = false;
  } finally {
    isFetching.value = false;
  }
}

/** When user selects an m3u8 URL from fetched list, the watch on m3u8Url will auto-fetch variants */
async function selectFetchedUrl(url: string): Promise<void> {
  // Allow the watcher to re-derive the filename from the freshly fetched title/URL
  fileNameEdited.value = false;
  m3u8Url.value = url;
  showFetchedUrls.value = false;
  hintMsg.value = '';
  // Cookie sync is handled by the watch on m3u8Url triggered above
}

/** 网页路径面板选用链接：回填主输入框并接管其页面上下文（Cookie/Referer/标题） */
function handleUseLink(payload: {
  url: string;
  pageUrl: string;
  pageTitle: string;
  cookies: RawCookie[];
}): void {
  rawCookies.value = payload.cookies;
  fetchedTitle.value = payload.pageTitle;
  fetchedUrls.value = [payload.url]; // 使 m3u8Url watch 不清空 fetchedTitle
  // Referer/Origin 取自该链接的来源页面（与 fetchM3u8FromPage 一致）
  try {
    const parsed = new URL(payload.pageUrl);
    headers['Referer'] = `${parsed.protocol}//${parsed.hostname}/`;
    headers['Origin'] = `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    /* ignore */
  }
  fileNameEdited.value = false;
  m3u8Url.value = payload.url; // 触发既有 watch：Cookie 同步 + 清晰度探测 + 自动文件名
}

// ─── Download Queue ──────────────────────────────────────────────────────────

const justEnqueued = ref(false);
let justEnqueuedTimer: ReturnType<typeof setTimeout> | null = null;
const isEnqueueing = ref(false); // 幂等保护：防止快速双击重复入队

async function enqueueDownload(): Promise<void> {
  if (isEnqueueing.value) {
    return;
  }
  errorMsg.value = '';
  hintMsg.value = '';

  const url = effectiveUrl.value;

  if (!isValidUrl(url)) {
    errorMsg.value = '请输入有效的 URL 地址';
    return;
  }
  if (!outputPath.value) {
    errorMsg.value = '请选择输出目录并输入文件名';
    return;
  }
  // Only set hint after all early-return checks, so it won't be cleared by next call
  if (looksLikeWebPage(url)) {
    hintMsg.value = '⚠ 当前输入看起来像网页地址而非 m3u8 流地址，建议先点击"从网页提取"获取真实播放链接。';
  }

  isEnqueueing.value = true;
  try {
    // Check for duplicate filename in download history
    const dup = await window.electronAPI.checkDownloadDuplicate(fileName.value);
    if (dup) {
      const confirmed = await window.electronAPI.confirmDialog(
        `文件名 "${fileName.value}" 已下载过（上次: ${new Date(dup.completedAt).toLocaleString()}），是否重复下载？`,
        '重复下载确认'
      );
      if (!confirmed) {
        hintMsg.value = '已取消重复下载';
        return;
      }
    }

    await window.electronAPI.enqueueDownload({
      url,
      output: outputPath.value,
      headers: { ...headers },
      fileName: fileName.value
    });
    justEnqueued.value = true;
    if (justEnqueuedTimer) {
      clearTimeout(justEnqueuedTimer);
    }
    justEnqueuedTimer = setTimeout(() => {
      justEnqueued.value = false;
    }, 1800);
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    isEnqueueing.value = false;
  }
}

async function cancelAllDownloads(): Promise<void> {
  await window.electronAPI.cancelDownloadQueue();
}

async function handleQueueRetry(id: string): Promise<void> {
  await window.electronAPI.retryQueueItem(id);
}

async function handleQueueRemove(id: string): Promise<void> {
  await window.electronAPI.removeQueueItem(id);
}

async function handleQueueCancel(id: string): Promise<void> {
  const ok = await window.electronAPI.cancelQueueItem(id);
  if (!ok) {
    // 点击与 IPC 之间项已转为终态，重新同步状态
    try {
      const status = await window.electronAPI.getQueueStatus();
      applyQueueStatus(status);
    } catch {
      /* ignore */
    }
  }
}

async function handleQueuePause(id: string): Promise<void> {
  await window.electronAPI.pauseQueueItem(id);
}

async function handleQueueResume(id: string): Promise<void> {
  await window.electronAPI.resumeQueueItem(id);
}

async function handleClearTerminal(): Promise<void> {
  await window.electronAPI.clearQueueTerminal();
}

/** 将后端队列状态同步到 progressStore */
function applyQueueStatus(status: QueueStatus): void {
  progressStore.updateQueueItems(status.items);
  progressStore.queueActiveIds = status.activeIds;
  progressStore.queueIsProcessing = status.isProcessing;
  progressStore.queueConcurrency = status.concurrency;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

onMounted(async () => {
  fetchCommonPaths();

  // Fetch download history JSON path
  try {
    historyJsonPath.value = await window.electronAPI.getDownloadHistoryPath();
  } catch {
    /* ignore */
  }

  // Register listeners BEFORE the initial status fetch so no backend update
  // arriving during the await gap is lost.
  window.electronAPI.onQueueUpdate((status) => {
    applyQueueStatus(status);
  });

  // Listen to download progress for the active queue item
  window.electronAPI.onQueueProgress((data) => {
    progressStore.updateQueueItemProgress(data.queueId, {
      percent: data.percent,
      speed: data.speed,
      eta: data.eta
    });
  });

  // 拉取初始队列状态（导航前可能已有任务）
  try {
    const status = await window.electronAPI.getQueueStatus();
    applyQueueStatus(status);
  } catch {
    /* backend may not be ready yet */
  }
});

onUnmounted(() => {
  if (justEnqueuedTimer) {
    clearTimeout(justEnqueuedTimer);
  }
  if (variantFetchTimer) {
    clearTimeout(variantFetchTimer);
  }
  window.electronAPI?.removeQueueListeners();
});
</script>

<template>
  <div class="page-container">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div
          class="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center"
        >
          <Globe :size="20" class="text-accent-blue" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频下载</h1>
      </div>
      <p class="text-text-secondary text-sm">输入 m3u8 播放地址下载视频，或从网页中自动提取 m3u8 链接</p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Left: URL & Headers -->
      <div class="space-y-3">
        <!-- URL Input -->
        <div class="glass-card p-4">
          <label class="text-sm font-semibold text-text-primary mb-2 block">m3u8 播放地址 / 网页 URL</label>
          <div class="flex gap-2">
            <div class="relative flex-1">
              <Globe :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                v-model="m3u8Url"
                type="url"
                placeholder="https://example.com/video/index.m3u8  或  网页地址"
                class="input-base w-full pl-9 pr-4"
                :class="{ 'border-danger': errorMsg && !isInputUrlValid }"
              />
            </div>
            <button
              @click="fetchM3u8FromPage"
              :disabled="!isInputUrlValid || isFetching"
              class="btn-secondary !px-3 !py-2 text-sm flex items-center gap-1.5 flex-shrink-0"
            >
              <Search v-if="!isFetching" :size="14" />
              <span v-if="isFetching">提取中...</span>
              <span v-else>从网页提取</span>
            </button>
          </div>
          <p class="text-xs text-text-muted mt-2">
            支持标准 HLS / m3u8 流媒体地址。对于视频网站，可输入网页地址后点击"从网页提取"自动获取真实链接。
          </p>

          <!-- Fetched URLs -->
          <div
            v-if="showFetchedUrls && fetchedUrls.length > 0"
            class="mt-3 p-3 rounded-lg bg-accent-blue/10 border border-accent-blue/30"
          >
            <div class="flex items-center gap-1.5 mb-2">
              <Link :size="14" class="text-accent-blue" />
              <span class="text-sm font-semibold text-accent-blue">已提取 {{ fetchedUrls.length }} 个 m3u8 地址</span>
              <span class="text-xs text-text-muted ml-1">（来自: {{ fetchedTitle }}）</span>
            </div>
            <div class="space-y-1.5 max-h-52 overflow-y-auto">
              <div
                v-for="(url, idx) in fetchedUrls"
                :key="idx"
                @click="selectFetchedUrl(url)"
                class="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-accent-blue/20 transition-colors group"
              >
                <span class="text-xs text-text-muted w-5 flex-shrink-0">{{ idx + 1 }}</span>
                <code class="text-xs text-text-primary flex-1 break-all font-mono">{{ url }}</code>
                <button class="btn-secondary !px-2 !py-0.5 text-xs opacity-0 group-hover:opacity-100 flex-shrink-0">
                  使用
                </button>
              </div>
            </div>
          </div>

          <!-- Quality Selector -->
          <div
            v-if="showQualitySelector && variants.length > 0"
            class="mt-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30"
          >
            <div class="flex items-center gap-1.5 mb-2">
              <MonitorPlay :size="14" class="text-green-400" />
              <span class="text-sm font-semibold text-green-400">清晰度 ({{ variants.length }} 个可选)</span>
              <span class="text-xs text-text-muted ml-auto">默认 480p</span>
            </div>
            <div class="flex gap-1.5 flex-wrap">
              <button
                v-for="(v, idx) in variants"
                :key="idx"
                @click="selectedVariantIndex = idx"
                class="px-2.5 py-1.5 text-xs rounded-md transition-colors"
                :class="
                  selectedVariantIndex === idx
                    ? 'bg-green-500 text-white font-semibold'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-green-500/20'
                "
              >
                {{ v.label }}
              </button>
            </div>
            <p class="text-xs text-text-muted mt-1.5">
              已选: {{ variants[selectedVariantIndex]?.label || '原始质量' }}
            </p>
          </div>
        </div>

        <!-- 网页路径管理面板 -->
        <WebPagePanel :output-dir="outputDir" @use-link="handleUseLink" />
      </div>

      <!-- Right: Output & Controls -->
      <div class="space-y-3">
        <!-- Hint -->
        <div v-if="hintMsg" class="glass-card p-3 border border-yellow-500/30 bg-yellow-500/5">
          <p class="text-xs text-yellow-400 flex items-start gap-1.5">
            <AlertTriangle :size="14" class="flex-shrink-0 mt-0.5" />
            <span>{{ hintMsg }}</span>
          </p>
        </div>

        <!-- Output -->
        <div class="glass-card p-4">
          <h3 class="text-sm font-semibold text-text-primary mb-3">输出设置</h3>
          <div class="flex gap-2 flex-wrap mb-3">
            <button
              @click="selectQuickDir('desktop')"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="loadingPath === 'desktop'"
            >
              <Monitor :size="14" /> {{ loadingPath === 'desktop' ? '加载中...' : '桌面' }}
            </button>
            <button
              @click="selectQuickDir('downloads')"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="loadingPath === 'downloads'"
            >
              <Download :size="14" /> {{ loadingPath === 'downloads' ? '加载中...' : '下载' }}
            </button>
            <button @click="selectCustomDir" class="btn-secondary !px-3 !py-1.5 text-xs">
              <Folder :size="14" /> 自定义
            </button>
          </div>
          <p v-if="outputDir" class="text-xs text-accent-light mb-3 truncate flex items-center gap-1">
            <FolderOpen :size="12" /> {{ outputDir }}
          </p>
          <p v-else class="text-xs text-text-muted mb-3">请选择保存目录</p>

          <div>
            <label class="text-xs text-text-secondary mb-1 block">文件名</label>
            <input
              v-model="fileName"
              @input="fileNameEdited = true"
              type="text"
              :placeholder="autoFileName"
              class="input-base w-full text-sm"
            />
            <p v-if="outputPath" class="text-xs text-text-muted mt-1 truncate">将保存至: {{ outputPath }}</p>
          </div>

          <!-- History JSON path -->
          <div v-if="historyJsonPath" class="mt-3 pt-3 border-t border-bg-tertiary">
            <p class="text-[10px] text-text-muted/70 mb-1">下载历史记录</p>
            <p class="text-xs text-text-muted truncate font-mono" :title="historyJsonPath">{{ historyJsonPath }}</p>
            <button
              @click="openHistoryFolder"
              class="btn-secondary !px-2 !py-0.5 text-xs mt-1.5 flex items-center gap-1"
            >
              <ExternalLink :size="10" /> 打开所在文件夹
            </button>
          </div>
        </div>

        <!-- Concurrency Control -->
        <div class="glass-card p-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-semibold text-text-primary">同时下载数</h3>
              <p class="text-xs text-text-muted mt-0.5">当前 {{ downloadingCount }} 个进行中</p>
            </div>
            <div class="flex items-center gap-1">
              <button
                v-for="n in [1, 2, 3, 4]"
                :key="n"
                @click="setConcurrency(n)"
                class="w-8 h-8 text-xs rounded-md transition-colors font-medium"
                :class="
                  progressStore.queueConcurrency === n
                    ? 'bg-accent-blue text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-accent-blue/20'
                "
              >
                {{ n }}
              </button>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="alert-danger whitespace-pre-line">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- Actions -->
        <div class="space-y-2">
          <!-- Enqueue / Start Download -->
          <button
            @click="enqueueDownload"
            :disabled="!canStart || justEnqueued || isEnqueueing"
            class="btn-primary w-full py-3 text-base transition-all duration-200"
            :class="
              canStart
                ? 'bg-gradient-to-r from-accent-blue to-accent-purple'
                : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
            "
          >
            <template v-if="justEnqueued">
              <Check :size="18" />
              已加入队列
            </template>
            <template v-else-if="hasActiveQueue">
              <Download :size="18" />
              加入下载队列{{
                selectedVariantIndex >= 0 && variants.length > 0 ? ` (${variants[selectedVariantIndex].label})` : ''
              }}
            </template>
            <template v-else>
              <Download :size="18" />
              开始下载{{
                selectedVariantIndex >= 0 && variants.length > 0 ? ` (${variants[selectedVariantIndex].label})` : ''
              }}
            </template>
          </button>

          <!-- Cancel All -->
          <button
            v-if="hasActiveQueue"
            @click="cancelAllDownloads"
            class="bg-danger/10 border border-danger/30 text-danger hover:bg-danger/20 w-full py-2.5 text-sm rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <X :size="16" /> 取消全部下载
          </button>
        </div>

        <!-- Download Queue -->
        <DownloadQueue
          @retry="handleQueueRetry"
          @remove="handleQueueRemove"
          @cancel="handleQueueCancel"
          @pause="handleQueuePause"
          @resume="handleQueueResume"
          @clear-terminal="handleClearTerminal"
        />

        <!-- Progress (for non-queue operations) -->
        <ProgressPanel v-if="progressStore.isProcessing && progressStore.operationType !== 'download'" />
      </div>
    </div>
  </div>
</template>
