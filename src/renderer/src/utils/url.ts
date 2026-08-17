// URL 校验与请求头构造工具

/** 判断字符串是否为合法 URL */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** 由页面 URL 生成 Referer/Origin 请求头；URL 解析失败时返回空对象 */
export function buildOriginHeaders(pageUrl: string): Record<string, string> {
  try {
    const parsed = new URL(pageUrl);
    return {
      Referer: `${parsed.protocol}//${parsed.hostname}/`,
      Origin: `${parsed.protocol}//${parsed.hostname}`
    };
  } catch {
    return {};
  }
}
