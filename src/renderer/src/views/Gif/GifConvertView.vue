<!-- 视频转GIF页面：参数配置、裁剪预览与批量转换 -->
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Image, Folder, X, Zap } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import GifTrimCard from './GifTrimCard.vue'
import { useProgressStore } from '@/stores/progress'
import { formatDuration } from '@/utils/time'
import { getFileName, getDirName } from '@/utils/format'
import { useFileList } from '@/composables/useFileList'
import type { FileEntry } from '@/types/file'
import type { QualityPreset, WidthOption } from './types'

const progressStore = useProgressStore()
const { files, addFiles, removeFile, selectOutputDir } = useFileList('.gif')

// 质量预设
const QUALITY_PRESETS: QualityPreset[] = [
  { value: 'high', label: '高质量', description: '最佳画质，文件较大' },
  { value: 'medium', label: '中等质量', description: '画质与大小平衡' },
  { value: 'low', label: '低质量', description: '最小文件，快速生成' }
]
const selectedQuality = ref<'high' | 'medium' | 'low'>('medium')

// 参数配置
const fps = ref(10)
const selectedWidth = ref('480')
const WIDTH_OPTIONS: WidthOption[] = [
  { label: '原始尺寸', value: '0' },
  { label: '320px', value: '320' },
  { label: '480px (推荐)', value: '480' },
  { label: '640px', value: '640' },
  { label: '800px', value: '800' }
]

// 片段截取状态（时间轴交互在 GifTrimCard 内，状态所有权归本视图）
const enableTrim = ref(false)
const trimStartSec = ref(0)
const trimEndSec = ref(5)             // 默认截取时长（秒）
const maxDuration = ref(0)

const FALLBACK_WIDTH = 640            // 元数据缺失时的回退宽度
const SIZE_ESTIMATE_FACTOR = 0.3      // GIF 体积估算压缩系数
const QUALITY_SIZE_FACTORS: Record<string, number> = { high: 0.6, medium: 0.4, low: 0.2 }
const LOOP_OPTIONS = [
  { label: '无限', val: 0 },
  { label: '1次', val: 1 },
  { label: '3次', val: 3 },
  { label: '5次', val: 5 }
] as const

// 循环次数
const loopCount = ref(0)

const errorMsg = ref('')

const computedWidth = computed((): number => {
  return parseInt(selectedWidth.value)
})

const canStart = computed((): boolean => {
  return files.value.length > 0 && !progressStore.isProcessing
})

function estimateOutputSize(entry: FileEntry): string {
  if (!entry.meta || entry.meta.duration === 0) { return '未知' }
  const duration = enableTrim.value ? (trimEndSec.value - trimStartSec.value) : entry.meta.duration
  const w = computedWidth.value > 0 ? computedWidth.value : (entry.meta.width || FALLBACK_WIDTH)
  const h = (entry.meta.height && entry.meta.width > 0)
    ? Math.round(w * (entry.meta.height / entry.meta.width))
    : Math.round(w * 9 / 16)
  const pixels = w * h
  const frames = duration * fps.value
  const factor = QUALITY_SIZE_FACTORS[selectedQuality.value]
  const estBytes = frames * pixels * factor * SIZE_ESTIMATE_FACTOR
  const estMB = estBytes / (1024 * 1024)
  if (estMB < 0.1) { return '< 0.1 MB' }
  return `~${estMB.toFixed(1)} MB`
}

async function startConvert(): Promise<void> {
  errorMsg.value = ''
  if (files.value.length === 0) { return }

  for (const entry of files.value) {
    if (!entry.outputPath) {
      await selectOutputDir('.gif')
      break
    }
  }

  const unresolved = files.value.filter((f) => !f.outputPath)
  if (unresolved.length > 0) {
    errorMsg.value = '请为所有文件选择输出目录'
    return
  }

  progressStore.start('gif')

  try {
    const startTime = enableTrim.value ? trimStartSec.value : undefined
    const duration = enableTrim.value ? Math.max(0, trimEndSec.value - trimStartSec.value) : undefined
    // 单/批量共用同一份参数构造，仅接口选择不同
    const batchFiles = files.value.map((f) => ({
      input: f.path,
      output: f.outputPath,
      fps: fps.value,
      width: computedWidth.value,
      quality: selectedQuality.value,
      startTime,
      duration,
      loop: loopCount.value
    }))

    let failedCount: number
    if (files.value.length === 1) {
      failedCount = (await window.electronAPI.convertToGif(batchFiles[0])) ? 0 : 1
    } else {
      failedCount = (await window.electronAPI.batchConvertToGif({ files: batchFiles })).failed.length
    }

    // 用户已取消（progressStore.cancel() 已 reset），不再更新状态
    if (!progressStore.isProcessing) { return }
    if (failedCount === 0) {
      progressStore.finish()
    } else {
      errorMsg.value = `${failedCount} 个文件转换失败`
      progressStore.reset()
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    progressStore.reset()
  }
}

onMounted(() => {
  window.electronAPI.onProgress((info) => {
    progressStore.update(info)
  })
})

onUnmounted(() => {
  window.electronAPI?.removeProgressListener()
})
</script>

<template>
  <div class="page-container">
    <!-- 头部 -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500/20 to-yellow-500/20 flex items-center justify-center">
          <Image :size="20" class="text-warning" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频转GIF</h1>
      </div>
      <p class="text-text-secondary text-sm">将视频片段转换为高质量 GIF 动图，双通道调色板优化</p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- 左侧：文件列表 -->
      <div class="space-y-3">
        <FileDropZone @files-selected="addFiles" />

        <!-- 视频预览与截取时间轴 -->
        <GifTrimCard
          v-if="files.length > 0"
          :file="files[0]"
          v-model:enable-trim="enableTrim"
          v-model:trim-start="trimStartSec"
          v-model:trim-end="trimEndSec"
          v-model:max-duration="maxDuration"
        />

        <!-- 文件列表 -->
        <div v-if="files.length > 0" class="glass-card overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-bg-tertiary text-text-secondary text-xs">
                <th class="text-left p-3 font-medium">文件名</th>
                <th class="text-right p-3 font-medium">时长</th>
                <th class="text-right p-3 font-medium">预估</th>
                <th class="text-right p-3 font-medium w-10" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(entry, idx) in files"
                :key="entry.path"
                class="border-b border-bg-tertiary/50 group"
              >
                <td class="p-3">
                  <div class="flex items-center gap-2">
                    <Image :size="16" class="text-warning flex-shrink-0" />
                    <span class="truncate max-w-[200px]" :title="entry.path">
                      {{ getFileName(entry.path) }}
                    </span>
                  </div>
                </td>
                <td class="p-3 text-right text-text-secondary">
                  {{ entry.meta ? formatDuration(entry.meta.duration) : '...' }}
                </td>
                <td class="p-3 text-right text-warning font-mono">
                  {{ entry.meta ? estimateOutputSize(entry) : '...' }}
                </td>
                <td class="p-3 text-right">
                  <button
                    @click="removeFile(idx)"
                    class="p-1 rounded"
                  >
                    <X :size="14" class="text-danger" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 右侧：参数配置 -->
      <div class="space-y-3">
        <!-- 质量预设 -->
        <div class="glass-card">
          <h3 class="section-title">质量预设</h3>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="p in QUALITY_PRESETS"
              :key="p.value"
              @click="selectedQuality = p.value"
              class="quality-preset-btn p-3 rounded-lg text-left transition-all duration-200 border"
              :class="selectedQuality === p.value
                ? 'bg-warning/10 border-warning/50'
                : 'bg-bg-tertiary/50 border-transparent'"
            >
              <span class="text-sm font-medium text-text-primary block">{{ p.label }}</span>
              <span class="text-xs text-text-muted">{{ p.description }}</span>
            </button>
          </div>
        </div>

        <!-- 帧率滑块 -->
        <div class="glass-card">
          <h3 class="section-title">帧率: {{ fps }} FPS</h3>
          <input
            v-model.number="fps"
            type="range"
            min="5"
            max="30"
            step="1"
            class="w-full slider-base slider"
          />
          <div class="flex justify-between text-xs text-text-muted mt-1">
            <span>5</span>
            <span>10 (推荐)</span>
            <span>15</span>
            <span>20</span>
            <span>25</span>
            <span>30</span>
          </div>
        </div>

        <!-- 宽度选择 -->
        <div class="glass-card">
          <h3 class="section-title">输出分辨率</h3>
          <select v-model="selectedWidth" class="select-input w-full">
            <option
              v-for="opt in WIDTH_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- 循环设置 -->
        <div class="glass-card">
          <h3 class="section-title">循环设置</h3>
          <div class="flex gap-2">
            <button
              v-for="opt in LOOP_OPTIONS"
              :key="opt.val"
              @click="loopCount = opt.val"
              class="flex-1 py-2 rounded-lg text-sm transition-all border"
              :class="loopCount === opt.val
                ? 'bg-warning/10 border-warning/50 text-text-primary'
                : 'bg-bg-tertiary/50 border-transparent text-text-secondary'"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- 输出设置 -->
        <div class="glass-card">
          <h3 class="section-title">输出设置</h3>
          <button
            @click="selectOutputDir('.gif')"
            class="btn-secondary"
          >
            <Folder :size="16" />
            选择输出目录
          </button>
          <p v-if="files.length > 0 && files[0].outputPath" class="text-xs text-warning mt-2 truncate">
            {{ getDirName(files[0].outputPath) }}
          </p>
        </div>

        <!-- 错误提示 -->
        <div v-if="errorMsg" class="alert-danger">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- 开始按钮 -->
        <button
          @click="startConvert"
          :disabled="!canStart"
          class="btn-primary"
          :class="canStart
            ? 'bg-gradient-to-r from-orange-500 to-yellow-500'
            : 'bg-bg-tertiary text-text-muted'"
        >
          <Zap :size="18" />
          {{ progressStore.isProcessing ? '转换中...' : `开始转换 (${files.length} 个文件)` }}
        </button>

        <ProgressPanel />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../../assets/styles/gif";
</style>
