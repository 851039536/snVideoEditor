import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { splitVideo, mergeVideos, compressVideo, batchCompress, getVideoMeta, convertToGif, batchConvertToGif, cancelFfmpegOperation, getAvailableEncoders } from './modules/ffmpeg'
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

// Operation lock to prevent concurrent processing
let isProcessing = false
let activeOperationType = ''

function acquireLock(type: string): boolean {
  if (isProcessing) {
    return false
  }
  isProcessing = true
  activeOperationType = type
  return true
}

function releaseLock(): void {
  isProcessing = false
  activeOperationType = ''
}

// ---- IPC Handlers ----

function sendProgress(event: Electron.IpcMainInvokeEvent, data: ProgressInfo): void {
  event.sender.send('operation:progress', data)
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
  ipcMain.handle('video:split', async (event, opts: {
    input: string
    output: string
    startTime: string
    duration: string
  }) => {
    if (!acquireLock('split')) {
      throw new Error('有操作正在进行中，请等待完成后再试')
    }
    try {
      return splitVideo({
        ...opts,
        onProgress: (data) => {
          sendProgress(event, { ...data, type: 'split' })
        }
      })
    } finally {
      releaseLock()
    }
  })

  ipcMain.handle('video:merge', async (event, opts: {
    inputs: string[]
    output: string
  }) => {
    if (!acquireLock('merge')) {
      throw new Error('有操作正在进行中，请等待完成后再试')
    }
    try {
      return mergeVideos({
        ...opts,
        onProgress: (data) => {
          sendProgress(event, { ...data, type: 'merge' })
        }
      })
    } finally {
      releaseLock()
    }
  })
}

// Compression handlers
function registerCompressHandlers(): void {
  ipcMain.handle('video:getMeta', async (_event, filePath: string) => {
    return getVideoMeta(filePath)
  })

  ipcMain.handle('video:compress', async (event, opts: {
    input: string
    output: string
    crf: number
    resolution: string
    bitrate: string
    codec: string
  }) => {
    if (!acquireLock('compress')) {
      throw new Error('有操作正在进行中，请等待完成后再试')
    }
    try {
      return compressVideo({
        ...opts,
        onProgress: (data) => {
          sendProgress(event, { ...data, type: 'compress' })
        }
      })
    } finally {
      releaseLock()
    }
  })

  ipcMain.handle('video:batchCompress', async (event, opts: {
    files: { input: string; output: string; crf: number; resolution: string; bitrate: string; codec: string }[]
  }) => {
    if (!acquireLock('compress')) {
      throw new Error('有操作正在进行中，请等待完成后再试')
    }
    try {
      return batchCompress({
        ...opts,
        onProgress: (data) => {
          sendProgress(event, { ...data, type: 'compress' })
        }
      })
    } finally {
      releaseLock()
    }
  })
}

// GIF conversion handlers
function registerGifHandlers(): void {
  ipcMain.handle('video:convertToGif', async (event, opts: {
    input: string
    output: string
    fps: number
    width: number
    quality: 'high' | 'medium' | 'low'
    startTime?: number
    duration?: number
    loop: number
  }) => {
    if (!acquireLock('gif')) {
      throw new Error('有操作正在进行中，请等待完成后再试')
    }
    try {
      return convertToGif({
        ...opts,
        onProgress: (data) => {
          sendProgress(event, { ...data, type: 'gif' })
        }
      })
    } finally {
      releaseLock()
    }
  })

  ipcMain.handle('video:batchConvertToGif', async (event, opts: {
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
  }) => {
    if (!acquireLock('gif')) {
      throw new Error('有操作正在进行中，请等待完成后再试')
    }
    try {
      return batchConvertToGif({
        ...opts,
        onProgress: (data) => {
          sendProgress(event, { ...data, type: 'gif' })
        }
      })
    } finally {
      releaseLock()
    }
  })
}

// Encryption/Decryption handlers
function registerCryptoHandlers(): void {
  ipcMain.handle('crypto:encrypt', async (event, opts: {
    input: string
    output: string
    password: string
  }) => {
    if (!acquireLock('crypto')) {
      throw new Error('有操作正在进行中，请等待完成后再试')
    }
    try {
      return encryptFile({
        ...opts,
        onProgress: (data) => {
          sendProgress(event, { ...data, type: 'encrypt' })
        }
      })
    } finally {
      releaseLock()
    }
  })

  ipcMain.handle('crypto:decrypt', async (event, opts: {
    input: string
    output: string
    password: string
  }) => {
    if (!acquireLock('crypto')) {
      throw new Error('有操作正在进行中，请等待完成后再试')
    }
    try {
      return decryptFile({
        ...opts,
        onProgress: (data) => {
          sendProgress(event, { ...data, type: 'decrypt' })
        }
      })
    } finally {
      releaseLock()
    }
  })

  ipcMain.handle('crypto:batchEncrypt', async (event, opts: {
    files: { input: string; output: string }[]
    password: string
  }) => {
    if (!acquireLock('crypto')) {
      throw new Error('有操作正在进行中，请等待完成后再试')
    }
    try {
      return batchProcessFiles(true, {
        ...opts,
        onProgress: (data) => {
          sendProgress(event, { ...data, type: 'encrypt' })
        }
      })
    } finally {
      releaseLock()
    }
  })

  ipcMain.handle('crypto:batchDecrypt', async (event, opts: {
    files: { input: string; output: string }[]
    password: string
  }) => {
    if (!acquireLock('crypto')) {
      throw new Error('有操作正在进行中，请等待完成后再试')
    }
    try {
      return batchProcessFiles(false, {
        ...opts,
        onProgress: (data) => {
          sendProgress(event, { ...data, type: 'decrypt' })
        }
      })
    } finally {
      releaseLock()
    }
  })
}

// App info handlers
function registerAppHandlers(): void {
  ipcMain.handle('app:getTempDir', async () => {
    return getTempClipsDir()
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
    if (activeOperationType === 'crypto') {
      cancelCryptoOperation()
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
