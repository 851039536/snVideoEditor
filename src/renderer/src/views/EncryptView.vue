<script setup lang="ts">
import { ref, computed } from 'vue'
import { Shield, Lock, Unlock, Folder, Play, Eye, EyeOff, X, FileVideo, FolderOpen } from 'lucide-vue-next'
import FileDropZone from '@/components/FileDropZone.vue'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'
import { useSettingsStore } from '@/stores/settings'

const progressStore = useProgressStore()
const settingsStore = useSettingsStore()

// Mode
const mode = ref<'encrypt' | 'decrypt'>('encrypt')

// Files
interface CryptoEntry {
  path: string
  outputPath: string
  name: string
}

const files = ref<CryptoEntry[]>([])
const errorMsg = ref('')

// Password
const password = ref('')
const showPassword = ref(false)
const confirmPassword = ref('')

// Password strength
const passwordStrength = computed((): { label: string; color: string; width: string } => {
  const pwd = password.value
  if (pwd.length === 0) {
    return { label: '', color: '', width: '0%' }
  }
  if (pwd.length < 6) {
    return { label: '弱', color: '#F85149', width: '25%' }
  }
  if (pwd.length < 10) {
    return { label: '中等', color: '#D29922', width: '50%' }
  }
  const hasUpper = /[A-Z]/.test(pwd)
  const hasLower = /[a-z]/.test(pwd)
  const hasNum = /\d/.test(pwd)
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(pwd)
  const score = [hasUpper, hasLower, hasNum, hasSpecial].filter(Boolean).length
  if (score >= 3 && pwd.length >= 12) {
    return { label: '强', color: '#3FB950', width: '100%' }
  }
  return { label: '较强', color: '#58A6FF', width: '75%' }
})

async function addFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    if (files.value.some((f) => f.path === p)) { continue }
    const output = await window.electronAPI.generateCryptoOutputPath(p, mode.value === 'encrypt')
    files.value.push({
      path: p,
      outputPath: output,
      name: p.split(/[/\\]/).pop() || p
    })
  }
}

async function selectDir(): Promise<void> {
  const dir = await window.electronAPI.selectDirectory()
  if (!dir) { return }

  const scannedFiles = await window.electronAPI.scanVideoFiles(dir)
  if (scannedFiles.length === 0) {
    errorMsg.value = '未找到视频文件'
    return
  }

  for (const p of scannedFiles) {
    if (files.value.some((f) => f.path === p)) { continue }
    const output = await window.electronAPI.generateCryptoOutputPath(p, mode.value === 'encrypt')
    files.value.push({
      path: p,
      outputPath: output,
      name: p.split(/[/\\]/).pop() || p
    })
  }
}

function removeFile(index: number): void {
  files.value.splice(index, 1)
}

async function selectOutputDirForAll(): Promise<void> {
  const dir = await window.electronAPI.selectDirectory()
  if (!dir) { return }
  for (const entry of files.value) {
    const name = entry.path.split(/[/\\]/).pop() || 'video'
    const ext = mode.value === 'encrypt' ? `${name}.enc` : name.replace('.enc', '')
    entry.outputPath = `${dir}/${ext}`
  }
}

function canStart(): boolean {
  if (files.value.length === 0) { return false }
  if (password.value.length === 0) { return false }
  if (mode.value === 'encrypt' && password.value !== confirmPassword.value) { return false }
  return true
}

async function startProcess(): Promise<void> {
  errorMsg.value = ''

  if (mode.value === 'encrypt' && password.value !== confirmPassword.value) {
    errorMsg.value = '两次输入的密码不一致'
    return
  }

  if (password.value.length < 4) {
    errorMsg.value = '密码至少需要 4 个字符'
    return
  }

  // Ensure output paths
  for (const entry of files.value) {
    if (!entry.outputPath) {
      await selectOutputDirForAll()
      break
    }
  }

  const unresolved = files.value.filter((f) => !f.outputPath)
  if (unresolved.length > 0) {
    errorMsg.value = '请为所有文件选择输出目录'
    return
  }

  progressStore.start(mode.value === 'encrypt' ? 'encrypt' : 'decrypt')
  window.electronAPI.onProgress((info) => {
    progressStore.update(info)
  })

  settingsStore.setLastPassword(password.value)

  try {
    if (files.value.length === 1) {
      const f = files.value[0]
      let result = false
      if (mode.value === 'encrypt') {
        result = await window.electronAPI.encryptFile({
          input: f.path,
          output: f.outputPath,
          password: password.value
        })
      } else {
        result = await window.electronAPI.decryptFile({
          input: f.path,
          output: f.outputPath,
          password: password.value
        })
      }
      if (result) {
        progressStore.finish()
      }
    } else {
      const batchFiles = files.value.map((f) => ({
        input: f.path,
        output: f.outputPath
      }))
      let result: { success: number; failed: string[] }
      if (mode.value === 'encrypt') {
        result = await window.electronAPI.batchEncrypt({
          files: batchFiles,
          password: password.value
        })
      } else {
        result = await window.electronAPI.batchDecrypt({
          files: batchFiles,
          password: password.value
        })
      }
      if (result.failed.length === 0) {
        progressStore.finish()
      } else {
        errorMsg.value = `${result.failed.length} 个文件处理失败`
        progressStore.reset()
      }
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    progressStore.reset()
  }
}

function switchMode(newMode: 'encrypt' | 'decrypt'): void {
  mode.value = newMode
  files.value = []
  errorMsg.value = ''
}
</script>

<template>
  <div class="max-w-6xl mx-auto animate-slide-up">
    <!-- Header -->
    <header class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
          <Shield :size="20" class="text-success" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频加密与解密</h1>
      </div>
      <p class="text-text-secondary text-sm">AES-256-CTR 军用级加密，流式处理大文件无压力</p>
    </header>

    <!-- Mode Tabs -->
    <div class="flex gap-1 mb-6 p-1 rounded-lg bg-bg-tertiary w-fit">
      <button
        @click="switchMode('encrypt')"
        class="px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-2"
        :class="mode === 'encrypt' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'"
      >
        <Lock :size="14" />
        加密
      </button>
      <button
        @click="switchMode('decrypt')"
        class="px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-2"
        :class="mode === 'decrypt' ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'"
      >
        <Unlock :size="14" />
        解密
      </button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Left: File Area -->
      <div class="space-y-4">
        <FileDropZone @files-selected="addFiles" />

        <!-- Directory Scan Button -->
        <button
          @click="selectDir"
          class="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-bg-tertiary hover:border-accent-blue/30 hover:bg-bg-tertiary/30 text-text-secondary hover:text-text-primary transition-all text-sm"
        >
          <FolderOpen :size="16" />
          {{ mode === 'encrypt' ? '扫描视频文件夹' : '扫描加密文件夹' }}
        </button>

        <!-- File List -->
        <div v-if="files.length > 0" class="glass-card p-4 space-y-2 max-h-72 overflow-y-auto">
          <div
            v-for="(file, idx) in files"
            :key="file.path"
            class="flex items-center gap-2 p-2 rounded-lg bg-bg-tertiary/50 hover:bg-bg-tertiary transition-colors group"
          >
            <FileVideo :size="16" class="text-accent-blue flex-shrink-0" />
            <span class="text-sm text-text-primary truncate flex-1">{{ file.name }}</span>
            <button
              @click="removeFile(idx)"
              class="p-1 rounded hover:bg-danger/20 transition-all opacity-0 group-hover:opacity-100"
            >
              <X :size="14" class="text-danger" />
            </button>
          </div>
        </div>
      </div>

      <!-- Right: Parameters -->
      <div class="space-y-4">
        <!-- Password -->
        <div class="glass-card p-5">
          <h3 class="text-base font-semibold text-text-primary mb-4">
            {{ mode === 'encrypt' ? '设置密码' : '输入密码' }}
          </h3>

          <div class="space-y-3">
            <div class="relative">
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="mode === 'encrypt' ? '输入加密密码' : '输入解密密码'"
                class="input-field w-full pr-10"
              />
              <button
                @click="showPassword = !showPassword"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                <EyeOff v-if="showPassword" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>

            <!-- Password Strength (encrypt only) -->
            <div v-if="mode === 'encrypt' && password.length > 0">
              <div class="h-1.5 bg-bg-tertiary rounded-full overflow-hidden mb-1">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :style="{ width: passwordStrength.width, backgroundColor: passwordStrength.color }"
                />
              </div>
              <span class="text-xs" :style="{ color: passwordStrength.color }">
                密码强度: {{ passwordStrength.label }}
              </span>
            </div>

            <!-- Confirm Password (encrypt only) -->
            <div v-if="mode === 'encrypt'">
              <input
                v-model="confirmPassword"
                type="password"
                placeholder="再次输入密码确认"
                class="input-field w-full"
                :class="confirmPassword && password !== confirmPassword ? 'border-danger/50' : ''"
              />
              <p
                v-if="confirmPassword && password !== confirmPassword"
                class="text-xs text-danger mt-1"
              >
                两次输入的密码不一致
              </p>
            </div>
          </div>
        </div>

        <!-- Output -->
        <div class="glass-card p-5">
          <h3 class="text-base font-semibold text-text-primary mb-3">输出设置</h3>
          <button
            @click="selectOutputDirForAll"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary hover:bg-bg-primary text-text-secondary hover:text-text-primary transition-all text-sm border border-transparent hover:border-accent-blue/30"
          >
            <Folder :size="16" />
            选择输出目录
          </button>
        </div>

        <!-- Info Card -->
        <div class="glass-card p-4 border border-accent-blue/20 bg-accent-blue/5">
          <div class="flex items-start gap-2">
            <Shield :size="16" class="text-accent-blue mt-0.5 flex-shrink-0" />
            <div class="text-xs text-text-secondary leading-relaxed">
              <p class="font-medium text-text-primary mb-1">加密说明</p>
              <p v-if="mode === 'encrypt'">
                使用 AES-256-CTR 算法加密视频文件。加密后的文件将以 <code class="text-accent-blue">.enc</code> 扩展名保存。
                请妥善保管密码，丢失后无法恢复。
              </p>
              <p v-else>
                解密使用 AES-256-CTR 加密的视频文件。需要输入加密时设置的密码。
                支持 <code class="text-accent-blue">.enc</code> 格式文件。
              </p>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="p-3 rounded-lg bg-danger/10 border border-danger/30">
          <p class="text-sm text-danger">{{ errorMsg }}</p>
        </div>

        <!-- Start -->
        <button
          @click="startProcess"
          :disabled="!canStart() || progressStore.isProcessing"
          class="w-full py-3 rounded-xl font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="canStart() && !progressStore.isProcessing
            ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:shadow-lg hover:shadow-emerald-500/25'
            : 'bg-bg-tertiary text-text-muted'"
        >
          <Lock v-if="mode === 'encrypt'" :size="18" />
          <Unlock v-else :size="18" />
          {{ progressStore.isProcessing ? '处理中...' : mode === 'encrypt' ? '开始加密' : '开始解密' }}
        </button>

        <ProgressPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.input-field {
  padding: 10px 14px;
  background: #21262D;
  border: 1px solid #30363D;
  border-radius: 8px;
  color: #E6EDF3;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.input-field:focus {
  border-color: #5B8DEF;
}

.input-field::placeholder {
  color: #484F58;
}

code {
  background: rgba(91, 141, 239, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
</style>
