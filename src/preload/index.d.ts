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

export interface ElectronAPI {
  // App info
  getTempDir: () => Promise<string>

  // File operations
  selectVideoFiles: () => Promise<string[]>
  selectSingleVideoFile: () => Promise<string | null>
  selectDirectory: () => Promise<string | null>
  selectSavePath: (defaultName: string, defaultExt: string) => Promise<string | null>
  getFileInfo: (filePath: string) => Promise<FileInfo>
  scanVideoFiles: (dirPath: string) => Promise<string[]>
  generateCryptoOutputPath: (inputPath: string, isEncrypt: boolean) => Promise<string>
  formatFileSize: (bytes: number) => Promise<string>
  formatDuration: (seconds: number) => Promise<string>

  // Split/Merge
  splitVideo: (opts: {
    input: string
    output: string
    startTime: string
    duration: string
  }) => Promise<boolean>

  mergeVideos: (opts: { inputs: string[]; output: string }) => Promise<boolean>

  // Video meta & compress
  getVideoMeta: (filePath: string) => Promise<VideoMeta>

  compressVideo: (opts: {
    input: string
    output: string
    crf: number
    resolution: string
    bitrate: string
    codec: string
  }) => Promise<boolean>

  batchCompress: (opts: {
    files: { input: string; output: string; crf: number; resolution: string; bitrate: string; codec: string }[]
  }) => Promise<{ success: number; failed: string[] }>

  // Crypto
  encryptFile: (opts: {
    input: string
    output: string
    password: string
  }) => Promise<boolean>

  decryptFile: (opts: {
    input: string
    output: string
    password: string
  }) => Promise<boolean>

  batchEncrypt: (opts: {
    files: { input: string; output: string }[]
    password: string
  }) => Promise<{ success: number; failed: string[] }>

  batchDecrypt: (opts: {
    files: { input: string; output: string }[]
    password: string
  }) => Promise<{ success: number; failed: string[] }>

  // Progress
  onProgress: (callback: (info: ProgressInfo) => void) => void
  removeProgressListener: () => void

  // Cancel
  cancelOperation: () => Promise<boolean>

  // Window controls
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
  windowIsMaximized: () => Promise<boolean>
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => void
  removeMaximizeChangeListener: () => void

  // File deletion
  deleteFile: (filePath: string) => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
