<script setup lang="ts">
import { ref, watch } from 'vue'
import { X, Plus } from 'lucide-vue-next'

const props = defineProps<{
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
const isVisible = ref(false)

watch(() => props.isOpen, (open) => {
  if (open) {
    isVisible.value = true
  } else {
    setTimeout(() => {
      isVisible.value = false
      name.value = ''
      repoUrl.value = ''
      instruction.value = ''
      tokenBudget.value = 50000
    }, 200)
  }
})

function handleSubmit() {
  if (!name.value.trim() || !repoUrl.value.trim()) return
  emit('create', name.value.trim(), repoUrl.value.trim(), instruction.value.trim(), tokenBudget.value)
  emit('close')
}
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-200 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />

      <Transition
        enter-active-class="transition-all duration-300 ease-out"
        enter-from-class="opacity-0 scale-95 translate-y-3"
        enter-to-class="opacity-100 scale-100 translate-y-0"
        leave-active-class="transition-all duration-200 ease-in"
        leave-from-class="opacity-100 scale-100 translate-y-0"
        leave-to-class="opacity-0 scale-95 translate-y-3"
      >
        <div
          v-if="isOpen"
          class="relative bg-white border border-gray-200 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        >
          <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 class="text-lg font-semibold text-gray-900">新建 Agent</h2>
            <button class="text-gray-400 hover:text-gray-700 transition-colors rounded-lg hover:bg-gray-100 p-1" @click="emit('close')">
              <X class="w-5 h-5" />
            </button>
          </div>

          <form class="p-6 space-y-4" @submit.prevent="handleSubmit">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1.5">Agent 名称</label>
              <input
                v-model="name"
                data-testid="agent-name-input"
                type="text"
                placeholder="例如: 前端专家"
                class="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-swarm-500 focus:ring-2 focus:ring-swarm-500/20 transition-all"
                autofocus
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1.5">仓库地址</label>
              <input
                v-model="repoUrl"
                data-testid="agent-repo-url-input"
                type="text"
                placeholder="例如: https://github.com/HelloWorldU/Kimi-Code-Swarm"
                class="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-swarm-500 focus:ring-2 focus:ring-swarm-500/20 transition-all"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1.5">初始指令</label>
              <textarea
                v-model="instruction"
                data-testid="agent-instruction-input"
                placeholder="描述这个 Agent 的职责..."
                rows="3"
                class="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-swarm-500 focus:ring-2 focus:ring-swarm-500/20 transition-all resize-none"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1.5">
                Token 预算上限: <span class="text-swarm-600 font-semibold">{{ tokenBudget.toLocaleString() }}</span>
              </label>
              <input
                v-model="tokenBudget"
                type="range"
                min="10000"
                max="200000"
                step="10000"
                class="w-full accent-swarm-500 h-1.5 rounded-full bg-gray-200 appearance-none cursor-pointer"
              />
              <div class="flex justify-between text-xs text-gray-400 mt-1.5">
                <span>10K</span>
                <span>200K</span>
              </div>
            </div>

            <div class="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                class="px-4 py-2 rounded-xl text-sm font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                @click="emit('close')"
              >
                取消
              </button>
              <button
                type="submit"
                data-testid="agent-create-submit"
                :disabled="!name.trim() || !repoUrl.trim()"
                class="px-4 py-2 rounded-xl text-sm font-medium bg-swarm-600 text-white hover:bg-swarm-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-sm hover:shadow-md"
              >
                <Plus class="w-4 h-4" /> 创建 Agent
              </button>
            </div>
          </form>
        </div>
      </Transition>
    </div>
  </Transition>
</template>
