import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { splitVideo, mergeVideos, compressVideo, batchCompress, getVideoMeta } from './modules/ffmpeg'
import { encryptFile, decryptFile, batchProcessFiles } from './modules/crypto'
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

// Track active operations for cancellation
let activeProcess: { cancel: () => void } | null = null

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
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
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
    return splitVideo({
      ...opts,
      onProgress: (data) => {
        sendProgress(event, { ...data, type: 'split' })
      }
    })
  })

  ipcMain.handle('video:merge', async (event, opts: {
    inputs: string[]
    output: string
  }) => {
    return mergeVideos({
      ...opts,
      onProgress: (data) => {
        sendProgress(event, { ...data, type: 'merge' })
      }
    })
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
    return compressVideo({
      ...opts,
      onProgress: (data) => {
        sendProgress(event, { ...data, type: 'compress' })
      }
    })
  })

  ipcMain.handle('video:batchCompress', async (event, opts: {
    files: { input: string; output: string; crf: number; resolution: string; bitrate: string; codec: string }[]
  }) => {
    return batchCompress({
      ...opts,
      onProgress: (data) => {
        sendProgress(event, { ...data, type: 'compress' })
      }
    })
  })
}

// Encrypt/Decrypt handlers
function registerCryptoHandlers(): void {
  ipcMain.handle('crypto:encrypt', async (event, opts: {
    input: string
    output: string
    password: string
  }) => {
    return encryptFile({
      ...opts,
      onProgress: (data) => {
        sendProgress(event, { ...data, type: 'encrypt' })
      }
    })
  })

  ipcMain.handle('crypto:decrypt', async (event, opts: {
    input: string
    output: string
    password: string
  }) => {
    return decryptFile({
      ...opts,
      onProgress: (data) => {
        sendProgress(event, { ...data, type: 'decrypt' })
      }
    })
  })

  ipcMain.handle('crypto:batchEncrypt', async (event, opts: {
    files: { input: string; output: string }[]
    password: string
  }) => {
    return batchProcessFiles(true, {
      ...opts,
      onProgress: (data) => {
        sendProgress(event, { ...data, type: 'encrypt' })
      }
    })
  })

  ipcMain.handle('crypto:batchDecrypt', async (event, opts: {
    files: { input: string; output: string }[]
    password: string
  }) => {
    return batchProcessFiles(false, {
      ...opts,
      onProgress: (data) => {
        sendProgress(event, { ...data, type: 'decrypt' })
      }
    })
  })
}

// Cancel operation
function registerCancelHandler(): void {
  ipcMain.handle('operation:cancel', async () => {
    if (activeProcess) {
      activeProcess.cancel()
      activeProcess = null
    }
    return true
  })
}

// ---- App Lifecycle ----

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sn.video-editor')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerFileHandlers()
  registerSplitMergeHandlers()
  registerCompressHandlers()
  registerCryptoHandlers()
  registerCancelHandler()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
