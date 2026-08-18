// 下载队列状态同步与操作转发（监听器绑定组件生命周期）
import { onMounted, onUnmounted } from 'vue';
import { useProgressStore } from '@/stores/progress';
import type { QueueStatus } from '@/types/file';

export function useDownloadQueueSync() {
  const progressStore = useProgressStore();

  /** 将后端队列状态同步到 progressStore */
  function applyQueueStatus(status: QueueStatus): void {
    progressStore.updateQueueItems(status.items);
    progressStore.queueConcurrency = status.concurrency;
  }

  /** 设置最大并发下载数并同步主进程 */
  function setConcurrency(n: number): void {
    progressStore.queueConcurrency = n;
    window.electronAPI.setDownloadConcurrency(n);
  }

  async function cancelAllDownloads(): Promise<void> {
    await window.electronAPI.cancelDownloadQueue();
  }

  async function retryQueueItem(id: string): Promise<void> {
    await window.electronAPI.retryQueueItem(id);
  }

  /** 一键重新入队所有失败项 */
  async function retryAllFailed(): Promise<void> {
    await window.electronAPI.retryAllFailed();
  }

  /** 用系统默认播放器打开已完成的文件 */
  function openFileItem(filePath: string): void {
    window.electronAPI.openFile(filePath);
  }

  /** 在资源管理器中显示并选中文件 */
  function revealItemInFolder(filePath: string): void {
    window.electronAPI.revealItem(filePath);
  }

  async function removeQueueItem(id: string): Promise<void> {
    await window.electronAPI.removeQueueItem(id);
  }

  async function cancelQueueItem(id: string): Promise<void> {
    const ok = await window.electronAPI.cancelQueueItem(id);
    if (!ok) {
      // 点击与 IPC 之间项已转为终态，重新同步状态
      try {
        const status = await window.electronAPI.getQueueStatus();
        applyQueueStatus(status);
      } catch {
        /* ignore */
      }
    }
  }

  async function pauseQueueItem(id: string): Promise<void> {
    await window.electronAPI.pauseQueueItem(id);
  }

  async function resumeQueueItem(id: string): Promise<void> {
    await window.electronAPI.resumeQueueItem(id);
  }

  async function clearQueueTerminal(): Promise<void> {
    await window.electronAPI.clearQueueTerminal();
  }

  // 监听器绑定组件生命周期：挂载时注册、卸载时移除，覆盖整个挂载期
  onMounted(async () => {
    // 先注册监听再拉取初始状态，避免 await 间隙丢失后端推送
    window.electronAPI.onQueueUpdate((status) => {
      applyQueueStatus(status);
    });

    // 监听活动队列项的下载进度
    window.electronAPI.onQueueProgress((data) => {
      progressStore.updateQueueItemProgress(data.queueId, {
        percent: data.percent,
        speed: data.speed,
        eta: data.eta
      });
    });

    // 拉取初始队列状态（导航前可能已有任务）
    try {
      const status = await window.electronAPI.getQueueStatus();
      applyQueueStatus(status);
    } catch {
      /* 后端可能尚未就绪 */
    }
  });

  onUnmounted(() => {
    window.electronAPI?.removeQueueListeners();
  });

  return {
    applyQueueStatus,
    setConcurrency,
    cancelAllDownloads,
    retryQueueItem,
    retryAllFailed,
    openFileItem,
    revealItemInFolder,
    removeQueueItem,
    cancelQueueItem,
    pauseQueueItem,
    resumeQueueItem,
    clearQueueTerminal
  };
}
