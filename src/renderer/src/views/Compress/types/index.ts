/** CompressView module type definitions */

/** 批量压缩文件处理状态 */
export type BatchFileStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface CompressResultItem {
  fileName: string
  originalSize: number
  compressedSize: number
}
