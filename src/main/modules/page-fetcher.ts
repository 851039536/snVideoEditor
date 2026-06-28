import { BrowserWindow } from 'electron'
import { PageFetchResult, DEFAULT_UA } from './download'

/**
 * Use a hidden Electron BrowserWindow to load a webpage and intercept
 * all m3u8 network requests. This bypasses Cloudflare anti-bot because
 * Electron uses a real Chromium browser engine.
 */
export function fetchPageM3u8ViaBrowser(pageUrl: string): Promise<PageFetchResult> {
  return new Promise((resolve, reject) => {
    const m3u8Urls: string[] = []
    let resolved = false

    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Allow loading external resources (images, scripts)
        images: true,
        javascript: true
      }
    })

    // Hide from taskbar
    win.setSkipTaskbar(true)

    const cleanup = (): void => {
      if (win && !win.isDestroyed()) {
        try { win.close() } catch { /* ignore */ }
      }
    }

    // ─── Intercept network requests for m3u8 URLs ───
    const m3u8Filter = { urls: ['*://*/*.m3u8*'] }

    try {
      win.webContents.session.webRequest.onBeforeRequest(
        m3u8Filter,
        (details, callback) => {
          if (!m3u8Urls.includes(details.url)) {
            m3u8Urls.push(details.url)
          }
          callback({ cancel: false })
        }
      )
    } catch {
      // webRequest might not be available in all session configurations
    }

    // ─── Timer: resolve after collecting URLs ───

    const TIMEOUT_MS = 20000
    const SETTLE_MS = 4000 // wait after page load for deferred JS to trigger m3u8

    const timer = setTimeout(() => {
      if (resolved) { return }
      resolved = true
      const title = win.webContents?.getTitle?.() || '未知标题'
      cleanup()
      if (m3u8Urls.length === 0) {
        reject(
          new Error(
            `未能从页面 "${title}" 中提取到 m3u8 地址（超时）。\n` +
            '该网站可能使用了更强的反爬保护，建议：\n' +
            '1. 在浏览器中打开页面，按 F12 → Network → 筛选 m3u8 → 复制地址\n' +
            '2. 尝试使用移动端 User-Agent 或将链接粘贴到第三方下载工具'
          )
        )
      } else {
        resolve({
          m3u8Urls: [...new Set(m3u8Urls)],
          pageTitle: title,
          pageUrl
        })
      }
    }, TIMEOUT_MS)

    // ─── Page load handlers ───

    win.webContents.on('did-finish-load', () => {
      if (resolved) { return }
      // Schedule a short settle period to let JS load video player
      setTimeout(() => {
        if (resolved) { return }
        // If we already have m3u8 URLs, resolve early
        if (m3u8Urls.length > 0) {
          resolved = true
          clearTimeout(timer)
          const title = win.webContents?.getTitle?.() || '未知标题'
          // Wait a tiny bit more for any extras
          setTimeout(() => {
            cleanup()
            resolve({
              m3u8Urls: [...new Set(m3u8Urls)],
              pageTitle: title,
              pageUrl
            })
          }, 1000)
        }
      }, SETTLE_MS)
    })

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (resolved) { return }
      // Some failures (e.g., ERR_ABORTED from navigations) are harmless
      // Only reject for actual failures
      if (errorCode < 0 && !validatedURL.includes('favicon')) {
        resolved = true
        clearTimeout(timer)
        cleanup()
        reject(new Error(`页面加载失败: ${errorDescription} (错误码: ${errorCode})`))
      }
    })

    win.webContents.on('did-redirect-navigation', (_event, url) => {
      if (resolved) { return }
      // Some sites redirect; let it happen
      if (!m3u8Urls.includes(url)) {
        // Check if redirect is to m3u8
        if (url.includes('.m3u8')) {
          m3u8Urls.push(url)
        }
      }
    })

    // ─── Start loading ───

    win.loadURL(pageUrl, {
      userAgent: DEFAULT_UA,
      httpReferrer: new URL(pageUrl).origin + '/'
    }).catch((err: Error) => {
      if (resolved) { return }
      resolved = true
      clearTimeout(timer)
      cleanup()
      reject(new Error(`无法加载页面: ${err.message}`))
    })
  })
}
