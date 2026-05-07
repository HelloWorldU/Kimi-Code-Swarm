<script setup lang="ts">
import { ref } from 'vue'
import { KeyRound, Loader2, Sparkles, Shield } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'login', key: string): void
}>()

defineProps<{
  isLoading: boolean
  error: string
}>()

const apiKey = ref('')
const showKey = ref(false)

function handleSubmit() {
  const key = apiKey.value.trim()
  if (!key) return
  emit('login', key)
}
</script>

<template>
  <div class="h-full w-full flex items-center justify-center bg-gray-50">
    <div class="w-full max-w-md px-6">
      <!-- Logo & Title -->
      <div class="text-center mb-10">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-swarm-50 mb-5">
          <Sparkles class="w-8 h-8 text-swarm-600" />
        </div>
        <h1 class="text-2xl font-bold text-gray-900 mb-2">Kimi Code Swarm</h1>
        <p class="text-sm text-gray-400">多 Agent 协同编程指挥中心</p>
      </div>

      <!-- Login Card -->
      <div class="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div class="flex items-center gap-2 mb-5">
          <KeyRound class="w-4 h-4 text-swarm-600" />
          <h2 class="text-sm font-semibold text-gray-700">API Key 登录</h2>
        </div>

        <form @submit.prevent="handleSubmit">
          <div class="relative mb-4">
            <input
              v-model="apiKey"
              :type="showKey ? 'text' : 'password'"
              placeholder="输入你的 Kimi API Key（sk-...）"
              class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all text-sm pr-20"
              :disabled="isLoading"
            />
            <button
              type="button"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-700 transition-colors"
              @click="showKey = !showKey"
            >
              {{ showKey ? '隐藏' : '显示' }}
            </button>
          </div>

          <button
            type="submit"
            :disabled="isLoading || !apiKey.trim()"
            class="w-full py-3 bg-swarm-600 hover:bg-swarm-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2"
          >
            <Loader2 v-if="isLoading" class="w-4 h-4 animate-spin" />
            <Shield v-else class="w-4 h-4" />
            {{ isLoading ? '验证中...' : '验证并登录' }}
          </button>
        </form>

        <!-- Error -->
        <div v-if="error" class="mt-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-100 text-xs text-red-600">
          {{ error }}
        </div>

        <!-- Tips -->
        <div class="mt-5 pt-5 border-t border-gray-100 space-y-2">
          <p class="text-xs text-gray-400 flex items-center gap-1.5">
            <span class="w-1 h-1 rounded-full bg-gray-300" />
            API Key 存储在操作系统密钥库中，不会明文保存
          </p>
          <p class="text-xs text-gray-400 flex items-center gap-1.5">
            <span class="w-1 h-1 rounded-full bg-gray-300" />
            在 <a href="https://platform.moonshot.cn/console/api-keys" target="_blank" class="text-swarm-600 hover:text-swarm-700">Moonshot 平台</a> 获取 API Key
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
