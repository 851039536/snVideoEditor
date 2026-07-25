<!-- 加密视频密码输入弹窗：自持密码输入与校验状态 -->
<script setup lang="ts">
import { ref, watch } from 'vue';
import { Lock } from 'lucide-vue-next';

const props = defineProps<{
  show: boolean;
  fileName: string;
}>();

const emit = defineEmits<{
  confirm: [password: string];
  cancel: [];
}>();

const passwordInput = ref('');
const passwordError = ref('');

// 每次打开弹窗时重置上次输入
watch(
  () => props.show,
  (val): void => {
    if (val) {
      passwordInput.value = '';
      passwordError.value = '';
    }
  }
);

function handleConfirm(): void {
  if (passwordInput.value.length < 4) {
    passwordError.value = '密码至少需要4个字符';
    return;
  }
  passwordError.value = '';
  emit('confirm', passwordInput.value);
  passwordInput.value = '';
}

function handleCancel(): void {
  passwordInput.value = '';
  passwordError.value = '';
  emit('cancel');
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="handleCancel"
    >
      <div class="glass-card w-full max-w-sm mx-4" @click.stop>
        <h3 class="text-lg font-semibold text-text-primary mb-2 flex items-center gap-2">
          <Lock :size="18" class="text-warning" />
          输入解密密码
        </h3>
        <p class="text-sm text-text-secondary mb-4">
          播放加密视频需要输入密码进行解密。
          <span class="text-xs text-text-muted truncate block mt-1">{{ fileName }}</span>
        </p>

        <input
          v-model="passwordInput"
          type="password"
          placeholder="输入解密密码（至少4位）"
          class="input-base w-full mb-2"
          @keyup.enter="handleConfirm"
        />

        <p v-if="passwordError" class="text-xs text-danger mb-2">{{ passwordError }}</p>

        <div class="flex justify-end gap-2 mt-4">
          <button @click="handleCancel" class="btn-secondary text-xs">取消</button>
          <button
            @click="handleConfirm"
            :disabled="passwordInput.length < 4"
            class="px-4 py-2 rounded-lg bg-gradient-to-r from-accent-blue to-accent-purple text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            解密并播放
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
