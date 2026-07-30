// 下载页模块类型定义：网页路径条目与解析状态
import type { RawCookie } from '@/types/file';

/** 持久化的网页路径条目（不含解析结果，cookies 有时效性不落盘） */
export interface WebPageEntry {
  /** 唯一标识，形如 `wp_${Date.now()}_${随机串}` */
  id: string;
  url: string;
  createdAt: number;
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
