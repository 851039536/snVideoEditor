// 视频压缩参数管理：预设持久化、编码器能力检测与体积预估
import { reactive, ref, computed, watch, onUnmounted } from 'vue'
import type { ComputedRef } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import type { CompressPreset } from '@/stores/settings'
import { isGpuCodec, isVp9Codec } from '@/utils/codec'
import type { FileEntry } from '@/types/file'

/** 分辨率 → 推荐码率联动表 */
const RESOLUTION_BITRATE: Record<string, string> = {
  '1920:1080': '4000k',
  '1280:720': '2500k',
  '854:480': '350k',
  '640:360': '200k'
}

// CRF 每提高 6，x264 码率约减半：用指数模型做连续预估，替代离散查找表避免相邻档位同值
function estimateRatio(crf: number): number {
  if (crf <= 18) {
    return 0.7
  }
  return Math.max(0.02, 0.7 * Math.pow(2, -(crf - 18) / 6))
}

export function useCompressPreset(): {
  params: CompressPreset
  hasNvidiaEncoders: ComputedRef<boolean>
  hasQsvEncoders: ComputedRef<boolean>
  crfMax: ComputedRef<number>
  crfActive: ComputedRef<boolean>
  showPreset: ComputedRef<boolean>
  showNvencPreset: ComputedRef<boolean>
  showTwoPass: ComputedRef<boolean>
  loadAvailableEncoders: () => Promise<void>
  estimateOutputSize: (entry: FileEntry) => string
} {
  const settingsStore = useSettingsStore()

  // Compression params — initialized from persisted preset
  const params = reactive<CompressPreset>({ ...settingsStore.compressPreset })

  let disposed = false

  // Persist changes back to store (debounced)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  function savePreset(): void {
    settingsStore.setCompressPreset({ ...params })
  }

  function savePresetDebounced(): void {
    if (saveTimer) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(savePreset, 300)
  }

  // GPU encoder detection
  const isGpuEncoder = computed((): boolean => isGpuCodec(params.codec))
  const isVp9 = computed((): boolean => isVp9Codec(params.codec))

  // CRF range adapts per codec: H.264/H.265 use 0-51, VP9 uses 0-63
  const crfMax = computed((): number => (isVp9.value ? 63 : 51))
  const crfActive = computed((): boolean => !params.bitrate)
  const showPreset = computed((): boolean => !isGpuEncoder.value && !isVp9.value)
  const showNvencPreset = computed((): boolean => isGpuEncoder.value && params.codec.includes('nvenc'))
  // 2-Pass 可用条件的唯一来源：固定码率 + CPU 编码
  const showTwoPass = computed((): boolean => !isGpuEncoder.value && !!params.bitrate)

  const availableEncoders = ref<string[]>([])
  const hasNvidiaEncoders = computed((): boolean => availableEncoders.value.some((e) => e.includes('nvenc')))
  const hasQsvEncoders = computed((): boolean => availableEncoders.value.some((e) => e.includes('qsv')))

  // Clamp crfValue when switching to a codec with a lower max
  watch(crfMax, (max) => {
    if (params.crfValue > max) {
      params.crfValue = max
    }
  })

  // resolution → bitrate linkage (does not clear bitrate for 'original')
  watch(() => params.resolution, (res) => {
    if (res && res !== 'original' && RESOLUTION_BITRATE[res]) {
      params.bitrate = RESOLUTION_BITRATE[res]
    }
  })

  // Persist preset on any param change + disable twoPass when inapplicable
  watch(params, () => {
    if (!showTwoPass.value) {
      params.twoPass = false
    }
    savePresetDebounced()
  })

  async function loadAvailableEncoders(): Promise<void> {
    try {
      const encoders = await window.electronAPI.getAvailableEncoders()
      if (disposed) {
        return
      }
      availableEncoders.value = encoders
      // 校验持久化的 codec 是否在可用编码器列表中，防止跨机器 nvenc 残留
      if (encoders.length > 0 && !encoders.includes(params.codec)) {
        params.codec = 'libx264'
      } else if (encoders.length === 0) {
        console.warn('[Compress] 未能获取可用编码器列表，ffmpeg 可能启动失败或被安全软件拦截')
        if (isGpuEncoder.value) {
          params.codec = 'libx264'
        }
      }
    } catch (e) {
      console.warn('[Compress] 获取编码器列表异常:', e)
    }
  }

  function estimateOutputSize(entry: FileEntry): string {
    if (!entry.meta || entry.meta.size === 0) {
      return '未知'
    }

    if (params.bitrate && entry.meta.duration > 0) {
      // Fixed bitrate mode: size ≈ bitrate × duration / 8
      const bpsMatch = params.bitrate.match(/^(\d+)k?$/)
      if (bpsMatch) {
        const kbps = parseInt(bpsMatch[1], 10)
        const audioKbps = parseInt(params.audioBitrate) || 32
        const totalKbps = kbps + audioKbps
        const estMB = (totalKbps * 1000 * entry.meta.duration) / 8 / (1024 * 1024)
        return `${Math.max(1, Math.round(estMB))} MB`
      }
    }

    // CRF mode with codec factor
    const originalMB = entry.meta.size / (1024 * 1024)
    // CRF < 18 (near-lossless / lossless) typically produces larger or equal files
    if (params.crfValue < 18) {
      return '≥ 原文件'
    }
    const ratio = estimateRatio(params.crfValue)
    // H.265/HEVC/VP9 ~30% more efficient than H.264
    const codecFactor =
      params.codec.includes('265') || params.codec.includes('hevc') || isVp9.value ? 0.7 : 1.0
    const estMB = originalMB * ratio * codecFactor
    return `${Math.max(1, Math.round(estMB))} MB`
  }

  onUnmounted(() => {
    disposed = true
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  })

  return {
    params,
    hasNvidiaEncoders,
    hasQsvEncoders,
    crfMax,
    crfActive,
    showPreset,
    showNvencPreset,
    showTwoPass,
    loadAvailableEncoders,
    estimateOutputSize
  }
}
