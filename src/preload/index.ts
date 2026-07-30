import { contextBridge, ipcRenderer } from 'electron';

export interface ProgressInfo {
  type: 'split' | 'merge' | 'compress' | 'encrypt' | 'decrypt' | 'gif' | 'download' | 'screenshot' | 'thumbnail' | 'tts';
  percent: number;
  currentFile: number;
  totalFiles: number;
  speed: string;
  eta: string;
  currentFileName?: string;
}

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  bitrate: number;
  codec: string;
  size: number;
}

export interface AudioMeta {
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string;
  bitrate: number;
  size: number;
}

export interface FileInfo {
  size: number;
  ext: string;
  name: string;
}

// 下载队列 DTO：渲染侧唯一类型来源（types/file.ts 从此处重新导出）。
// 字段需与后端 src/main/modules/download-queue.ts 的 QueueItem/QueueStatus 保持对齐。
export type QueueStatusType = 'pending' | 'downloading' | 'merging' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface QueueItemDTO {
  id: string;
  url: string;
  output: string;
  headers?: Record<string, string>;
  cacheDir?: string;
  status: QueueStatusType;
  progress: { percent: number; speed: string; eta: string };
  error?: string;
  addedAt: number;
  fileName: string;
}

export interface QueueStatusDTO {
  items: QueueItemDTO[];
  isProcessing: boolean;
  activeIds: string[];
  concurrency: number;
}

const electronAPI = {
  // App info
  getTempDir: (): Promise<string> => ipcRenderer.invoke('app:getTempDir'),

  openFolder: (folderPath: string): Promise<string> => ipcRenderer.invoke('app:openFolder', folderPath),

  getCommonPaths: (): Promise<{ desktop: string; downloads: string }> => ipcRenderer.invoke('app:getCommonPaths'),

  // File operations
  selectVideoFiles: (): Promise<string[]> => ipcRenderer.invoke('file:selectVideoFiles'),

  selectSingleVideoFile: (): Promise<string | null> => ipcRenderer.invoke('file:selectSingleVideoFile'),

  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('file:selectDirectory'),

  selectPlayerFiles: (): Promise<string[]> => ipcRenderer.invoke('file:selectPlayerFiles'),

  selectSavePath: (defaultName: string, defaultExt: string): Promise<string | null> =>
    ipcRenderer.invoke('file:selectSavePath', defaultName, defaultExt),

  getFileInfo: (filePath: string): Promise<FileInfo> => ipcRenderer.invoke('file:getInfo', filePath),

  scanVideoFiles: (dirPath: string): Promise<string[]> => ipcRenderer.invoke('file:scanVideoFiles', dirPath),

  scanPlayerFiles: (dirPath: string): Promise<string[]> => ipcRenderer.invoke('file:scanPlayerFiles', dirPath),

  generateCryptoOutputPath: (inputPath: string, isEncrypt: boolean): Promise<string> =>
    ipcRenderer.invoke('file:generateCryptoOutputPath', inputPath, isEncrypt),

  formatFileSize: (bytes: number): Promise<string> => ipcRenderer.invoke('file:formatFileSize', bytes),

  formatDuration: (seconds: number): Promise<string> => ipcRenderer.invoke('file:formatDuration', seconds),

  selectAudioFiles: (): Promise<string[]> => ipcRenderer.invoke('file:selectAudioFiles'),

  // Split/Merge
  splitVideo: (opts: { input: string; output: string; startTime: string; duration: string }): Promise<boolean> =>
    ipcRenderer.invoke('video:split', opts),

  mergeVideos: (opts: { inputs: string[]; output: string }): Promise<boolean> =>
    ipcRenderer.invoke('video:merge', opts),

  // Video meta & compress
  getVideoMeta: (filePath: string): Promise<VideoMeta> => ipcRenderer.invoke('video:getMeta', filePath),

  // Audio meta
  getAudioMeta: (filePath: string): Promise<AudioMeta> => ipcRenderer.invoke('audio:getMeta', filePath),

  compressVideo: (opts: {
    input: string;
    output: string;
    crf: number;
    resolution: string;
    bitrate: string;
    codec: string;
    audioBitrate?: string;
    preset?: string;
    nvencPreset?: string;
    twoPass?: boolean;
  }): Promise<boolean> => ipcRenderer.invoke('video:compress', opts),

  batchCompress: (opts: {
    files: {
      input: string;
      output: string;
      crf: number;
      resolution: string;
      bitrate: string;
      codec: string;
      audioBitrate?: string;
      preset?: string;
      nvencPreset?: string;
      twoPass?: boolean;
    }[];
  }): Promise<{
    success: number;
    successFiles: string[];
    failed: { input: string; error: string }[];
    fallbacks: { input: string; originalCodec: string; fallbackCodec: string }[];
  }> => ipcRenderer.invoke('video:batchCompress', opts),

  // GIF conversion
  convertToGif: (opts: {
    input: string;
    output: string;
    fps: number;
    width: number;
    quality: 'high' | 'medium' | 'low';
    startTime?: number;
    duration?: number;
    loop: number;
  }): Promise<boolean> => ipcRenderer.invoke('video:convertToGif', opts),

  batchConvertToGif: (opts: {
    files: {
      input: string;
      output: string;
      fps: number;
      width: number;
      quality: 'high' | 'medium' | 'low';
      startTime?: number;
      duration?: number;
      loop: number;
    }[];
  }): Promise<{ success: number; failed: string[] }> => ipcRenderer.invoke('video:batchConvertToGif', opts),

  // Crypto
  encryptFile: (opts: { input: string; output: string; password: string }): Promise<boolean> =>
    ipcRenderer.invoke('crypto:encrypt', opts),

  decryptFile: (opts: { input: string; output: string; password: string }): Promise<boolean> =>
    ipcRenderer.invoke('crypto:decrypt', opts),

  batchEncrypt: (opts: {
    files: { input: string; output: string }[];
    password: string;
  }): Promise<{ success: number; failed: string[] }> => ipcRenderer.invoke('crypto:batchEncrypt', opts),

  batchDecrypt: (opts: {
    files: { input: string; output: string }[];
    password: string;
  }): Promise<{ success: number; failed: string[] }> => ipcRenderer.invoke('crypto:batchDecrypt', opts),

  decryptForPlayback: (input: string, password: string, tempDir: string): Promise<string> =>
    ipcRenderer.invoke('video:decryptForPlayback', input, password, tempDir),

  // Screenshot
  captureScreenshot: (opts: { input: string; output: string; time: number }): Promise<boolean> =>
    ipcRenderer.invoke('video:screenshot', opts),

  // Thumbnails
  generateThumbnails: (opts: {
    input: string;
    outputDir: string;
    thumbWidth?: number;
    thumbHeight?: number;
    interval?: number;
    cols?: number;
  }): Promise<{ spriteUrl: string; vttUrl: string; count: number; interval: number }> =>
    ipcRenderer.invoke('video:generateThumbnails', opts),

  // TTS
  selectTextFiles: (): Promise<string[]> => ipcRenderer.invoke('file:selectTextFiles'),

  scanTextFiles: (dirPath: string): Promise<string[]> => ipcRenderer.invoke('file:scanTextFiles', dirPath),

  ttsGetVoices: (): Promise<{ id: string; label: string; gender: string; style: string }[]> =>
    ipcRenderer.invoke('tts:getVoices'),

  ttsPreview: (opts: { text: string; voice: string; rate: number }): Promise<string> =>
    ipcRenderer.invoke('tts:preview', opts),

  ttsBatchConvert: (opts: {
    files: { input: string; output: string }[];
    voice: string;
    rate: number;
  }): Promise<{ success: number; failed: string[] }> => ipcRenderer.invoke('tts:batchConvert', opts),

  // Progress
  onProgress: (callback: (info: ProgressInfo) => void): void => {
    ipcRenderer.removeAllListeners('operation:progress');
    ipcRenderer.on('operation:progress', (_event, data: ProgressInfo) => {
      callback(data);
    });
  },

  removeProgressListener: (): void => {
    ipcRenderer.removeAllListeners('operation:progress');
  },

  // Cancel
  cancelOperation: (): Promise<boolean> => ipcRenderer.invoke('operation:cancel'),

  // Window controls
  windowMinimize: (): void => {
    ipcRenderer.send('window:minimize');
  },

  windowMaximize: (): void => {
    ipcRenderer.send('window:maximize');
  },

  windowClose: (): void => {
    ipcRenderer.send('window:close');
  },

  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),

  onMaximizeChange: (callback: (isMaximized: boolean) => void): void => {
    ipcRenderer.on('window:maximizeChange', (_event, isMaximized: boolean) => {
      callback(isMaximized);
    });
  },

  removeMaximizeChangeListener: (): void => {
    ipcRenderer.removeAllListeners('window:maximizeChange');
  },

  // File deletion
  deleteFile: (filePath: string): Promise<boolean> => ipcRenderer.invoke('file:delete', filePath),

  getAvailableEncoders: (): Promise<string[]> => ipcRenderer.invoke('ffmpeg:getAvailableEncoders'),

  // Download
  /**
   * @deprecated Legacy single-shot download channel. The UI now uses the download
   * queue (enqueueDownload). Retained only for backward compatibility.
   */
  downloadVideo: (opts: { url: string; output: string; headers?: Record<string, string> }): Promise<boolean> =>
    ipcRenderer.invoke('video:download', opts),

  fetchPageM3u8: (
    pageUrl: string
  ): Promise<{
    m3u8Urls: string[];
    pageTitle: string;
    pageUrl: string;
    cookies: { domain: string; name: string; value: string }[];
  }> => ipcRenderer.invoke('video:fetchPageM3u8Browser', pageUrl),

  fetchM3u8Variants: (
    m3u8Url: string,
    headers?: Record<string, string>
  ): Promise<{ url: string; resolution: string; height: number; label: string; bandwidth?: number }[]> =>
    ipcRenderer.invoke('video:fetchM3u8Variants', m3u8Url, headers),

  // Download queue
  enqueueDownload: (opts: {
    url: string;
    output: string;
    headers?: Record<string, string>;
    fileName?: string;
  }): Promise<{ queueId: string }> => ipcRenderer.invoke('download:enqueue', opts),

  cancelDownloadQueue: (): Promise<void> => ipcRenderer.invoke('download:cancelQueue'),

  cancelQueueItem: (id: string): Promise<boolean> => ipcRenderer.invoke('download:cancelItem', id),

  pauseQueueItem: (id: string): Promise<boolean> => ipcRenderer.invoke('download:pauseItem', id),

  resumeQueueItem: (id: string): Promise<boolean> => ipcRenderer.invoke('download:resumeItem', id),

  removeQueueItem: (id: string): Promise<boolean> => ipcRenderer.invoke('download:removeQueueItem', id),

  clearQueueTerminal: (): Promise<number> => ipcRenderer.invoke('download:clearTerminal'),

  retryQueueItem: (id: string): Promise<boolean> => ipcRenderer.invoke('download:retryQueueItem', id),

  getQueueStatus: (): Promise<QueueStatusDTO> => ipcRenderer.invoke('download:getStatus'),

  setDownloadConcurrency: (n: number): Promise<void> => ipcRenderer.invoke('download:setConcurrency', n),

  onQueueProgress: (
    callback: (data: { queueId: string; percent: number; speed: string; eta: string }) => void
  ): void => {
    ipcRenderer.removeAllListeners('download:queue-progress');
    ipcRenderer.on('download:queue-progress', (_event, data) => {
      callback(data);
    });
  },

  onQueueUpdate: (callback: (status: QueueStatusDTO) => void): void => {
    ipcRenderer.removeAllListeners('download:queue-update');
    ipcRenderer.on('download:queue-update', (_event, data) => {
      callback(data);
    });
  },

  removeQueueListeners: (): void => {
    ipcRenderer.removeAllListeners('download:queue-progress');
    ipcRenderer.removeAllListeners('download:queue-update');
  },

  // Download history
  checkDownloadDuplicate: (
    fileName: string
  ): Promise<{
    fileName: string;
    url: string;
    output: string;
    completedAt: number;
    fileSize?: number;
  } | null> => ipcRenderer.invoke('download:checkDuplicate', fileName),

  getDownloadHistoryPath: (): Promise<string> => ipcRenderer.invoke('download:getHistoryPath'),

  getDownloadHistory: (): Promise<
    {
      fileName: string;
      url: string;
      output: string;
      completedAt: number;
      fileSize?: number;
    }[]
  > => ipcRenderer.invoke('download:getHistory'),

  clearDownloadHistory: (): Promise<void> => ipcRenderer.invoke('download:clearHistory'),

  // Dialog
  confirmDialog: (message: string, title?: string): Promise<boolean> =>
    ipcRenderer.invoke('dialog:confirm', message, title)
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore
  window.electronAPI = electronAPI;
}
