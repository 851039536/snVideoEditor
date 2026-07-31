// 格式转换功能类型定义

/** 媒体类型 */
export type MediaKind = 'video' | 'audio'

/** 格式选项 */
export interface FormatOption {
  /** 显示名称，如 'MP4' */
  label: string
  /** 扩展名（不含点），如 'mp4' */
  value: string
  /** 媒体类型 */
  kind: MediaKind
}

/** 支持的视频格式 */
export const VIDEO_FORMATS: FormatOption[] = [
  { label: 'MP4', value: 'mp4', kind: 'video' },
  { label: 'MKV', value: 'mkv', kind: 'video' },
  { label: 'AVI', value: 'avi', kind: 'video' },
  { label: 'MOV', value: 'mov', kind: 'video' },
  { label: 'WebM', value: 'webm', kind: 'video' }
]

/** 支持的音频格式 */
export const AUDIO_FORMATS: FormatOption[] = [
  { label: 'MP3', value: 'mp3', kind: 'audio' },
  { label: 'WAV', value: 'wav', kind: 'audio' },
  { label: 'FLAC', value: 'flac', kind: 'audio' },
  { label: 'AAC', value: 'aac', kind: 'audio' },
  { label: 'OGG', value: 'ogg', kind: 'audio' }
]
