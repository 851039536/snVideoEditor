// 下载页模块类型定义：网页路径条目与解析状态
import type { RawCookie } from '@/types/file';

/** 网页路径下载状态：待下载 / 已下载 */
export type WebPageStatus = 'pending' | 'downloaded';

/** 持久化的网页路径条目（主进程 web-page-paths.json，不含解析结果） */
export interface WebPageEntry {
  /** 唯一标识，形如 `wp_${Date.now()}_${随机串}` */
  id: string;
  url: string;
  createdAt: number;
  /** 下载状态，默认 pending（旧数据/手编缺失时读取端补默认值） */
  status: WebPageStatus;
}

/** 单条解析出的媒体链接（含勾选态） */
export interface ParsedLink {
  url: string;
  selected: boolean;
}

/** 每条网页路径的解析运行时状态（仅内存，不持久化） */
export interface WebPageParseState {
  status: 'idle' | 'parsing' | 'done' | 'error';
  links: ParsedLink[];
  pageTitle: string;
  pageUrl: string;
  cookies: RawCookie[];
  error: string;
}
