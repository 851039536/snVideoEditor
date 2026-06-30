import type { VideoMeta } from '@/types/file'

export interface PlayerEntry {
  path: string
  isEncrypted: boolean
  meta: VideoMeta | null
  tempPath: string | null
}

/** Data persisted to localStorage across app restarts */
export interface PersistedPlayerData {
  /** Absolute paths of playlist files */
  filePaths: string[]
  /** Last scanned folder path (for quick re-scan) */
  lastFolder: string
  /** Auto-decrypt toggle preference */
  autoDecrypt: boolean
  /** Last playing index in playlist */
  lastIndex: number
  /** Playback position in seconds for the last played file */
  playbackTime: number
}

export const DEFAULT_PLAYER_DATA: PersistedPlayerData = {
  filePaths: [],
  lastFolder: '',
  autoDecrypt: true,
  lastIndex: -1,
  playbackTime: 0
}
