<!-- 视频下载页面：m3u8 解析、网页提取、清晰度选择与下载队列管理 -->
<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch, provide } from 'vue';
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
import { useSettingsStore } from '@/stores/settings';
import { getDirName, formatSize, todayDateStr } from '@/utils/format';
import { buildCookieHeader } from '@/utils/cookies';
import { isValidUrl, buildOriginHeaders, DEFAULT_UA } from '@/utils/url';
import { confirmIfDownloadDuplicate } from '@/utils/download';
import { useWebPageParse, webPageParseKey } from '@/views/Download/useWebPageParse';
import { useQualityVariants } from '@/views/Download/useQualityVariants';
import { useOutputTarget } from '@/views/Download/useOutputTarget';
import { useDownloadQueueSync } from '@/views/Download/useDownloadQueueSync';
import type { RawCookie } from '@/types/file';

const progressStore = useProgressStore();
const settingsStore = useSettingsStore();

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

// ─── Headers (auto-managed, not shown in UI) ──────────────────────────────────

const headers = reactive<Record<string, string>>({
  'User-Agent': DEFAULT_UA
});

// ─── Quality (m3u8 variants) ─────────────────────────────────────────────────

const {
  variants,
  selectedVariantIndex,
  showQualitySelector,
  variantsLoading,
  effectiveUrl,
  fetchQualityVariants,
  resetVariants
} = useQualityVariants(m3u8Url, headers);

// ─── Output ──────────────────────────────────────────────────────────────────

const {
  outputDir,
  fileName,
  fileNameEdited,
  loadingPath,
  autoFileName,
  outputPath,
  fetchCommonPaths,
  selectQuickDir,
  selectCustomDir
} = useOutputTarget(m3u8Url, fetchedTitle);

const historyJsonPath = ref('');

async function openHistoryFolder(): Promise<void> {
  if (!historyJsonPath.value) {
    return;
  }
  const dir = getDirName(historyJsonPath.value);
  await window.electronAPI.openFolder(dir);
}

/** 快速选目录包装：无法获取系统路径时给出错误提示 */
async function handleSelectQuickDir(type: 'desktop' | 'downloads'): Promise<void> {
  const ok = await selectQuickDir(type);
  if (!ok) {
    errorMsg.value = '无法获取系统路径，请使用自定义目录';
  }
}

/** 打开当前保存目录 */
async function openOutputDir(): Promise<void> {
  if (outputDir.value) {
    await window.electronAPI.openFolder(outputDir.value);
  }
}

// ─── Download queue sync（监听器绑定组件生命周期） ─────────────────────────────

const {
  setConcurrency,
  cancelAllDownloads,
  retryQueueItem,
  retryAllFailed,
  openFileItem,
  revealItemInFolder,
  removeQueueItem,
  cancelQueueItem,
  pauseQueueItem,
  resumeQueueItem,
  clearQueueTerminal
} = useDownloadQueueSync();

// ─── 网页路径解析共享实例（与「从网页提取」共用互斥锁） ─────────────────────────

const parse = useWebPageParse();
provide(webPageParseKey, parse);
const { isBusy: parseBusy, setManualFetching } = parse;

// ─── 磁盘剩余空间提示 ────────────────────────────────────────────────────────

const diskFreeBytes = ref<number | null>(null);

// 选定目录后查询所在磁盘剩余空间，不足 1GB 时以警告色展示
watch(outputDir, async (dir): Promise<void> => {
  diskFreeBytes.value = null;
  if (!dir) {
    return;
  }
  try {
    diskFreeBytes.value = await window.electronAPI.getDiskFree(dir);
  } catch {
    /* 查询失败时静默，不展示 */
  }
});

// ─── URL watcher：自动文件名 / Cookie 同步 / 清晰度探测 ──────────────────────────

// 清晰度探测防抖定时器
let variantFetchTimer: ReturnType<typeof setTimeout> | null = null;

// Auto-detect quality + auto-fill filename when m3u8 URL changes
watch(m3u8Url, (url) => {
  // 用户修正输入时清除旧的错误/提示，避免陈旧信息悬挂
  errorMsg.value = '';
  hintMsg.value = '';
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
    resetVariants();
  }
});

// Keep Cookie header in sync when effective URL changes (e.g. quality variant selection)
watch(effectiveUrl, (url) => {
  syncCookiesForUrl(url);
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
  // 与网页路径面板的「解析」共用互斥锁，避免 page-fetcher 全局拦截器并发串扰
  setManualFetching(true);
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
      Object.assign(headers, buildOriginHeaders(pageUrl));
      // Don't auto-fill Cookie yet — wait for user to select a specific m3u8 URL
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
    showFetchedUrls.value = false;
  } finally {
    isFetching.value = false;
    setManualFetching(false);
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
  Object.assign(headers, buildOriginHeaders(payload.pageUrl));
  fileNameEdited.value = false;
  m3u8Url.value = payload.url; // 触发既有 watch：Cookie 同步 + 清晰度探测 + 自动文件名
}

// ─── Download enqueue ────────────────────────────────────────────────────────

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
    const confirmed = await confirmIfDownloadDuplicate(fileName.value);
    if (!confirmed) {
      hintMsg.value = '已取消重复下载';
      return;
    }

    const enqueuedName = fileName.value;
    await window.electronAPI.enqueueDownload({
      url,
      output: outputPath.value,
      headers: { ...headers },
      fileName: enqueuedName
    });
    prepareNextFileName(enqueuedName);
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

/** 入队成功后备好下一个文件名：同基础名递增序号，避免与队列中已有文件重名 */
function prepareNextFileName(enqueuedName: string): void {
  const ts = todayDateStr();
  // 自动文件名必以「_日期.mp4」结尾，去掉后缀得到基础名（保留标题中的数字，如 EP_12）
  const autoBase = autoFileName.value.slice(0, -`_${ts}.mp4`.length);
  let base: string;
  if (enqueuedName === autoFileName.value || enqueuedName.startsWith(`${autoBase}_`)) {
    // 自动命名族（含之前自动追加的序号名）：从标题/URL 推导的基础名出发
    base = autoBase;
  } else {
    // 用户手动改过名：从入队名剥离末尾的序号与日期后缀
    base = enqueuedName.replace(/(?:_\d+)?_\d{8}\.mp4$/, '');
  }
  if (!base) {
    return;
  }
  const used = new Set(progressStore.queueItems.map((i) => i.fileName));
  used.add(enqueuedName);
  let n = 2;
  while (used.has(`${base}_${n}_${ts}.mp4`)) {
    n++;
  }
  fileName.value = `${base}_${n}_${ts}.mp4`;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

onMounted(async () => {
  fetchCommonPaths();

  // 恢复上次使用的输出目录（localStorage 持久化）
  if (!outputDir.value && settingsStore.outputDirectory) {
    outputDir.value = settingsStore.outputDirectory;
  }

  // Fetch download history JSON path
  try {
    historyJsonPath.value = await window.electronAPI.getDownloadHistoryPath();
  } catch {
    /* ignore */
  }
});

// 选定目录后同步持久化，下次进入页面自动恢复
watch(outputDir, (dir): void => {
  settingsStore.setOutputDirectory(dir);
});

onUnmounted(() => {
  if (justEnqueuedTimer) {
    clearTimeout(justEnqueuedTimer);
  }
  if (variantFetchTimer) {
    clearTimeout(variantFetchTimer);
  }
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
              :disabled="!isInputUrlValid || isFetching || parseBusy"
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
          <p v-if="variantsLoading" class="text-xs text-accent-blue mt-1.5">正在检测清晰度...</p>

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
              @click="handleSelectQuickDir('desktop')"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="loadingPath === 'desktop'"
            >
              <Monitor :size="14" /> {{ loadingPath === 'desktop' ? '加载中...' : '桌面' }}
            </button>
            <button
              @click="handleSelectQuickDir('downloads')"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="loadingPath === 'downloads'"
            >
              <Download :size="14" /> {{ loadingPath === 'downloads' ? '加载中...' : '下载' }}
            </button>
            <button @click="selectCustomDir" class="btn-secondary !px-3 !py-1.5 text-xs">
              <Folder :size="14" /> 自定义
            </button>
          </div>
          <div v-if="outputDir" class="flex items-center gap-1.5 mb-3 min-w-0">
            <p class="text-xs text-accent-light truncate flex items-center gap-1 flex-1 min-w-0">
              <FolderOpen :size="12" class="flex-shrink-0" /> {{ outputDir }}
            </p>
            <button
              @click="openOutputDir"
              class="btn-secondary !px-2 !py-0.5 text-xs flex items-center gap-1 flex-shrink-0"
              title="打开保存目录"
            >
              <ExternalLink :size="10" /> 打开
            </button>
          </div>
          <p
            v-if="outputDir && diskFreeBytes !== null"
            class="text-[10px] mb-3"
            :class="diskFreeBytes < 1024 * 1024 * 1024 ? 'text-danger' : 'text-text-muted'"
          >
            磁盘剩余空间: {{ formatSize(diskFreeBytes) }}{{ diskFreeBytes < 1024 * 1024 * 1024 ? '（空间不足，请更换目录）' : '' }}
          </p>
          <p v-if="!outputDir" class="text-xs text-text-muted mb-3">请选择保存目录</p>

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
          @retry="retryQueueItem"
          @retry-all="retryAllFailed"
          @remove="removeQueueItem"
          @cancel="cancelQueueItem"
          @pause="pauseQueueItem"
          @resume="resumeQueueItem"
          @clear-terminal="clearQueueTerminal"
          @open-file="openFileItem"
          @reveal-item="revealItemInFolder"
        />

        <!-- Progress (for non-queue operations) -->
        <ProgressPanel v-if="progressStore.isProcessing && progressStore.operationType !== 'download'" />
      </div>
    </div>
  </div>
</template>
