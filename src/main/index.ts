import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { splitVideo, mergeVideos, compressVideo, batchCompress, getVideoMeta, convertToGif, batchConvertToGif, cancelFfmpegOperation, getAvailableEncoders } from './modules/ffmpeg'
import { downloadM3u8, fetchM3u8Variants } from './modules/download'
import { fetchPageM3u8ViaBrowser } from './modules/page-fetcher'
import { DownloadQueueManager } from './modules/download-queue'
import { acquireLock, releaseLock, getActiveOperationType } from './modules/lock'
import { encryptFile, decryptFile, batchProcessFiles, cancelCryptoOperation } from './modules/crypto'
import {
  selectVideoFiles,
  selectSingleVideoFile,
  selectDirectory,
  selectSavePath,
  getFileInfo,
  scanVideoFiles,
  generateCryptoOutputPath,
  formatFileSize,
  formatDuration
} from './modules/file'
import type { ProgressInfo } from '../preload/index'

// Temp directory for clip segments
function getTempClipsDir(): string {
  const dir = join(app.getPath('temp'), 'sn-video-clips')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
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
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximizeChange', true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximizeChange', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---- IPC Handlers ----

function sendProgress(event: Electron.IpcMainInvokeEvent, data: ProgressInfo): void {
  event.sender.send('operation:progress', data)
}

type ProgressData = {
  percent: number
  currentFile: number
  totalFiles: number
  speed: string
  eta: string
}

/**
 * Register an IPC handler that acquires the operation lock, forwards progress
 * events, and always releases the lock in `finally`.
 */
function wrapOperation<TOpts>(
  channel: string,
  lockType: string,
  progressType: ProgressInfo['type'],
  executor: (opts: TOpts, onProgress: (data: ProgressData) => void) => Promise<unknown>
): void {
  ipcMain.handle(channel, async (event, opts: TOpts) => {
    if (!acquireLock(lockType)) {
      throw new Error('有操作正在进行中，请等待完成后再试')
    }
    try {
      return executor(opts, (data) => {
        sendProgress(event, { ...data, type: progressType })
      })
    } finally {
      releaseLock()
    }
  })
}

// File operations
function registerFileHandlers(): void {
  ipcMain.handle('file:selectVideoFiles', async () => {
    return selectVideoFiles()
  })

  ipcMain.handle('file:selectSingleVideoFile', async () => {
    return selectSingleVideoFile()
  })

  ipcMain.handle('file:selectDirectory', async () => {
    return selectDirectory()
  })

  ipcMain.handle('file:selectSavePath', async (_event, defaultName: string, defaultExt: string) => {
    return selectSavePath(defaultName, defaultExt)
  })

  ipcMain.handle('file:getInfo', async (_event, filePath: string) => {
    return getFileInfo(filePath)
  })

  ipcMain.handle('file:scanVideoFiles', async (_event, dirPath: string) => {
    return scanVideoFiles(dirPath)
  })

  ipcMain.handle('file:generateCryptoOutputPath', async (_event, inputPath: string, isEncrypt: boolean) => {
    return generateCryptoOutputPath(inputPath, isEncrypt)
  })

  ipcMain.handle('file:formatFileSize', async (_event, bytes: number) => {
    return formatFileSize(bytes)
  })

  ipcMain.handle('file:formatDuration', async (_event, seconds: number) => {
    return formatDuration(seconds)
  })
}

// Split/Merge handlers
function registerSplitMergeHandlers(): void {
  wrapOperation<{
    input: string
    output: string
    startTime: string
    duration: string
  }>('video:split', 'split', 'split', (opts, onProgress) => splitVideo({ ...opts, onProgress }))

  wrapOperation<{ inputs: string[]; output: string }>(
    'video:merge', 'merge', 'merge', (opts, onProgress) => mergeVideos({ ...opts, onProgress })
  )
}

// Compression handlers
function registerCompressHandlers(): void {
  ipcMain.handle('video:getMeta', async (_event, filePath: string) => {
    return getVideoMeta(filePath)
  })

  wrapOperation<{
    input: string
    output: string
    crf: number
    resolution: string
    bitrate: string
    codec: string
  }>('video:compress', 'compress', 'compress', (opts, onProgress) => compressVideo({ ...opts, onProgress }))

  wrapOperation<{
    files: { input: string; output: string; crf: number; resolution: string; bitrate: string; codec: string }[]
  }>('video:batchCompress', 'compress', 'compress', (opts, onProgress) => batchCompress({ ...opts, onProgress }))
}

// GIF conversion handlers
function registerGifHandlers(): void {
  wrapOperation<{
    input: string
    output: string
    fps: number
    width: number
    quality: 'high' | 'medium' | 'low'
    startTime?: number
    duration?: number
    loop: number
  }>('video:convertToGif', 'gif', 'gif', (opts, onProgress) => convertToGif({ ...opts, onProgress }))

  wrapOperation<{
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
  }>('video:batchConvertToGif', 'gif', 'gif', (opts, onProgress) => batchConvertToGif({ ...opts, onProgress }))
}

// Encryption/Decryption handlers
function registerCryptoHandlers(): void {
  wrapOperation<{ input: string; output: string; password: string }>(
    'crypto:encrypt', 'crypto', 'encrypt', (opts, onProgress) => encryptFile({ ...opts, onProgress })
  )

  wrapOperation<{ input: string; output: string; password: string }>(
    'crypto:decrypt', 'crypto', 'decrypt', (opts, onProgress) => decryptFile({ ...opts, onProgress })
  )

  wrapOperation<{ files: { input: string; output: string }[]; password: string }>(
    'crypto:batchEncrypt', 'crypto', 'encrypt', (opts, onProgress) => batchProcessFiles(true, { ...opts, onProgress })
  )

  wrapOperation<{ files: { input: string; output: string }[]; password: string }>(
    'crypto:batchDecrypt', 'crypto', 'decrypt', (opts, onProgress) => batchProcessFiles(false, { ...opts, onProgress })
  )
}

// Download handlers (queue-based)
function registerDownloadHandlers(): void {
  const queueManager = DownloadQueueManager.getInstance()

  // Progress broadcast callback — uses the main window to push events
  queueManager.setProgressCallback((queueId, data) => {
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) {
      wins[0].webContents.send('download:queue-progress', { queueId, ...data })
    }
  })

  // Status broadcast — full queue snapshot on every mutation
  queueManager.setStatusCallback((status) => {
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) {
      wins[0].webContents.send('download:queue-update', status)
    }
  })

  // Enqueue a download task
  ipcMain.handle('download:enqueue', async (_event, opts: {
    url: string
    output: string
    headers?: Record<string, string>
    fileName?: string
  }) => {
    const item = queueManager.enqueue(opts)
    return { queueId: item.id }
  })

  // Cancel all downloads and clear queue
  ipcMain.handle('download:cancelQueue', async () => {
    queueManager.cancelAll()
  })

  // Remove a pending item from queue
  ipcMain.handle('download:removeQueueItem', async (_event, id: string) => {
    return queueManager.removeItem(id)
  })

  // Retry a failed item
  ipcMain.handle('download:retryQueueItem', async (_event, id: string) => {
    return queueManager.retryItem(id)
  })

  // Get current queue status
  ipcMain.handle('download:getStatus', async () => {
    return queueManager.getStatus()
  })

  // Original single-download channel: redirect to queue (backward compat)
  wrapOperation<{
    url: string
    output: string
    headers?: Record<string, string>
  }>('video:download', 'download', 'download', (opts, onProgress) =>
    downloadM3u8({ ...opts, onProgress })
  )

  // Page fetch (not wrapped — no ffmpeg involvement)
  ipcMain.handle('video:fetchPageM3u8Browser', async (_event, pageUrl: string) => {
    return fetchPageM3u8ViaBrowser(pageUrl)
  })

  // Quality variant parsing (not wrapped — no ffmpeg involvement)
  ipcMain.handle('video:fetchM3u8Variants', async (_event, m3u8Url: string, headers?: Record<string, string>) => {
    return fetchM3u8Variants(m3u8Url, headers)
  })
}

// App info handlers
function registerAppHandlers(): void {
  ipcMain.handle('app:getTempDir', async () => {
    return getTempClipsDir()
  })

  ipcMain.handle('app:getCommonPaths', () => {
    const home = os.homedir()
    return {
      desktop: join(home, 'Desktop'),
      downloads: join(home, 'Downloads')
    }
  })

  ipcMain.handle('file:delete', async (_event, filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      return true
    } catch {
      return false
    }
  })
}

// Cancel operation
function registerCancelHandler(): void {
  ipcMain.handle('operation:cancel', async () => {
    const activeType = getActiveOperationType()
    if (activeType === 'crypto') {
      cancelCryptoOperation()
    } else if (activeType === 'download') {
      // Delegate to queue manager for download cancellation
      DownloadQueueManager.getInstance().cancelAll()
    } else {
      cancelFfmpegOperation()
    }
    return true
  })

  ipcMain.handle('ffmpeg:getAvailableEncoders', async () => {
    return getAvailableEncoders()
  })
}

// Window controls
function registerWindowHandlers(): void {
  ipcMain.on('window:minimize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      win.minimize()
    }
  })

  ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.on('window:close', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      win.close()
    }
  })

  ipcMain.handle('window:isMaximized', () => {
    const win = BrowserWindow.getFocusedWindow()
    return win ? win.isMaximized() : false
  })
}

// ---- App Lifecycle ----

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sn.video-editor')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerAppHandlers()
  registerFileHandlers()
  registerSplitMergeHandlers()
  registerCompressHandlers()
  registerGifHandlers()
  registerCryptoHandlers()
  registerDownloadHandlers()
  registerCancelHandler()
  registerWindowHandlers()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Clean up temporary clip files
  const tempClipsDir = join(app.getPath('temp'), 'sn-video-clips')
  try {
    if (fs.existsSync(tempClipsDir)) {
      fs.rmSync(tempClipsDir, { recursive: true, force: true })
    }
  } catch {
    // Silently ignore cleanup failures
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
