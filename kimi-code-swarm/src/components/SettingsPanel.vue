<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Github, KeyRound, Check, AlertCircle, Terminal } from 'lucide-vue-next'
import { setToken, hasToken } from '../api/github'

const token = ref('')
const saved = ref(hasToken())
const showToken = ref(false)

onMounted(() => {
  saved.value = hasToken()
})

function handleSave() {
  if (!token.value.trim()) return
  setToken(token.value.trim())
  saved.value = true
  token.value = ''
}

function handleClear() {
  localStorage.removeItem('github-token')
  saved.value = false
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
        <Github class="w-5 h-5 text-gray-500" />
      </div>
      <div>
        <p class="text-sm font-medium text-gray-900">GitHub Personal Access Token</p>
        <p class="text-xs text-gray-400">用于创建和合并 Pull Request</p>
      </div>
    </div>

    <div v-if="saved" class="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
      <Check class="w-4 h-4" />
      <span>Token 已配置</span>
      <button class="ml-auto text-xs text-gray-400 hover:text-gray-700 transition-colors" @click="handleClear">
        清除
      </button>
    </div>

    <div v-else class="flex items-start gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
      <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
      <span>未配置 Token，PR 创建/合并将以模拟模式运行</span>
    </div>

    <div class="flex gap-3">
      <div class="flex-1 relative">
        <KeyRound class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          v-model="token"
          :type="showToken ? 'text' : 'password'"
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          class="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all text-sm"
        />
      </div>
      <button
        type="button"
        class="px-3 py-2.5 text-xs text-gray-400 hover:text-gray-700 bg-gray-50 border border-gray-200 rounded-lg transition-colors"
        @click="showToken = !showToken"
      >
        {{ showToken ? '隐藏' : '显示' }}
      </button>
      <button
        class="px-4 py-2.5 bg-swarm-600 text-white rounded-lg text-sm font-medium hover:bg-swarm-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        :disabled="!token.trim()"
        @click="handleSave"
      >
        保存
      </button>
    </div>

    <p class="text-xs text-gray-400">
      在 GitHub Settings → Developer settings → Personal access tokens → Tokens (classic) 中创建。
      需要 <code class="text-gray-500 bg-gray-100 px-1 py-0.5 rounded">repo</code> 权限。
    </p>

    <div class="border-t border-gray-100 pt-4 mt-4">
      <div class="flex items-center gap-3 mb-3">
        <div class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
          <Terminal class="w-5 h-5 text-gray-500" />
        </div>
        <div>
          <p class="text-sm font-medium text-gray-900">Kimi CLI</p>
          <p class="text-xs text-gray-400">Agent 执行依赖 Kimi Code CLI</p>
        </div>
      </div>

      <div class="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5">
        <Terminal class="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
        <div class="space-y-1.5 text-xs">
          <p>
            <span class="text-gray-500">安装:</span>
            <code class="text-swarm-600 bg-gray-100 px-1.5 py-0.5 rounded ml-1">py -3.12 -m pip install kimi-cli</code>
          </p>
          <p>
            <span class="text-gray-500">配置 API Key:</span>
            <code class="text-swarm-600 bg-gray-100 px-1.5 py-0.5 rounded ml-1">kimi /setup</code>
            <span class="text-gray-400">或设置环境变量</span>
            <code class="text-swarm-600 bg-gray-100 px-1.5 py-0.5 rounded ml-1">MOONSHOT_API_KEY</code>
          </p>
          <p class="text-gray-400">安装完成后重启 App 即可调用真实 Agent。</p>
        </div>
      </div>
    </div>
  </div>
</template>
