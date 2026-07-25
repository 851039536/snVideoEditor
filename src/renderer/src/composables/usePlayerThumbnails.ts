/**
 * Player 缩略图生成 composable：精灵图会话缓存、按需生成与取消。
 * 取消时终止 ffmpeg 进程以释放源文件句柄（否则清空/删除后文件仍被占用）。
 */
import { ref, type Ref } from 'vue';
import type { PlayerEntry, ThumbnailData } from '@/views/Player/types';
import { resolvePlayablePath } from '@/views/Player/types';

export function usePlayerThumbnails(deps: {
  currentFile: Ref<PlayerEntry | null>;
  tempDir: Ref<string>;
}) {
  const thumbnailGenerating = ref(false);
  const thumbnailData = ref<ThumbnailData | null>(null);
  // Session-level cache: video path -> sprite/vtt, avoids regenerating on re-select
  const thumbnailCache = new Map<string, ThumbnailData>();
  let thumbGenId = 0;

  function hashPath(p: string): string {
    let hash = 0;
    for (let i = 0; i < p.length; i++) {
      const ch = p.charCodeAt(i);
      hash = (hash << 5) - hash + ch;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  function getThumbnailCacheDir(): string {
    if (!deps.tempDir.value) {
      return '';
    }
    const hash = hashPath(deps.currentFile.value?.path || '');
    return deps.tempDir.value + '/thumbnails_' + hash;
  }

  async function generateThumbnailsIfNeeded(): Promise<void> {
    const cf = deps.currentFile.value;
    if (!cf || !deps.tempDir.value) {
      return;
    }

    const input = resolvePlayablePath(cf);
    if (!input) {
      return;
    }

    // Session cache reuse — skip ffmpeg if we already generated for this file
    const cached = thumbnailCache.get(cf.path);
    if (cached) {
      thumbnailData.value = cached;
      return;
    }

    const dur = cf.meta?.duration || 0;
    if (dur < 5) {
      return;
    } // Too short, skip

    const myGen = ++thumbGenId;
    thumbnailData.value = null;
    thumbnailGenerating.value = true;
    try {
      const result = await window.electronAPI.generateThumbnails({
        input,
        outputDir: getThumbnailCacheDir(),
        thumbWidth: 160,
        thumbHeight: 90,
        interval: Math.max(5, Math.ceil(dur / 100)), // ~100 thumbnails total
        cols: 10
      });
      // Dropped if user switched to another file meanwhile
      if (myGen !== thumbGenId) {
        return;
      }
      if (result.vttUrl) {
        const data: ThumbnailData = { spriteUrl: result.spriteUrl, vttUrl: result.vttUrl };
        thumbnailData.value = data;
        thumbnailCache.set(cf.path, data);
      }
    } catch (_e) {
      // Silently skip — thumbnail generation is best-effort
      if (myGen === thumbGenId) {
        console.warn('Thumbnail generation failed:', _e);
      }
    } finally {
      if (myGen === thumbGenId) {
        thumbnailGenerating.value = false;
      }
    }
  }

  /** 终止进行中的缩略图生成：ffmpeg 全程持有源文件句柄，不终止会导致清空/删除后文件仍被占用 */
  async function cancelThumbnailGeneration(): Promise<void> {
    if (!thumbnailGenerating.value) {
      return;
    }
    thumbGenId++; // 使进行中的结果失效
    thumbnailGenerating.value = false;
    try {
      await window.electronAPI.cancelOperation();
      // taskkill 异步生效，稍候片刻确保 ffmpeg 退出并释放文件句柄
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (_e) {
      /* ignore */
    }
  }

  return {
    thumbnailGenerating,
    thumbnailData,
    generateThumbnailsIfNeeded,
    cancelThumbnailGeneration
  };
}
