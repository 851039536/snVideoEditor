// 网页路径解析与勾选入队逻辑
import { computed, reactive, ref } from 'vue';
import type { ComputedRef, InjectionKey, Ref } from 'vue';
import { sanitizeFileName, todayDateStr } from '@/utils/format';
import { buildCookieHeader } from '@/utils/cookies';
import { buildOriginHeaders, DEFAULT_UA } from '@/utils/url';
import { confirmDownloadDuplicatesBatch } from '@/utils/download';
import type { WebPageEntry, WebPageParseState } from '@/views/Download/types';

/** 手动提取（「从网页提取」）占用互斥锁时的哨兵 id */
const MANUAL_FETCH_ID = '__manual__';

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
  /** 是否有解析/手动提取正在进行（互斥锁被占用） */
  isBusy: ComputedRef<boolean>;
  /** 手动提取（「从网页提取」）占用/释放同一互斥锁，防止与解析并发串扰 */
  setManualFetching: (busy: boolean) => void;
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
  /** 是否有解析或手动提取进行中（与解析共用同一互斥锁） */
  const isBusy = computed((): boolean => parsingId.value !== '');

  /** 手动提取（「从网页提取」）占用/释放互斥锁；占用时解析按钮同步被禁用 */
  function setManualFetching(busy: boolean): void {
    if (busy) {
      if (!parsingId.value) {
        parsingId.value = MANUAL_FETCH_ID;
      }
    } else if (parsingId.value === MANUAL_FETCH_ID) {
      parsingId.value = '';
    }
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
    Object.assign(headers, buildOriginHeaders(state.pageUrl));
    const cookieStr = buildCookieHeader(linkUrl, state.cookies);
    if (cookieStr) {
      headers['Cookie'] = cookieStr;
    }
    return headers;
  }

  /** 按序号生成下载文件名：多链接时追加序号避免同页重名 */
  function buildFileName(baseName: string, index: number, total: number, dateStr: string): string {
    return total > 1 ? `${baseName}_${index + 1}_${dateStr}.mp4` : `${baseName}_${dateStr}.mp4`;
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
      // 先为全部勾选链接生成文件名并批量查重，命中重复时仅弹一次汇总确认，
      // 用户选择「取消」时返回重复项集合，对应链接直接跳过
      const fileNames = selectedLinks.map((_l, i) => buildFileName(baseName, i, selectedLinks.length, dateStr));
      const duplicates = await confirmDownloadDuplicatesBatch(fileNames);
      for (let i = 0; i < selectedLinks.length; i++) {
        const link = selectedLinks[i];
        const fileName = fileNames[i];
        if (duplicates.has(fileName)) {
          result.skipped++;
          continue;
        }
        try {
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
    isBusy,
    setManualFetching,
    parseEntry,
    toggleLink,
    toggleAll,
    enqueueSelected,
    clearState
  };
}
