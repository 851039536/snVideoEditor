# settings.ts 审查修复

## 修改范围
仅 `src/renderer/src/stores/settings.ts` 单文件，3 处小改动。

## 1. 补文件头注释
L1 之前添加：
```ts
// 应用设置 store：主题、压缩预设、播放器数据、输出目录、侧栏状态的 localStorage 持久化
```

## 2. 行内注释翻译为中文
6 处英文注释按原意翻译：
- `// Apply theme on init` → 随第 3 项一并删除（见下）
- `// Persist output directory` → `// 持久化输出目录`
- `// Persist theme and apply to DOM` → `// 持久化主题并应用到 DOM`
- `// Persist compress preset` → `// 持久化压缩预设`
- `// Persist player data` → `// 持久化播放器数据`
- `// Persist sidebar collapsed state` → `// 持久化侧栏折叠状态`

## 3. 消除主题初始化双重执行
- 删除 L89-L90（`// Apply theme on init` + `applyTheme(theme.value)`）
- 保留 theme watch 的 `immediate: true` 不变——初始化时由 watch 统一负责应用主题与持久化，单一数据流

## 不做的事（审查观察项，备案）
- 不抽象 `usePersistedRef` 助手：5 组 load/persist 序列化方式各异（string / boolean / JSON+浅合并），抽象收益低于维护成本
- 不给 `loadCompressPreset` / `loadPlayerData` 加逐字段类型校验：schema 稳定，消费方对异常值有容忍，属过度设计
- 两处 `deep: true` 保留：防御外部对暴露 ref 的就地修改

## 验证
修改后运行 `npx vue-tsc --noEmit -p tsconfig.web.json` 确认类型无误（纯注释与删行改动，预期通过）。