// URL 校验工具

/** 判断字符串是否为合法 URL */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
