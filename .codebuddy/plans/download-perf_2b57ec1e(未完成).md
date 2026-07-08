---
name: download-perf
overview: 优化 chromium-downloader.ts 下载性能：queue.shift() O(n²)→O(n) 索引指针、writeFileSync→异步写入、移除 faststart、删除冗余 existsSync 验证、resume 用 readdirSync 批量扫描、stderrLines 恢复上限。
todos:
  - id: p0-shift-to-index
    content: 将 queue.shift() 改为索引指针 queuePtr，消除 O(n²) 元素移动
    status: pending
  - id: p1-async-write
    content: 将 fs.writeFileSync 改为 await fs.promises.writeFile，消除事件循环阻塞
    status: pending
  - id: p2-remove-faststart
    content: 移除 ffmpeg -movflags +faststart 参数
    status: pending
  - id: p3-readdir-resume
    content: 删除 post-download existsSync 验证块；resume 路径用 readdirSync Set 替代逐分片 stat
    status: pending
  - id: p4-stderr-cap
    content: stderrLines 恢复 MAX_STDERR_LINES=50 上限，push 后裁剪
    status: pending
---

## 用户需求

对 `chromium-downloader.ts` 实施 5 项性能优化（P0-P4），全部集中在一个文件内，无跨文件依赖。

## 核心优化项

- P0：`queue.shift()` O(n²) 改为索引指针 O(n)
- P1：`fs.writeFileSync` 同步阻塞改为 `fs.promises.writeFile` 异步写入
- P2：移除 ffmpeg `-movflags +faststart` 参数，避免大文件二次重写
- P3：删除下载后冗余 `existsSync` 验证；resume 路径用一次 `readdirSync` 替代逐分片 stat
- P4：`stderrLines` 数组恢复 50 行上限，防止长视频内存累积

## Tech Stack

- Electron 31 主进程 `net.fetch` + Node.js `fs` / `child_process`
- TypeScript 严格模式
- 现有 `chromium-downloader.ts` 单文件，无跨文件依赖

## Implementation Approach

全部修改集中在 `src/main/modules/chromium-downloader.ts` 一个文件，共 5 处定点修改：

### P0: queue.shift() O(n²) → 索引指针 O(n)

- **当前**：第 226 行 `const queue = [...segments]`，第 231 行 `const seg = queue.shift()` — 每次 shift 移动全部剩余元素，1000 分片 = 499,500 次移动
- **修改**：删除 `queue` 数组，新增 `let queuePtr = 0`，worker 循环改为 `while (queuePtr < total && !isAborted())`，取分片改为 `const seg = segments[queuePtr++]`
- **预期**：O(n²) → O(n)，1000 分片时消除 ~50 万次元素移动

### P1: fs.writeFileSync → fs.promises.writeFile

- **当前**：第 209 行 `fs.writeFileSync(seg.localPath, resp.body)` — 同步写入阻塞事件循环，6 worker 轮流阻塞
- **修改**：改为 `await fs.promises.writeFile(seg.localPath, resp.body)` — 写入期间其他 worker 可继续 fetch
- **注意**：第 299 行 `fs.writeFileSync(localM3u8Path, ...)` 写的是小文件（m3u8 文本），保持同步即可

### P2: 移除 -movflags +faststart

- **当前**：第 334 行 `'-movflags', '+faststart'` — ffmpeg 需读写整个文件以移动 moov atom
- **修改**：删除该行。本地播放不需要 faststart，GB 级视频可节省 10-20 秒

### P3: 删除冗余验证 + 优化 resume 扫描

- **删除**：第 280-284 行 post-download `segments.filter(s => !fs.existsSync(s.localPath))` 验证块 — worker 成功完成即表示所有分片已下载，无需再遍历
- **优化**：第 234-238 行 resume 路径 — 下载前一次 `const existingFiles = new Set(fs.readdirSync(workDir))`，worker 内改为 `if (existingFiles.has(path.basename(seg.localPath)))` 查找 Set
- **预期**：恢复时从 N 次 sync stat → 1 次 readdirSync + N 次 Set.has（O(1)）

### P4: stderrLines 恢复上限

- **当前**：第 345-349 行 `stderrLines.push(chunk)` 无限增长
- **修改**：新增 `const MAX_STDERR_LINES = 50` 常量，push 后裁剪：`if (stderrLines.length > MAX_STDERR_LINES) { stderrLines.splice(0, stderrLines.length - MAX_STDERR_LINES) }`

## Implementation Notes

- P0 的索引指针需要在线程安全方面注意：Node.js 单线程，`queuePtr++` 无竞争，但 `queuePtr` 需在 worker 函数外层声明（闭包共享）
- P1 改为异步后，`downloadSegmentWithRetry` 已是 async 函数，只需加 `await`
- P3 删除验证块后，如果 worker 内 `downloadSegmentWithRetry` 抛异常，`Promise.all` 会 reject，不会到达验证块，所以删除是安全的
- P3 的 `readdirSync` 在 Phase 2 开始前执行一次，worker 内用 `existingFiles.has()` 判断