export interface ProgressInfo {
  type: 'split' | 'merge' | 'compress' | 'encrypt' | 'decrypt' | 'gif' | 'download' | 'screenshot' | 'thumbnail' | 'tts' | 'color';
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

export interface HistoryEntry {
  fileName: string;
  url: string;
  output: string;
  completedAt: number;
  fileSize?: number;
}

// Download queue DTOs. Field shape MUST stay aligned with
// src/renderer/src/types/file.ts and src/main/modules/download-queue.ts.
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

export interface TtsVoicePreset {
  id: string;
  label: string;
  gender: string;
  style: string;
}

export interface ElectronAPI {
  // App info
  getTempDir: () => Promise<string>;
  openFolder: (folderPath: string) => Promise<string>;
  getCommonPaths: () => Promise<{ desktop: string; downloads: string }>;

  // File operations
  selectVideoFiles: () => Promise<string[]>;
  selectSingleVideoFile: () => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;
  selectPlayerFiles: () => Promise<string[]>;
  selectSavePath: (defaultName: string, defaultExt: string) => Promise<string | null>;
  getFileInfo: (filePath: string) => Promise<FileInfo>;
  scanVideoFiles: (dirPath: string) => Promise<string[]>;
  scanPlayerFiles: (dirPath: string) => Promise<string[]>;
  generateCryptoOutputPath: (inputPath: string, isEncrypt: boolean) => Promise<string>;
  formatFileSize: (bytes: number) => Promise<string>;
  formatDuration: (seconds: number) => Promise<string>;

  selectAudioFiles: () => Promise<string[]>;

  // Split/Merge
  splitVideo: (opts: { input: string; output: string; startTime: string; duration: string }) => Promise<boolean>;

  mergeVideos: (opts: { inputs: string[]; output: string }) => Promise<boolean>;

  // Video meta & compress
  getVideoMeta: (filePath: string) => Promise<VideoMeta>;

  // Audio meta
  getAudioMeta: (filePath: string) => Promise<AudioMeta>;

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
  }) => Promise<boolean>;

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
  }) => Promise<{
    success: number;
    successFiles: string[];
    failed: { input: string; error: string }[];
    fallbacks: { input: string; originalCodec: string; fallbackCodec: string }[];
  }>;

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
  }) => Promise<boolean>;

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
  }) => Promise<{ success: number; failed: string[] }>;

  // 色彩调整
  adjustColor: (opts: {
    input: string;
    output: string;
    brightness: number;
    contrast: number;
    saturation: number;
    temperature: number;
  }) => Promise<boolean>;
  
  batchAdjustColor: (opts: {
    files: {
      input: string;
      output: string;
      brightness: number;
      contrast: number;
      saturation: number;
      temperature: number;
    }[];
  }) => Promise<{ success: number; failed: string[] }>;
  
  // Crypto
  encryptFile: (opts: { input: string; output: string; password: string }) => Promise<boolean>;

  decryptFile: (opts: { input: string; output: string; password: string }) => Promise<boolean>;

  batchEncrypt: (opts: {
    files: { input: string; output: string }[];
    password: string;
  }) => Promise<{ success: number; failed: string[] }>;

  batchDecrypt: (opts: {
    files: { input: string; output: string }[];
    password: string;
  }) => Promise<{ success: number; failed: string[] }>;

  decryptForPlayback: (input: string, password: string, tempDir: string) => Promise<string>;

  // Screenshot
  captureScreenshot: (opts: { input: string; output: string; time: number }) => Promise<boolean>;

  // Thumbnails
  generateThumbnails: (opts: {
    input: string;
    outputDir: string;
    thumbWidth?: number;
    thumbHeight?: number;
    interval?: number;
    cols?: number;
  }) => Promise<{ spriteUrl: string; vttUrl: string; count: number; interval: number }>;

  // TTS
  selectTextFiles: () => Promise<string[]>;
  scanTextFiles: (dirPath: string) => Promise<string[]>;
  ttsGetVoices: () => Promise<TtsVoicePreset[]>;
  ttsPreview: (opts: { text: string; voice: string; rate: number }) => Promise<string>;
  ttsBatchConvert: (opts: {
    files: { input: string; output: string }[];
    voice: string;
    rate: number;
  }) => Promise<{ success: number; failed: string[] }>;

  // Progress
  onProgress: (callback: (info: ProgressInfo) => void) => void;
  removeProgressListener: () => void;

  // Cancel
  cancelOperation: () => Promise<boolean>;

  // Window controls
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  windowIsMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => void;
  removeMaximizeChangeListener: () => void;

  // File deletion
  deleteFile: (filePath: string) => Promise<boolean>;

  getAvailableEncoders: () => Promise<string[]>;

  // Download
  downloadVideo: (opts: { url: string; output: string; headers?: Record<string, string> }) => Promise<boolean>;

  fetchPageM3u8: (pageUrl: string) => Promise<{
    m3u8Urls: string[];
    pageTitle: string;
    pageUrl: string;
    cookies: { domain: string; name: string; value: string }[];
  }>;

  fetchM3u8Variants: (
    m3u8Url: string,
    headers?: Record<string, string>
  ) => Promise<{ url: string; resolution: string; height: number; label: string; bandwidth?: number }[]>;

  // Download queue
  enqueueDownload: (opts: {
    url: string;
    output: string;
    headers?: Record<string, string>;
    fileName?: string;
  }) => Promise<{ queueId: string }>;

  cancelDownloadQueue: () => Promise<void>;

  cancelQueueItem: (id: string) => Promise<boolean>;

  pauseQueueItem: (id: string) => Promise<boolean>;

  resumeQueueItem: (id: string) => Promise<boolean>;

  removeQueueItem: (id: string) => Promise<boolean>;

  clearQueueTerminal: () => Promise<number>;

  retryQueueItem: (id: string) => Promise<boolean>;

  getQueueStatus: () => Promise<QueueStatusDTO>;

  setDownloadConcurrency: (n: number) => Promise<void>;

  onQueueProgress: (callback: (data: { queueId: string; percent: number; speed: string; eta: string }) => void) => void;

  onQueueUpdate: (callback: (status: QueueStatusDTO) => void) => void;

  removeQueueListeners: () => void;

  // Download history
  checkDownloadDuplicate: (fileName: string) => Promise<HistoryEntry | null>;
  getDownloadHistoryPath: () => Promise<string>;
  getDownloadHistory: () => Promise<HistoryEntry[]>;
  clearDownloadHistory: () => Promise<void>;

  // 网页路径持久化（userData/web-page-paths.json）
  getWebPagePaths: () => Promise<{
    entries: { id: string; url: string; createdAt: number; status: 'pending' | 'downloaded' }[];
    error?: string;
  }>;
  saveWebPagePaths: (
    entries: { id: string; url: string; createdAt: number; status: 'pending' | 'downloaded' }[]
  ) => Promise<void>;
  getWebPagePathsFile: () => Promise<string>;
  backupWebPagePaths: () => Promise<string | null>;
  restoreWebPagePaths: () => Promise<
    { id: string; url: string; createdAt: number; status: 'pending' | 'downloaded' }[] | null
  >;

  // Dialog
  confirmDialog: (message: string, title?: string) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
