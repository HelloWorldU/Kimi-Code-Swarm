<script setup lang="ts">
import { ref } from 'vue'
import { X, Plus } from 'lucide-vue-next'

defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create', name: string, repoUrl: string, instruction: string, tokenBudget: number): void
}>()

const name = ref('')
const repoUrl = ref('')
const instruction = ref('')
const tokenBudget = ref(50000)

function handleSubmit() {
  if (!name.value.trim() || !repoUrl.value.trim()) return
  emit('create', name.value.trim(), repoUrl.value.trim(), instruction.value.trim(), tokenBudget.value)
  name.value = ''
  repoUrl.value = ''
  instruction.value = ''
  tokenBudget.value = 50000
  emit('close')
}
</script>

<template>
  <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="emit('close')" />
    <div class="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <h2 class="text-lg font-semibold text-white">新建任务</h2>
        <button class="text-gray-500 hover:text-gray-300 transition-colors" @click="emit('close')">
          <X class="w-5 h-5" />
        </button>
      </div>

      <form class="p-6 space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">任务名称</label>
          <input
            v-model="name"
            type="text"
            placeholder="例如: 登录模块开发"
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all"
            autofocus
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">仓库地址</label>
          <input
            v-model="repoUrl"
            type="text"
            placeholder="例如: https://github.com/HelloWorldU/Kimi-Code-Swarm"
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">任务指令</label>
          <textarea
            v-model="instruction"
            placeholder="描述这个任务要完成什么..."
            rows="3"
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all resize-none"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">
            Token 预算上限: <span class="text-swarm-400">{{ tokenBudget.toLocaleString() }}</span>
          </label>
          <input
            v-model="tokenBudget"
            type="range"
            min="10000"
            max="200000"
            step="10000"
            class="w-full accent-swarm-500"
          />
          <div class="flex justify-between text-xs text-gray-500 mt-1">
            <span>10K</span>
            <span>200K</span>
          </div>
        </div>

        <div class="pt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            @click="emit('close')"
          >
            取消
          </button>
          <button
            type="submit"
            :disabled="!name.trim() || !repoUrl.trim()"
            class="px-4 py-2 rounded-lg text-sm font-medium bg-swarm-600 text-white hover:bg-swarm-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <Plus class="w-4 h-4" /> 创建任务
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
