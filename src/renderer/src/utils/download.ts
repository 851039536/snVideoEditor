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

/**
 * 批量查重：一次性检查多个文件名，返回其中命中下载历史的重复项列表。
 * 用于批量入队前汇总确认，避免逐条弹窗。
 */
export async function findDownloadDuplicates(fileNames: string[]): Promise<string[]> {
  const duplicates: string[] = [];
  for (const name of fileNames) {
    const dup = await window.electronAPI.checkDownloadDuplicate(name);
    if (dup) {
      duplicates.push(name);
    }
  }
  return duplicates;
}

/**
 * 批量入队重复确认：命中重复时仅弹一次汇总确认框。
 * - 无重复：返回空集（全部允许入队）
 * - 有重复且用户确定：返回空集（全部入队，含重复项）
 * - 有重复且用户取消：返回重复项集合（调用方跳过这些项）
 */
export async function confirmDownloadDuplicatesBatch(fileNames: string[]): Promise<Set<string>> {
  const duplicates = await findDownloadDuplicates(fileNames);
  if (duplicates.length === 0) {
    return new Set();
  }
  const preview = duplicates.slice(0, 5).map((n) => `“${n}”`).join('、');
  const suffix = duplicates.length > 5 ? ` 等 ${duplicates.length} 个` : '';
  const confirmed = await window.electronAPI.confirmDialog(
    `以下文件名已下载过：${preview}${suffix}。\n\n确定 = 全部下载（含重复项）；取消 = 跳过重复项仅下载其余。`,
    '重复下载确认'
  );
  return confirmed ? new Set() : new Set(duplicates);
}
