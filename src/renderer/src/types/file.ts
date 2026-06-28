import type { VideoMeta } from '../../../preload/index'

export type { VideoMeta }

export interface FileEntry {
  path: string
  outputPath: string
  meta: VideoMeta | null
}

export interface ClipItem {
  id: string
  sourceFile: string
  sourceFileName: string
  startSec: number
  endSec: number
  duration: number
  outputFile: string
  selected: boolean
}
