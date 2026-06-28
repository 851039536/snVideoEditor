import { dialog, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export interface FileFilter {
  name: string
  extensions: string[]
}

const VIDEO_FILTERS: FileFilter[] = [
  {
    name: '视频文件',
    extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp']
  },
  {
    name: '所有文件',
    extensions: ['*']
  }
]

const ENCRYPTED_FILTER: FileFilter[] = [
  {
    name: '加密视频文件',
    extensions: ['enc']
  },
  {
    name: '所有文件',
    extensions: ['*']
  }
]

const PLAYER_FILTERS: FileFilter[] = [
  {
    name: '视频文件（含加密）',
    extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp', 'enc']
  },
  {
    name: '所有文件',
    extensions: ['*']
  }
]

/**
 * Open native dialog to select video files
 */
export async function selectVideoFiles(): Promise<string[]> {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) {
    return []
  }

  const result = await dialog.showOpenDialog(window, {
    title: '选择视频文件',
    filters: VIDEO_FILTERS,
    properties: ['openFile', 'multiSelections']
  })

  return result.canceled ? [] : result.filePaths
}

/**
 * Open native dialog to select a single video file
 */
export async function selectSingleVideoFile(): Promise<string | null> {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) {
    return null
  }

  const result = await dialog.showOpenDialog(window, {
    title: '选择视频文件',
    filters: VIDEO_FILTERS,
    properties: ['openFile']
  })

  return result.canceled ? null : result.filePaths[0]
}

/**
 * Open native dialog to select video + encrypted files for the player
 */
export async function selectPlayerFiles(): Promise<string[]> {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) {
    return []
  }

  const result = await dialog.showOpenDialog(window, {
    title: '选择视频文件',
    filters: PLAYER_FILTERS,
    properties: ['openFile', 'multiSelections']
  })

  return result.canceled ? [] : result.filePaths
}

/**
 * Open native dialog to select a directory
 */
export async function selectDirectory(): Promise<string | null> {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) {
    return null
  }

  const result = await dialog.showOpenDialog(window, {
    title: '选择目录',
    properties: ['openDirectory']
  })

  return result.canceled ? null : result.filePaths[0]
}

/**
 * Open save dialog for output path
 */
export async function selectSavePath(
  defaultName: string,
  defaultExt: string
): Promise<string | null> {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) {
    return null
  }

  const result = await dialog.showSaveDialog(window, {
    title: '保存文件',
    defaultPath: defaultName,
    filters: [
      {
        name: `${defaultExt.toUpperCase()} 文件`,
        extensions: [defaultExt]
      }
    ]
  })

  return result.canceled ? null : result.filePath
}

/**
 * Get basic file info
 */
export function getFileInfo(filePath: string): { size: number; ext: string; name: string } {
  const stat = fs.statSync(filePath)
  return {
    size: stat.size,
    ext: path.extname(filePath).toLowerCase(),
    name: path.basename(filePath)
  }
}

/**
 * Scan directory for video files recursively
 */
export function scanVideoFiles(dirPath: string): string[] {
  const results: string[] = []
  const videoExts = new Set(VIDEO_FILTERS[0].extensions)

  function scan(currentPath: string): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        scan(fullPath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase().slice(1)
        if (videoExts.has(ext)) {
          results.push(fullPath)
        }
      }
    }
  }

  scan(dirPath)
  return results
}

/**
 * Scan directory for video + encrypted files recursively (for player)
 */
export function scanPlayerFiles(dirPath: string): string[] {
  const results: string[] = []
  const playerExts = new Set(PLAYER_FILTERS[0].extensions)

  function scan(currentPath: string): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        scan(fullPath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase().slice(1)
        if (playerExts.has(ext)) {
          results.push(fullPath)
        }
      }
    }
  }

  scan(dirPath)
  return results
}

/**
 * Generate output path for encrypted/decrypted file
 */
export function generateCryptoOutputPath(inputPath: string, isEncrypt: boolean): string {
  const dir = path.dirname(inputPath)
  const ext = path.extname(inputPath)
  const name = path.basename(inputPath, ext)

  if (isEncrypt) {
    return path.join(dir, `${name}${ext}.enc`)
  } else {
    // Remove .enc extension if present
    if (ext === '.enc') {
      // Need to get the original extension before .enc
      const baseName = path.basename(inputPath, '.enc')
      return path.join(dir, baseName)
    }
    return path.join(dir, `${name}_decrypted${ext}`)
  }
}

/**
 * Format file size to human readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`
}

/**
 * Format duration in seconds to HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
