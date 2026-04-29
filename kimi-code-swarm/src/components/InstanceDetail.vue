<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ArrowLeft, Send, Terminal, AlertCircle, CheckCircle, MessageSquare } from 'lucide-vue-next'
import type { CliInstance } from '../types'

const props = defineProps<{
  instance: CliInstance
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'sendCommand', id: string, command: string): void
}>()

const command = ref('')
const scrollRef = ref<HTMLDivElement>()

const tokenPercent = computed(() => (props.instance.tokenUsed / props.instance.tokenLimit) * 100)

const statusText = computed(() => {
  const map: Record<string, string> = {
    running: '运行中',
    idle: '空闲',
    error: '错误',
    queued: '排队中',
    stopped: '已停止',
  }
  return map[props.instance.status] || props.instance.status
})

const statusColor = computed(() => {
  if (props.instance.status === 'running') return 'text-emerald-400'
  if (props.instance.status === 'error') return 'text-red-400'
  return 'text-gray-400'
})

const logTypeConfig: Record<string, { icon: any; color: string; bg: string }> = {
  system: { icon: Terminal, color: 'text-gray-400', bg: 'bg-gray-800/50' },
  input: { icon: MessageSquare, color: 'text-swarm-400', bg: 'bg-swarm-500/5' },
  output: { icon: CheckCircle, color: 'text-blue-400', bg: 'bg-blue-500/5' },
  error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/5' },
}

function handleSend() {
  if (!command.value.trim()) return
  emit('sendCommand', props.instance.id, command.value.trim())
  command.value = ''
}

watch(() => props.instance.logs.length, async () => {
  await nextTick()
  if (scrollRef.value) {
    scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  }
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="flex items-center gap-4 mb-6">
      <button
        @click="emit('back')"
        class="p-2 rounded-lg bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div class="flex-1">
        <h2 class="text-xl font-bold text-white">{{ instance.name }}</h2>
        <div class="flex items-center gap-3 text-sm text-gray-500 mt-0.5">
          <span>{{ instance.workspace }}</span>
          <span>•</span>
          <span>PID: {{ instance.pid || 'N/A' }}</span>
          <span>•</span>
          <span :class="statusColor">{{ statusText }}</span>
        </div>
      </div>
      <div class="text-right">
        <p class="text-sm font-medium text-gray-300">{{ instance.tokenUsed.toLocaleString() }} <span class="text-gray-500">/ {{ instance.tokenLimit.toLocaleString() }}</span></p>
        <div class="w-32 bg-gray-700 rounded-full h-1.5 mt-1">
          <div :class="['h-1.5 rounded-full', tokenPercent > 80 ? 'bg-red-500' : 'bg-swarm-500']" :style="{ width: Math.min(tokenPercent, 100) + '%' }" />
        </div>
      </div>
    </div>

    <!-- Task Description -->
    <div v-if="instance.taskDescription" class="mb-4 px-4 py-3 rounded-lg bg-gray-800/50 border border-gray-700/50">
      <p class="text-sm text-gray-400">当前任务</p>
      <p class="text-sm text-gray-200 mt-1">{{ instance.taskDescription }}</p>
    </div>

    <!-- Logs -->
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto scrollbar-thin rounded-xl bg-gray-900/50 border border-gray-800 p-4 space-y-2 min-h-0"
    >
      <div
        v-for="log in instance.logs"
        :key="log.id"
        :class="['flex gap-3 p-2.5 rounded-lg border border-transparent hover:border-gray-700/50 transition-colors', logTypeConfig[log.type].bg]"
      >
        <component :is="logTypeConfig[log.type].icon" :class="['w-4 h-4 mt-0.5 shrink-0', logTypeConfig[log.type].color]" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-xs text-gray-500">{{ log.timestamp.toLocaleTimeString() }}</span>
            <span v-if="log.tokens" class="text-xs text-gray-600">{{ log.tokens }} tokens</span>
          </div>
          <p :class="['text-sm whitespace-pre-wrap break-words', log.type === 'error' ? 'text-red-300' : 'text-gray-300']">
            {{ log.content }}
          </p>
        </div>
      </div>
    </div>

    <!-- Command Input -->
    <form @submit.prevent="handleSend" class="mt-4 flex gap-3">
      <input
        v-model="command"
        type="text"
        :placeholder="instance.status === 'running' ? '输入指令发送给 CLI...' : '实例未运行，无法发送指令'"
        :disabled="instance.status !== 'running'"
        class="flex-1 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-gray-100 placeholder-gray-500 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        :disabled="instance.status !== 'running' || !command.trim()"
        class="px-5 py-2.5 bg-swarm-600 text-white rounded-xl hover:bg-swarm-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
      >
        <Send class="w-4 h-4" /> 发送
      </button>
    </form>
  </div>
</template>
