// 渲染进程共享类型：文件条目、分割片段、下载队列与下载页类型（部分自 preload 重新导出）
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

/** 变速片段：用户在时间轴上标记的待变速区间（统一源、全部处理，无需 ClipItem 的源/选中字段） */
export interface SpeedSegment {
  id: string;
  startSec: number;
  endSec: number;
  duration: number;
  speed: number;
}

// ─── 下载队列共享类型 ─────────────────────────────────────────────
// 从 preload 重新导出（与 VideoMeta 同模式）；后端 download-queue.ts 的
// QueueItem 为含主进程私有字段的超集，二者字段需保持对齐。
export type {
  QueueStatusType,
  QueueItemDTO as QueueItem,
  QueueStatusDTO as QueueStatus
} from '../../../preload/index';

// ─── 下载页共享类型 ────────────────────────────────────────────────

/** 从 master playlist 解析出的可选 m3u8 清晰度变体 */
export interface QualityVariant {
  url: string;
  resolution: string;
  height: number;
  label: string;
  bandwidth?: number;
}

/** 从浏览器会话提取的原始 Cookie，按 (domain, name) 区分 */
export interface RawCookie {
  domain: string;
  name: string;
  value: string;
}
