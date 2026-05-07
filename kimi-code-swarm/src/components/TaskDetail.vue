<script setup lang="ts">
import { ref, computed, watch, nextTick, type Component } from 'vue'
import { ArrowLeft, Send, Terminal, AlertCircle, CheckCircle, MessageSquare, Play, GitPullRequest, GitMerge, RotateCcw, Square, Clock, XCircle, FileCode } from 'lucide-vue-next'
import type { AgentTask } from '../types'

const props = defineProps<{
  task: AgentTask
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'start', id: string): void
  (e: 'stop', id: string): void
  (e: 'sendInstruction', id: string, instruction: string): void
  (e: 'submitForReview', id: string): void
  (e: 'mergePr', id: string): void
  (e: 'rejectPr', id: string): void
  (e: 'submitReview', taskId: string, reviewerTaskId: string, approved: boolean): void
  (e: 'showFileDiff', taskId: string, filePath: string): void
}>()

const instruction = ref('')
const scrollRef = ref<HTMLDivElement>()

const tokenPercent = computed(() => (props.task.tokenUsed / props.task.tokenBudget) * 100)

const approvedCount = computed(() => props.task.reviews.filter(r => r.status === 'approved').length)
const canMerge = computed(() => props.task.reviews.length === 0 || props.task.reviews.every(r => r.status === 'approved'))

const statusText = computed(() => {
  const map: Record<string, string> = {
    pending: '待启动', cloning: '克隆中', ready: '就绪',
    working: '工作中', reviewing: '待审阅', completed: '已完成', stopped: '已停止',
  }
  return map[props.task.status] || props.task.status
})

const statusColor = computed(() => {
  if (props.task.status === 'working') return 'text-amber-400'
  if (props.task.status === 'completed') return 'text-emerald-400'
  if (props.task.status === 'stopped') return 'text-red-400'
  if (props.task.status === 'reviewing') return 'text-purple-400'
  return 'text-gray-400'
})

const logTypeConfig: Record<string, { icon: Component; color: string; bg: string }> = {
  system: { icon: Terminal, color: 'text-gray-400', bg: 'bg-gray-800/50' },
  input: { icon: MessageSquare, color: 'text-swarm-400', bg: 'bg-swarm-500/5' },
  output: { icon: CheckCircle, color: 'text-blue-400', bg: 'bg-blue-500/5' },
  error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/5' },
}

function handleSendInstruction() {
  if (!instruction.value.trim()) return
  emit('sendInstruction', props.task.id, instruction.value.trim())
  instruction.value = ''
}

watch(() => props.task.logs.length, async () => {
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
        class="p-2 rounded-lg bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
        @click="emit('back')"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div class="flex-1 min-w-0">
        <h2 class="text-xl font-bold text-white truncate">{{ task.name }}</h2>
        <div class="flex items-center gap-3 text-sm text-gray-500 mt-0.5 flex-wrap">
          <span class="truncate">{{ task.workspace || '未分配' }}</span>
          <span>•</span>
          <span class="truncate">{{ task.branch }}</span>
          <span>•</span>
          <span :class="statusColor">{{ statusText }}</span>
        </div>
      </div>
      <div class="text-right shrink-0">
        <p class="text-sm font-medium text-gray-300">{{ task.tokenUsed.toLocaleString() }} <span class="text-gray-500">/ {{ task.tokenBudget.toLocaleString() }}</span></p>
        <div class="w-32 bg-gray-700 rounded-full h-1.5 mt-1">
          <div :class="['h-1.5 rounded-full', tokenPercent > 80 ? 'bg-red-500' : 'bg-swarm-500']" :style="{ width: Math.min(tokenPercent, 100) + '%' }" />
        </div>
      </div>
    </div>

    <!-- Info Panel -->
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="px-4 py-3 rounded-lg bg-gray-800/50 border border-gray-700/50">
        <p class="text-xs text-gray-400">任务指令</p>
        <p class="text-sm text-gray-200 mt-1">{{ task.instruction || '暂无指令' }}</p>
      </div>
      <div class="px-4 py-3 rounded-lg bg-gray-800/50 border border-gray-700/50">
        <p class="text-xs text-gray-400">仓库</p>
        <p class="text-sm text-gray-200 mt-1 truncate">{{ task.repoUrl }}</p>
      </div>
    </div>

    <!-- PR Panel (reviewing/completed) -->
    <div v-if="task.prStatus !== 'none'" class="mb-4 px-4 py-3 rounded-lg bg-purple-500/5 border border-purple-500/20 space-y-3">
      <!-- PR Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <GitPullRequest class="w-4 h-4 text-purple-400" />
          <span class="text-sm font-medium text-purple-300">PR #{{ task.prNumber }}</span>
          <span
            :class="[
              'text-xs px-2 py-0.5 rounded-full',
              task.prStatus === 'open' ? 'bg-purple-500/10 text-purple-400' :
              task.prStatus === 'merged' ? 'bg-emerald-500/10 text-emerald-400' :
              'bg-red-500/10 text-red-400'
            ]"
          >
            {{ task.prStatus === 'open' ? 'Open' : task.prStatus === 'merged' ? 'Merged' : 'Closed' }}
          </span>
        </div>
        <div v-if="task.status === 'reviewing'" class="flex items-center gap-2">
          <button
            :disabled="!canMerge"
            :class="[
              'px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors',
              canMerge
                ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
            ]"
            :title="canMerge ? '全员审阅通过，可合并' : `需等待审阅通过 (${approvedCount}/${task.reviews.length})`"
            @click="emit('mergePr', task.id)"
          >
            <GitMerge class="w-3 h-3" /> 合并
          </button>
          <button
            class="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-medium flex items-center gap-1"
            @click="emit('rejectPr', task.id)"
          >
            <RotateCcw class="w-3 h-3" /> 打回
          </button>
        </div>
      </div>

      <!-- Review Progress -->
      <div v-if="task.reviews.length > 0 && task.status === 'reviewing'">
        <div class="flex items-center justify-between text-xs mb-1.5">
          <span class="text-gray-400">审阅进度</span>
          <span :class="approvedCount === task.reviews.length ? 'text-emerald-400' : 'text-gray-300'">
            {{ approvedCount }}/{{ task.reviews.length }} 通过
          </span>
        </div>
        <div class="w-full bg-gray-700/50 rounded-full h-1.5">
          <div
            :class="[
              'h-1.5 rounded-full transition-all',
              approvedCount === task.reviews.length ? 'bg-emerald-500' : 'bg-purple-500'
            ]"
            :style="{ width: (approvedCount / task.reviews.length * 100) + '%' }"
          />
        </div>
        <!-- Reviewer List -->
        <div class="mt-2 space-y-1.5">
          <div
            v-for="review in task.reviews"
            :key="review.reviewerTaskId"
            class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-gray-800/40 text-xs"
          >
            <div class="flex items-center gap-2">
              <Clock v-if="review.status === 'pending'" class="w-3.5 h-3.5 text-gray-500" />
              <CheckCircle v-else-if="review.status === 'approved'" class="w-3.5 h-3.5 text-emerald-400" />
              <XCircle v-else class="w-3.5 h-3.5 text-red-400" />
              <span class="text-gray-300">{{ review.reviewerName }}</span>
              <span v-if="review.reviewedAt" class="text-gray-600">{{ new Date(review.reviewedAt).toLocaleTimeString() }}</span>
            </div>
            <div v-if="review.status === 'pending'" class="flex items-center gap-1">
              <button
                class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                @click="emit('submitReview', task.id, review.reviewerTaskId, true)"
              >
                通过
              </button>
              <button
                class="px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                @click="emit('submitReview', task.id, review.reviewerTaskId, false)"
              >
                拒绝
              </button>
            </div>
            <span
              v-else :class="[
                'text-xs px-2 py-0.5 rounded-full',
                review.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
              ]"
            >
              {{ review.status === 'approved' ? '已通过' : '已拒绝' }}
            </span>
          </div>
        </div>
      </div>

      <a v-if="task.prUrl" :href="task.prUrl" target="_blank" class="text-xs text-gray-500 hover:text-swarm-400 block">{{ task.prUrl }}</a>
    </div>

    <!-- Action Panel (pending / ready / working) -->
    <div v-if="task.status === 'pending'" class="mb-4">
      <button
        class="w-full px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors flex items-center justify-center gap-2"
        @click="emit('start', task.id)"
      >
        <Play class="w-4 h-4" /> 启动任务（自动 clone + 启动 CLI）
      </button>
    </div>

    <div v-else-if="task.status === 'ready'" class="mb-4">
      <form class="flex gap-3" @submit.prevent="handleSendInstruction">
        <input
          v-model="instruction"
          type="text"
          placeholder="输入任务指令发送给 Agent..."
          class="flex-1 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-gray-100 placeholder-gray-500 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all"
        />
        <button
          type="submit"
          :disabled="!instruction.trim()"
          class="px-5 py-2.5 bg-swarm-600 text-white rounded-xl hover:bg-swarm-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
        >
          <Send class="w-4 h-4" /> 发送
        </button>
      </form>
    </div>

    <div v-else-if="task.status === 'working'" class="mb-4 flex items-center gap-3">
      <button
        class="flex-1 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors flex items-center justify-center gap-2"
        @click="emit('submitForReview', task.id)"
      >
        <GitPullRequest class="w-4 h-4" /> 提交审阅（推送分支 + 创建 PR）
      </button>
      <button
        class="px-4 py-2.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-medium flex items-center gap-2"
        @click="emit('stop', task.id)"
      >
        <Square class="w-4 h-4" /> 停止
      </button>
    </div>

    <!-- Changed Files -->
    <div v-if="task.changedFiles && task.changedFiles.length > 0" class="mb-4">
      <div class="flex items-center gap-2 mb-2">
        <FileCode class="w-3.5 h-3.5 text-swarm-400" />
        <span class="text-xs font-medium text-gray-400">文件变更 ({{ task.changedFiles.length }})</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="file in task.changedFiles"
          :key="file"
          class="px-2 py-1 rounded-md bg-gray-800/80 border border-gray-700/50 text-xs text-gray-300 hover:text-swarm-400 hover:border-swarm-500/30 transition-colors truncate max-w-[200px]"
          :title="file"
          @click="emit('showFileDiff', task.id, file)"
        >
          {{ file }}
        </button>
      </div>
    </div>

    <!-- Logs -->
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto scrollbar-thin rounded-xl bg-gray-900/50 border border-gray-800 p-4 space-y-2 min-h-0"
    >
      <div
        v-for="log in task.logs"
        :key="log.id"
        :class="['flex gap-3 p-2.5 rounded-lg border border-transparent hover:border-gray-700/50 transition-colors', logTypeConfig[log.type].bg]"
      >
        <component :is="logTypeConfig[log.type].icon" :class="['w-4 h-4 mt-0.5 shrink-0', logTypeConfig[log.type].color]" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-xs text-gray-500">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
            <span v-if="log.tokens" class="text-xs text-gray-600">{{ log.tokens }} tokens</span>
          </div>
          <p :class="['text-sm whitespace-pre-wrap break-words', log.type === 'error' ? 'text-red-300' : 'text-gray-300']">
            {{ log.content }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
