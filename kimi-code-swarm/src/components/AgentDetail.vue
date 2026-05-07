<script setup lang="ts">
import { ref, computed, watch, nextTick, type Component } from 'vue'
import {
  ArrowLeft, Send, Terminal, AlertCircle, CheckCircle, MessageSquare, Play,
  GitPullRequest, GitMerge, RotateCcw, Square, Clock, XCircle, FileCode
} from 'lucide-vue-next'
import type { AgentTask } from '../types'

const props = defineProps<{
  agent: AgentTask
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'start', id: string): void
  (e: 'stop', id: string): void
  (e: 'sendInstruction', id: string, instruction: string): void
  (e: 'submitForReview', id: string): void
  (e: 'mergePr', id: string): void
  (e: 'rejectPr', id: string): void
  (e: 'submitReview', agentId: string, reviewerTaskId: string, approved: boolean): void
  (e: 'showFileDiff', agentId: string, filePath: string): void
}>()

const instruction = ref('')
const scrollRef = ref<HTMLDivElement>()

const tokenPercent = computed(() => (props.agent.tokenUsed / props.agent.tokenBudget) * 100)
const approvedCount = computed(() => props.agent.reviews.filter((r) => r.status === 'approved').length)
const canMerge = computed(() => props.agent.reviews.length === 0 || props.agent.reviews.every((r) => r.status === 'approved'))

const statusText = computed(() => {
  const map: Record<string, string> = {
    pending: '待启动', cloning: '克隆中', ready: '就绪',
    working: '工作中', reviewing: '待审阅', completed: '已完成', stopped: '已停止',
  }
  return map[props.agent.status] || props.agent.status
})

const statusColor = computed(() => {
  if (props.agent.status === 'working') return 'text-amber-600'
  if (props.agent.status === 'completed') return 'text-emerald-600'
  if (props.agent.status === 'stopped') return 'text-red-600'
  if (props.agent.status === 'reviewing') return 'text-purple-600'
  return 'text-gray-500'
})

const logTypeConfig: Record<string, { icon: Component; color: string; bg: string }> = {
  system: { icon: Terminal, color: 'text-gray-500', bg: 'bg-gray-50' },
  input: { icon: MessageSquare, color: 'text-swarm-600', bg: 'bg-swarm-50' },
  output: { icon: CheckCircle, color: 'text-blue-600', bg: 'bg-blue-50' },
  error: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
}

function handleSendInstruction() {
  if (!instruction.value.trim()) return
  emit('sendInstruction', props.agent.id, instruction.value.trim())
  instruction.value = ''
}

watch(() => props.agent.logs.length, async () => {
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
        class="p-2 rounded-lg bg-gray-100 text-gray-500 hover:text-gray-900 hover:bg-gray-200 transition-colors"
        @click="emit('back')"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div class="flex-1 min-w-0">
        <h2 class="text-xl font-bold text-gray-900 truncate">{{ agent.name }}</h2>
        <div class="flex items-center gap-3 text-sm text-gray-400 mt-0.5 flex-wrap">
          <span class="truncate">{{ agent.workspace || '未分配' }}</span>
          <span class="text-gray-300">•</span>
          <span class="truncate">{{ agent.branch }}</span>
          <span class="text-gray-300">•</span>
          <span :class="statusColor">{{ statusText }}</span>
        </div>
      </div>
      <div class="text-right shrink-0">
        <p class="text-sm font-medium text-gray-700">{{ agent.tokenUsed.toLocaleString() }} <span class="text-gray-400">/ {{ agent.tokenBudget.toLocaleString() }}</span></p>
        <div class="w-32 bg-gray-200 rounded-full h-1.5 mt-1">
          <div :class="['h-1.5 rounded-full', tokenPercent > 80 ? 'bg-red-500' : 'bg-swarm-500']" :style="{ width: Math.min(tokenPercent, 100) + '%' }" />
        </div>
      </div>
    </div>

    <!-- Info Panel -->
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="px-4 py-3 rounded-lg bg-gray-50 border border-gray-100">
        <p class="text-xs text-gray-500">任务指令</p>
        <p class="text-sm text-gray-700 mt-1">{{ agent.instruction || '暂无指令' }}</p>
      </div>
      <div class="px-4 py-3 rounded-lg bg-gray-50 border border-gray-100">
        <p class="text-xs text-gray-500">仓库</p>
        <p class="text-sm text-gray-700 mt-1 truncate">{{ agent.repoUrl }}</p>
      </div>
    </div>

    <!-- PR Panel -->
    <div v-if="agent.prStatus !== 'none'" class="mb-4 px-4 py-3 rounded-lg bg-purple-50 border border-purple-100 space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <GitPullRequest class="w-4 h-4 text-purple-600" />
          <span class="text-sm font-medium text-purple-700">PR #{{ agent.prNumber }}</span>
          <span
            :class="[
              'text-xs px-2 py-0.5 rounded-full',
              agent.prStatus === 'open' ? 'bg-purple-100 text-purple-600' :
              agent.prStatus === 'merged' ? 'bg-emerald-100 text-emerald-600' :
              'bg-red-100 text-red-600'
            ]"
          >
            {{ agent.prStatus === 'open' ? 'Open' : agent.prStatus === 'merged' ? 'Merged' : 'Closed' }}
          </span>
        </div>
        <div v-if="agent.status === 'reviewing'" class="flex items-center gap-2">
          <button
            :disabled="!canMerge"
            :class="[
              'px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors',
              canMerge
                ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            ]"
            :title="canMerge ? '全员审阅通过，可合并' : `需等待审阅通过 (${approvedCount}/${agent.reviews.length})`"
            @click="emit('mergePr', agent.id)"
          >
            <GitMerge class="w-3 h-3" /> 合并
          </button>
          <button
            class="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors text-xs font-medium flex items-center gap-1"
            @click="emit('rejectPr', agent.id)"
          >
            <RotateCcw class="w-3 h-3" /> 打回
          </button>
        </div>
      </div>

      <div v-if="agent.reviews.length > 0 && agent.status === 'reviewing'">
        <div class="flex items-center justify-between text-xs mb-1.5">
          <span class="text-gray-500">审阅进度</span>
          <span :class="approvedCount === agent.reviews.length ? 'text-emerald-600' : 'text-gray-700'">
            {{ approvedCount }}/{{ agent.reviews.length }} 通过
          </span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-1.5">
          <div
            :class="[
              'h-1.5 rounded-full transition-all',
              approvedCount === agent.reviews.length ? 'bg-emerald-500' : 'bg-purple-500'
            ]"
            :style="{ width: (approvedCount / agent.reviews.length * 100) + '%' }"
          />
        </div>
        <div class="mt-2 space-y-1.5">
          <div
            v-for="review in agent.reviews"
            :key="review.reviewerTaskId"
            class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white text-xs"
          >
            <div class="flex items-center gap-2">
              <Clock v-if="review.status === 'pending'" class="w-3.5 h-3.5 text-gray-400" />
              <CheckCircle v-else-if="review.status === 'approved'" class="w-3.5 h-3.5 text-emerald-600" />
              <XCircle v-else class="w-3.5 h-3.5 text-red-600" />
              <span class="text-gray-700">{{ review.reviewerName }}</span>
              <span v-if="review.reviewedAt" class="text-gray-400">{{ new Date(review.reviewedAt).toLocaleTimeString() }}</span>
            </div>
            <div v-if="review.status === 'pending'" class="flex items-center gap-1">
              <button
                class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                @click="emit('submitReview', agent.id, review.reviewerTaskId, true)"
              >
                通过
              </button>
              <button
                class="px-2 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                @click="emit('submitReview', agent.id, review.reviewerTaskId, false)"
              >
                拒绝
              </button>
            </div>
            <span
              v-else :class="[
                'text-xs px-2 py-0.5 rounded-full',
                review.status === 'approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
              ]"
            >
              {{ review.status === 'approved' ? '已通过' : '已拒绝' }}
            </span>
          </div>
        </div>
      </div>

      <a v-if="agent.prUrl" :href="agent.prUrl" target="_blank" class="text-xs text-gray-400 hover:text-swarm-600 block">{{ agent.prUrl }}</a>
    </div>

    <!-- Action Panel -->
    <div v-if="agent.status === 'pending'" class="mb-4">
      <button
        class="w-full px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors flex items-center justify-center gap-2"
        @click="emit('start', agent.id)"
      >
        <Play class="w-4 h-4" /> 启动 Agent（自动 clone + 启动 CLI）
      </button>
    </div>

    <div v-else-if="agent.status === 'ready'" class="mb-4">
      <form class="flex gap-3" @submit.prevent="handleSendInstruction">
        <input
          v-model="instruction"
          type="text"
          placeholder="输入任务指令发送给 Agent..."
          class="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all"
        />
        <button
          type="submit"
          :disabled="!instruction.trim()"
          class="px-5 py-2.5 bg-swarm-600 text-white rounded-xl hover:bg-swarm-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
        >
          <Send class="w-4 h-4" /> 发送
        </button>
      </form>
    </div>

    <div v-else-if="agent.status === 'working'" class="mb-4 flex items-center gap-3">
      <button
        class="flex-1 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors flex items-center justify-center gap-2"
        @click="emit('submitForReview', agent.id)"
      >
        <GitPullRequest class="w-4 h-4" /> 提交审阅（推送分支 + 创建 PR）
      </button>
      <button
        class="px-4 py-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-colors font-medium flex items-center gap-2"
        @click="emit('stop', agent.id)"
      >
        <Square class="w-4 h-4" /> 停止
      </button>
    </div>

    <!-- Changed Files -->
    <div v-if="agent.changedFiles && agent.changedFiles.length > 0" class="mb-4">
      <div class="flex items-center gap-2 mb-2">
        <FileCode class="w-3.5 h-3.5 text-swarm-600" />
        <span class="text-xs font-medium text-gray-500">文件变更 ({{ agent.changedFiles.length }})</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="file in agent.changedFiles"
          :key="file"
          class="px-2 py-1 rounded-md bg-gray-50 border border-gray-200 text-xs text-gray-600 hover:text-swarm-600 hover:border-swarm-200 transition-colors truncate max-w-[200px]"
          :title="file"
          @click="emit('showFileDiff', agent.id, file)"
        >
          {{ file }}
        </button>
      </div>
    </div>

    <!-- Logs -->
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto scrollbar-thin rounded-xl bg-white border border-gray-200 p-4 space-y-2 min-h-0 shadow-sm"
    >
      <div
        v-for="log in agent.logs"
        :key="log.id"
        :class="['flex gap-3 p-2.5 rounded-lg border border-transparent hover:border-gray-200 transition-colors', logTypeConfig[log.type].bg]"
      >
        <component :is="logTypeConfig[log.type].icon" :class="['w-4 h-4 mt-0.5 shrink-0', logTypeConfig[log.type].color]" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-xs text-gray-400">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
            <span v-if="log.tokens" class="text-xs text-gray-400">{{ log.tokens }} tokens</span>
          </div>
          <p :class="['text-sm whitespace-pre-wrap break-words', log.type === 'error' ? 'text-red-700' : 'text-gray-700']">
            {{ log.content }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
