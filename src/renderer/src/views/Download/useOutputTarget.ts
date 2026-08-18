// 下载输出目标管理：目录选择与文件名自动生成
import { computed, ref } from 'vue';
import type { Ref } from 'vue';
import { todayDateStr, sanitizeFileName } from '@/utils/format';

export function useOutputTarget(m3u8Url: Ref<string>, fetchedTitle: Ref<string>) {
  const commonPaths = ref<{ desktop: string; downloads: string }>({ desktop: '', downloads: '' });
  const outputDir = ref('');
  const fileName = ref('');
  // 用户手动编辑过文件名后置 true，避免 URL 变化时覆盖用户输入
  const fileNameEdited = ref(false);
  const loadingPath = ref('');

  /** 自动文件名：优先页面标题，其次 URL 路径末段，均带日期后缀 */
  const autoFileName = computed((): string => {
    const ts = todayDateStr();
    // 优先级 1：使用页面标题（来自「从网页提取」）
    if (fetchedTitle.value) {
      const safe = sanitizeFileName(fetchedTitle.value);
      return `${safe || 'video'}_${ts}.mp4`;
    }
    // 优先级 2：从 URL 路径推导
    try {
      const urlPath = new URL(m3u8Url.value).pathname;
      const segments = urlPath.split('/').filter(Boolean);
      const last = segments[segments.length - 1] || 'video';
      const name = last.replace(/\.(m3u8|ts|mp4|mkv|webm|avi)$/i, '');
      return `${name}_${ts}.mp4`;
    } catch {
      return `download_${ts}.mp4`;
    }
  });

  /** 完整输出路径（正斜杠拼接），目录或文件名缺失时为空 */
  const outputPath = computed((): string => {
    if (!outputDir.value || !fileName.value) {
      return '';
    }
    return outputDir.value.replace(/\\/g, '/') + '/' + fileName.value;
  });

  /** 拉取桌面/下载等系统常用目录 */
  async function fetchCommonPaths(): Promise<void> {
    try {
      commonPaths.value = await window.electronAPI.getCommonPaths();
    } catch (_e) {
      /* 保留默认空值 */
    }
  }

  /** 快速选择桌面或系统下载目录；无法获取系统路径时返回 false（由调用方提示） */
  async function selectQuickDir(type: 'desktop' | 'downloads'): Promise<boolean> {
    loadingPath.value = type;
    try {
      if (!commonPaths.value[type]) {
        await fetchCommonPaths();
      }
      const dir = commonPaths.value[type];
      if (dir) {
        outputDir.value = dir;
        return true;
      }
      return false;
    } finally {
      loadingPath.value = '';
    }
  }

  /** 打开目录选择对话框自定义输出位置 */
  async function selectCustomDir(): Promise<void> {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      outputDir.value = dir;
    }
  }

  return {
    commonPaths,
    outputDir,
    fileName,
    fileNameEdited,
    loadingPath,
    autoFileName,
    outputPath,
    fetchCommonPaths,
    selectQuickDir,
    selectCustomDir
  };
}
