/**
 * Check if a codec string refers to a GPU-accelerated encoder (NVENC or QuickSync).
 * Shared between renderer and main process. 主进程侧在 ffmpeg-shared.ts 中有同逻辑副本。
 */
export function isGpuCodec(codec: string): boolean {
  return codec.includes('nvenc') || codec.includes('qsv')
}

/**
 * Check if a codec string refers to VP9 encoder (libvpx-vp9).
 * VP9 uses different preset values and CRF range than H.264/H.265.
 * 主进程侧在 ffmpeg-shared.ts 中有同逻辑副本，保持一致。
 */
export function isVp9Codec(codec: string): boolean {
  return codec.includes('vp9')
}
