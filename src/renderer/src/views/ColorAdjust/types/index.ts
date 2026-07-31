// 色彩调整功能类型定义

/** 色彩参数（UI 层值域） */
export interface ColorParams {
  /** 亮度，-100 ~ 100，默认 0 */
  brightness: number
  /** 对比度，0 ~ 200，默认 100 */
  contrast: number
  /** 饱和度，0 ~ 300，默认 100 */
  saturation: number
  /** 色温，-100(冷) ~ 100(暖)，默认 0 */
  temperature: number
}

/** 色彩预设 */
export interface ColorPreset {
  name: string
  params: ColorParams
}
