/** GifConvertView module type definitions */

export interface QualityPreset {
  value: 'high' | 'medium' | 'low'
  label: string
  description: string
}

export interface WidthOption {
  label: string
  value: string
}
