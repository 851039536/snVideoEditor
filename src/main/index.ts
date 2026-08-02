import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import {
  splitVideo,
  mergeVideos,
  compressVideo,
  batchCompress,
  getVideoMeta,
  getAudioMeta,
  convertToGif,
  batchConvertToGif,
  captureScreenshot,
  generateThumbnailSprite,
  cancelFfmpegOperation,
  getAvailableEncoders,
  adjustColor,
  batchAdjustColor,
  changeSpeed,
  batchSpeedMerge,
  convertFormat,
  batchConvertFormat
} from './modules/ffmpeg';
import { downloadM3u8, fetchM3u8Variants } from './modules/download';
import { fetchPageM3u8ViaBrowser } from './modules/page-fetcher';
import { DownloadQueueManager } from './modules/download-queue';
import { DownloadHistoryManager } from './modules/download-history';
import { WebPathsManager } from './modules/web-paths';
import type { WebPageEntry } from './modules/web-paths';
import { acquireLock, releaseLock, getActiveOperationType } from './modules/lock';
import { encryptFile, decryptFile, batchProcessFiles, cancelCryptoOperation } from './modules/crypto';
import { decryptForPlayback } from './modules/player';
import {
  selectVideoFiles,
  selectSingleVideoFile,
  selectDirectory,
  selectSavePath,
  getFileInfo,
  scanVideoFiles,
  generateCryptoOutputPath,
  formatFileSize,
  formatDuration,
  selectPlayerFiles,
  scanPlayerFiles,
  selectTextFiles,
  scanTextFiles,
  selectAudioFiles
} from './modules/file';
import { getTtsVoices, previewVoice, batchSynthesize, cancelTts } from './modules/tts';
import type { ProgressInfo } from '../preload/index';

// Temp directory for clip segments
function getTempClipsDir(): string {
  const dir = join(app.getPath('temp'), 'sn-video-clips');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0D1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximizeChange', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximizeChange', false);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// ---- IPC Handlers ----

function sendProgress(event: Electron.IpcMainInvokeEvent, data: ProgressInfo): void {
  event.sender.send('operation:progress', data);
}

type ProgressData = {
  percent: number;
  currentFile: number;
  totalFiles: number;
  speed: string;
  eta: string;
  currentFileName?: string;
};

/**
 * Register an IPC handler that acquires the operation lock, forwards progress
 * events, and always releases the lock in `finally`.
 */
function wrapOperation<TOpts>(
  channel: string,
  lockType: string,
  progressType: ProgressInfo['type'],
  executor: (opts: TOpts, onProgress: (data: ProgressData) => void) => Promise<unknown>,
  timeoutMs?: number
): void {
  ipcMain.handle(channel, async (event, opts: TOpts) => {
    acquireLock(lockType, timeoutMs);
    try {
      return executor(opts, (data) => {
        sendProgress(event, { ...data, type: progressType });
      });
    } finally {
      releaseLock();
    }
  });
}

// File operations
function registerFileHandlers(): void {
  ipcMain.handle('file:selectVideoFiles', async () => {
    return selectVideoFiles();
  });

  ipcMain.handle('file:selectSingleVideoFile', async () => {
    return selectSingleVideoFile();
  });

  ipcMain.handle('file:selectDirectory', async () => {
    return selectDirectory();
  });

  ipcMain.handle('file:selectSavePath', async (_event, defaultName: string, defaultExt: string) => {
    return selectSavePath(defaultName, defaultExt);
  });

  ipcMain.handle('file:getInfo', async (_event, filePath: string) => {
    return getFileInfo(filePath);
  });

  ipcMain.handle('file:scanVideoFiles', async (_event, dirPath: string) => {
    return scanVideoFiles(dirPath);
  });

  ipcMain.handle('file:selectPlayerFiles', async () => {
    return selectPlayerFiles();
  });

  ipcMain.handle('file:scanPlayerFiles', async (_event, dirPath: string) => {
    return scanPlayerFiles(dirPath);
  });

  ipcMain.handle('file:generateCryptoOutputPath', async (_event, inputPath: string, isEncrypt: boolean) => {
    return generateCryptoOutputPath(inputPath, isEncrypt);
  });

  ipcMain.handle('file:formatFileSize', async (_event, bytes: number) => {
    return formatFileSize(bytes);
  });

  ipcMain.handle('file:formatDuration', async (_event, seconds: number) => {
    return formatDuration(seconds);
  });

  ipcMain.handle('file:selectAudioFiles', async () => {
    return selectAudioFiles();
  });
}

// Split/Merge handlers
function registerSplitMergeHandlers(): void {
  wrapOperation<{
    input: string;
    output: string;
    startTime: string;
    duration: string;
  }>('video:split', 'split', 'split', (opts, onProgress) => splitVideo({ ...opts, onProgress }));

  wrapOperation<{ inputs: string[]; output: string }>('video:merge', 'merge', 'merge', (opts, onProgress) =>
    mergeVideos({ ...opts, onProgress })
  );

  ipcMain.handle('audio:getMeta', async (_event, filePath: string) => {
    return getAudioMeta(filePath);
  });

  wrapOperation<{
    input: string; output: string;
    startTime: number; duration: number; speed: number
  }>('video:speed', 'speed', 'speed', (opts, onProgress) =>
    changeSpeed({ ...opts, onProgress })
  );

  wrapOperation<{
    input: string; output: string;
    segments: { id: string; startSec: number; endSec: number; duration: number; speed: number }[];
    sourceDuration: number; sourceCodec?: string
  }>('video:batchSpeedMerge', 'speed', 'speed', (opts, onProgress) =>
    batchSpeedMerge({ ...opts, onProgress }),
    600000 // 10min 超时：多段重编码 + 合并耗时较长，对齐 batchConvertFormat/tts 先例
  );
}

// Compression handlers
function registerCompressHandlers(): void {
  ipcMain.handle('video:getMeta', async (_event, filePath: string) => {
    return getVideoMeta(filePath);
  });

  wrapOperation<{
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
  }>('video:compress', 'compress', 'compress', (opts, onProgress) => compressVideo({ ...opts, onProgress }));

  wrapOperation<{
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
  }>('video:batchCompress', 'compress', 'compress', (opts, onProgress) => batchCompress({ ...opts, onProgress }));
}

// GIF conversion handlers
function registerGifHandlers(): void {
  wrapOperation<{
    input: string;
    output: string;
    fps: number;
    width: number;
    quality: 'high' | 'medium' | 'low';
    startTime?: number;
    duration?: number;
    loop: number;
  }>('video:convertToGif', 'gif', 'gif', (opts, onProgress) => convertToGif({ ...opts, onProgress }));

  wrapOperation<{
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
  }>('video:batchConvertToGif', 'gif', 'gif', (opts, onProgress) => batchConvertToGif({ ...opts, onProgress }));
}

// 色彩调整 handlers
function registerColorHandlers(): void {
  wrapOperation<{
    input: string;
    output: string;
    brightness: number;
    contrast: number;
    saturation: number;
    temperature: number;
  }>('video:adjustColor', 'color', 'color', (opts, onProgress) => adjustColor({ ...opts, onProgress }));

  wrapOperation<{
    files: {
      input: string;
      output: string;
      brightness: number;
      contrast: number;
      saturation: number;
      temperature: number;
    }[];
  }>('video:batchAdjustColor', 'color', 'color', (opts, onProgress) => batchAdjustColor({ ...opts, onProgress }));
}

// 格式转换 handlers
function registerConvertHandlers(): void {
  wrapOperation<{
    input: string;
    output: string;
    targetFormat: string;
    copy: boolean;
  }>('video:convertFormat', 'convert', 'convert', (opts, onProgress) =>
    convertFormat({ ...opts, onProgress }), 300000);

  wrapOperation<{
    files: {
      input: string;
      output: string;
      targetFormat: string;
      copy: boolean;
    }[];
  }>('video:batchConvertFormat', 'convert', 'convert', (opts, onProgress) =>
    batchConvertFormat({ ...opts, onProgress }), 600000);
}

// Encryption/Decryption handlers
function registerCryptoHandlers(): void {
  wrapOperation<{ input: string; output: string; password: string }>(
    'crypto:encrypt',
    'crypto',
    'encrypt',
    (opts, onProgress) => encryptFile({ ...opts, onProgress })
  );

  wrapOperation<{ input: string; output: string; password: string }>(
    'crypto:decrypt',
    'crypto',
    'decrypt',
    (opts, onProgress) => decryptFile({ ...opts, onProgress })
  );

  wrapOperation<{ files: { input: string; output: string }[]; password: string }>(
    'crypto:batchEncrypt',
    'crypto',
    'encrypt',
    (opts, onProgress) => batchProcessFiles(true, { ...opts, onProgress })
  );

  wrapOperation<{ files: { input: string; output: string }[]; password: string }>(
    'crypto:batchDecrypt',
    'crypto',
    'decrypt',
    (opts, onProgress) => batchProcessFiles(false, { ...opts, onProgress })
  );
}

// Player handlers (no lock — playback preview only)
function registerPlayerHandlers(): void {
  ipcMain.handle('video:decryptForPlayback', async (_event, input: string, password: string, tempDir: string) => {
    return decryptForPlayback(input, password, tempDir);
  });

  wrapOperation<{ input: string; output: string; time: number }>(
    'video:screenshot',
    'screenshot',
    'screenshot',
    (opts, onProgress) => captureScreenshot({ ...opts, onProgress })
  );

  wrapOperation<{
    input: string;
    outputDir: string;
    thumbWidth?: number;
    thumbHeight?: number;
    interval?: number;
    cols?: number;
  }>('video:generateThumbnails', 'thumbnail', 'thumbnail', (opts, onProgress) =>
    generateThumbnailSprite({ ...opts, onProgress })
  );
}

// Download handlers (queue-based)
function registerDownloadHandlers(): void {
  const queueManager = DownloadQueueManager.getInstance();

  // Progress broadcast callback — uses the main window to push events
  queueManager.setProgressCallback((queueId, data) => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
      wins[0].webContents.send('download:queue-progress', { queueId, ...data });
    }
  });

  // Status broadcast — full queue snapshot on every mutation
  queueManager.setStatusCallback((status) => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
      wins[0].webContents.send('download:queue-update', status);
    }
  });

  // Enqueue a download task
  ipcMain.handle(
    'download:enqueue',
    async (
      _event,
      opts: {
        url: string;
        output: string;
        headers?: Record<string, string>;
        fileName?: string;
      }
    ) => {
      const item = queueManager.enqueue(opts);
      return { queueId: item.id };
    }
  );

  // Cancel a single queue item
  ipcMain.handle('download:cancelItem', async (_event, id: string) => {
    return queueManager.cancelItem(id);
  });

  // Pause a downloading item
  ipcMain.handle('download:pauseItem', async (_event, id: string) => {
    return queueManager.pauseItem(id);
  });

  // Resume a paused item
  ipcMain.handle('download:resumeItem', async (_event, id: string) => {
    return queueManager.resumeItem(id);
  });

  // Cancel all downloads and clear queue
  ipcMain.handle('download:cancelQueue', async () => {
    queueManager.cancelAll();
  });

  // Remove a pending item from queue
  ipcMain.handle('download:removeQueueItem', async (_event, id: string) => {
    return queueManager.removeItem(id);
  });

  // Batch-clear all terminal (completed/failed/cancelled) items
  ipcMain.handle('download:clearTerminal', async () => {
    return queueManager.clearTerminal();
  });

  // Retry a failed item
  ipcMain.handle('download:retryQueueItem', async (_event, id: string) => {
    return queueManager.retryItem(id);
  });

  // Get current queue status
  ipcMain.handle('download:getStatus', async () => {
    return queueManager.getStatus();
  });

  // Set concurrency
  ipcMain.handle('download:setConcurrency', async (_event, n: number) => {
    queueManager.setConcurrency(n);
  });

  // Original single-download channel: redirect to queue (backward compat)
  wrapOperation<{
    url: string;
    output: string;
    headers?: Record<string, string>;
  }>('video:download', 'download', 'download', (opts, onProgress) => downloadM3u8({ ...opts, onProgress }));

  // Page fetch (not wrapped — no ffmpeg involvement)
  ipcMain.handle('video:fetchPageM3u8Browser', async (_event, pageUrl: string) => {
    return fetchPageM3u8ViaBrowser(pageUrl);
  });

  // Quality variant parsing (not wrapped — no ffmpeg involvement)
  ipcMain.handle('video:fetchM3u8Variants', async (_event, m3u8Url: string, headers?: Record<string, string>) => {
    return fetchM3u8Variants(m3u8Url, headers);
  });

  // Download history
  const historyManager = DownloadHistoryManager.getInstance();

  ipcMain.handle('download:checkDuplicate', async (_event, fileName: string) => {
    return historyManager.checkDuplicate(fileName);
  });

  ipcMain.handle('download:getHistoryPath', async () => {
    return historyManager.getFilePath();
  });

  ipcMain.handle('download:getHistory', async () => {
    return historyManager.getAll();
  });

  ipcMain.handle('download:clearHistory', async () => {
    historyManager.clear();
  });

  // 网页路径持久化（userData/web-page-paths.json，纯文件读写不走操作锁）
  const webPathsManager = WebPathsManager.getInstance();

  ipcMain.handle('webpaths:getAll', async () => {
    return webPathsManager.loadAll();
  });

  ipcMain.handle('webpaths:saveAll', async (_event, entries: WebPageEntry[]) => {
    webPathsManager.saveAll(entries);
  });

  ipcMain.handle('webpaths:getFilePath', async () => {
    return webPathsManager.getFilePath();
  });

  // 备份：弹出保存对话框，取消返回 null，否则返回备份文件路径
  ipcMain.handle('webpaths:backup', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const result = await dialog.showSaveDialog(win || BrowserWindow.getAllWindows()[0], {
      title: '备份网页路径',
      defaultPath: `web-page-paths-backup-${dateStr}.json`,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    webPathsManager.backup(result.filePath);
    return result.filePath;
  });

  // 还原：弹出打开对话框，取消返回 null，否则校验后覆盖主文件并返回新条目
  ipcMain.handle('webpaths:restore', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win || BrowserWindow.getAllWindows()[0], {
      title: '还原网页路径',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return webPathsManager.restoreFrom(result.filePaths[0]);
  });

  // Native confirm dialog (reusable for duplicate download prompts)
  ipcMain.handle('dialog:confirm', async (_event, message: string, title?: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) {
      return false;
    }
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['取消', '确认'],
      defaultId: 1,
      cancelId: 0,
      title: title || '提示',
      message
    });
    return result.response === 1;
  });
}

// App info handlers
function registerAppHandlers(): void {
  ipcMain.handle('app:getTempDir', async () => {
    return getTempClipsDir();
  });

  ipcMain.handle('app:openFolder', async (_event, folderPath: string) => {
    const { shell } = await import('electron');
    return shell.openPath(folderPath);
  });

  ipcMain.handle('app:getCommonPaths', () => {
    const home = os.homedir();
    return {
      desktop: join(home, 'Desktop'),
      downloads: join(home, 'Downloads')
    };
  });

  ipcMain.handle('file:delete', async (_event, filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return true;
    } catch {
      return false;
    }
  });
}

// TTS operations
function registerTtsHandlers(): void {
  ipcMain.handle('tts:getVoices', async () => {
    return getTtsVoices();
  });

  ipcMain.handle('tts:preview', async (_event, opts: { text: string; voice: string; rate: number }) => {
    return previewVoice(opts);
  });

  ipcMain.handle('file:selectTextFiles', async () => {
    return selectTextFiles();
  });

  ipcMain.handle('file:scanTextFiles', async (_event, dirPath: string) => {
    return scanTextFiles(dirPath);
  });

  wrapOperation<{ files: { input: string; output: string }[]; voice: string; rate: number }>(
    'tts:batchConvert',
    'tts',
    'tts',
    (opts, onProgress) => {
      return batchSynthesize({ ...opts, onProgress });
    },
    600000 // 10 minutes timeout for batch TTS
  );
}

// Cancel operation
function registerCancelHandler(): void {
  ipcMain.handle('operation:cancel', async () => {
    const activeType = getActiveOperationType();
    if (activeType === 'crypto') {
      cancelCryptoOperation();
    } else if (activeType === 'download') {
      // Cancel both queue items AND standalone download (video:download via wrapOperation)
      DownloadQueueManager.getInstance().cancelAll();
      cancelFfmpegOperation();
    } else if (activeType === 'tts') {
      cancelTts();
    } else {
      cancelFfmpegOperation();
    }
    return true;
  });

  ipcMain.handle('ffmpeg:getAvailableEncoders', async () => {
    return getAvailableEncoders();
  });
}

// Window controls
function registerWindowHandlers(): void {
  ipcMain.on('window:minimize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.minimize();
    }
  });

  ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.on('window:close', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.close();
    }
  });

  ipcMain.handle('window:isMaximized', () => {
    const win = BrowserWindow.getFocusedWindow();
    return win ? win.isMaximized() : false;
  });
}

// ---- App Lifecycle ----

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sn.video-editor');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerAppHandlers();
  registerFileHandlers();
  registerSplitMergeHandlers();
  registerCompressHandlers();
  registerGifHandlers();
  registerColorHandlers();
  registerConvertHandlers();
  registerCryptoHandlers();
  registerDownloadHandlers();
  registerTtsHandlers();
  registerCancelHandler();
  registerWindowHandlers();
  registerPlayerHandlers();

  // Restore download queue from disk
  DownloadQueueManager.getInstance().loadFromDisk();

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Clean up temporary clip files
  const tempClipsDir = join(app.getPath('temp'), 'sn-video-clips');
  try {
    if (fs.existsSync(tempClipsDir)) {
      fs.rmSync(tempClipsDir, { recursive: true, force: true });
    }
  } catch {
    // Silently ignore cleanup failures
  }
  // Save download queue state before quitting
  DownloadQueueManager.getInstance().doSaveToDisk();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
