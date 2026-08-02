// 通用数学/数组工具函数

/**
 * 将数值钳制在 [min, max] 区间内（含边界）
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/**
 * 交换数组中 index 与 index+direction 位置的元素
 * @returns 是否成功执行交换（越界返回 false）
 */
export function swapArrayElements<T>(arr: T[], index: number, direction: -1 | 1): boolean {
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= arr.length) { return false }
  const temp = arr[index]
  arr[index] = arr[newIndex]
  arr[newIndex] = temp
  return true
}
