<!-- 网页路径条目卡片：编辑、复制、解析、链接勾选入队与状态切换确认 -->
<script setup lang="ts">
import { computed, inject, onUnmounted, ref } from 'vue';
import { Check, Copy, Download, Link, Pencil, Search, Trash2, X } from 'lucide-vue-next';
import { truncateUrl } from '@/utils/format';
import { isValidUrl } from '@/utils/url';
import { useWebPathsStore } from '@/stores/webPaths';
import { webPageParseKey } from '@/views/Download/useWebPageParse';
import type { WebPageEntry, WebPageStatus } from '@/views/Download/types';
import type { RawCookie } from '@/types/file';

const props = defineProps<{
  /** 网页路径条目 */
  entry: WebPageEntry;
  /** 下载输出目录（为空时禁用批量入队） */
  outputDir: string;
}>();

const emit = defineEmits<{
  'use-link': [payload: { url: string; pageUrl: string; pageTitle: string; cookies: RawCookie[] }];
}>();

// 注入父级（DownloadView）共享的解析状态：useWebPageParse 每次调用新建状态（非单例），
// 由 DownloadView 创建并 provide 同一实例，解析结果才能被本组件读取
const parse = inject(webPageParseKey);
if (!parse) {
  throw new Error('WebPageEntryItem 必须在 WebPagePanel 内使用');
}
const {
  parseStates,
  parsingId,
  enqueueingId,
  parseEntry,
  toggleLink,
  toggleAll,
  enqueueSelected,
  clearState
} = parse;
const webPathsStore = useWebPathsStore();

// ─── 下载状态 badge 配置 ─────────────────────────────────────────────────────

const STATUS_CONFIG: Record<WebPageStatus, { label: string; cls: string }> = {
  pending: { label: '待下载', cls: 'text-yellow-400 bg-yellow-400/10' },
  downloaded: { label: '已下载', cls: 'text-success bg-success/10' }
};

// ─── 状态切换（待下载 ↔ 已下载 两个方向均需确认） ─────────────────────────────

/** 切换条目状态；两个方向都弹确认框，防止误点直接改状态 */
async function handleToggleStatus(): Promise<void> {
  const message =
    props.entry.status === 'downloaded'
      ? '将该条目标记为「待下载」？'
      : '将该条目标记为「已下载」？';
  const confirmed = await window.electronAPI.confirmDialog(message, '状态切换确认');
  if (!confirmed) {
    return;
  }
  await webPathsStore.toggleStatus(props.entry.id);
}

// ─── 行内编辑 ────────────────────────────────────────────────────────────────

/** 是否处于编辑态 */
const isEditing = ref(false);
const editingUrl = ref('');
/** 编辑保存时的去重提示 */
const editHint = ref('');

function startEdit(): void {
  isEditing.value = true;
  editingUrl.value = props.entry.url;
}

async function saveEdit(): Promise<void> {
  const url = editingUrl.value.trim();
  if (!isValidUrl(url)) {
    return;
  }
  // 去重校验：排除自身后检查是否与其他条目重复
  if (webPathsStore.entries.some((e) => e.id !== props.entry.id && e.url === url)) {
    editHint.value = '该网页路径已存在';
    return;
  }
  // URL 变化后旧解析结果已失效，一并清理（状态重置由 store.update 负责）
  if (url !== props.entry.url) {
    clearState(props.entry.id);
  }
  await webPathsStore.update(props.entry.id, url);
  cancelEdit();
}

function cancelEdit(): void {
  isEditing.value = false;
  editingUrl.value = '';
}

// ─── 复制链接 ────────────────────────────────────────────────────────────────

/** 是否刚复制成功（用于短暂显示反馈） */
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copyUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.entry.url);
    copied.value = true;
    if (copiedTimer) {
      clearTimeout(copiedTimer);
    }
    copiedTimer = setTimeout((): void => {
      copied.value = false;
    }, 1500);
  } catch {
    /* 剪贴板不可用时静默失败 */
  }
}

// 组件卸载时清理复制反馈定时器，避免泄漏
onUnmounted(() => {
  if (copiedTimer) {
    clearTimeout(copiedTimer);
  }
});

// ─── 解析 ────────────────────────────────────────────────────────────────────

/** 是否已手动关闭解析结果面板 */
const closed = ref(false);

/** 解析入口：重新解析时清除关闭标记，确保结果面板可见 */
async function handleParse(): Promise<void> {
  closed.value = false;
  await parseEntry(props.entry);
}

function closeParse(): void {
  closed.value = true;
}

// ─── 删除 ────────────────────────────────────────────────────────────────────

/** 删除路径：二次确认防误删（与状态切换的确认策略保持一致） */
async function removePath(): Promise<void> {
  const confirmed = await window.electronAPI.confirmDialog('删除该网页路径？删除后不可恢复。', '删除确认');
  if (!confirmed) {
    return;
  }
  await webPathsStore.remove(props.entry.id);
  clearState(props.entry.id);
}

// ─── 勾选与入队 ──────────────────────────────────────────────────────────────

/** 已勾选链接数 */
const selectedCount = computed((): number => {
  const state = parseStates[props.entry.id];
  if (!state) {
    return 0;
  }
  return state.links.filter((l) => l.selected).length;
});

/** 是否已全选 */
const isAllSelected = computed((): boolean => {
  const state = parseStates[props.entry.id];
  if (!state || state.links.length === 0) {
    return false;
  }
  return state.links.every((l) => l.selected);
});

/** 单条链接「使用」：交由父组件回填主输入框并接管页面上下文 */
function useLink(linkUrl: string): void {
  const state = parseStates[props.entry.id];
  if (!state) {
    return;
  }
  emit('use-link', {
    url: linkUrl,
    pageUrl: state.pageUrl,
    pageTitle: state.pageTitle,
    cookies: state.cookies
  });
}

/** 批量入队结果提示 */
const enqueueHint = ref('');

async function enqueueEntry(): Promise<void> {
  enqueueHint.value = '';
  const result = await enqueueSelected(props.entry, props.outputDir);
  const parts: string[] = [];
  if (result.ok > 0) {
    parts.push(`已加入 ${result.ok} 个下载任务`);
  }
  if (result.skipped > 0) {
    parts.push(`跳过 ${result.skipped} 个重复项`);
  }
  if (result.fail > 0) {
    parts.push(`${result.fail} 个入队失败`);
  }
  enqueueHint.value = parts.join('，');
  // 有任务成功入队即自动标记为已下载
  if (result.ok > 0) {
    await webPathsStore.setStatus(props.entry.id, 'downloaded');
  }
}
</script>

<template>
  <div
    class="p-2 rounded-lg bg-bg-tertiary/50 border border-border/40"
    :class="{ 'opacity-75': entry.status === 'downloaded' }"
  >
    <!-- 编辑态：输入框 + 保存/取消 -->
    <div v-if="isEditing" class="flex gap-2 items-center">
      <input
        v-model="editingUrl"
        type="url"
        class="input-base flex-1 !py-1.5 text-xs"
        @keyup.enter="saveEdit"
        @keyup.esc="cancelEdit"
      />
      <button
        @click="saveEdit"
        :disabled="!isValidUrl(editingUrl.trim())"
        class="btn-secondary !px-2 !py-1 text-xs flex-shrink-0"
      >
        <Check :size="12" />
        保存
      </button>
      <button @click="cancelEdit" class="btn-secondary !px-2 !py-1 text-xs flex-shrink-0">
        <X :size="12" />
        取消
      </button>
    </div>

    <!-- 非编辑态：状态 badge + URL 文本 + 操作按钮 -->
    <div v-else class="flex gap-2 items-center">
      <button
        @click="handleToggleStatus"
        class="text-xs px-1.5 py-0.5 rounded flex-shrink-0 transition-colors"
        :class="STATUS_CONFIG[entry.status].cls"
        title="点击切换状态"
      >
        {{ STATUS_CONFIG[entry.status].label }}
      </button>
      <code class="text-xs text-text-primary flex-1 break-all font-mono" :title="entry.url">
        {{ truncateUrl(entry.url, 60) }}
      </code>
      <button
        @click="handleParse"
        :disabled="parsingId !== ''"
        class="btn-secondary !px-2 !py-1 text-xs flex items-center gap-1 flex-shrink-0"
      >
        <Search v-if="parsingId !== entry.id" :size="12" />
        <span v-if="parsingId === entry.id">解析中...</span>
        <span v-else>解析</span>
      </button>
      <button
        @click="copyUrl"
        class="btn-secondary !px-2 !py-1 text-xs flex-shrink-0"
        :title="copied ? '已复制' : '复制链接'"
      >
        <Check v-if="copied" :size="12" class="text-success" />
        <Copy v-else :size="12" />
      </button>
      <button
        @click="startEdit"
        :disabled="parsingId === entry.id"
        class="btn-secondary !px-2 !py-1 text-xs flex-shrink-0"
        title="编辑"
      >
        <Pencil :size="12" />
      </button>
      <button
        @click="removePath"
        :disabled="parsingId === entry.id"
        class="btn-secondary !px-2 !py-1 text-xs text-danger flex-shrink-0"
        title="删除"
      >
        <Trash2 :size="12" />
      </button>
    </div>

    <!-- 编辑去重提示 -->
    <p v-if="editHint" class="text-xs text-warning mt-1.5">{{ editHint }}</p>

    <!-- 解析失败提示 -->
    <p
      v-if="parseStates[entry.id]?.status === 'error'"
      class="text-danger text-xs mt-2 whitespace-pre-line"
    >
      {{ parseStates[entry.id].error }}
    </p>

    <!-- 解析成功但无链接提示 -->
    <p
      v-if="parseStates[entry.id]?.status === 'done' && parseStates[entry.id].links.length === 0"
      class="text-xs text-text-muted mt-2"
    >
      未提取到 m3u8 链接。可在浏览器中打开页面，按 F12 → Network → 筛选 m3u8 查找真实播放地址。
    </p>

    <!-- 解析结果：链接勾选列表（可关闭） -->
    <div
      v-if="parseStates[entry.id]?.status === 'done' && parseStates[entry.id].links.length > 0 && !closed"
      class="mt-2 p-3 rounded-lg bg-accent-blue/10 border border-accent-blue/30"
    >
      <!-- 结果头部：数量 + 来源 + 全选 + 关闭 -->
      <div class="flex items-center gap-1.5 mb-2">
        <Link :size="14" class="text-accent-blue" />
        <span class="text-sm font-semibold text-accent-blue">
          已提取 {{ parseStates[entry.id].links.length }} 个链接
        </span>
        <span class="text-xs text-text-muted ml-1 truncate">（来自: {{ parseStates[entry.id].pageTitle }}）</span>
        <label class="text-xs text-text-secondary ml-auto flex items-center gap-1 cursor-pointer flex-shrink-0">
          <input
            type="checkbox"
            :checked="isAllSelected"
            @change="toggleAll(entry.id, ($event.target as HTMLInputElement).checked)"
          />
          全选
        </label>
        <button
          @click="closeParse"
          class="btn-secondary !px-1.5 !py-0.5 text-xs flex-shrink-0"
          title="关闭解析结果"
        >
          <X :size="12" />
        </button>
      </div>

      <!-- 链接列表 -->
      <div class="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar">
        <div
          v-for="(link, idx) in parseStates[entry.id].links"
          :key="idx"
          class="flex items-center gap-2 p-2 rounded hover:bg-accent-blue/20 transition-colors group"
        >
          <input
            type="checkbox"
            :checked="link.selected"
            @change="toggleLink(entry.id, idx)"
            class="flex-shrink-0 cursor-pointer"
          />
          <code class="text-xs text-text-primary flex-1 break-all font-mono">{{ link.url }}</code>
          <button
            @click="useLink(link.url)"
            class="btn-secondary !px-2 !py-0.5 text-xs opacity-0 group-hover:opacity-100 flex-shrink-0"
          >
            使用
          </button>
        </div>
      </div>

      <!-- 批量入队操作 -->
      <div class="mt-2 flex items-center gap-2">
        <button
          @click="enqueueEntry"
          :disabled="selectedCount === 0 || !outputDir || enqueueingId !== ''"
          class="btn-secondary !px-3 !py-1.5 text-xs flex items-center gap-1.5"
        >
          <Download :size="12" />
          <span v-if="enqueueingId === entry.id">入队中...</span>
          <span v-else>加入下载队列 (已选 {{ selectedCount }})</span>
        </button>
        <span v-if="!outputDir" class="text-xs text-warning">请先在右侧选择输出目录</span>
        <span v-else-if="enqueueHint" class="text-xs text-success">{{ enqueueHint }}</span>
      </div>
    </div>
  </div>
</template>
