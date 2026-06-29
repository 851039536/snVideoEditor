import type { VideoMeta } from '@/types/file'

export interface PlayerEntry {
  path: string
  isEncrypted: boolean
  meta: VideoMeta | null
  tempPath: string | null
}
