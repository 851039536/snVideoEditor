<!-- 网页路径管理面板：路径增改删、解析、链接勾选入队与备份还原 -->
<script setup lang="ts">
import { computed, onMounted, provide, ref } from 'vue';
import { FolderInput, FolderOpen, Plus, Save } from 'lucide-vue-next';
import { useWebPathsStore } from '@/stores/webPaths';
import { getDirName } from '@/utils/format';
import { isValidUrl } from '@/utils/url';
import { useWebPageParse, webPageParseKey } from '@/views/Download/useWebPageParse';
import WebPageEntryItem from '@/views/Download/WebPageEntryItem.vue';
import type { WebPageEntry } from '@/views/Download/types';
import type { RawCookie } from '@/types/file';

defineProps<{
  /** 下载输出目录（为空时禁用批量入队） */
  outputDir: string;
}>();

const emit = defineEmits<{
  'use-link': [payload: { url: string; pageUrl: string; pageTitle: string; cookies: RawCookie[] }];
}>();

const webPathsStore = useWebPathsStore();

// 解析状态由父级持有并共享：useWebPageParse 每次调用新建状态（非单例），
// 子组件通过 inject(webPageParseKey) 复用同一实例，解析结果才能在各卡片间正确读写
const parse = useWebPageParse();
provide(webPageParseKey, parse);

// ─── 数量实时统计 & 分组 ──────────────────────────────────────────────────────

/** 待下载条目 */
const pendingEntries = computed((): WebPageEntry[] => webPathsStore.entries.filter((e) => e.status === 'pending'));
/** 已下载条目 */
const downloadedEntries = computed((): WebPageEntry[] => webPathsStore.entries.filter((e) => e.status === 'downloaded'));

// ─── 备份 / 还原 / 打开文件 ──────────────────────────────────────────────────

/** 备份还原操作结果提示 */
const actionHint = ref('');

/** 持久化 JSON 文件完整路径（界面展示用） */
const pathsFilePath = ref('');

async function backupPaths(): Promise<void> {
  actionHint.value = '';
  try {
    const path = await webPathsStore.backup();
    if (path) {
      actionHint.value = `已备份到: ${path}`;
    }
  } catch (e) {
    actionHint.value = e instanceof Error ? e.message : String(e);
  }
}

async function restorePaths(): Promise<void> {
  actionHint.value = '';
  const confirmed = await window.electronAPI.confirmDialog('还原将覆盖当前网页路径列表，是否继续？', '还原确认');
  if (!confirmed) {
    return;
  }
  try {
    const ok = await webPathsStore.restore();
    if (ok) {
      actionHint.value = '还原完成';
    }
  } catch (e) {
    actionHint.value = e instanceof Error ? e.message : String(e);
  }
}

/** 打开 JSON 文件所在文件夹，方便直接查看编辑 */
async function openPathsFolder(): Promise<void> {
  const filePath = pathsFilePath.value || (await window.electronAPI.getWebPagePathsFile());
  const dir = getDirName(filePath);
  await window.electronAPI.openFolder(dir);
}

// 每次挂载重新加载 JSON 文件，可捡起用户手动编辑的改动
onMounted(async () => {
  webPathsStore.init();
  // 获取 JSON 文件完整路径用于界面展示
  try {
    pathsFilePath.value = await window.electronAPI.getWebPagePathsFile();
  } catch {
    /* ignore */
  }
});

// ─── 新增路径 ────────────────────────────────────────────────────────────────

const newUrl = ref('');
const addHint = ref('');

/** 添加新的网页路径（去重 + 合法性校验） */
async function addPath(): Promise<void> {
  const url = newUrl.value.trim();
  if (!isValidUrl(url)) {
    return;
  }
  if (webPathsStore.entries.some((e) => e.url === url)) {
    addHint.value = '该网页路径已存在';
    return;
  }
  await webPathsStore.add(url);
  newUrl.value = '';
  addHint.value = '';
}

// ─── 事件透传 ────────────────────────────────────────────────────────────────

/** 透传子组件「使用链接」事件给 DownloadView */
function forwardUseLink(payload: { url: string; pageUrl: string; pageTitle: string; cookies: RawCookie[] }): void {
  emit('use-link', payload);
}
</script>

<template>
  <div class="glass-card p-4">
    <!-- 标题行 + 备份/还原/打开文件按钮组 -->
    <div class="flex items-center mb-2">
      <label class="text-sm font-semibold text-text-primary">网页路径</label>
      <span v-if="webPathsStore.entries.length > 0" class="text-xs text-text-muted ml-2">
        共 {{ webPathsStore.entries.length }} 条
      </span>
      <div class="flex gap-1.5 ml-auto">
        <button @click="backupPaths" class="btn-secondary !px-2 !py-1 text-xs flex items-center gap-1" title="备份网页路径列表到指定位置">
          <Save :size="12" />
          备份
        </button>
        <button @click="restorePaths" class="btn-secondary !px-2 !py-1 text-xs flex items-center gap-1" title="从备份文件还原（覆盖当前列表）">
          <FolderInput :size="12" />
          还原
        </button>
        <button @click="openPathsFolder" class="btn-secondary !px-2 !py-1 text-xs flex items-center gap-1" title="打开 web-page-paths.json 所在文件夹">
          <FolderOpen :size="12" />
          打开文件
        </button>
      </div>
    </div>
    <p class="text-xs text-text-muted mb-2">保存常用视频网页地址，点击"解析"提取 m3u8 链接后可勾选下载。</p>

    <!-- 持久化 JSON 文件路径展示（点击打开所在文件夹） -->
    <p v-if="pathsFilePath" class="text-xs text-text-muted mb-2 break-all">
      存储位置:
      <code
        @click="openPathsFolder"
        class="font-mono text-accent-blue cursor-pointer hover:underline"
        title="点击打开所在文件夹"
      >{{ pathsFilePath }}</code>
    </p>

    <!-- 备份/还原操作结果提示 -->
    <p v-if="actionHint" class="text-xs text-accent-blue mb-2 break-all">{{ actionHint }}</p>

    <!-- 加载/保存错误提示（如 JSON 手编损坏） -->
    <div v-if="webPathsStore.loadError" class="alert-danger mb-2 whitespace-pre-line">
      <p>{{ webPathsStore.loadError }}</p>
    </div>

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

    <!-- 路径列表：按状态分组展示 -->
    <div v-if="webPathsStore.entries.length > 0" class="mt-3 space-y-3 max-h-[32rem] overflow-y-auto custom-scrollbar">
      <!-- 待下载分组 -->
      <div v-if="pendingEntries.length > 0">
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="w-2 h-2 rounded-full bg-yellow-400"></span>
          <span class="text-xs font-semibold text-yellow-400">待下载 ({{ pendingEntries.length }})</span>
        </div>
        <div class="space-y-2">
          <WebPageEntryItem
            v-for="entry in pendingEntries"
            :key="entry.id"
            :entry="entry"
            :output-dir="outputDir"
            @use-link="forwardUseLink"
          />
        </div>
      </div>

      <!-- 已下载分组 -->
      <div v-if="downloadedEntries.length > 0">
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="w-2 h-2 rounded-full bg-success"></span>
          <span class="text-xs font-semibold text-success">已下载 ({{ downloadedEntries.length }})</span>
        </div>
        <div class="space-y-2">
          <WebPageEntryItem
            v-for="entry in downloadedEntries"
            :key="entry.id"
            :entry="entry"
            :output-dir="outputDir"
            @use-link="forwardUseLink"
          />
        </div>
      </div>
    </div>

    <!-- 空列表提示 -->
    <p v-else class="text-xs text-text-muted mt-3">暂无网页路径，添加后可一键解析提取播放链接。</p>
  </div>
</template>
