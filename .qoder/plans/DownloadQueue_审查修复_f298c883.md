# DownloadQueue.vue 审查修复

## 修改范围
仅 `src/renderer/src/views/Download/DownloadQueue.vue` 单文件。

## 1. 补文件头注释
文件最顶部（`<script setup>` 之前）添加：
```html
<!-- 下载队列面板：队列项状态展示与暂停/恢复/取消/重试/移除操作 -->
```

## 2. 修复"全部完成"图标显示时机
- script 中新增 computed（中文注释）：
  ```ts
  // 队列全部到达终态（完成/失败/取消）时显示"全部处理完"图标
  const allSettled = computed((): boolean =>
    store.queueItems.every(
      (i) => i.status === 'completed' || i.status === 'failed' || i.status === 'cancelled'
    )
  )
  ```
- L87 条件 `statusCounts.pending === 0 && store.queueItems.length > 0` 改为 `allSettled`（顺带消除恒真条件，即问题 3）
- 注意：外层 v-if 保证列表非空，空列表时 every 返回 true 的边界不会出现

## 3. 合并 paused 进度文本
L157-L158 两个 span 合并为一个（徽章已显示"已暂停"，此处只保留百分比）：
```html
<span v-if="STATUS_CONFIG[item.status].isActive || item.status === 'paused'">{{ item.progress.percent }}%</span>
```

## 验证
- `npx vue-tsc --noEmit -p tsconfig.web.json` 类型检查通过
- 运行时（用户 npm run dev 验证）：下载中 pending=0 时绿色对勾不再提前出现；暂停项进度行只显示百分比不再重复"已暂停"

## 不做的事
- 不重构 statusCounts 的 if-else 链（直白且类型安全）
- 不提取本地 .custom-scrollbar 样式（仅 1 处使用，Rule of Three）
- 不改 error 双重截断（slice 防超长字符串，有意为之）