<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Globe, Download, Folder, FolderOpen, Monitor, Plus, X, Trash2, Search, Link, AlertTriangle, MonitorPlay, Check } from 'lucide-vue-next'
import ProgressPanel from '@/components/ProgressPanel.vue'
import DownloadQueue from '@/views/Download/DownloadQueue.vue'
import { useProgressStore } from '@/stores/progress'
import { useHeaders } from '@/composables/useHeaders'
import { todayDateStr, sanitizeFileName } from '@/utils/format'

const progressStore = useProgressStore()

// ─── URL input ───────────────────────────────────────────────────────────────

const m3u8Url = ref('')
const errorMsg = ref('')
const hintMsg = ref('')

// ─── Page fetch ──────────────────────────────────────────────────────────────

const isFetching = ref(false)
const fetchedUrls = ref<string[]>([])
const fetchedTitle = ref('')
const showFetchedUrls = ref(false)

// ─── Quality (m3u8 variants) ─────────────────────────────────────────────────

interface QualityVariant {
  url: string
  resolution: string
  height: number
  label: string
  bandwidth?: number
}
const variants = ref<QualityVariant[]>([])
const selectedVariantIndex = ref(-1) // -1 = use original URL (direct download)
const isFetchingVariants = ref(false)
const showQualitySelector = ref(false)

/** The actual URL to download — could be a variant URL or the original */
const effectiveUrl = computed((): string => {
  if (variants.value.length > 0 && selectedVariantIndex.value >= 0) {
    return variants.value[selectedVariantIndex.value].url
  }
  return m3u8Url.value.trim()
})

/** Auto-select 480p variant */
function autoSelect480p(variantList: QualityVariant[]): void {
  if (variantList.length === 0) {
    selectedVariantIndex.value = -1
    return
  }
  // Exact 480p match
  const idx480 = variantList.findIndex((v) => v.height === 480)
  if (idx480 >= 0) {
    selectedVariantIndex.value = idx480
    return
  }
  // Closest to 480p (prefer slightly lower)
  let bestIdx = 0
  let bestDiff = Math.abs(variantList[0].height - 480)
  for (let i = 1; i < variantList.length; i++) {
    const diff = Math.abs(variantList[i].height - 480)
    if (diff < bestDiff || (diff === bestDiff && variantList[i].height < variantList[bestIdx].height)) {
      bestIdx = i
      bestDiff = diff
    }
  }
  selectedVariantIndex.value = bestIdx
}

/** Fetch quality variants for the current m3u8 URL */
async function fetchQualityVariants(): Promise<void> {
  const url = m3u8Url.value.trim()
  if (!isValidUrl(url)) { return }

  isFetchingVariants.value = true
  try {
    const result = await window.electronAPI.fetchM3u8Variants(url, buildHeaders())
    variants.value = result
    if (result.length > 0) {
      autoSelect480p(result)
      showQualitySelector.value = true
    } else {
      selectedVariantIndex.value = -1
      showQualitySelector.value = false
    }
  } catch {
    variants.value = []
    selectedVariantIndex.value = -1
    showQualitySelector.value = false
  } finally {
    isFetchingVariants.value = false
  }
}

// Auto-detect quality when user pastes or selects an m3u8 URL
watch(m3u8Url, (url) => {
  if (url && isValidUrl(url) && url.includes('.m3u8')) {
    fetchQualityVariants()
  } else {
    showQualitySelector.value = false
    variants.value = []
    selectedVariantIndex.value = -1
  }
})

// ─── Headers ──────────────────────────────────────────────────────────────────

const { headers, UA_PRESETS, addHeader, removeHeader, applyUAPreset, buildHeaders } = useHeaders()

// ─── Output ──────────────────────────────────────────────────────────────────

const commonPaths = ref<{ desktop: string; downloads: string }>({ desktop: '', downloads: '' })
const outputDir = ref('')
const fileName = ref('')
const loadingPath = ref('')

async function fetchCommonPaths(): Promise<void> {
  try {
    commonPaths.value = await window.electronAPI.getCommonPaths()
  } catch (_e) { /* leave defaults */ }
}

async function selectQuickDir(type: 'desktop' | 'downloads'): Promise<void> {
  loadingPath.value = type
  if (!commonPaths.value.desktop) { await fetchCommonPaths() }
  loadingPath.value = ''
  const dir = commonPaths.value[type]
  if (dir) { outputDir.value = dir }
  else { errorMsg.value = '无法获取系统路径，请使用自定义目录' }
}

async function selectCustomDir(): Promise<void> {
  const dir = await window.electronAPI.selectDirectory()
  if (dir) { outputDir.value = dir }
}

const autoFileName = computed((): string => {
  const ts = todayDateStr()
  // Priority 1: use page title if available (from "从网页提取")
  if (fetchedTitle.value) {
    const safe = sanitizeFileName(fetchedTitle.value)
    return `${safe || 'video'}_${ts}.mp4`
  }
  // Priority 2: derive from URL path
  try {
    const urlPath = new URL(m3u8Url.value).pathname
    const segments = urlPath.split('/').filter(Boolean)
    const last = segments[segments.length - 1] || 'video'
    const name = last.replace(/\.(m3u8|ts|mp4|mkv|webm|avi)$/i, '')
    return `${name}_${ts}.mp4`
  } catch {
    return `download_${ts}.mp4`
  }
})

// Auto-fill filename from URL
watch(m3u8Url, () => {
  fileName.value = autoFileName.value
})

const outputPath = computed((): string => {
  if (!outputDir.value || !fileName.value) { return '' }
  return outputDir.value.replace(/\\/g, '/') + '/' + fileName.value
})

// ─── Validation ──────────────────────────────────────────────────────────────

const canStart = computed((): boolean => {
  return (
    effectiveUrl.value.length > 0 &&
    outputDir.value.length > 0 &&
    fileName.value.trim().length > 0
  )
})

// Whether the queue has any active items (pending or downloading)
const hasActiveQueue = computed((): boolean => {
  return progressStore.queueItems.some(
    (i) => i.status === 'pending' || i.status === 'downloading'
  )
})

const downloadingCount = computed((): number => {
  return progressStore.queueItems.filter((i) => i.status === 'downloading').length
})

function setConcurrency(n: number): void {
  progressStore.queueConcurrency = n
  window.electronAPI.setDownloadConcurrency(n)
}

function isValidUrl(url: string): boolean {
  try { new URL(url); return true }
  catch { return false }
}

const isInputUrlValid = computed(() => isValidUrl(m3u8Url.value))

function looksLikeWebPage(url: string): boolean {
  if (!url) { return false }
  const lower = url.toLowerCase()
  // Definitely a streaming URL, not a webpage
  if (lower.includes('.m3u8') || lower.includes('.ts') || lower.includes('/hls/') || lower.includes('/dash/')) {
    return false
  }
  // Known video platforms that serve HTML pages
  const videoHosts = ['vimeo.com', 'dailymotion.com', 'bilibili.com', 'youtube.com',
                      'youku.com', 'iqiyi.com', 'netflix.com']
  if (videoHosts.some((h) => lower.includes(h))) {
    return true
  }
  // Common webpage extensions
  if (lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.php')) {
    return true
  }
  // Generic heuristic: if no media extension, treat as webpage
  return !/\.(mp4|mkv|webm|avi|mov|flv|wmv|m4v|3gp)(\?|$)/i.test(lower)
}

// ─── Fetch m3u8 from page ────────────────────────────────────────────────────

async function fetchM3u8FromPage(): Promise<void> {
  errorMsg.value = ''
  hintMsg.value = ''
  const pageUrl = m3u8Url.value.trim()

  if (!isValidUrl(pageUrl)) {
    errorMsg.value = '请输入有效的网页 URL 地址'
    return
  }

  isFetching.value = true
  try {
    const result = await window.electronAPI.fetchPageM3u8(pageUrl)
    fetchedTitle.value = result.pageTitle
    fetchedUrls.value = result.m3u8Urls

    if (result.m3u8Urls.length === 0) {
      hintMsg.value = `未能从页面 "${result.pageTitle}" 中提取到 m3u8 地址。请尝试直接在浏览器中打开页面，按 F12 → Network → 筛选 m3u8 查找真实播放地址。`
      showFetchedUrls.value = false
    } else {
      showFetchedUrls.value = true
      // Auto-fill Referer/Origin
      try {
        const parsed = new URL(pageUrl)
        const referer = `${parsed.protocol}//${parsed.hostname}/`
        const refHeader = headers.value.find((h) => h.key.toLowerCase() === 'referer')
        if (refHeader && !refHeader.value) { refHeader.value = referer }
        const originHeader = headers.value.find((h) => h.key.toLowerCase() === 'origin')
        if (originHeader && !originHeader.value) { originHeader.value = `${parsed.protocol}//${parsed.hostname}` }
      } catch { /* ignore */ }
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    showFetchedUrls.value = false
  } finally {
    isFetching.value = false
  }
}

/** When user selects an m3u8 URL from fetched list, also fetch its quality variants */
async function selectFetchedUrl(url: string): Promise<void> {
  m3u8Url.value = url
  showFetchedUrls.value = false
  hintMsg.value = ''
  // Fetch quality variants for this URL
  await fetchQualityVariants()
}

// ─── Download Queue ──────────────────────────────────────────────────────────

const justEnqueued = ref(false)
let justEnqueuedTimer: ReturnType<typeof setTimeout> | null = null

async function enqueueDownload(): Promise<void> {
  errorMsg.value = ''
  hintMsg.value = ''

  const url = effectiveUrl.value

  if (!isValidUrl(url)) {
    errorMsg.value = '请输入有效的 URL 地址'
    return
  }
  if (looksLikeWebPage(url)) {
    hintMsg.value = '⚠ 当前输入看起来像网页地址而非 m3u8 流地址，建议先点击"从网页提取"获取真实播放链接。'
  }
  if (!outputPath.value) {
    errorMsg.value = '请选择输出目录并输入文件名'
    return
  }

  try {
    await window.electronAPI.enqueueDownload({
      url,
      output: outputPath.value,
      headers: buildHeaders(),
      fileName: fileName.value
    })
    justEnqueued.value = true
    if (justEnqueuedTimer) { clearTimeout(justEnqueuedTimer) }
    justEnqueuedTimer = setTimeout(() => { justEnqueued.value = false }, 1800)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  }
}

async function cancelAllDownloads(): Promise<void> {
  await window.electronAPI.cancelDownloadQueue()
}

async function handleQueueRetry(id: string): Promise<void> {
  await window.electronAPI.retryQueueItem(id)
}

async function handleQueueRemove(id: string): Promise<void> {
  await window.electronAPI.removeQueueItem(id)
}

async function handleQueueCancel(id: string): Promise<void> {
  await window.electronAPI.cancelQueueItem(id)
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

onMounted(async () => {
  fetchCommonPaths()

  // Fetch initial queue status (items may exist from before navigation)
  try {
    const status = await window.electronAPI.getQueueStatus()
    progressStore.updateQueueItems(status.items)
    progressStore.queueActiveIds = status.activeIds
    progressStore.queueIsProcessing = status.isProcessing
    progressStore.queueConcurrency = status.concurrency
  } catch { /* backend may not be ready yet */ }

  // Listen to queue status updates from backend
  window.electronAPI.onQueueUpdate((status) => {
    progressStore.updateQueueItems(status.items)
    progressStore.queueActiveIds = status.activeIds
    progressStore.queueIsProcessing = status.isProcessing
    progressStore.queueConcurrency = status.concurrency
  })

  // Listen to download progress for the active queue item
  window.electronAPI.onQueueProgress((data) => {
    progressStore.updateQueueItemProgress(data.queueId, {
      percent: data.percent,
      speed: data.speed,
      eta: data.eta
    })
  })
})

onUnmounted(() => {
  if (justEnqueuedTimer) { clearTimeout(justEnqueuedTimer) }
  window.electronAPI?.removeProgressListener()
  window.electronAPI?.removeQueueListeners()
})
</script>

<template>
  <div class="page-container">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
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
          <div v-if="showFetchedUrls && fetchedUrls.length > 0" class="mt-3 p-3 rounded-lg bg-accent-blue/10 border border-accent-blue/30">
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
                <button class="btn-secondary !px-2 !py-0.5 text-xs opacity-0 group-hover:opacity-100 flex-shrink-0">使用</button>
              </div>
            </div>
          </div>

          <!-- Quality Selector -->
          <div v-if="showQualitySelector && variants.length > 0" class="mt-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
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
                :class="selectedVariantIndex === idx
                  ? 'bg-green-500 text-white font-semibold'
                  : 'bg-bg-tertiary text-text-secondary hover:bg-green-500/20'"
              >
                {{ v.label }}
              </button>
            </div>
            <p class="text-xs text-text-muted mt-1.5">
              已选: {{ variants[selectedVariantIndex]?.label || '原始质量' }}
            </p>
          </div>
        </div>

        <!-- HTTP Headers -->
        <div class="glass-card p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-text-primary">HTTP 请求头</h3>
            <button @click="addHeader" class="btn-secondary !px-2 !py-1 text-xs flex items-center gap-1">
              <Plus :size="12" /> 添加
            </button>
          </div>
          <p class="text-xs text-text-muted mb-3">
            部分网站需要正确的 Referer、Origin 和 User-Agent 才能下载。
          </p>

          <div class="space-y-2 mb-3">
            <div v-for="(h, idx) in headers" :key="idx" class="flex items-center gap-2">
              <input v-model="h.key" type="text" placeholder="Key (如 Referer)" class="input-base w-[140px] text-sm flex-shrink-0" />
              <input v-model="h.value" type="text" placeholder="Value" class="input-base flex-1 text-sm" />
              <button @click="removeHeader(idx)" class="p-1.5 rounded" :class="headers.length > 1 ? 'visible' : 'invisible'">
                <Trash2 :size="14" class="text-text-muted" />
              </button>
            </div>
          </div>

          <div class="border-t border-bg-tertiary pt-3">
            <p class="text-xs text-text-muted mb-2">User-Agent 快捷填充</p>
            <div class="flex gap-1.5 flex-wrap">
              <button
                v-for="ua in UA_PRESETS"
                :key="ua.label"
                @click="applyUAPreset(ua.value)"
                class="px-2 py-1 text-xs rounded-md bg-bg-tertiary text-text-secondary hover:bg-accent-blue/20 hover:text-accent-blue transition-colors"
              >{{ ua.label }}</button>
            </div>
          </div>
        </div>
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
            <button @click="selectQuickDir('desktop')" class="btn-secondary !px-3 !py-1.5 text-xs" :disabled="loadingPath === 'desktop'">
              <Monitor :size="14" /> {{ loadingPath === 'desktop' ? '加载中...' : '桌面' }}
            </button>
            <button @click="selectQuickDir('downloads')" class="btn-secondary !px-3 !py-1.5 text-xs" :disabled="loadingPath === 'downloads'">
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
            <input v-model="fileName" type="text" :placeholder="autoFileName" class="input-base w-full text-sm" />
            <p v-if="outputPath" class="text-xs text-text-muted mt-1 truncate">将保存至: {{ outputPath }}</p>
          </div>
        </div>

        <!-- Concurrency Control -->
        <div class="glass-card p-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-semibold text-text-primary">同时下载数</h3>
              <p class="text-xs text-text-muted mt-0.5">
                当前 {{ downloadingCount }} 个进行中
              </p>
            </div>
            <div class="flex items-center gap-1">
              <button
                v-for="n in [1, 2, 3, 4]"
                :key="n"
                @click="setConcurrency(n)"
                class="w-8 h-8 text-xs rounded-md transition-colors font-medium"
                :class="progressStore.queueConcurrency === n
                  ? 'bg-accent-blue text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:bg-accent-blue/20'"
              >{{ n }}</button>
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
            :disabled="!canStart || justEnqueued"
            class="btn-primary w-full py-3 text-base transition-all duration-200"
            :class="canStart
              ? 'bg-gradient-to-r from-accent-blue to-accent-purple'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed'"
          >
            <template v-if="justEnqueued">
              <Check :size="18" />
              已加入队列
            </template>
            <template v-else-if="hasActiveQueue">
              <Download :size="18" />
              加入下载队列{{ selectedVariantIndex >= 0 && variants.length > 0 ? ` (${variants[selectedVariantIndex].label})` : '' }}
            </template>
            <template v-else>
              <Download :size="18" />
              开始下载{{ selectedVariantIndex >= 0 && variants.length > 0 ? ` (${variants[selectedVariantIndex].label})` : '' }}
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
        />

        <!-- Progress (for non-queue operations) -->
        <ProgressPanel v-if="progressStore.isProcessing && progressStore.operationType !== 'download'" />
      </div>
    </div>
  </div>
</template>
