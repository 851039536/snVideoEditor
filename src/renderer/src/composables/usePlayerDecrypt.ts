/**
 * Player 加密视频解密播放 composable：密码弹窗流程与解密临时文件生命周期管理。
 */
import { ref, computed, type Ref } from 'vue';
import type { PlayerEntry } from '@/views/Player/types';

export function usePlayerDecrypt(deps: {
  files: Ref<PlayerEntry[]>;
  currentIndex: Ref<number>;
  errorMsg: Ref<string>;
  tempDir: Ref<string>;
  tempDirReady: Promise<void>;
  loadMeta: (entry: PlayerEntry) => Promise<void>;
  onDecrypted: () => Promise<void>;
}) {
  // Password modal for encrypted files
  const showPasswordModal = ref(false);
  const decryptingFile = ref<PlayerEntry | null>(null);

  // Auto-decrypt toggle (default: ON — use built-in key)
  const autoDecrypt = ref(true);

  // Guard against concurrent decrypts
  let decrypting = false;

  // Derived: how many files currently have a temp decrypted copy
  const tempCount = computed((): number => {
    return deps.files.value.filter((e) => e.tempPath).length;
  });

  async function decryptAndPlay(file: PlayerEntry, password: string): Promise<void> {
    if (decrypting) {
      return;
    }
    decrypting = true;

    try {
      if (file.tempPath) {
        await cleanupTemp(file.tempPath);
        file.tempPath = null;
      }

      await deps.tempDirReady;
      if (!deps.tempDir.value) {
        deps.errorMsg.value = '无法获取临时目录，解密失败';
        return;
      }

      const tempPath = await window.electronAPI.decryptForPlayback(file.path, password, deps.tempDir.value);

      if (deps.files.value[deps.currentIndex.value]?.path !== file.path) {
        await cleanupTemp(tempPath);
        return;
      }

      file.tempPath = tempPath;

      await deps.loadMeta(file);
      await deps.onDecrypted();
    } finally {
      decrypting = false;
    }
  }

  /** 打开密码弹窗（手动解密模式），密码输入与校验由 PasswordModal 组件自持 */
  function openPasswordModal(file: PlayerEntry): void {
    decryptingFile.value = file;
    showPasswordModal.value = true;
  }

  /** 接收 PasswordModal 校验通过后 emit 的密码并解密播放 */
  async function confirmDecrypt(password: string): Promise<void> {
    if (!decryptingFile.value) {
      return;
    }
    const file = decryptingFile.value;
    showPasswordModal.value = false;
    decryptingFile.value = null;

    await decryptAndPlay(file, password);
  }

  function cancelDecrypt(): void {
    showPasswordModal.value = false;
    decryptingFile.value = null;
  }

  // ---- Temp Cleanup ----
  async function cleanupTemp(tempPath: string): Promise<void> {
    await window.electronAPI.deleteFile(tempPath);
  }

  async function cleanupAllTemps(): Promise<void> {
    for (const entry of deps.files.value) {
      if (entry.tempPath) {
        await cleanupTemp(entry.tempPath);
        entry.tempPath = null;
      }
    }
  }

  return {
    showPasswordModal,
    decryptingFile,
    autoDecrypt,
    tempCount,
    decryptAndPlay,
    openPasswordModal,
    confirmDecrypt,
    cancelDecrypt,
    cleanupTemp,
    cleanupAllTemps
  };
}
