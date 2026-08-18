// m3u8 清晰度变体探测与选择逻辑（含竞态保护与防抖定时器）
import { computed, ref } from 'vue';
import type { Ref } from 'vue';
import { isValidUrl } from '@/utils/url';
import type { QualityVariant } from '@/types/file';

export function useQualityVariants(m3u8Url: Ref<string>, headers: Record<string, string>) {
  const variants = ref<QualityVariant[]>([]);
  const selectedVariantIndex = ref(-1); // -1 = 使用原始 URL（直接下载）
  const showQualitySelector = ref(false);
  /** 清晰度探测进行中（用于输入框下方加载提示） */
  const variantsLoading = ref(false);
  // 竞态保护：每次新请求递增版本号，旧请求的过时结果被丢弃
  let fetchVariantsVersion = 0;

  /** 实际下载地址：变体 URL 或原始输入 */
  const effectiveUrl = computed((): string => {
    if (variants.value.length > 0 && selectedVariantIndex.value >= 0) {
      return variants.value[selectedVariantIndex.value].url;
    }
    return m3u8Url.value.trim();
  });

  /** 自动选择 480p：无精确匹配时取最接近者（同差距优先更低分辨率） */
  function autoSelect480p(variantList: QualityVariant[]): void {
    if (variantList.length === 0) {
      selectedVariantIndex.value = -1;
      return;
    }
    // 精确 480p
    const idx480 = variantList.findIndex((v) => v.height === 480);
    if (idx480 >= 0) {
      selectedVariantIndex.value = idx480;
      return;
    }
    // 最接近 480p（优先略低）
    let bestIdx = 0;
    let bestDiff = Math.abs(variantList[0].height - 480);
    for (let i = 1; i < variantList.length; i++) {
      const diff = Math.abs(variantList[i].height - 480);
      if (diff < bestDiff || (diff === bestDiff && variantList[i].height < variantList[bestIdx].height)) {
        bestIdx = i;
        bestDiff = diff;
      }
    }
    selectedVariantIndex.value = bestIdx;
  }

  /** 探测当前 m3u8 地址的清晰度变体（master playlist） */
  async function fetchQualityVariants(): Promise<void> {
    const url = m3u8Url.value.trim();
    if (!isValidUrl(url)) {
      return;
    }

    const version = ++fetchVariantsVersion;
    variantsLoading.value = true;
    try {
      const result = await window.electronAPI.fetchM3u8Variants(url, { ...headers });
      // 竞态保护：URL 已变化（版本号已递增）时丢弃过时结果
      if (version !== fetchVariantsVersion) {
        return;
      }
      variants.value = result;
      if (result.length > 0) {
        autoSelect480p(result);
        showQualitySelector.value = true;
      } else {
        selectedVariantIndex.value = -1;
        showQualitySelector.value = false;
      }
    } catch {
      if (version !== fetchVariantsVersion) {
        return;
      }
      variants.value = [];
      selectedVariantIndex.value = -1;
      showQualitySelector.value = false;
    } finally {
      // 仅由最新一次请求负责清除加载态，避免过时请求提前熄灭提示
      if (version === fetchVariantsVersion) {
        variantsLoading.value = false;
      }
    }
  }

  /** 清空变体状态（URL 不再是 m3u8 时调用） */
  function resetVariants(): void {
    variants.value = [];
    selectedVariantIndex.value = -1;
    showQualitySelector.value = false;
  }

  return {
    variants,
    selectedVariantIndex,
    showQualitySelector,
    variantsLoading,
    effectiveUrl,
    fetchQualityVariants,
    resetVariants
  };
}
