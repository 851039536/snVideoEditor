// TTS 视图模块类型定义

export interface TtsFileEntry {
  path: string
  fileName: string
  size: number
  status: 'pending' | 'converting' | 'done' | 'error'
  outputPath?: string
}

export interface TtsVoiceOption {
  id: string
  label: string
  gender: string
  style: string
}
