<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Github, KeyRound, Check, AlertCircle } from 'lucide-vue-next'
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
      <div class="w-10 h-10 rounded-lg bg-gray-700/50 flex items-center justify-center">
        <Github class="w-5 h-5 text-gray-400" />
      </div>
      <div>
        <p class="text-sm font-medium text-white">GitHub Personal Access Token</p>
        <p class="text-xs text-gray-500">用于创建和合并 Pull Request</p>
      </div>
    </div>

    <div v-if="saved" class="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
      <Check class="w-4 h-4" />
      <span>Token 已配置</span>
      <button class="ml-auto text-xs text-gray-400 hover:text-white transition-colors" @click="handleClear">
        清除
      </button>
    </div>

    <div v-else class="flex items-start gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
      <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
      <span>未配置 Token，PR 创建/合并将以模拟模式运行</span>
    </div>

    <div class="flex gap-3">
      <div class="flex-1 relative">
        <KeyRound class="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          v-model="token"
          :type="showToken ? 'text' : 'password'"
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          class="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all text-sm"
        />
      </div>
      <button
        type="button"
        class="px-3 py-2.5 text-xs text-gray-400 hover:text-white bg-gray-800 border border-gray-700 rounded-lg transition-colors"
        @click="showToken = !showToken"
      >
        {{ showToken ? '隐藏' : '显示' }}
      </button>
      <button
        class="px-4 py-2.5 bg-swarm-600 text-white rounded-lg text-sm font-medium hover:bg-swarm-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        :disabled="!token.trim()"
        @click="handleSave"
      >
        保存
      </button>
    </div>

    <p class="text-xs text-gray-600">
      在 GitHub Settings → Developer settings → Personal access tokens → Tokens (classic) 中创建。
      需要 <code class="text-gray-400 bg-gray-800 px-1 py-0.5 rounded">repo</code> 权限。
    </p>
  </div>
</template>
