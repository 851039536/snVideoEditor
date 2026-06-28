import * as fs from 'fs'
import * as path from 'path'
import { decryptFile } from './crypto'

/**
 * Decrypt an encrypted video file to a temporary location for playback.
 * This bypasses the operation lock (wrapOperation) since playback is a
 * lightweight preview that shouldn't block other operations.
 *
 * @param input - Path to the encrypted .enc file
 * @param password - Decryption password
 * @param tempDir - Directory to store the temporary decrypted file
 * @returns The path to the temporary decrypted file
 */
export async function decryptForPlayback(
  input: string,
  password: string,
  tempDir: string
): Promise<string> {
  if (!fs.existsSync(input)) {
    throw new Error(`文件不存在: ${input}`)
  }

  if (!password || password.length < 4) {
    throw new Error('密码至少需要4个字符')
  }

  // Verify the file looks like an encrypted file (has .enc suffix)
  if (path.extname(input).toLowerCase() !== '.enc') {
    throw new Error('不是加密视频文件（缺少 .enc 扩展名）')
  }

  // Generate temp output path
  const baseName = path.basename(input, '.enc')
  const tempName = `sn_player_${Date.now()}_${baseName}`
  const tempPath = path.join(tempDir, tempName)

  try {
    await decryptFile({
      input,
      output: tempPath,
      password
    })

    if (!fs.existsSync(tempPath)) {
      throw new Error('解密失败：未生成输出文件')
    }

    return tempPath
  } catch (e) {
    // Clean up partial output on failure
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }
    } catch {
      // ignore cleanup errors
    }
    throw e
  }
}
