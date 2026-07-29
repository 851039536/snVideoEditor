# CompressView.vue 审查修复

## 修改范围
仅 `src/renderer/src/views/Compress/CompressView.vue` 单文件，4 处小改动。

## 1. 模板硬编码后缀改用常量
- L276：`selectOutputDir('_compressed.mp4')` → `selectOutputDir(COMPRESS_SUFFIX)`

## 2. 修复压缩结果负百分比显示（`--N%` 乱码）
- script 中新增函数（带中文注释）：
  ```ts
  /** 计算体积变化百分比文案：压缩为负显示 -N%，膨胀显示 +N% */
  function sizeChangeText(item: CompressResultItem): { text: string; grew: boolean }
  ```
  计算 `Math.round((1 - compressedSize / originalSize) * 100)`；`originalSize <= 0` 时返回 `-0%`；结果为正返回 `-N%`（grew=false），为负返回 `+N%`（grew=true）
- 模板 L315-L317：删除固定 `-` 前缀，改为渲染 `sizeChangeText(item).text`，颜色类按 `grew` 切换 `text-danger` / `text-success`
- 需从 `@/views/Compress/types` 导入 `CompressResultItem` 类型

## 3. selectQuickDir 加载判断按实际按钮类型
- L109：`if (!commonPaths.value.desktop)` → `if (!commonPaths.value[type])`

## 4. fetchCommonPaths 返回值语义化
- 返回类型 `Promise<boolean>` 改为 `Promise<void>`，删除 `return true/false`；catch 分支保留静默（`selectQuickDir` 已有"无法获取系统路径"兜底提示）

## 验证
- `npx vue-tsc --noEmit -p tsconfig.web.json` 类型检查通过
- 不执行 `npm run build`（项目规范禁止）；运行时表现由用户 `npm run dev` 自行验证

## 不做的事
- 不改 `errorMsg` 跨层写入、`sourceDir` 取 files[0]、`openDetail` 命令式调用等已备注为可接受的设计
- 不触碰 useCompressBatch / useFileList（本次审查未发现其需修复的问题）