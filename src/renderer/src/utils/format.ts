/**
 * Format file size (bytes) to human readable string.
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) { return '0 B' }
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

/**
 * Extract file name (with extension) from a full path.
 */
export function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

/**
 * Return today's date as "YYYYMMDD" compact string.
 */
export function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * Truncate URL to maxLen, appending "..." if truncated.
 */
export function truncateUrl(url: string, maxLen = 50): string {
  if (url.length <= maxLen) { return url }
  return url.slice(0, maxLen - 3) + '...'
}

/**
 * Extract the directory portion from a full file path.
 * Returns empty string if path has no directory component.
 */
export function getDirName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

/**
 * Sanitize a string for use as a filename:
 * - Remove illegal characters (\\ / : * ? " < > |)
 * - Replace whitespace with underscores
 * - Collapse consecutive underscores
 * - Trim leading/trailing underscores
 * - Truncate to maxLen (default 80)
 */
export function sanitizeFileName(raw: string, maxLen = 80): string {
  return raw
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, maxLen)
}
