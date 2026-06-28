import { ref } from 'vue'

export interface HeaderEntry {
  key: string
  value: string
}

export function useHeaders() {
  const headers = ref<HeaderEntry[]>([
    { key: 'Referer', value: '' },
    { key: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
    { key: 'Origin', value: '' }
  ])

  const UA_PRESETS = [
    { label: 'Chrome (Win)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
    { label: 'Firefox (Win)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0' },
    { label: 'Edge (Win)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0' },
    { label: 'Safari (Mac)', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15' }
  ]

  function addHeader(): void {
    headers.value.push({ key: '', value: '' })
  }

  function removeHeader(index: number): void {
    if (headers.value.length > 1) {
      headers.value.splice(index, 1)
    }
  }

  function applyUAPreset(ua: string): void {
    const uaHeader = headers.value.find((h) => h.key.toLowerCase() === 'user-agent')
    if (uaHeader) {
      uaHeader.value = ua
    } else {
      headers.value.unshift({ key: 'User-Agent', value: ua })
    }
  }

  function buildHeaders(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const h of headers.value) {
      const key = h.key.trim()
      if (key && h.value.trim()) { result[key] = h.value.trim() }
    }
    return result
  }

  return { headers, UA_PRESETS, addHeader, removeHeader, applyUAPreset, buildHeaders }
}
