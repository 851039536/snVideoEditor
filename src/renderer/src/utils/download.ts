// 下载通用工具：下载历史查重与重复下载确认

/**
 * 下载前查重：若目标文件名已存在于下载历史，弹窗询问是否重复下载。
 * - 无重复记录：返回 true（允许入队）
 * - 有重复且用户确认重复下载：返回 true
 * - 有重复且用户取消：返回 false
 */
export async function confirmIfDownloadDuplicate(fileName: string): Promise<boolean> {
  const dup = await window.electronAPI.checkDownloadDuplicate(fileName);
  if (!dup) {
    return true;
  }
  return window.electronAPI.confirmDialog(
    `文件名 "${fileName}" 已下载过（上次: ${new Date(dup.completedAt).toLocaleString()}），是否重复下载？`,
    '重复下载确认'
  );
}
