import { contextBridge, ipcRenderer } from 'electron'

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

const electronAPI = {
  // App info
  getTempDir: (): Promise<string> =>
    ipcRenderer.invoke('app:getTempDir'),

  // File operations
  selectVideoFiles: (): Promise<string[]> =>
    ipcRenderer.invoke('file:selectVideoFiles'),

  selectSingleVideoFile: (): Promise<string | null> =>
    ipcRenderer.invoke('file:selectSingleVideoFile'),

  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('file:selectDirectory'),

  selectSavePath: (defaultName: string, defaultExt: string): Promise<string | null> =>
    ipcRenderer.invoke('file:selectSavePath', defaultName, defaultExt),

  getFileInfo: (filePath: string): Promise<FileInfo> =>
    ipcRenderer.invoke('file:getInfo', filePath),

  scanVideoFiles: (dirPath: string): Promise<string[]> =>
    ipcRenderer.invoke('file:scanVideoFiles', dirPath),

  generateCryptoOutputPath: (inputPath: string, isEncrypt: boolean): Promise<string> =>
    ipcRenderer.invoke('file:generateCryptoOutputPath', inputPath, isEncrypt),

  formatFileSize: (bytes: number): Promise<string> =>
    ipcRenderer.invoke('file:formatFileSize', bytes),

  formatDuration: (seconds: number): Promise<string> =>
    ipcRenderer.invoke('file:formatDuration', seconds),

  // Split/Merge
  splitVideo: (opts: {
    input: string
    output: string
    startTime: string
    duration: string
  }): Promise<boolean> =>
    ipcRenderer.invoke('video:split', opts),

  mergeVideos: (opts: { inputs: string[]; output: string }): Promise<boolean> =>
    ipcRenderer.invoke('video:merge', opts),

  // Video meta & compress
  getVideoMeta: (filePath: string): Promise<VideoMeta> =>
    ipcRenderer.invoke('video:getMeta', filePath),

  compressVideo: (opts: {
    input: string
    output: string
    crf: number
    resolution: string
    bitrate: string
    codec: string
  }): Promise<boolean> =>
    ipcRenderer.invoke('video:compress', opts),

  batchCompress: (opts: {
    files: { input: string; output: string; crf: number; resolution: string; bitrate: string; codec: string }[]
  }): Promise<{ success: number; failed: string[] }> =>
    ipcRenderer.invoke('video:batchCompress', opts),

  // Crypto
  encryptFile: (opts: {
    input: string
    output: string
    password: string
  }): Promise<boolean> =>
    ipcRenderer.invoke('crypto:encrypt', opts),

  decryptFile: (opts: {
    input: string
    output: string
    password: string
  }): Promise<boolean> =>
    ipcRenderer.invoke('crypto:decrypt', opts),

  batchEncrypt: (opts: {
    files: { input: string; output: string }[]
    password: string
  }): Promise<{ success: number; failed: string[] }> =>
    ipcRenderer.invoke('crypto:batchEncrypt', opts),

  batchDecrypt: (opts: {
    files: { input: string; output: string }[]
    password: string
  }): Promise<{ success: number; failed: string[] }> =>
    ipcRenderer.invoke('crypto:batchDecrypt', opts),

  // Progress
  onProgress: (callback: (info: ProgressInfo) => void): void => {
    ipcRenderer.removeAllListeners('operation:progress')
    ipcRenderer.on('operation:progress', (_event, data: ProgressInfo) => {
      callback(data)
    })
  },

  removeProgressListener: (): void => {
    ipcRenderer.removeAllListeners('operation:progress')
  },

  // Cancel
  cancelOperation: (): Promise<boolean> =>
    ipcRenderer.invoke('operation:cancel'),

  // Window controls
  windowMinimize: (): void => {
    ipcRenderer.send('window:minimize')
  },

  windowMaximize: (): void => {
    ipcRenderer.send('window:maximize')
  },

  windowClose: (): void => {
    ipcRenderer.send('window:close')
  },

  windowIsMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke('window:isMaximized'),

  onMaximizeChange: (callback: (isMaximized: boolean) => void): void => {
    ipcRenderer.on('window:maximizeChange', (_event, isMaximized: boolean) => {
      callback(isMaximized)
    })
  },

  removeMaximizeChangeListener: (): void => {
    ipcRenderer.removeAllListeners('window:maximizeChange')
  },

  // File deletion
  deleteFile: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('file:delete', filePath)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electronAPI = electronAPI
}
