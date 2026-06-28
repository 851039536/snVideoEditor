import type { VideoMeta } from '../../../preload/index'

export interface FileEntry {
  path: string
  outputPath: string
  meta: VideoMeta | null
}
