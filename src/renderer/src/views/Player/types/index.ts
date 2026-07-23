import type { VideoMeta } from '@/types/file';

export interface PlayerEntry {
  path: string;
  isEncrypted: boolean;
  meta: VideoMeta | null;
  tempPath: string | null;
}

export interface ScreenshotMarker {
  time: number; // seconds
  label: string; // e.g. "截图 #1"
}

/** Thumbnail sprite data for Plyr previewThumbnails */
export interface ThumbnailData {
  spriteUrl: string;
  vttUrl: string;
}

/** Playback order mode for the playlist */
export type PlayMode = 'sequential' | 'repeat-one' | 'repeat-all' | 'shuffle';

/** Data persisted to localStorage across app restarts */
export interface PersistedPlayerData {
  /** Absolute paths of playlist files */
  filePaths: string[];
  /** Last scanned folder path (for quick re-scan) */
  lastFolder: string;
  /** Auto-decrypt toggle preference */
  autoDecrypt: boolean;
  /** Last playing index in playlist */
  lastIndex: number;
  /** Per-file playback position in seconds, keyed by file path */
  playbackTimes: Record<string, number>;
  /** Screenshot markers for the progress bar */
  screenshotMarkers: ScreenshotMarker[];
  /** Playback order mode */
  playMode: PlayMode;
}

export const DEFAULT_PLAYER_DATA: PersistedPlayerData = {
  filePaths: [],
  lastFolder: '',
  autoDecrypt: true,
  lastIndex: -1,
  playbackTimes: {},
  screenshotMarkers: [],
  playMode: 'sequential'
};

/**
 * Resolve the actual playable file-system path for an entry.
 * Encrypted files resolve to their decrypted temp copy; plain files to their
 * own path. Returns '' when an encrypted file has not been decrypted yet.
 * NOTE: returns a raw path WITHOUT any file:// scheme prefix.
 */
export function resolvePlayablePath(entry: PlayerEntry | null): string {
  if (!entry) {
    return '';
  }
  if (entry.isEncrypted && entry.tempPath) {
    return entry.tempPath;
  }
  if (!entry.isEncrypted) {
    return entry.path;
  }
  return '';
}
