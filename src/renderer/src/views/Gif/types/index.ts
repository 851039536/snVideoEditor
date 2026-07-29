/** GIF 转换模块类型定义 */

export interface QualityPreset {
  value: 'high' | 'medium' | 'low'
  label: string
  description: string
}

export interface WidthOption {
  label: string
  value: string
}
