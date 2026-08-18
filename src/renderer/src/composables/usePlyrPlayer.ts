/**
 * Plyr 播放器实例 composable：初始化/销毁、倍速、控件栏开关、A-B 循环与事件接线。
 * 从 PlayerView.vue 提取（2026-08）。
 */
import { ref, shallowRef, watch, type Ref } from 'vue';
// @ts-ignore - Plyr ESM default export
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import type { PlayerEntry, ThumbnailData } from '@/views/Player/types';

export function usePlyrPlayer(deps: {
  videoPlayer: Ref<HTMLVideoElement | null>;
  videoSrc: Ref<string>;
  currentFile: Ref<PlayerEntry | null>;
  thumbnailData: Ref<ThumbnailData | null>;
  isPlaying: Ref<boolean>;
  errorMsg: Ref<string>;
  /** 是否需要响应式追踪当前播放时间（仅截图弹窗打开时为 true，避免高频无效更新） */
  shouldTrackTime: () => boolean;
  /** 暂停时回调（用于持久化播放进度） */
  onPause: () => void;
  /** 播放结束时回调 */
  onEnded: () => void;
  /** Plyr 初始化完成后回调（用于渲染进度条截图标记） */
  onInit: () => void;
  /** 读取当前文件的持久化播放进度（秒），用于断点续播 */
  getSavedTime: () => number;
}) {
  // Plyr instance (shallowRef to avoid deep reactive proxy overhead)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const player = shallowRef<any>(null);
  // Path of the file the current player instance is actually playing (persistence key)
  const currentPlayingPath = ref('');
  /** 响应式当前播放时间（供截图弹窗显示，由 timeupdate 驱动，按需更新） */
  const reactiveCurrentTime = ref(0);

  // ---- Toolbar controls ----
  const showControlsOverlay = ref(false); // force-show controls bar
  const autoHideControls = ref(true); // auto-hide toggle
  const currentSpeed = ref(1); // synced with Plyr speed
  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // ---- A-B loop ----
  const loopStart = ref<number | null>(null);
  const loopEnd = ref<number | null>(null);

  function setSpeed(speed: number): void {
    if (!player.value) {
      return;
    }
    currentSpeed.value = speed;
    player.value.speed = speed;
  }

  function toggleControlsOverlay(): void {
    if (!player.value) {
      return;
    }
    showControlsOverlay.value = !showControlsOverlay.value;
    player.value.toggleControls(showControlsOverlay.value);
  }

  function toggleAutoHide(): void {
    autoHideControls.value = !autoHideControls.value;
  }

  // Reactively toggle Plyr auto-hide when user changes the switch
  watch(autoHideControls, (val): void => {
    if (!player.value) {
      return;
    }
    player.value.toggleControls(!val);
  });

  function setLoopA(): void {
    if (!player.value) {
      return;
    }
    const start = player.value.currentTime || 0;
    loopStart.value = start;
    if (loopEnd.value !== null && loopEnd.value <= start) {
      loopEnd.value = null;
    }
  }

  function setLoopB(): void {
    if (!player.value) {
      return;
    }
    const t = player.value.currentTime || 0;
    if (loopStart.value !== null && t > loopStart.value) {
      loopEnd.value = t;
    }
  }

  function clearLoop(): void {
    loopStart.value = null;
    loopEnd.value = null;
  }

  function destroyPlayer(): void {
    if (player.value) {
      // Plyr 初始化时 cloneNode 备份了带 src 的原始 video，destroy 会把该克隆插回 DOM。
      // 克隆 preload=auto 一进 DOM 就重新打开文件句柄，且 Vue 不感知该元素，必须手动中止并移除
      const restored = player.value.elements?.original as HTMLVideoElement | undefined;
      try {
        player.value.destroy();
      } catch (_e) {
        /* ignore */
      }
      player.value = null;
      if (restored && typeof restored.load === 'function') {
        try {
          restored.pause();
          restored.removeAttribute('src');
          restored.load();
          restored.remove();
        } catch (_e) {
          /* ignore */
        }
      }
    }
    deps.isPlaying.value = false;
  }

  /** 显式释放 video 元素资源（文件句柄 + 解码线程），避免 file:/// 延迟释放导致文件被线程占用无法删除 */
  function releaseVideoSource(): void {
    const el = deps.videoPlayer.value;
    if (!el) {
      return;
    }
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
    } catch (_e) {
      /* ignore */
    }
  }

  function initAndPlay(): void {
    const el = deps.videoPlayer.value;
    if (!el || !deps.videoSrc.value) {
      return;
    }

    destroyPlayer();

    player.value = new Plyr(el, {
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'settings', 'fullscreen'],
      settings: ['speed'],
      speed: { selected: currentSpeed.value, options: speedOptions },
      tooltips: { controls: true, seek: true },
      keyboard: { focused: true, global: true },
      fullscreen: { enabled: true, fallback: true },
      hideControls: autoHideControls.value,
      resetOnEnd: false,
      previewThumbnails: deps.thumbnailData.value
        ? { enabled: true, src: deps.thumbnailData.value.vttUrl }
        : { enabled: false, src: '' }
    });

    currentPlayingPath.value = deps.currentFile.value?.path || '';

    deps.onInit();

    player.value.on('ratechange', (): void => {
      if (player.value) {
        currentSpeed.value = player.value.speed;
      }
    });

    // 始终注册 controlshidden 监听：用户可能在运行中切换 autoHideControls
    player.value.on('controlshidden', (): void => {
      if (!autoHideControls.value && player.value) {
        player.value.toggleControls(true);
      }
    });

    player.value.on('play', (): void => {
      deps.isPlaying.value = true;
    });

    player.value.on('pause', (): void => {
      deps.isPlaying.value = false;
      deps.onPause();
    });

    // A-B loop enforcement + 响应式时间追踪（仅截图弹窗打开时更新，避免高频无效渲染）
    player.value.on('timeupdate', (): void => {
      if (deps.shouldTrackTime()) {
        reactiveCurrentTime.value = player.value?.currentTime || 0;
      }
      if (loopStart.value !== null && loopEnd.value !== null && player.value) {
        if (player.value.currentTime >= loopEnd.value) {
          player.value.currentTime = loopStart.value;
        }
      }
    });

    player.value.on('ended', (): void => {
      deps.isPlaying.value = false;
      deps.onEnded();
    });

    player.value.on('error', (): void => {
      deps.isPlaying.value = false;
      deps.errorMsg.value = '视频加载失败';
    });

    // Resume per-file playback position (once, on first canplay)
    const savedTime = deps.getSavedTime();
    let didResume = false;
    player.value.on('canplay', (): void => {
      if (didResume) {
        return;
      }
      didResume = true;
      if (savedTime > 1 && player.value && player.value.currentTime < 1) {
        player.value.currentTime = savedTime;
      }
    });

    void player.value.play().catch((): void => {
      /* 忽略自动播放限制 */
    });
  }

  return {
    // State
    player,
    currentPlayingPath,
    reactiveCurrentTime,
    currentSpeed,
    speedOptions,
    showControlsOverlay,
    autoHideControls,
    loopStart,
    loopEnd,
    // Lifecycle
    initAndPlay,
    destroyPlayer,
    releaseVideoSource,
    // Controls
    setSpeed,
    toggleControlsOverlay,
    toggleAutoHide,
    // A-B loop
    setLoopA,
    setLoopB,
    clearLoop
  };
}
