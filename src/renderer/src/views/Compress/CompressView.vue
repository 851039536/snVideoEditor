<!-- 视频压缩页面：参数配置与批量压缩 -->
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  FileVideo,
  Folder,
  X,
  Zap,
  Monitor,
  Download,
  FolderOpen,
  Info,
  Loader2,
  CheckCircle2,
  XCircle
} from 'lucide-vue-next';
import FileDropZone from '@/components/FileDropZone.vue';
import ProgressPanel from '@/components/ProgressPanel.vue';
import VideoDetailModal from './VideoDetailModal.vue';
import CompressParams from './CompressParams.vue';
import { formatSize, getDirName, getFileName } from '@/utils/format';
import { useFileList } from '@/composables/useFileList';
import { useCompressPreset } from '@/composables/useCompressPreset';
import { useCompressBatch, compressFiles } from '@/composables/useCompressBatch';
import type { FileEntry } from '@/types/file';
import type { CompressResultItem } from './types';

/** Output filename suffix for compressed videos. */
const COMPRESS_SUFFIX = '_compressed.mp4';

// 文件列表使用模块级持久 ref，切换页面再返回时压缩过程内容不丢失
const { files, addFiles, removeFile, selectOutputDir, setOutputDir } = useFileList(COMPRESS_SUFFIX, compressFiles);

// Compression params — persisted preset + encoder capability detection
const {
  params,
  hasNvidiaEncoders,
  hasQsvEncoders,
  crfMax,
  crfActive,
  showPreset,
  showNvencPreset,
  showTwoPass,
  loadAvailableEncoders,
  estimateOutputSize
} = useCompressPreset();

// Batch compression flow — file statuses, progress mapping, result summary
const {
  fileStatuses,
  compressResult,
  errorMsg,
  allOutputsResolved,
  canStart,
  handleProgress,
  handleRemoveFile,
  startCompress
} = useCompressBatch({ removeFile, params });

let isUnmounted = false;

// 视频详情弹窗
const detailEntry = ref<FileEntry | null>(null);

function openDetail(entry: FileEntry): void {
  detailEntry.value = entry;
}

function closeDetail(): void {
  detailEntry.value = null;
}

/** 计算体积变化百分比文案：压缩为负显示 -N%，膨胀显示 +N%，体积未变显示 ±0% */
function sizeChangeText(item: CompressResultItem): { text: string; grew: boolean } {
  if (item.originalSize <= 0) {
    return { text: '--', grew: false };
  }
  const pct = Math.round((1 - item.compressedSize / item.originalSize) * 100);
  if (pct === 0) {
    return { text: '±0%', grew: false };
  }
  if (pct > 0) {
    return { text: `-${pct}%`, grew: false };
  }
  return { text: `+${Math.abs(pct)}%`, grew: true };
}

// 压缩结果展示行：预计算体积变化文案与颜色，避免模板内重复调用
const compressResultRows = computed(() =>
  compressResult.value.map((item) => ({ ...item, change: sizeChangeText(item) }))
);

// Common paths for quick output selection
const commonPaths = ref<{ desktop: string; downloads: string }>({ desktop: '', downloads: '' });
const loadingPath = ref('');
const sourceDir = computed(() => {
  if (files.value.length === 0) {
    return '';
  }
  return getDirName(files.value[0].path);
});
const selectedOutputDir = computed(() => {
  const path = files.value[0]?.outputPath;
  return path ? getDirName(path) : '';
});

async function fetchCommonPaths(): Promise<void> {
  try {
    const paths = await window.electronAPI.getCommonPaths();
    if (!isUnmounted) {
      commonPaths.value = paths;
    }
  } catch {
    // 静默失败，selectQuickDir 已有兜底提示
  }
}

async function selectQuickDir(type: 'desktop' | 'downloads' | 'source'): Promise<void> {
  let dir: string | null = null;

  if (type === 'source') {
    dir = sourceDir.value;
  } else {
    loadingPath.value = type;
    try {
      if (!commonPaths.value[type]) {
        await fetchCommonPaths();
      }
      dir = commonPaths.value[type];
    } finally {
      // 无论成功与否都复位 loading 态，避免异常时按钮卡死
      loadingPath.value = '';
    }
  }

  if (!dir) {
    if (type !== 'source') {
      errorMsg.value = '无法获取系统路径，请使用自定义目录';
    }
    return;
  }
  setOutputDir(dir, COMPRESS_SUFFIX);
}

onMounted(() => {
  // Register the progress listener for the whole mounted lifetime, so that
  // navigating away and back re-subscribes and keeps showing live progress.
  window.electronAPI.onProgress(handleProgress);
  fetchCommonPaths();
  loadAvailableEncoders();
});

onUnmounted(() => {
  isUnmounted = true;
  window.electronAPI?.removeProgressListener();
});
</script>

<template>
  <div class="page-container">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div
          class="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center"
        >
          <FileVideo :size="20" class="text-accent-purple" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频压缩</h1>
      </div>
      <p class="text-text-secondary text-sm">智能压缩视频文件大小，支持 H.264 / H.265 编码，批量处理</p>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Left: File List -->
      <div class="space-y-3">
        <FileDropZone @files-selected="addFiles" />

        <!-- File Table -->
        <div v-if="files.length > 0" class="glass-card overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-bg-tertiary text-text-secondary text-xs">
                <th class="text-left p-3 font-medium">文件名</th>
                <th class="text-right p-3 font-medium">大小</th>
                <th class="text-right p-3 font-medium">预估</th>
                <th class="text-center p-3 font-medium w-16">状态</th>
                <th class="text-right p-3 font-medium w-20" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(entry, idx) in files" :key="entry.path" class="border-b border-bg-tertiary/50">
                <td class="p-3">
                  <div class="flex items-center gap-2">
                    <FileVideo :size="16" class="text-accent-purple flex-shrink-0" />
                    <span class="truncate max-w-[200px]" :title="entry.path">
                      {{ getFileName(entry.path) }}
                    </span>
                  </div>
                </td>
                <td class="p-3 text-right text-text-secondary">
                  {{ entry.meta ? formatSize(entry.meta.size) : '...' }}
                </td>
                <td class="p-3 text-right text-accent-light font-mono">
                  {{ entry.meta ? estimateOutputSize(entry) : '...' }}
                </td>
                <td class="p-3 text-center">
                  <span v-if="fileStatuses[entry.path] === 'processing'" title="处理中">
                    <Loader2 :size="14" class="text-accent-blue animate-spin inline-block" />
                  </span>
                  <span v-else-if="fileStatuses[entry.path] === 'completed'" title="已完成">
                    <CheckCircle2 :size="14" class="text-success inline-block" />
                  </span>
                  <span v-else-if="fileStatuses[entry.path] === 'failed'" title="失败">
                    <XCircle :size="14" class="text-danger inline-block" />
                  </span>
                  <span v-else class="text-text-muted text-xs">-</span>
                </td>
                <td class="p-3 text-right">
                  <div class="flex items-center justify-end gap-0.5">
                    <button
                      @click="openDetail(entry)"
                      class="p-1 rounded hover:bg-bg-tertiary transition-colors"
                      title="视频详情"
                    >
                      <Info :size="14" class="text-accent-blue" />
                    </button>
                    <button
                      @click="handleRemoveFile(idx)"
                      class="p-1 rounded hover:bg-bg-tertiary transition-colors"
                      title="移除文件"
                    >
                      <X :size="14" class="text-danger" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right: Parameters -->
      <div class="space-y-3">
        <!-- Compression Parameters -->
        <CompressParams
          :params="params"
          :crf-max="crfMax"
          :crf-active="crfActive"
          :show-preset="showPreset"
          :show-nvenc-preset="showNvencPreset"
          :show-two-pass="showTwoPass"
          :has-nvidia-encoders="hasNvidiaEncoders"
          :has-qsv-encoders="hasQsvEncoders"
        />

        <!-- Output -->
        <div class="glass-card">
          <h3 class="section-title">输出设置</h3>

          <!-- Quick select -->
          <div class="flex gap-2 flex-wrap">
            <button
              @click="selectQuickDir('desktop')"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="loadingPath === 'desktop'"
            >
              <Monitor :size="14" />
              {{ loadingPath === 'desktop' ? '加载中...' : '桌面' }}
            </button>
            <button
              @click="selectQuickDir('downloads')"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="loadingPath === 'downloads'"
            >
              <Download :size="14" />
              {{ loadingPath === 'downloads' ? '加载中...' : '下载' }}
            </button>
            <button
              @click="selectQuickDir('source')"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="!sourceDir"
              :title="sourceDir || '请先添加文件'"
            >
              <FolderOpen :size="14" />
              源文件目录
            </button>
          </div>

          <!-- Current output dir -->
          <p v-if="selectedOutputDir" class="text-xs text-accent-light mt-2 truncate">
            {{ selectedOutputDir }}
          </p>

          <div class="mt-3 pt-3 border-t border-bg-tertiary">
            <button @click="selectOutputDir(COMPRESS_SUFFIX)" class="btn-secondary">
              <Folder :size="16" />
              自定义目录
            </button>
          </div>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="alert-danger">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- Start -->
        <button
          @click="startCompress"
          :disabled="!canStart"
          class="btn-primary"
          :class="canStart ? 'bg-gradient-to-r from-accent-purple to-pink-500' : 'bg-bg-tertiary text-text-muted'"
          :title="files.length > 0 && !allOutputsResolved ? '请先选择输出目录' : ''"
        >
          <Zap :size="18" />
          开始压缩 ({{ files.length }} 个文件)
        </button>

        <ProgressPanel />

        <!-- Compression Result Comparison -->
        <div v-if="compressResultRows.length > 0" class="glass-card p-4">
          <h3 class="text-base font-semibold text-text-primary mb-3">压缩结果对比</h3>
          <div class="space-y-2">
            <div
              v-for="(item, idx) in compressResultRows"
              :key="idx"
              class="flex items-center justify-between gap-2 py-1.5 border-b border-bg-tertiary/50 last:border-0"
            >
              <span class="text-sm text-text-primary truncate flex-1 min-w-0">{{ item.fileName }}</span>
              <span class="text-xs text-text-secondary whitespace-nowrap">
                {{ formatSize(item.originalSize) }} → {{ formatSize(item.compressedSize) }}
              </span>
              <span
                class="text-xs font-mono whitespace-nowrap"
                :class="item.change.grew ? 'text-danger' : 'text-success'"
              >
                {{ item.change.text }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Video Detail Modal -->
    <VideoDetailModal :entry="detailEntry" @close="closeDetail" />
  </div>
</template>
