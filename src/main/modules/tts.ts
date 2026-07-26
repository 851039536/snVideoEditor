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
  // 女声
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 (女声·自然)', gender: '女', style: '自然风格，适合小说朗读' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 (女声·温柔)', gender: '女', style: '温柔风格' },
  { id: 'zh-CN-XiaochenNeural', label: '晓辰 (女声·新闻)', gender: '女', style: '新闻风格' },
  { id: 'zh-CN-XiaoyouNeural', label: '晓悠 (女声·轻松)', gender: '女', style: '轻松愉快风格' },
  { id: 'zh-CN-XiaohanNeural', label: '晓涵 (女声·知性)', gender: '女', style: '知性风格，适合教程讲解' },
  { id: 'zh-CN-XiaomengNeural', label: '晓梦 (女声·甜美)', gender: '女', style: '甜美可爱风格' },
  { id: 'zh-CN-XiaoxuanNeural', label: '晓萱 (女声·活泼)', gender: '女', style: '活泼风格，适合娱乐内容' },
  { id: 'zh-CN-XiaoruiNeural', label: '晓睿 (女声·成熟)', gender: '女', style: '成熟稳重，适合纪录片' },
  { id: 'zh-CN-XiaoshuangNeural', label: '晓双 (女声·儿童)', gender: '女', style: '儿童声音，适合儿童故事' },
  { id: 'zh-CN-XiaozhenNeural', label: '晓甄 (女声·优雅)', gender: '女', style: '优雅风格，适合文学作品' },
  // 男声
  { id: 'zh-CN-YunxiNeural', label: '云希 (男声·年轻)', gender: '男', style: '年轻风格，适合男主故事' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 (男声·播报)', gender: '男', style: '新闻播报风格' },
  { id: 'zh-CN-YunjianNeural', label: '云健 (男声·沉稳)', gender: '男', style: '沉稳风格' },
  { id: 'zh-CN-YunfengNeural', label: '云枫 (男声·磁性)', gender: '男', style: '磁性嗓音，适合有声书' },
  { id: 'zh-CN-YunhaoNeural', label: '云皓 (男声·广告)', gender: '男', style: '广告风格，充满活力' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏 (男声·少年)', gender: '男', style: '少年音，适合青春题材' },
  { id: 'zh-CN-YunzeNeural', label: '云泽 (男声·标准)', gender: '男', style: '标准男声，通用场景' },
  // 方言/地区
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北 (女声·东北)', gender: '女', style: '东北方言风格' },
  { id: 'zh-TW-HsiaoChenNeural', label: '晓臻 (女声·台湾)', gender: '女', style: '台湾口音中文' },
  { id: 'zh-HK-HiuGaaiNeural', label: '晓佳 (女声·粤语)', gender: '女', style: '粤语风格' }
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
 * 合成文本到 MP3 文件（带重试）
 */
async function synthesizeToFile(text: string, voice: string, rate: number, outputPath: string, retries = 2): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
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
        if (attempt < retries) {
          continue
        }
        return false
      }

      const audioBuffer = Buffer.concat(chunks)
      const dir = path.dirname(outputPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(outputPath, audioBuffer)
      return true
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      // NoAudioReceived 错误时重试
      if (errMsg.includes('No audio was received') && attempt < retries) {
        continue
      }
      throw e
    }
  }
  return false
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

  try {
    const ok = await synthesizeToFile(text, voice, rate, outputPath)
    if (!ok) {
      throw new Error('empty')
    }
    return outputPath
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    if (errMsg.includes('No audio was received') || errMsg === 'empty') {
      throw new Error(`该语音暂时不可用，请尝试其他声音或调整语速为 0% 后重试`)
    }
    if (errMsg.includes('network') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ETIMEDOUT')) {
      throw new Error('网络连接失败，请检查网络后重试')
    }
    throw new Error(`语音合成失败: ${errMsg}`)
  }
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
