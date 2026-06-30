<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { FileVideo, Folder, X, Zap, Monitor, Download, FolderOpen, Info, HelpCircle } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import VideoDetailModal from './VideoDetailModal.vue'
import { useProgressStore } from '@/stores/progress'
import { useSettingsStore } from '@/stores/settings'
import { formatSize, getDirName } from '@/utils/format'
import { useFileList } from '@/composables/useFileList'
import { useInfoTooltip } from '@/composables/useInfoTooltip'
import type { FileEntry } from '@/types/file'
import type { CompressResultItem } from './types'

const progressStore = useProgressStore()
const settingsStore = useSettingsStore()

const { files, addFiles, removeFile, selectOutputDir, setOutputDir } = useFileList()

const twoPassTip = useInfoTooltip()
const codecTip = useInfoTooltip()
const bitrateTip = useInfoTooltip()
const audioBitrateTip = useInfoTooltip()
const presetTip = useInfoTooltip()

// Compression params — initialized from persisted preset
const preset = ref(settingsStore.compressPreset.preset)
const crfValue = ref(settingsStore.compressPreset.crfValue)
const resolution = ref(settingsStore.compressPreset.resolution)
const bitrate = ref(settingsStore.compressPreset.bitrate)
const codec = ref(settingsStore.compressPreset.codec)
const audioBitrate = ref(settingsStore.compressPreset.audioBitrate)
const twoPass = ref(settingsStore.compressPreset.twoPass)

const errorMsg = ref('')
let isUnmounted = false

// Persist changes back to store
function savePreset(): void {
  settingsStore.setCompressPreset({
    crfValue: crfValue.value,
    resolution: resolution.value,
    bitrate: bitrate.value,
    codec: codec.value,
    audioBitrate: audioBitrate.value,
    preset: preset.value,
    twoPass: twoPass.value
  })
}

// Video detail modal
const detailEntry = ref<FileEntry | null>(null)
const detailModalRef = ref<InstanceType<typeof VideoDetailModal> | null>(null)

function openDetail(entry: FileEntry): void {
  detailEntry.value = entry
  // Defer meta fetch to modal's onOpen via nextTick
  import('vue').then(({ nextTick }) => {
    nextTick(() => {
      detailModalRef.value?.onOpen()
    })
  })
}

function closeDetail(): void {
  detailEntry.value = null
}

// Common paths for quick output selection
const commonPaths = ref<{ desktop: string; downloads: string }>({ desktop: '', downloads: '' })
const loadingPath = ref('')
const sourceDir = computed(() => {
  if (files.value.length === 0) { return '' }
  return getDirName(files.value[0].path)
})
const selectedOutputDir = computed(() => {
  const path = files.value[0]?.outputPath
  return path ? getDirName(path) : ''
})

async function fetchCommonPaths(): Promise<boolean> {
  try {
    commonPaths.value = await window.electronAPI.getCommonPaths()
    return true
  } catch (_e) {
    return false
  }
}

async function selectQuickDir(type: 'desktop' | 'downloads' | 'source'): Promise<void> {
  let dir: string | null = null

  if (type === 'source') {
    dir = sourceDir.value
  } else {
    loadingPath.value = type
    // Use cached path if available, otherwise fetch
    if (!commonPaths.value.desktop) {
      await fetchCommonPaths()
    }
    dir = commonPaths.value[type]
    loadingPath.value = ''
  }

  if (!dir) {
    if (type !== 'source') {
      errorMsg.value = '无法获取系统路径，请使用自定义目录'
    }
    return
  }
  setOutputDir(dir, '_compressed.mp4')
}

// Pre-fetch common paths on mount for snappier first click
onMounted(async () => {
  fetchCommonPaths()
  try {
    const encoders = await window.electronAPI.getAvailableEncoders()
    if (!isUnmounted) {
      availableEncoders.value = encoders
    }
  } catch (_e) {
    // leave empty
  }
})

// GPU encoder detection
const isGpuEncoder = computed(() => {
  return (codec.value || '').includes('nvenc') || (codec.value || '').includes('qsv')
})

const RESOLUTION_BITRATE: Record<string, string> = {
  '1920:1080': '4000k',
  '1280:720': '500k',
  '854:480': '300k',
  '640:360': '300k'
}

const crfActive = computed(() => !bitrate.value)

watch(resolution, (res) => {
  bitrate.value = RESOLUTION_BITRATE[res] || ''
})

// Auto-persist preset on any param change
watch([crfValue, resolution, bitrate, codec, audioBitrate, preset, twoPass], () => {
  savePreset()
}, { deep: false })

function estimateOutputSize(entry: FileEntry): string {
  if (!entry.meta || entry.meta.size === 0) { return '未知' }
  const originalMB = entry.meta.size / (1024 * 1024)
  // Rough estimate based on CRF
  const ratios: Record<number, number> = { 18: 0.7, 23: 0.4, 28: 0.2, 32: 0.12 }
  const ratio = ratios[crfValue.value] || 0.4
  const estMB = originalMB * ratio
  return `${Math.round(estMB)} MB`
}

async function startCompress(): Promise<void> {
  errorMsg.value = ''
  compressResult.value = []
  if (files.value.length === 0) { return }

  for (const entry of files.value) {
    if (!entry.outputPath) {
      await selectOutputDir('_compressed.mp4')
      break
    }
  }

  const unresolved = files.value.filter((f) => !f.outputPath)
  if (unresolved.length > 0) {
    errorMsg.value = '请为所有文件选择输出目录'
    return
  }

  progressStore.start('compress')
  window.electronAPI.onProgress((info) => {
    progressStore.update(info)
  })

  try {
    const batchFiles = files.value.map((f) => ({
      input: f.path,
      output: f.outputPath,
      crf: crfValue.value,
      resolution: resolution.value,
      bitrate: bitrate.value,
      codec: codec.value,
      audioBitrate: audioBitrate.value,
      preset: preset.value,
      twoPass: twoPass.value
    }))
    const result = await window.electronAPI.batchCompress({ files: batchFiles })
    if (!progressStore.isProcessing) {
      return
    }
    if (result.failed.length === 0) {
      progressStore.finish()
      // Build comparison data
      for (const outputPath of result.successFiles) {
        try {
          const fileInfo = await window.electronAPI.getFileInfo(outputPath)
          const original = files.value.find((f) => f.outputPath === outputPath)
          if (original && original.meta) {
            compressResult.value.push({
              fileName: outputPath.split(/[/\\]/).pop() || outputPath,
              originalSize: original.meta.size,
              compressedSize: fileInfo.size
            })
          }
        } catch { /* skip files that can't be read */ }
      }
    } else {
      const failedNames = result.failed.map((_p) => {
        const f = files.value.find((x) => x.path === _p)
        return f ? (f.path.split(/[/\\]/).pop() || _p) : _p
      }).join(', ')
      errorMsg.value = `${result.failed.length} 个文件压缩失败: ${failedNames}`
      progressStore.reset()
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    progressStore.reset()
  } finally {
    window.electronAPI.removeProgressListener()
  }
}

const canStart = computed((): boolean => {
  return files.value.length > 0 && !progressStore.isProcessing
})

// Compression result comparison
const compressResult = ref<CompressResultItem[]>([])

const availableEncoders = ref<string[]>([])

const hasNvidiaEncoders = computed((): boolean => {
  return availableEncoders.value.some((e) => e.includes('nvenc'))
})

const hasQsvEncoders = computed((): boolean => {
  return availableEncoders.value.some((e) => e.includes('qsv'))
})

onUnmounted(() => {
  isUnmounted = true
  window.electronAPI?.removeProgressListener()
})
</script>

<template>
  <div class="page-container">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
          <FileVideo :size="20" class="text-accent-purple" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频压缩</h1>
      </div>
      <p class="text-text-secondary text-sm">智能压缩视频文件大小，支持 H.264 / H.265 编码</p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Left: File List -->
      <div class="space-y-3">
        <FileDropZone @files-selected="addFiles" />

        <!-- File Table -->
        <div v-if="files.length > 0" class="glass-card overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-bg-tertiary text-text-secondary text-xs">
                <th class="text-left p-3 font-medium">文件名</th>
                <th class="text-right p-3 font-medium">大小</th>
                <th class="text-right p-3 font-medium">预估</th>
                <th class="text-right p-3 font-medium w-20" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(entry, idx) in files"
                :key="entry.path"
                class="border-b border-bg-tertiary/50"
              >
                <td class="p-3">
                  <div class="flex items-center gap-2">
                    <FileVideo :size="16" class="text-accent-purple flex-shrink-0" />
                    <span class="truncate max-w-[200px]" :title="entry.path">
                      {{ entry.path.split(/[/\\]/).pop() }}
                    </span>
                  </div>
                </td>
                <td class="p-3 text-right text-text-secondary">
                  {{ entry.meta ? formatSize(entry.meta.size) : '...' }}
                </td>
                <td class="p-3 text-right text-accent-light font-mono">
                  {{ entry.meta ? estimateOutputSize(entry) : '...' }}
                </td>
                <td class="p-3 text-right">
                  <div class="flex items-center justify-end gap-0.5">
                    <button
                      @click="openDetail(entry)"
                      class="p-1 rounded hover:bg-bg-tertiary transition-colors"
                      title="视频详情"
                    >
                      <Info :size="14" class="text-accent-blue" />
                    </button>
                    <button
                      @click="removeFile(idx)"
                      class="p-1 rounded hover:bg-bg-tertiary transition-colors"
                      title="移除文件"
                    >
                      <X :size="14" class="text-danger" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right: Parameters -->
      <div class="space-y-3">
        <!-- Compression Parameters -->
        <div class="glass-card p-4 space-y-3">
            <h3 class="text-base font-semibold text-text-primary">压缩参数</h3>

            <!-- Resolution -->
            <div>
              <label class="text-sm text-text-secondary mb-2 block">输出分辨率</label>
              <select v-model="resolution" class="select-input w-full">
                <option value="original">原始分辨率</option>
                <option value="1920:1080">1080p (1920×1080)</option>
                <option value="1280:720">720p (1280×720)</option>
                <option value="854:480">480p (854×480)</option>
                <option value="640:360">360p (640×360)</option>
              </select>
            </div>

            <!-- Bitrate -->
            <div>
              <div class="relative flex items-center gap-1 mb-2">
                <label class="text-sm text-text-secondary">视频码率限制</label>
                <button
                  type="button"
                  class="p-0.5 rounded hover:bg-bg-tertiary transition-colors"
                  @click.stop="bitrateTip.toggle()"
                  title="视频码率是什么？"
                >
                  <HelpCircle :size="14" class="text-text-muted hover:text-text-secondary transition-colors" />
                </button>
                <transition name="tooltip-fade">
                  <div
                    v-if="bitrateTip.isOpen.value"
                    :ref="bitrateTip.elRef"
                    class="absolute left-0 bottom-full mb-2 w-72 p-3 rounded-lg bg-bg-secondary border border-bg-tertiary shadow-lg z-50 text-xs leading-relaxed text-text-secondary"
                  >
                    <p class="mb-2"><strong class="text-text-primary">视频码率</strong> 表示每秒传输的视频数据量：</p>
                    <ul class="list-disc list-inside space-y-1">
                      <li>码率越高 → 画质越好，文件越大</li>
                      <li>码率越低 → 文件越小，画质越差</li>
                    </ul>
                    <p class="mt-2 text-text-muted">
                      <span class="text-accent-blue font-medium">CRF 模式</span>（选"自动"）：以画质为目标，编码器自行决定码率。<br/>
                      <span class="text-accent-purple font-medium">固定码率</span>：精确控制输出文件大小，适合有体积要求的场景。
                    </p>
                    <p class="mt-1 text-text-muted">选择固定码率后可开启 <span class="text-accent-blue">2-Pass</span> 进一步提升画质。</p>
                  </div>
                </transition>
              </div>
              <select v-model="bitrate" class="select-input w-full">
                <option value="">自动 (CRF 模式)</option>
                <option value="4000k">4 Mbps</option>
                <option value="500k">500 Kbps</option>
                <option value="300k">300 Kbps</option>
              </select>
            </div>

            <!-- CRF Slider -->
            <div :class="{ 'opacity-40 pointer-events-none': !crfActive }">
              <label class="text-sm text-text-secondary">
                CRF 质量 ({{ crfValue }})
                <span v-if="!crfActive" class="text-accent-yellow text-xs ml-1">(已被码率限制覆盖)</span>
              </label>
              <input
                v-model.number="crfValue"
                type="range"
                min="0"
                max="51"
                class="w-full mt-2 slider-base slider"
              />
              <div class="flex justify-between text-xs text-text-muted mt-1">
                <span>0 真无损</span>
                <span>18 视觉无损</span>
                <span>23 默认</span>
                <span>28 标清</span>
                <span>51 最差</span>
              </div>
            </div>

            <!-- Codec -->
            <div>
              <div class="relative flex items-center gap-1 mb-2">
                <label class="text-sm text-text-secondary">编码格式</label>
                <button
                  type="button"
                  class="p-0.5 rounded hover:bg-bg-tertiary transition-colors"
                  @click.stop="codecTip.toggle()"
                  title="编码格式有什么区别？"
                >
                  <HelpCircle :size="14" class="text-text-muted hover:text-text-secondary transition-colors" />
                </button>
                <transition name="tooltip-fade">
                  <div
                    v-if="codecTip.isOpen.value"
                    :ref="codecTip.elRef"
                    class="absolute left-0 bottom-full mb-2 w-80 p-3 rounded-lg bg-bg-secondary border border-bg-tertiary shadow-lg z-50 text-xs leading-relaxed text-text-secondary"
                  >
                    <p class="mb-2"><strong class="text-text-primary">编码格式</strong> 决定视频的兼容性与压缩效率：</p>
                    <ul class="list-disc list-inside space-y-1.5">
                      <li><span class="text-accent-blue font-medium">H.264</span>：兼容性最好，几乎所有设备都能播放，文件适中。</li>
                      <li><span class="text-accent-purple font-medium">H.265 / HEVC</span>：比 H.264 压缩率高约 30%~50%，同等画质文件更小，但老设备可能不兼容。</li>
                      <li><span class="text-accent-yellow font-medium">VP9</span>：YouTube/Web 优化，开源免费，压缩比接近 HEVC，适合网页播放。</li>
                    </ul>
                    <p class="mt-2 pt-2 border-t border-bg-tertiary text-text-muted">
                      <span class="font-medium text-text-primary">GPU 加速</span>（NVENC / QSV）：编码速度极快，但同码率下画质略逊于 CPU 软编码。
                    </p>
                  </div>
                </transition>
              </div>
              <select v-model="codec" class="select-input w-full">
                <optgroup label="CPU 软编码">
                  <option value="libx264">H.264 (兼容性最好)</option>
                  <option value="libx265">H.265 / HEVC (更高压缩比)</option>
                  <option value="libvpx-vp9">VP9 (Web优化)</option>
                </optgroup>
                <optgroup v-if="hasNvidiaEncoders" label="NVIDIA GPU (NVENC)">
                  <option value="h264_nvenc">H.264 NVENC</option>
                  <option value="hevc_nvenc">HEVC NVENC</option>
                </optgroup>
                <optgroup v-if="hasQsvEncoders" label="Intel GPU (QuickSync)">
                  <option value="h264_qsv">H.264 QSV</option>
                  <option value="hevc_qsv">HEVC QSV</option>
                </optgroup>
              </select>
            </div>

            <!-- Audio Bitrate -->
            <div>
              <div class="relative flex items-center gap-1 mb-2">
                <label class="text-sm text-text-secondary">音频码率</label>
                <button
                  type="button"
                  class="p-0.5 rounded hover:bg-bg-tertiary transition-colors"
                  @click.stop="audioBitrateTip.toggle()"
                  title="音频码率是什么？"
                >
                  <HelpCircle :size="14" class="text-text-muted hover:text-text-secondary transition-colors" />
                </button>
                <transition name="tooltip-fade">
                  <div
                    v-if="audioBitrateTip.isOpen.value"
                    :ref="audioBitrateTip.elRef"
                    class="absolute left-0 bottom-full mb-2 w-72 p-3 rounded-lg bg-bg-secondary border border-bg-tertiary shadow-lg z-50 text-xs leading-relaxed text-text-secondary"
                  >
                    <p class="mb-2"><strong class="text-text-primary">音频码率</strong> 决定音频的清晰度：</p>
                    <ul class="list-disc list-inside space-y-1">
                      <li><span class="text-accent-blue font-medium">32~64 Kbps</span>：语音/ podcast 足够，极小体积</li>
                      <li><span class="text-accent-purple font-medium">96~128 Kbps</span>：常规视频够用，音质与体积平衡</li>
                      <li><span class="text-accent-yellow font-medium">192 Kbps</span>：接近无损，适合音乐/高音质需求</li>
                    </ul>
                    <p class="mt-2 text-text-muted">音频通常只占视频总大小的 5%~15%，降低音频码率对总文件大小影响有限。</p>
                  </div>
                </transition>
              </div>
              <select v-model="audioBitrate" class="select-input w-full">
                <option value="32k">32 Kbps</option>
                <option value="64k">64 Kbps</option>
                <option value="96k">96 Kbps</option>
                <option value="128k">128 Kbps</option>
                <option value="192k">192 Kbps</option>
              </select>
            </div>

            <!-- Encoding Preset (CPU only) -->
            <div v-if="!isGpuEncoder">
              <div class="relative flex items-center gap-1 mb-2">
                <label class="text-sm text-text-secondary">编码速度预设</label>
                <button
                  type="button"
                  class="p-0.5 rounded hover:bg-bg-tertiary transition-colors"
                  @click.stop="presetTip.toggle()"
                  title="编码预设是什么意思？"
                >
                  <HelpCircle :size="14" class="text-text-muted hover:text-text-secondary transition-colors" />
                </button>
                <transition name="tooltip-fade">
                  <div
                    v-if="presetTip.isOpen.value"
                    :ref="presetTip.elRef"
                    class="absolute left-0 bottom-full mb-2 w-72 p-3 rounded-lg bg-bg-secondary border border-bg-tertiary shadow-lg z-50 text-xs leading-relaxed text-text-secondary"
                  >
                    <p class="mb-2"><strong class="text-text-primary">编码速度预设</strong> 是速度与画质的权衡：</p>
                    <ul class="list-disc list-inside space-y-1">
                      <li><span class="text-accent-blue font-medium">ultrafast → fast</span>：编码快，但同码率下画质略差，文件更大</li>
                      <li><span class="text-accent-purple font-medium">medium → veryslow</span>：编码慢，但用更复杂的算法压缩，同码率下画质更好，文件更小</li>
                    </ul>
                    <p class="mt-2 text-text-muted">
                      越慢的预设意味着编码器会花更多时间分析视频，用更智能的方式分配码率。<br/>
                      推荐日常使用 <span class="text-accent-blue">medium</span>，追求画质用 <span class="text-accent-purple">slow</span> 或 <span class="text-accent-purple">veryslow</span>。
                    </p>
                    <p class="mt-1 text-text-muted">仅 CPU 编码可用，GPU 加速编码不受此影响。</p>
                  </div>
                </transition>
              </div>
              <select v-model="preset" class="select-input w-full">
                <option value="ultrafast">ultrafast (极速)</option>
                <option value="superfast">superfast</option>
                <option value="veryfast">veryfast</option>
                <option value="faster">faster</option>
                <option value="fast">fast (默认)</option>
                <option value="medium">medium</option>
                <option value="slow">slow</option>
                <option value="slower">slower</option>
                <option value="veryslow">veryslow (最佳画质)</option>
              </select>
            </div>

            <!-- 2-Pass (CPU + bitrate only) -->
            <div v-if="!isGpuEncoder && !!bitrate" class="flex items-center gap-3">
              <div class="relative flex items-center gap-1">
                <label class="text-sm text-text-secondary">2-Pass 编码</label>
                <button
                  type="button"
                  class="p-0.5 rounded hover:bg-bg-tertiary transition-colors"
                  @click.stop="twoPassTip.toggle()"
                  title="什么是 2-Pass？"
                >
                  <HelpCircle :size="14" class="text-text-muted hover:text-text-secondary transition-colors" />
                </button>
                <!-- Tooltip -->
                <transition name="tooltip-fade">
                  <div
                    v-if="twoPassTip.isOpen.value"
                    :ref="twoPassTip.elRef"
                    class="absolute left-0 bottom-full mb-2 w-72 p-3 rounded-lg bg-bg-secondary border border-bg-tertiary shadow-lg z-50 text-xs leading-relaxed text-text-secondary"
                  >
                    <p class="mb-2"><strong class="text-text-primary">2-Pass 编码</strong> 是一种两次编码技术：</p>
                    <ul class="list-disc list-inside space-y-1">
                      <li><span class="text-accent-blue font-medium">第 1 遍</span>：分析视频内容，记录每帧的复杂度信息（不输出文件）</li>
                      <li><span class="text-accent-purple font-medium">第 2 遍</span>：根据分析结果，更精准地分配码率，正式编码输出文件</li>
                    </ul>
                    <p class="mt-2 text-text-muted">✅ 同等码率下画质更好 &nbsp;|&nbsp; ⚠️ 耗时约 2 倍</p>
                    <p class="mt-1 text-text-muted">仅在使用码率限制（非 CRF 模式）+ CPU 编码时可用。</p>
                  </div>
                </transition>
              </div>
              <button
                type="button"
                class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200"
                :class="twoPass ? 'bg-accent-blue' : 'bg-bg-tertiary'"
                @click="twoPass = !twoPass"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200"
                  :class="twoPass ? 'translate-x-[18px]' : 'translate-x-[2px]'"
                />
              </button>
              <span class="text-xs text-text-muted">提升画质，耗时约 2 倍</span>
            </div>
        </div>

        <!-- Output -->
        <div class="glass-card">
          <h3 class="section-title">输出设置</h3>

          <!-- Quick select -->
          <div class="flex gap-2 flex-wrap">
            <button
              @click="selectQuickDir('desktop')"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="loadingPath === 'desktop'"
            >
              <Monitor :size="14" />
              {{ loadingPath === 'desktop' ? '加载中...' : '桌面' }}
            </button>
            <button
              @click="selectQuickDir('downloads')"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="loadingPath === 'downloads'"
            >
              <Download :size="14" />
              {{ loadingPath === 'downloads' ? '加载中...' : '下载' }}
            </button>
            <button
              @click="selectQuickDir('source')"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="!sourceDir"
              :title="sourceDir || '请先添加文件'"
            >
              <FolderOpen :size="14" />
              源文件目录
            </button>
          </div>

          <!-- Current output dir -->
          <p v-if="selectedOutputDir" class="text-xs text-accent-light mt-2 truncate">
            {{ selectedOutputDir }}
          </p>

          <div class="mt-3 pt-3 border-t border-bg-tertiary">
            <button
              @click="selectOutputDir('_compressed.mp4')"
              class="btn-secondary"
            >
              <Folder :size="16" />
              自定义目录
            </button>
          </div>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="alert-danger">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- Start -->
        <button
          @click="startCompress"
          :disabled="!canStart"
          class="btn-primary"
          :class="canStart
            ? 'bg-gradient-to-r from-accent-purple to-pink-500'
            : 'bg-bg-tertiary text-text-muted'"
        >
          <Zap :size="18" />
          开始压缩 ({{ files.length }} 个文件)
        </button>

        <ProgressPanel />

        <!-- Compression Result Comparison -->
        <div v-if="compressResult.length > 0" class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">压缩结果对比</h3>
          <div class="space-y-2">
            <div
              v-for="(item, idx) in compressResult"
              :key="idx"
              class="flex items-center justify-between gap-2 py-1.5 border-b border-bg-tertiary/50 last:border-0"
            >
              <span class="text-sm text-text-primary truncate flex-1 min-w-0">{{ item.fileName }}</span>
              <span class="text-xs text-text-secondary whitespace-nowrap">
                {{ formatSize(item.originalSize) }} → {{ formatSize(item.compressedSize) }}
              </span>
              <span class="text-xs font-mono text-success whitespace-nowrap">
                -{{ Math.round((1 - item.compressedSize / item.originalSize) * 100) }}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Video Detail Modal -->
    <VideoDetailModal
      ref="detailModalRef"
      :entry="detailEntry"
      @close="closeDetail"
    />
  </div>
</template>

<style scoped>
@use "../../assets/styles/compress";
</style>
