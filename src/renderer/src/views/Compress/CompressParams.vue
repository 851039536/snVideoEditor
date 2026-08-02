<!-- 压缩参数配置面板：分辨率/码率/CRF/编码器/预设选择 -->
<script setup lang="ts">
import { computed } from 'vue';
import InfoTooltip from '@/components/InfoTooltip.vue';
import type { CompressPreset } from '@/stores/settings';

// params 为父组件共享的 reactive 对象，本组件直接双向修改属有意设计
const props = defineProps<{
  params: CompressPreset;
  crfMax: number;
  crfActive: boolean;
  showPreset: boolean;
  showNvencPreset: boolean;
  showTwoPass: boolean;
  hasNvidiaEncoders: boolean;
  hasQsvEncoders: boolean;
}>();

// CRF 刻度：H.264 系锚点语义，按当前 crfMax 等比映射（VP9 范围 0-63 时自动换算，避免误导）
const crfTicks = computed<{ value: number; label: string }[]>(() => {
  const anchors = [
    { value: 0, label: '真无损' },
    { value: 18, label: '视觉无损' },
    { value: 23, label: '默认' },
    { value: 28, label: '标清' },
    { value: 51, label: '最差' }
  ];
  if (props.crfMax === 51) {
    return anchors;
  }
  return anchors.map((tick) => ({
    value: tick.value === 0 ? 0 : Math.round((tick.value / 51) * props.crfMax),
    label: tick.label
  }));
});
</script>

<template>
  <div class="glass-card p-4 space-y-3">
    <h3 class="text-base font-semibold text-text-primary">压缩参数</h3>

    <!-- Resolution -->
    <div>
      <label class="text-sm text-text-secondary mb-2 block">输出分辨率</label>
      <select v-model="params.resolution" class="select-input w-full">
        <option value="original">原始分辨率</option>
        <option value="1920:1080">1080p (1920×1080)</option>
        <option value="1280:720">720p (1280×720)</option>
        <option value="854:480">480p (854×480)</option>
        <option value="640:360">360p (640×360)</option>
      </select>
    </div>

    <!-- Bitrate -->
    <div>
      <InfoTooltip title="视频码率是什么？" widthClass="w-72">
        <template #label>
          <label class="text-sm text-text-secondary">视频码率限制</label>
        </template>
        <template #content>
          <p class="mb-2"><strong class="text-text-primary">视频码率</strong> 表示每秒传输的视频数据量：</p>
          <ul class="list-disc list-inside space-y-1">
            <li>码率越高 → 画质越好，文件越大</li>
            <li>码率越低 → 文件越小，画质越差</li>
          </ul>
          <p class="mt-2 text-text-muted">
            <span class="text-accent-blue font-medium">CRF 模式</span
            >（选"自动"）：以画质为目标，编码器自行决定码率。<br />
            <span class="text-accent-purple font-medium">固定码率</span
            >：精确控制输出文件大小，适合有体积要求的场景。
          </p>
          <p class="mt-1 text-text-muted">
            选择固定码率后可开启 <span class="text-accent-blue">2-Pass</span> 进一步提升画质。
          </p>
        </template>
      </InfoTooltip>
      <select v-model="params.bitrate" class="select-input w-full">
        <option value="">自动 (CRF 模式)</option>
        <option value="4000k">4 Mbps</option>
        <option value="2500k">2.5 Mbps</option>
        <option value="500k">500 Kbps</option>
        <option value="380k">380 Kbps</option>
        <option value="370k">370 Kbps</option>
        <option value="360k">360 Kbps</option>
        <option value="350k">350 Kbps</option>
        <option value="340k">340 Kbps</option>
        <option value="200k">200 Kbps</option>
      </select>
    </div>

    <!-- CRF Slider -->
    <div :class="{ 'opacity-40 pointer-events-none': !crfActive }">
      <label class="text-sm text-text-secondary">
        CRF 质量 ({{ params.crfValue }})
        <span v-if="!crfActive" class="text-accent-yellow text-xs ml-1">(已被码率限制覆盖)</span>
      </label>
      <input
        v-model.number="params.crfValue"
        type="range"
        min="0"
        :max="crfMax"
        :disabled="!crfActive"
        class="w-full mt-2 slider-base slider"
      />
      <div class="flex justify-between text-xs text-text-muted mt-1">
        <span v-for="tick in crfTicks" :key="tick.label">{{ tick.value }} {{ tick.label }}</span>
      </div>
    </div>

    <!-- Codec -->
    <div>
      <InfoTooltip title="编码格式有什么区别？" widthClass="w-80">
        <template #label>
          <label class="text-sm text-text-secondary">编码格式</label>
        </template>
        <template #content>
          <p class="mb-2"><strong class="text-text-primary">编码格式</strong> 决定视频的兼容性与压缩效率：</p>
          <ul class="list-disc list-inside space-y-1.5">
            <li>
              <span class="text-accent-blue font-medium">H.264</span
              >：兼容性最好，几乎所有设备都能播放，文件适中。
            </li>
            <li>
              <span class="text-accent-purple font-medium">H.265 / HEVC</span>：比 H.264 压缩率高约
              30%~50%，同等画质文件更小，但老设备可能不兼容。
            </li>
            <li>
              <span class="text-accent-yellow font-medium">VP9</span>：YouTube/Web 优化，开源免费，压缩比接近
              HEVC，适合网页播放。
            </li>
          </ul>
          <p class="mt-2 pt-2 border-t border-bg-tertiary text-text-muted">
            <span class="font-medium text-text-primary">GPU 加速</span>（NVENC /
            QSV）：编码速度极快，但同码率下画质略逊于 CPU 软编码。
          </p>
        </template>
      </InfoTooltip>
      <select v-model="params.codec" class="select-input w-full">
        <optgroup label="CPU 软编码">
          <option value="libx264">H.264 (兼容性最好)</option>
          <option value="libx265">H.265 / HEVC (更高压缩比)</option>
          <option value="libvpx-vp9">VP9 (Web优化)</option>
        </optgroup>
        <optgroup v-if="hasNvidiaEncoders" label="NVIDIA GPU (NVENC)">
          <option value="h264_nvenc">H.264 NVENC</option>
          <option value="hevc_nvenc">HEVC NVENC</option>
        </optgroup>
        <optgroup v-if="hasQsvEncoders" label="Intel GPU (QuickSync)">
          <option value="h264_qsv">H.264 QSV</option>
          <option value="hevc_qsv">HEVC QSV</option>
        </optgroup>
      </select>
    </div>

    <!-- Audio Bitrate -->
    <div>
      <InfoTooltip title="音频码率是什么？" widthClass="w-72">
        <template #label>
          <label class="text-sm text-text-secondary">音频码率</label>
        </template>
        <template #content>
          <p class="mb-2"><strong class="text-text-primary">音频码率</strong> 决定音频的清晰度：</p>
          <ul class="list-disc list-inside space-y-1">
            <li><span class="text-accent-blue font-medium">32~64 Kbps</span>：语音/播客足够，极小体积</li>
            <li><span class="text-accent-purple font-medium">96~128 Kbps</span>：常规视频够用，音质与体积平衡</li>
            <li><span class="text-accent-yellow font-medium">192 Kbps</span>：接近无损，适合音乐/高音质需求</li>
          </ul>
          <p class="mt-2 text-text-muted">音频通常只占视频总大小的 5%~15%，降低音频码率对总文件大小影响有限。</p>
        </template>
      </InfoTooltip>
      <select v-model="params.audioBitrate" class="select-input w-full">
        <option value="32k">32 Kbps</option>
        <option value="64k">64 Kbps</option>
        <option value="96k">96 Kbps</option>
        <option value="128k">128 Kbps</option>
        <option value="192k">192 Kbps</option>
      </select>
    </div>

    <!-- Encoding Preset (CPU + non-VP9 only) -->
    <div v-if="showPreset">
      <InfoTooltip title="编码预设是什么意思？" widthClass="w-72">
        <template #label>
          <label class="text-sm text-text-secondary">编码速度预设</label>
        </template>
        <template #content>
          <p class="mb-2"><strong class="text-text-primary">编码速度预设</strong> 是速度与画质的权衡：</p>
          <ul class="list-disc list-inside space-y-1">
            <li>
              <span class="text-accent-blue font-medium">ultrafast → fast</span
              >：编码快，但同码率下画质略差，文件更大
            </li>
            <li>
              <span class="text-accent-purple font-medium">medium → veryslow</span
              >：编码慢，但用更复杂的算法压缩，同码率下画质更好，文件更小
            </li>
          </ul>
          <p class="mt-2 text-text-muted">
            越慢的预设意味着编码器会花更多时间分析视频，用更智能的方式分配码率。<br />
            推荐日常使用 <span class="text-accent-blue">medium</span>，追求画质用
            <span class="text-accent-purple">slow</span> 或 <span class="text-accent-purple">veryslow</span>。
          </p>
          <p class="mt-1 text-text-muted">仅 CPU 编码可用，GPU 加速编码不受此影响。</p>
        </template>
      </InfoTooltip>
      <select v-model="params.preset" class="select-input w-full">
        <option value="ultrafast">ultrafast (极速)</option>
        <option value="superfast">superfast</option>
        <option value="veryfast">veryfast</option>
        <option value="faster">faster</option>
        <option value="fast">fast (默认)</option>
        <option value="medium">medium</option>
        <option value="slow">slow</option>
        <option value="slower">slower</option>
        <option value="veryslow">veryslow (最佳画质)</option>
      </select>
    </div>

    <!-- NVENC Encoding Preset (GPU NVENC only) -->
    <div v-if="showNvencPreset">
      <InfoTooltip title="NVENC 预设是什么？" widthClass="w-72">
        <template #label>
          <label class="text-sm text-text-secondary">NVENC 编码预设</label>
        </template>
        <template #content>
          <p class="mb-2">
            <strong class="text-text-primary">NVENC 预设（p1 ~ p7）</strong> 是 NVIDIA
            硬件编码器专用的速度/质量权衡：
          </p>
          <ul class="list-disc list-inside space-y-1">
            <li>
              <span class="text-accent-blue font-medium">p1 ~ p3</span>：极速编码，吞吐量最高，同画质下文件略大
            </li>
            <li>
              <span class="text-accent-purple font-medium">p4（默认）</span>：速度与质量的平衡点，推荐日常使用
            </li>
            <li>
              <span class="text-accent-yellow font-medium">p6 ~ p7</span
              >：最高画质，编码速度降低，但同码率下画质更好
            </li>
          </ul>
          <p class="mt-2 text-text-muted">
            与 CPU 预设不同，NVENC 预设仅影响硬件编码器的内部调度策略，不增加 CPU 负载。
          </p>
        </template>
      </InfoTooltip>
      <select v-model="params.nvencPreset" class="select-input w-full">
        <option value="p1">p1 (极速 - 最大吞吐)</option>
        <option value="p2">p2</option>
        <option value="p3">p3</option>
        <option value="p4">p4 (默认 - 平衡)</option>
        <option value="p5">p5</option>
        <option value="p6">p6</option>
        <option value="p7">p7 (最佳画质)</option>
      </select>
    </div>

    <!-- 2-Pass (CPU + bitrate only) -->
    <div v-if="showTwoPass" class="flex items-center gap-3">
      <InfoTooltip inline title="什么是 2-Pass？" widthClass="w-72">
        <template #label>
          <label class="text-sm text-text-secondary">2-Pass 编码</label>
        </template>
        <template #content>
          <p class="mb-2"><strong class="text-text-primary">2-Pass 编码</strong> 是一种两次编码技术：</p>
          <ul class="list-disc list-inside space-y-1">
            <li>
              <span class="text-accent-blue font-medium">第 1 遍</span
              >：分析视频内容，记录每帧的复杂度信息（不输出文件）
            </li>
            <li>
              <span class="text-accent-purple font-medium">第 2 遍</span
              >：根据分析结果，更精准地分配码率，正式编码输出文件
            </li>
          </ul>
          <p class="mt-2 text-text-muted">仅在使用码率限制（非 CRF 模式）+ CPU 编码时可用。</p>
        </template>
      </InfoTooltip>
      <button
        type="button"
        class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200"
        :class="params.twoPass ? 'bg-accent-blue' : 'bg-bg-tertiary'"
        @click="params.twoPass = !params.twoPass"
      >
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200"
          :class="params.twoPass ? 'translate-x-[18px]' : 'translate-x-[2px]'"
        />
      </button>
      <span class="text-xs text-text-muted">提升画质，耗时约 2 倍</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/styles/compress';
</style>
