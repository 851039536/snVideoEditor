// 色彩调整参数管理组合式函数
import { reactive, computed } from 'vue'
import type { ColorParams, ColorPreset } from '@/views/ColorAdjust/types'

/** 默认参数（无调整） */
const DEFAULT_PARAMS: ColorParams = {
  brightness: 0,
  contrast: 100,
  saturation: 100,
  temperature: 0
}

/** 内置预设列表 */
export const COLOR_PRESETS: ColorPreset[] = [
  { name: '原始', params: { ...DEFAULT_PARAMS } },
  { name: '暖色调', params: { brightness: 5, contrast: 105, saturation: 110, temperature: 40 } },
  { name: '冷色调', params: { brightness: 0, contrast: 105, saturation: 95, temperature: -40 } },
  { name: '高对比', params: { brightness: 0, contrast: 140, saturation: 120, temperature: 0 } },
  { name: '复古', params: { brightness: 5, contrast: 90, saturation: 70, temperature: 25 } },
  { name: '鲜艳', params: { brightness: 5, contrast: 115, saturation: 160, temperature: 10 } }
]

export function useColorParams(): {
  params: ColorParams
  presets: ColorPreset[]
  applyPreset: (preset: ColorPreset) => void
  resetParams: () => void
  toFfmpegParams: () => { brightness: number; contrast: number; saturation: number; temperature: number }
  previewFilterStyle: ReturnType<typeof computed<string>>
  isDefault: ReturnType<typeof computed<boolean>>
} {
  const params = reactive<ColorParams>({ ...DEFAULT_PARAMS })

  /** 应用预设 */
  function applyPreset(preset: ColorPreset): void {
    params.brightness = preset.params.brightness
    params.contrast = preset.params.contrast
    params.saturation = preset.params.saturation
    params.temperature = preset.params.temperature
  }

  /** 重置为默认值 */
  function resetParams(): void {
    params.brightness = DEFAULT_PARAMS.brightness
    params.contrast = DEFAULT_PARAMS.contrast
    params.saturation = DEFAULT_PARAMS.saturation
    params.temperature = DEFAULT_PARAMS.temperature
  }

  /** UI 值转换为 ffmpeg 滤镜参数 */
  function toFfmpegParams(): { brightness: number; contrast: number; saturation: number; temperature: number } {
    return {
      brightness: params.brightness / 100,
      contrast: params.contrast / 100,
      saturation: params.saturation / 100,
      temperature: params.temperature
    }
  }

  /** CSS 滤镜预览样式（近似效果） */
  const previewFilterStyle = computed((): string => {
    const parts: string[] = []

    // 亮度：CSS brightness 以 1 为基准
    const cssBrightness = 1 + params.brightness / 100
    if (cssBrightness !== 1) {
      parts.push(`brightness(${cssBrightness.toFixed(3)})`)
    }

    // 对比度：CSS contrast 以 1 为基准
    const cssContrast = params.contrast / 100
    if (cssContrast !== 1) {
      parts.push(`contrast(${cssContrast.toFixed(3)})`)
    }

    // 饱和度：CSS saturate 以 1 为基准
    const cssSaturation = params.saturation / 100
    if (cssSaturation !== 1) {
      parts.push(`saturate(${cssSaturation.toFixed(3)})`)
    }

    // 色温近似：暖色用 sepia，冷色用 hue-rotate
    if (params.temperature > 0) {
      parts.push(`sepia(${(params.temperature / 100 * 0.35).toFixed(3)})`)
    } else if (params.temperature < 0) {
      parts.push(`hue-rotate(${(params.temperature / 100 * 15).toFixed(1)}deg)`)
    }

    return parts.length > 0 ? parts.join(' ') : 'none'
  })

  /** 是否为默认参数（无调整） */
  const isDefault = computed((): boolean => {
    return (
      params.brightness === DEFAULT_PARAMS.brightness &&
      params.contrast === DEFAULT_PARAMS.contrast &&
      params.saturation === DEFAULT_PARAMS.saturation &&
      params.temperature === DEFAULT_PARAMS.temperature
    )
  })

  return {
    params,
    presets: COLOR_PRESETS,
    applyPreset,
    resetParams,
    toFfmpegParams,
    previewFilterStyle,
    isDefault
  }
}
