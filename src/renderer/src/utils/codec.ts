/**
 * Check if a codec string refers to a GPU-accelerated encoder (NVENC or QuickSync).
 * Shared between renderer and main process. 主进程侧在 ffmpeg-shared.ts 中有同逻辑副本。
 */
export function isGpuCodec(codec: string): boolean {
  return codec.includes('nvenc') || codec.includes('qsv')
}
