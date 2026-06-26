import { ElectronAPI } from '@electron-toolkit/preload'

export interface ProgressInfo {
  type: 'split' | 'merge' | 'compress' | 'encrypt' | 'decrypt'
  percent: number
  currentFile: number
  totalFiles: number
  speed: string
  eta: string
}

export interface VideoMeta {
  duration: number
  width: number
  height: number
  bitrate: number
  codec: string
  size: number
}

export interface FileInfo {
  size: number
  ext: string
  name: string
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Record<string, unknown>
  }
}
