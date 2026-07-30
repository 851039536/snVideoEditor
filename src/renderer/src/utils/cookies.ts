// Cookie 域匹配与请求头构建工具
import type { RawCookie } from '@/types/file';

/** 判断 Cookie 域是否匹配 URL 主机名 */
export function cookieDomainMatches(cookieDomain: string, hostname: string): boolean {
  // 归一化：去除前导点（如 ".surrit.com" → "surrit.com"）
  const d = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
  if (hostname === d) {
    return true;
  }
  if (hostname.endsWith('.' + d)) {
    return true;
  }
  return false;
}

/** 按目标 URL 域名过滤 cookies，构建 Cookie 请求头字符串（无匹配时返回空串） */
export function buildCookieHeader(url: string, cookies: RawCookie[]): string {
  if (!url || cookies.length === 0) {
    return '';
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return '';
  }
  // 同一匹配域范围内按 (domain, name) 去重
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const c of cookies) {
    if (cookieDomainMatches(c.domain, hostname)) {
      const key = `${c.domain}|${c.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        parts.push(`${c.name}=${c.value}`);
      }
    }
  }
  return parts.join('; ');
}
