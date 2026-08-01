// 网页路径解析与勾选入队逻辑
import { reactive, ref } from 'vue';
import type { InjectionKey, Ref } from 'vue';
import { sanitizeFileName, todayDateStr } from '@/utils/format';
import { buildCookieHeader } from '@/utils/cookies';
import type { WebPageEntry, WebPageParseState } from '@/views/Download/types';

/** 与 DownloadView 保持一致的默认 UA */
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** 批量入队结果统计 */
export interface EnqueueResult {
  ok: number;
  fail: number;
  skipped: number;
}

export interface UseWebPageParseReturn {
  parseStates: Record<string, WebPageParseState>;
  parsingId: Ref<string>;
  enqueueingId: Ref<string>;
  getState: (entryId: string) => WebPageParseState | undefined;
  parseEntry: (entry: WebPageEntry) => Promise<void>;
  toggleLink: (entryId: string, linkIndex: number) => void;
  toggleAll: (entryId: string, selected: boolean) => void;
  enqueueSelected: (entry: WebPageEntry, outputDir: string) => Promise<EnqueueResult>;
  clearState: (entryId: string) => void;
}

/** 供父子组件共享同一解析状态实例的注入键（useWebPageParse 每次调用新建状态，非单例） */
export const webPageParseKey: InjectionKey<UseWebPageParseReturn> = Symbol('webPageParse');

/** 创建空白解析状态 */
function createEmptyState(): WebPageParseState {
  return { status: 'idle', links: [], pageTitle: '', pageUrl: '', cookies: [], error: '' };
}

export function useWebPageParse(): UseWebPageParseReturn {
  /** 按条目 id 存放各自的解析状态（仅内存） */
  const parseStates = reactive<Record<string, WebPageParseState>>({});
  // 互斥锁：同一时刻只允许一条路径解析（page-fetcher 在默认 session 注册全局拦截器，
  // 并发解析会互相串扰，且每个隐藏 BrowserWindow 是独立渲染进程，需避免资源失控）
  const parsingId = ref('');
  // 批量入队幂等保护：防止快速双击重复入队
  const enqueueingId = ref('');

  function getState(entryId: string): WebPageParseState | undefined {
    return parseStates[entryId];
  }

  /** 解析单条网页路径，提取页面中的 m3u8 链接 */
  async function parseEntry(entry: WebPageEntry): Promise<void> {
    if (parsingId.value) {
      return;
    }
    parsingId.value = entry.id;
    const state = createEmptyState();
    state.status = 'parsing';
    parseStates[entry.id] = state;
    try {
      const result = await window.electronAPI.fetchPageM3u8(entry.url);
      state.links = result.m3u8Urls.map((url) => ({ url, selected: false }));
      state.pageTitle = result.pageTitle;
      state.pageUrl = result.pageUrl;
      state.cookies = result.cookies || [];
      state.status = 'done';
    } catch (e) {
      state.status = 'error';
      state.error = e instanceof Error ? e.message : String(e);
    } finally {
      parsingId.value = '';
    }
  }

  /** 切换单条链接勾选态 */
  function toggleLink(entryId: string, linkIndex: number): void {
    const state = parseStates[entryId];
    if (state && state.links[linkIndex]) {
      state.links[linkIndex].selected = !state.links[linkIndex].selected;
    }
  }

  /** 全选/全不选 */
  function toggleAll(entryId: string, selected: boolean): void {
    const state = parseStates[entryId];
    if (state) {
      for (const link of state.links) {
        link.selected = selected;
      }
    }
  }

  /** 按条目自身的页面上下文构建请求头（不依赖视图全局 headers，避免多路径互相污染） */
  function buildHeadersForLink(state: WebPageParseState, linkUrl: string): Record<string, string> {
    const headers: Record<string, string> = { 'User-Agent': DEFAULT_UA };
    try {
      const parsed = new URL(state.pageUrl);
      headers['Referer'] = `${parsed.protocol}//${parsed.hostname}/`;
      headers['Origin'] = `${parsed.protocol}//${parsed.hostname}`;
    } catch {
      /* ignore */
    }
    const cookieStr = buildCookieHeader(linkUrl, state.cookies);
    if (cookieStr) {
      headers['Cookie'] = cookieStr;
    }
    return headers;
  }

  /** 将勾选的链接逐条加入下载队列，返回成功/失败/跳过数 */
  async function enqueueSelected(entry: WebPageEntry, outputDir: string): Promise<EnqueueResult> {
    const result: EnqueueResult = { ok: 0, fail: 0, skipped: 0 };
    const state = parseStates[entry.id];
    if (!state || enqueueingId.value || !outputDir) {
      return result;
    }
    enqueueingId.value = entry.id;
    try {
      const selectedLinks = state.links.filter((l) => l.selected);
      const baseName = sanitizeFileName(state.pageTitle) || 'video';
      const dateStr = todayDateStr();
      for (let i = 0; i < selectedLinks.length; i++) {
        const link = selectedLinks[i];
        // 多链接时追加序号，避免同页多个链接互相重名
        const fileName = selectedLinks.length > 1
          ? `${baseName}_${i + 1}_${dateStr}.mp4`
          : `${baseName}_${dateStr}.mp4`;
        try {
          // 下载历史查重：重复时弹确认框，拒绝则跳过该条
          const dup = await window.electronAPI.checkDownloadDuplicate(fileName);
          if (dup) {
            const confirmed = await window.electronAPI.confirmDialog(
              `文件名 "${fileName}" 已下载过（上次: ${new Date(dup.completedAt).toLocaleString()}），是否重复下载？`,
              '重复下载确认'
            );
            if (!confirmed) {
              result.skipped++;
              continue;
            }
          }
          await window.electronAPI.enqueueDownload({
            url: link.url,
            output: outputDir.replace(/\\/g, '/') + '/' + fileName,
            headers: buildHeadersForLink(state, link.url),
            fileName
          });
          link.selected = false; // 入队成功后取消勾选，防止重复批量入队
          result.ok++;
        } catch (e) {
          result.fail++;
          // 队列已满时终止循环，剩余未入队数计入 fail
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('下载队列已满')) {
            result.fail += selectedLinks.length - 1 - i;
            break;
          }
        }
      }
    } finally {
      enqueueingId.value = '';
    }
    return result;
  }

  /** 删除路径条目时清理对应解析状态 */
  function clearState(entryId: string): void {
    delete parseStates[entryId];
  }

  return {
    parseStates,
    parsingId,
    enqueueingId,
    getState,
    parseEntry,
    toggleLink,
    toggleAll,
    enqueueSelected,
    clearState
  };
}
