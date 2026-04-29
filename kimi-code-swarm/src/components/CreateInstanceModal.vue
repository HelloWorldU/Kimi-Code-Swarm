<script setup lang="ts">
import { ref } from 'vue'
import { X, Plus } from 'lucide-vue-next'

defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create', name: string, workspace: string, task: string): void
}>()

const name = ref('')
const workspace = ref('')
const task = ref('')

function handleSubmit() {
  if (!name.value.trim() || !workspace.value.trim()) return
  emit('create', name.value.trim(), workspace.value.trim(), task.value.trim())
  name.value = ''
  workspace.value = ''
  task.value = ''
  emit('close')
}
</script>

<template>
  <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="emit('close')" />
    <div class="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <h2 class="text-lg font-semibold text-white">新建 CLI 实例</h2>
        <button class="text-gray-500 hover:text-gray-300 transition-colors" @click="emit('close')">
          <X class="w-5 h-5" />
        </button>
      </div>

      <form class="p-6 space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">实例名称</label>
          <input
            v-model="name"
            type="text"
            placeholder="例如: Frontend Refactor #5"
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all"
            autofocus
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">工作目录</label>
          <input
            v-model="workspace"
            type="text"
            placeholder="例如: E:/projects/my-app"
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">任务描述</label>
          <textarea
            v-model="task"
            placeholder="描述这个实例要完成的任务..."
            rows="3"
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all resize-none"
          />
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
            :disabled="!name.trim() || !workspace.trim()"
            class="px-4 py-2 rounded-lg text-sm font-medium bg-swarm-600 text-white hover:bg-swarm-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <Plus class="w-4 h-4" /> 创建实例
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
