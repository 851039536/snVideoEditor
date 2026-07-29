# ffprobe 元信息诊断与取消句柄修复

## 修改范围
仅 `src/main/modules/ffmpeg.ts` 单文件，两个函数。

## 1. getVideoMeta：错误信息带上真实原因
- L266：spawn 参数 `'-v', 'quiet'` 改为 `'-v', 'error'`，让 ffprobe 把失败原因输出到 stderr（`-print_format json` 的 stdout 输出不受影响）
- L288：错误消息改为携带文件路径与截断后的 stderr，与 mergeVideos 的风格一致：
  ```ts
  reject(new Error(`ffprobe 执行失败 (${filePath}): ${stderr.trim().slice(0, 500)}`))
  ```

## 2. 移除只读探测进程对全局取消句柄的抢占
背景：`setFfmpegProc` 是无条件覆盖全局 `currentProc`（operation:cancel 的杀进程句柄）。毫秒级只读探测不属于任何加锁操作，注册进去会在"压缩运行中添加文件/打开详情/切回压缩页"时覆盖并清空句柄，导致取消失效或错杀探测进程。

- getVideoMeta：删除 L272 `_setFfmpegProc(ffprobeProcess)`、L286 与 L316 的 `_setFfmpegProc(null)`
- getAvailableEncoders：删除 L327 `_setFfmpegProc(proc)`、L330-L331 close 回调中的 `_setFfmpegProc(null)`、L338 error 回调中的 `_setFfmpegProc(null)`（保留 `resolve([])` 等其余逻辑）
- `_setFfmpegProc` 导入保留（compress/split/merge 等真正的长任务仍在使用）
- 在两个函数内各加一行中文注释说明：只读探测不注册取消句柄，避免覆盖运行中操作的进程引用

## 3. 明确不改的部分
- L315-L318 的 `on('error')` 处理已存在且正确（此前审查误判为缺失），仅因第 2 项顺带删掉其中的 `_setFfmpegProc(null)` 一行
- 渲染层无需改动：useFileList / VideoDetailModal 的 catch 兜底不变，修复后 console 将显示具体失败原因
- 控制台中文乱码（GBK 解码 UTF-8）是终端显示问题，不做处理

## 验证
- `npx tsc --noEmit -p tsconfig.node.json` 主进程类型检查通过（不执行 npm run build，项目规范禁止）
- 用户 `npm run dev` 后重新添加此前报错的文件，确认错误日志带出具体原因（如 Invalid data found / No such file）
- 回归确认：压缩运行中打开详情弹窗或切回压缩页，再点取消，压缩进程能被正常终止