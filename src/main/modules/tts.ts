// TTS 语音合成：基于 edge-tts 将文本转 MP3，支持批量处理、试听与取消
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { Communicate } from 'edge-tts-universal'

export interface TtsVoicePreset {
  id: string
  label: string
  gender: string
  style: string
}

export interface TtsProgressData {
  percent: number
  currentFile: number
  totalFiles: number
  speed: string
  eta: string
  currentFileName?: string
}

export interface BatchTtsOptions {
  files: { input: string; output: string }[]
  voice: string
  rate: number
  onProgress?: (data: TtsProgressData) => void
}

export interface PreviewTtsOptions {
  text: string
  voice: string
  rate: number
}

/** 预设中文语音列表 */
export const TTS_VOICE_PRESETS: TtsVoicePreset[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 (女声·自然)', gender: '女', style: '自然风格，适合小说朗读' },
  { id: 'zh-CN-YunxiNeural', label: '云希 (男声·年轻)', gender: '男', style: '年轻风格，适合男主故事' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 (男声·播报)', gender: '男', style: '新闻播报风格' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 (女声·温柔)', gender: '女', style: '温柔风格' },
  { id: 'zh-CN-YunjianNeural', label: '云健 (男声·沉稳)', gender: '男', style: '沉稳风格' },
  { id: 'zh-CN-XiaochenNeural', label: '晓辰 (女声·新闻)', gender: '女', style: '新闻风格' },
  { id: 'zh-CN-XiaoyouNeural', label: '晓悠 (女声·轻松)', gender: '女', style: '轻松愉快风格' }
]

/** 模块级取消标志 */
let isCancelled = false

/** 将数字语速（-50~+50）转为 edge-tts rate 字符串 */
function formatRate(rate: number): string {
  const sign = rate >= 0 ? '+' : ''
  return `${sign}${rate}%`
}

/** Markdown 格式清洗正则 */
const MD_CLEANUP_PATTERNS: [RegExp, string][] = [
  [/\*([^*]+)\*/g, '$1'],
  [/_([^_]+)_/g, '$1'],
  [/\[([^\]]+)\]\([^)]+\)/g, '$1'],
  [/!\[([^\]]*)\]\([^)]+\)/g, ''],
  [/^```\w*$/gm, ''],
  [/`([^`]+)`/g, '$1']
]

/**
 * 清洗 Markdown 格式标记，保留纯文本内容
 */
export function cleanMarkdown(text: string): string {
  const lines: string[] = []

  for (let line of text.split('\n')) {
    // 去除标题标记
    line = line.replace(/^#+\s*/, '')
    // 去除粗体
    line = line.replace(/\*\*/g, '').replace(/__/g, '')

    // 应用正则清洗
    for (const [pattern, replacement] of MD_CLEANUP_PATTERNS) {
      line = line.replace(pattern, replacement)
    }

    // 去除列表标记
    if (line.startsWith('- ')) {
      line = line.slice(2)
    }
    const orderedMatch = line.match(/^\d+\.\s*/)
    if (orderedMatch) {
      line = line.slice(orderedMatch[0].length)
    }

    // 去除分隔线
    if (/^[-*_]{3,}$/.test(line.trim())) {
      line = ''
    }

    if (line.trim()) {
      lines.push(line)
    }
  }

  return lines.join('\n')
}

/**
 * 合成文本到 MP3 文件
 */
async function synthesizeToFile(text: string, voice: string, rate: number, outputPath: string): Promise<boolean> {
  const communicate = new Communicate(text, {
    voice,
    rate: formatRate(rate)
  })

  const chunks: Buffer[] = []
  for await (const chunk of communicate.stream()) {
    if (isCancelled) {
      return false
    }
    if (chunk.type === 'audio' && chunk.data) {
      chunks.push(chunk.data)
    }
  }

  if (chunks.length === 0) {
    return false
  }

  const audioBuffer = Buffer.concat(chunks)
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(outputPath, audioBuffer)
  return true
}

/**
 * 批量合成文本文件为 MP3
 */
export async function batchSynthesize(opts: BatchTtsOptions): Promise<{ success: number; failed: string[] }> {
  isCancelled = false
  const { files, voice, rate, onProgress } = opts
  const total = files.length
  let success = 0
  const failed: string[] = []
  const startTime = Date.now()

  for (let i = 0; i < total; i++) {
    if (isCancelled) {
      break
    }

    const { input, output } = files[i]
    const fileName = path.basename(input)

    if (onProgress) {
      const elapsed = (Date.now() - startTime) / 1000
      const speed = i > 0 ? `${(i / elapsed).toFixed(1)} 文件/秒` : ''
      const eta = i > 0 ? `${Math.round((elapsed / i) * (total - i))}s` : ''
      onProgress({
        percent: Math.round((i / total) * 100),
        currentFile: i + 1,
        totalFiles: total,
        speed,
        eta,
        currentFileName: fileName
      })
    }

    try {
      let text = fs.readFileSync(input, 'utf-8')
      // 对 .md 文件进行格式清洗
      if (input.toLowerCase().endsWith('.md') || input.toLowerCase().endsWith('.markdown')) {
        text = cleanMarkdown(text)
      }

      if (!text.trim()) {
        failed.push(input)
        continue
      }

      const ok = await synthesizeToFile(text, voice, rate, output)
      if (ok) {
        success++
      } else {
        failed.push(input)
      }
    } catch (_e) {
      failed.push(input)
    }
  }

  // 最终进度
  if (onProgress && !isCancelled) {
    onProgress({
      percent: 100,
      currentFile: total,
      totalFiles: total,
      speed: '',
      eta: '',
      currentFileName: ''
    })
  }

  return { success, failed }
}

/**
 * 语音预览：合成短文本到临时文件，返回 MP3 路径
 */
export async function previewVoice(opts: PreviewTtsOptions): Promise<string> {
  const { text, voice, rate } = opts
  const previewDir = path.join(app.getPath('temp'), 'sn-tts-preview')
  if (!fs.existsSync(previewDir)) {
    fs.mkdirSync(previewDir, { recursive: true })
  }

  // 清理旧预览文件
  try {
    const oldFiles = fs.readdirSync(previewDir)
    for (const f of oldFiles) {
      fs.unlinkSync(path.join(previewDir, f))
    }
  } catch (_e) {
    // ignore cleanup errors
  }

  const outputPath = path.join(previewDir, `preview_${Date.now()}.mp3`)
  const ok = await synthesizeToFile(text, voice, rate, outputPath)
  if (!ok) {
    throw new Error('语音合成失败，请检查网络连接或尝试其他声音')
  }
  return outputPath
}

/**
 * 获取预设语音列表
 */
export function getTtsVoices(): TtsVoicePreset[] {
  return TTS_VOICE_PRESETS
}

/**
 * 取消 TTS 操作
 */
export function cancelTts(): void {
  isCancelled = true
}
