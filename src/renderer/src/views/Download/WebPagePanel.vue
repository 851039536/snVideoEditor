<!-- 网页路径管理面板：路径增改删、解析与媒体链接勾选入队 -->
<script setup lang="ts">
import { ref } from 'vue';
import { Plus, Search, Pencil, Trash2, Check, X, Download, Link } from 'lucide-vue-next';
import { useSettingsStore } from '@/stores/settings';
import { truncateUrl } from '@/utils/format';
import { isValidUrl } from '@/utils/url';
import { useWebPageParse } from '@/views/Download/useWebPageParse';
import type { WebPageEntry } from '@/views/Download/types';
import type { RawCookie } from '@/types/file';

const props = defineProps<{
  /** 下载输出目录（为空时禁用批量入队） */
  outputDir: string;
}>();

const emit = defineEmits<{
  'use-link': [payload: { url: string; pageUrl: string; pageTitle: string; cookies: RawCookie[] }];
}>();

const settingsStore = useSettingsStore();
const {
  parseStates,
  parsingId,
  enqueueingId,
  parseEntry,
  toggleLink,
  toggleAll,
  enqueueSelected,
  clearState
} = useWebPageParse();

// ─── 新增路径 ────────────────────────────────────────────────────────────────

const newUrl = ref('');
const addHint = ref('');

/** 添加新的网页路径（去重 + 合法性校验） */
function addPath(): void {
  const url = newUrl.value.trim();
  if (!isValidUrl(url)) {
    return;
  }
  if (settingsStore.webPagePaths.some((e) => e.url === url)) {
    addHint.value = '该网页路径已存在';
    return;
  }
  settingsStore.addWebPagePath(url);
  newUrl.value = '';
  addHint.value = '';
}

// ─── 行内编辑 ────────────────────────────────────────────────────────────────

const editingId = ref('');
const editingUrl = ref('');

function startEdit(entry: WebPageEntry): void {
  editingId.value = entry.id;
  editingUrl.value = entry.url;
}

function saveEdit(): void {
  const url = editingUrl.value.trim();
  if (!isValidUrl(url)) {
    return;
  }
  // URL 变化后旧解析结果已失效，一并清理
  if (url !== getEntryUrl(editingId.value)) {
    clearState(editingId.value);
  }
  settingsStore.updateWebPagePath(editingId.value, url);
  cancelEdit();
}

function cancelEdit(): void {
  editingId.value = '';
  editingUrl.value = '';
}

function getEntryUrl(id: string): string {
  return settingsStore.webPagePaths.find((e) => e.id === id)?.url || '';
}

// ─── 删除 ────────────────────────────────────────────────────────────────────

function removePath(entry: WebPageEntry): void {
  settingsStore.removeWebPagePath(entry.id);
  clearState(entry.id);
  if (editingId.value === entry.id) {
    cancelEdit();
  }
}

// ─── 解析与勾选 ──────────────────────────────────────────────────────────────

/** 该条目已勾选链接数 */
function selectedCount(entryId: string): number {
  const state = parseStates[entryId];
  if (!state) {
    return 0;
  }
  return state.links.filter((l) => l.selected).length;
}

/** 该条目是否已全选 */
function isAllSelected(entryId: string): boolean {
  const state = parseStates[entryId];
  if (!state || state.links.length === 0) {
    return false;
  }
  return state.links.every((l) => l.selected);
}

/** 单条链接「使用」：交由父组件回填主输入框并接管页面上下文 */
function useLink(entryId: string, url: string): void {
  const state = parseStates[entryId];
  if (!state) {
    return;
  }
  emit('use-link', {
    url,
    pageUrl: state.pageUrl,
    pageTitle: state.pageTitle,
    cookies: state.cookies
  });
}

// ─── 批量入队 ────────────────────────────────────────────────────────────────

/** 批量入队结果提示（按条目 id 记录） */
const enqueueHints = ref<Record<string, string>>({});

async function enqueueEntry(entry: WebPageEntry): Promise<void> {
  enqueueHints.value[entry.id] = '';
  const result = await enqueueSelected(entry, props.outputDir);
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
  enqueueHints.value[entry.id] = parts.join('，');
}
</script>

<template>
  <div class="glass-card p-4">
    <!-- 标题行 -->
    <label class="text-sm font-semibold text-text-primary mb-2 block">网页路径</label>
    <p class="text-xs text-text-muted mb-2">保存常用视频网页地址，点击"解析"提取 m3u8 链接后可勾选下载。</p>

    <!-- 新增路径输入行 -->
    <div class="flex gap-2">
      <input
        v-model="newUrl"
        type="url"
        placeholder="https://example.com/video-page"
        class="input-base flex-1"
        @keyup.enter="addPath"
      />
      <button
        @click="addPath"
        :disabled="!isValidUrl(newUrl.trim())"
        class="btn-secondary !px-3 !py-2 text-sm flex items-center gap-1.5 flex-shrink-0"
      >
        <Plus :size="14" />
        添加
      </button>
    </div>
    <p v-if="addHint" class="text-xs text-warning mt-1.5">{{ addHint }}</p>

    <!-- 路径列表 -->
    <div v-if="settingsStore.webPagePaths.length > 0" class="mt-3 space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
      <div
        v-for="entry in settingsStore.webPagePaths"
        :key="entry.id"
        class="p-2 rounded-lg bg-bg-tertiary/50 border border-border/40"
      >
        <!-- 编辑态：输入框 + 保存/取消 -->
        <div v-if="editingId === entry.id" class="flex gap-2 items-center">
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

        <!-- 非编辑态：URL 文本 + 解析/编辑/删除 -->
        <div v-else class="flex gap-2 items-center">
          <code class="text-xs text-text-primary flex-1 break-all font-mono" :title="entry.url">
            {{ truncateUrl(entry.url, 60) }}
          </code>
          <button
            @click="parseEntry(entry)"
            :disabled="parsingId !== ''"
            class="btn-secondary !px-2 !py-1 text-xs flex items-center gap-1 flex-shrink-0"
          >
            <Search v-if="parsingId !== entry.id" :size="12" />
            <span v-if="parsingId === entry.id">解析中...</span>
            <span v-else>解析</span>
          </button>
          <button
            @click="startEdit(entry)"
            :disabled="parsingId === entry.id"
            class="btn-secondary !px-2 !py-1 text-xs flex-shrink-0"
            title="编辑"
          >
            <Pencil :size="12" />
          </button>
          <button
            @click="removePath(entry)"
            :disabled="parsingId === entry.id"
            class="btn-secondary !px-2 !py-1 text-xs text-danger flex-shrink-0"
            title="删除"
          >
            <Trash2 :size="12" />
          </button>
        </div>

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

        <!-- 解析结果：链接勾选列表 -->
        <div
          v-if="parseStates[entry.id]?.status === 'done' && parseStates[entry.id].links.length > 0"
          class="mt-2 p-3 rounded-lg bg-accent-blue/10 border border-accent-blue/30"
        >
          <!-- 结果头部：数量 + 来源 + 全选 -->
          <div class="flex items-center gap-1.5 mb-2">
            <Link :size="14" class="text-accent-blue" />
            <span class="text-sm font-semibold text-accent-blue">
              已提取 {{ parseStates[entry.id].links.length }} 个链接
            </span>
            <span class="text-xs text-text-muted ml-1 truncate">（来自: {{ parseStates[entry.id].pageTitle }}）</span>
            <label class="text-xs text-text-secondary ml-auto flex items-center gap-1 cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                :checked="isAllSelected(entry.id)"
                @change="toggleAll(entry.id, ($event.target as HTMLInputElement).checked)"
              />
              全选
            </label>
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
                @click="useLink(entry.id, link.url)"
                class="btn-secondary !px-2 !py-0.5 text-xs opacity-0 group-hover:opacity-100 flex-shrink-0"
              >
                使用
              </button>
            </div>
          </div>

          <!-- 批量入队操作 -->
          <div class="mt-2 flex items-center gap-2">
            <button
              @click="enqueueEntry(entry)"
              :disabled="selectedCount(entry.id) === 0 || !props.outputDir || enqueueingId !== ''"
              class="btn-secondary !px-3 !py-1.5 text-xs flex items-center gap-1.5"
            >
              <Download :size="12" />
              <span v-if="enqueueingId === entry.id">入队中...</span>
              <span v-else>加入下载队列 (已选 {{ selectedCount(entry.id) }})</span>
            </button>
            <span v-if="!props.outputDir" class="text-xs text-warning">请先在右侧选择输出目录</span>
            <span v-else-if="enqueueHints[entry.id]" class="text-xs text-success">{{ enqueueHints[entry.id] }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 空列表提示 -->
    <p v-else class="text-xs text-text-muted mt-3">暂无网页路径，添加后可一键解析提取播放链接。</p>
  </div>
</template>
