export interface ProgressInfo {
  type: 'split' | 'merge' | 'compress' | 'encrypt' | 'decrypt' | 'gif' | 'download'
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
    openFolder: (folderPath: string) => Promise<string>
    getCommonPaths: () => Promise<{ desktop: string; downloads: string }>

  // File operations
  selectVideoFiles: () => Promise<string[]>
  selectSingleVideoFile: () => Promise<string | null>
  selectDirectory: () => Promise<string | null>
  selectPlayerFiles: () => Promise<string[]>
  selectSavePath: (defaultName: string, defaultExt: string) => Promise<string | null>
  getFileInfo: (filePath: string) => Promise<FileInfo>
  scanVideoFiles: (dirPath: string) => Promise<string[]>
  scanPlayerFiles: (dirPath: string) => Promise<string[]>
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
    audioBitrate?: string
  }) => Promise<boolean>

  batchCompress: (opts: {
    files: { input: string; output: string; crf: number; resolution: string; bitrate: string; codec: string; audioBitrate?: string }[]
  }) => Promise<{ success: number; failed: string[] }>

  // GIF conversion
  convertToGif: (opts: {
    input: string
    output: string
    fps: number
    width: number
    quality: 'high' | 'medium' | 'low'
    startTime?: number
    duration?: number
    loop: number
  }) => Promise<boolean>

  batchConvertToGif: (opts: {
    files: {
      input: string
      output: string
      fps: number
      width: number
      quality: 'high' | 'medium' | 'low'
      startTime?: number
      duration?: number
      loop: number
    }[]
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

  decryptForPlayback: (input: string, password: string, tempDir: string) => Promise<string>

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

  getAvailableEncoders: () => Promise<string[]>

  // Download
  downloadVideo: (opts: {
    url: string
    output: string
    headers?: Record<string, string>
  }) => Promise<boolean>

  fetchPageM3u8: (pageUrl: string) => Promise<{
    m3u8Urls: string[]
    pageTitle: string
    pageUrl: string
  }>

  fetchM3u8Variants: (
    m3u8Url: string,
    headers?: Record<string, string>
  ) => Promise<
    { url: string; resolution: string; height: number; label: string; bandwidth?: number }[]
  >

  // Download queue
  enqueueDownload: (opts: {
    url: string
    output: string
    headers?: Record<string, string>
    fileName?: string
  }) => Promise<{ queueId: string }>

  cancelDownloadQueue: () => Promise<void>

  cancelQueueItem: (id: string) => Promise<boolean>

  removeQueueItem: (id: string) => Promise<boolean>

  clearQueueTerminal: () => Promise<number>

  retryQueueItem: (id: string) => Promise<boolean>

  getQueueStatus: () => Promise<{
    items: {
      id: string
      url: string
      output: string
      headers?: Record<string, string>
      status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
      progress: { percent: number; speed: string; eta: string }
      error?: string
      addedAt: number
      fileName: string
    }[]
    isProcessing: boolean
    activeIds: string[]
    concurrency: number
  }>

  setDownloadConcurrency: (n: number) => Promise<void>

  onQueueProgress: (callback: (data: {
    queueId: string
    percent: number
    speed: string
    eta: string
  }) => void) => void

  onQueueUpdate: (callback: (status: {
    items: {
      id: string
      url: string
      output: string
      headers?: Record<string, string>
      status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
      progress: { percent: number; speed: string; eta: string }
      error?: string
      addedAt: number
      fileName: string
    }[]
    isProcessing: boolean
    activeIds: string[]
    concurrency: number
  }) => void) => void

  removeQueueListeners: () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
