import type { VideoMeta } from '../../../preload/index';

export type { VideoMeta };

export interface FileEntry {
  path: string;
  outputPath: string;
  meta: VideoMeta | null;
}

export interface ClipItem {
  id: string;
  sourceFile: string;
  sourceFileName: string;
  startSec: number;
  endSec: number;
  duration: number;
  outputFile: string;
  selected: boolean;
}

// ─── Download queue shared types ───────────────────────────────────────────────
// Single source of truth for the download queue shape. Must stay aligned with
// the backend definition in src/main/modules/download-queue.ts.

/** Lifecycle status of a download queue item. */
export type QueueStatusType = 'pending' | 'downloading' | 'merging' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface QueueItem {
  id: string;
  url: string;
  output: string;
  headers?: Record<string, string>;
  /** Persistent cache directory for TS segments (enables resume after restart). */
  cacheDir?: string;
  status: QueueStatusType;
  progress: { percent: number; speed: string; eta: string };
  error?: string;
  addedAt: number;
  fileName: string;
}

export interface QueueStatus {
  items: QueueItem[];
  isProcessing: boolean;
  activeIds: string[];
  concurrency: number;
}

// ─── Download view shared types ────────────────────────────────────────────────

/** A selectable m3u8 quality variant parsed from a master playlist. */
export interface QualityVariant {
  url: string;
  resolution: string;
  height: number;
  label: string;
  bandwidth?: number;
}

/** Raw cookie extracted from a browser session, keyed by (domain, name). */
export interface RawCookie {
  domain: string;
  name: string;
  value: string;
}
