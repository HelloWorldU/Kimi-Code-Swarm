<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import {
  ArrowLeft, Send, Terminal, AlertCircle, CheckCircle, Play,
  GitPullRequest, GitMerge, RotateCcw, Square, Clock, XCircle, FileCode,
  User, Bot, Loader2, Brain, Wrench, Server,
  ChevronDown, ChevronRight
} from 'lucide-vue-next'
import type { AgentTask } from '../types'
import { getLastInput } from '../utils/getLastInput'
import { useSwarmStore } from '../store/useSwarmStore'

const props = withDefaults(defineProps<{
  agent: AgentTask
  /** 引擎是否已 restore 完毕；false 时禁用「启动/发送/停止」等向引擎发命令的按钮 */
  engineReady?: boolean
}>(), { engineReady: true })

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

const store = useSwarmStore()
const instruction = ref('')
const scrollRef = ref<HTMLDivElement>()

// Track whether user was near bottom *before* new content arrives.
// This fixes the race where scrollHeight grows but scrollTop stays stale,
// causing isNearBottom() to falsely return false after DOM update.
const userWasNearBottom = ref(true)

function onScroll() {
  userWasNearBottom.value = isNearBottom()
}

// Collapsible logs: expanded by default for none; stored as Set of log ids
const expandedLogIds = ref<Set<string>>(new Set())

function toggleLogExpand(logId: string) {
  const set = expandedLogIds.value
  if (set.has(logId)) {
    set.delete(logId)
  } else {
    set.add(logId)
  }
  expandedLogIds.value = new Set(set)
  // If user was at bottom, follow up after expand/collapse animation
  nextTick(() => {
    if (userWasNearBottom.value) {
      scrollToBottom(false)
    }
  })
}

function isLogExpanded(logId: string) {
  return expandedLogIds.value.has(logId)
}

const tokenPercent = computed(() => (props.agent.tokenUsed / props.agent.tokenBudget) * 100)
const approvedCount = computed(() => props.agent.reviews.filter((r) => r.status === 'approved').length)
const lastInput = computed(() => getLastInput(props.agent.logs))
const canMerge = computed(() => props.agent.reviews.length === 0 || props.agent.reviews.every((r) => r.status === 'approved'))

const statusText = computed(() => {
  const map: Record<string, string> = {
    pending: '待启动', cloning: '克隆中', ready: '就绪',
    working: '执行中', reviewing: '待审阅', completed: '已完成', stopped: '已停止',
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

const canSendMessage = computed(() => {
  return ['ready', 'stopped', 'completed'].includes(props.agent.status)
})

const isWorking = computed(() => props.agent.status === 'working')

function handleSendInstruction() {
  if (!instruction.value.trim()) return
  if (!props.engineReady) return
  if (!canSendMessage.value && !isWorking.value) return
  emit('sendInstruction', props.agent.id, instruction.value.trim())
  instruction.value = ''
  store.setDraftInput(props.agent.id, '')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSendInstruction()
  }
  // Shift+Enter 默认换行，不拦截
}

const NEAR_BOTTOM_THRESHOLD = 50

function isNearBottom(): boolean {
  if (!scrollRef.value) return true
  const el = scrollRef.value
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD
}

function scrollToBottom(smooth = false) {
  if (!scrollRef.value) return
  const el = scrollRef.value
  if (smooth) {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  } else {
    el.scrollTop = el.scrollHeight
  }
}

let resizeObserver: ResizeObserver | null = null
let scrollEl: HTMLDivElement | undefined

onMounted(() => {
  instruction.value = store.getDraftInput(props.agent.id)
  scrollEl = scrollRef.value
  scrollToBottom(false)

  scrollEl?.addEventListener('scroll', onScroll)

  if (scrollEl) {
    resizeObserver = new ResizeObserver(() => {
      if (userWasNearBottom.value) {
        scrollToBottom(false)
      }
    })
    resizeObserver.observe(scrollEl)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  scrollEl?.removeEventListener('scroll', onScroll)
  store.setDraftInput(props.agent.id, instruction.value)
})

watch(() => props.agent.id, async (newId, oldId) => {
  if (oldId) {
    store.setDraftInput(oldId, instruction.value)
  }
  instruction.value = store.getDraftInput(newId)
  userWasNearBottom.value = true
  await nextTick()
  scrollToBottom(false)
})

watch(() => props.agent.logs.length, async () => {
  await nextTick()
  if (userWasNearBottom.value) {
    scrollToBottom(false)
  }
})

// Also watch the last log's content for streaming append scenarios
// where logs.length does not change but content grows.
watch(() => props.agent.logs[props.agent.logs.length - 1]?.content, async () => {
  await nextTick()
  if (userWasNearBottom.value) {
    scrollToBottom(false)
  }
})

watch(() => props.agent.status, async () => {
  await nextTick()
  if (userWasNearBottom.value) {
    scrollToBottom(false)
  }
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="flex items-center gap-4 mb-4 shrink-0">
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
    <div class="grid grid-cols-2 gap-3 mb-3 shrink-0">
      <div class="px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-100">
        <p class="text-xs text-gray-500">任务指令</p>
        <p class="text-sm text-gray-700 mt-1">{{ lastInput || '暂无指令' }}</p>
      </div>
      <div class="px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-100">
        <p class="text-xs text-gray-500">仓库</p>
        <p class="text-sm text-gray-700 mt-1 truncate">{{ agent.repoUrl }}</p>
      </div>
    </div>

    <!-- PR Panel -->
    <div v-if="agent.prStatus !== 'none'" class="mb-3 px-4 py-3 rounded-lg bg-purple-50 border border-purple-100 space-y-3 shrink-0">
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
            title="打回 PR：清空审阅状态、切回就绪态等待你发送新指令；不会自动让 Agent 修改"
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
            <div class="flex items-center gap-2 min-w-0">
              <Clock v-if="review.status === 'pending'" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <CheckCircle v-else-if="review.status === 'approved'" class="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <AlertCircle v-else-if="review.status === 'failed'" class="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <XCircle v-else class="w-3.5 h-3.5 text-red-600 shrink-0" />
              <span class="text-gray-700 shrink-0">{{ review.reviewerName }}</span>
              <span v-if="review.status === 'failed' && review.failureReason" class="text-amber-600 truncate" :title="review.failureReason">
                — {{ review.failureReason }}
              </span>
              <span v-if="review.reviewedAt" class="text-gray-400 shrink-0">{{ new Date(review.reviewedAt).toLocaleTimeString() }}</span>
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
                'text-xs px-2 py-0.5 rounded-full shrink-0',
                review.status === 'approved' ? 'bg-emerald-50 text-emerald-600'
                : review.status === 'failed' ? 'bg-amber-50 text-amber-600'
                  : 'bg-red-50 text-red-600'
              ]"
              :title="review.status === 'failed' ? '自动审阅多次失败，需要人工处置（重试 / 改派 / 强制合并 / 打回）' : ''"
            >
              {{ review.status === 'approved' ? '已通过'
                : review.status === 'failed' ? `失败 (×${review.attempts ?? '?'})`
                  : '已拒绝' }}
            </span>
          </div>
        </div>
      </div>

      <a v-if="agent.prUrl" :href="agent.prUrl" target="_blank" class="text-xs text-gray-400 hover:text-swarm-600 block">{{ agent.prUrl }}</a>
    </div>

    <!-- Changed Files -->
    <div v-if="agent.changedFiles && agent.changedFiles.length > 0" class="mb-3 shrink-0">
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

    <!-- Chat Area -->
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto scrollbar-thin rounded-xl bg-gray-50/50 border border-gray-200 p-4 space-y-4 min-h-0"
    >
      <template v-if="agent.logs.length === 0">
        <div class="h-full flex flex-col items-center justify-center text-gray-400">
          <Bot class="w-10 h-10 mb-3 opacity-30" />
          <p class="text-sm">Agent 已就绪，开始对话吧</p>
        </div>
      </template>

      <template v-for="log in agent.logs" :key="log.id">
        <!-- User Message -->
        <div v-if="log.type === 'input'" class="flex justify-end animate-message-enter">
          <div class="flex items-end gap-2 max-w-[85%] min-w-0">
            <div class="bg-swarm-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-sm">
              <p class="text-sm whitespace-pre-wrap break-words leading-relaxed">{{ log.content }}</p>
              <div class="flex items-center justify-end gap-2 mt-1">
                <span v-if="log.tokens" class="text-[10px] opacity-60">{{ log.tokens }} tokens</span>
                <span class="text-[10px] opacity-60">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
              </div>
            </div>
            <div class="w-7 h-7 rounded-full bg-swarm-100 flex items-center justify-center shrink-0 mb-1">
              <User class="w-3.5 h-3.5 text-swarm-600" />
            </div>
          </div>
        </div>

        <!-- Agent Message -->
        <div v-else-if="log.type === 'output'" class="flex justify-start animate-message-enter">
          <div class="flex items-end gap-2 max-w-[85%] min-w-0">
            <div class="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mb-1">
              <Bot class="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div class="bg-white text-gray-800 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm border border-gray-100">
              <p class="text-sm whitespace-pre-wrap break-words leading-relaxed">{{ log.content }}</p>
              <div class="flex items-center gap-2 mt-1">
                <span class="text-[10px] text-gray-400">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Thinking Message -->
        <div v-else-if="log.type === 'think'" class="flex justify-start animate-message-enter">
          <div class="flex items-end gap-2 max-w-[85%] min-w-0">
            <div class="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mb-1">
              <Brain class="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div class="bg-amber-50 text-amber-800 rounded-2xl rounded-tl-sm shadow-sm border border-amber-100 min-w-0">
              <button
                class="w-full flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-amber-100/50 transition-colors rounded-2xl rounded-bl-sm"
                @click="toggleLogExpand(log.id)"
              >
                <span class="text-xs font-medium text-amber-600">Thinking</span>
                <ChevronRight v-if="!isLogExpanded(log.id)" class="w-3.5 h-3.5 text-amber-600 shrink-0 ml-2" />
                <ChevronDown v-else class="w-3.5 h-3.5 text-amber-600 shrink-0 ml-2" />
              </button>
              <div v-if="isLogExpanded(log.id)" class="px-4 pb-2.5">
                <p class="text-sm whitespace-pre-wrap break-words leading-relaxed">{{ log.content }}</p>
                <div class="flex items-center gap-2 mt-1">
                  <span class="text-[10px] text-amber-400">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Tool Call / MCP Message -->
        <div v-else-if="log.type === 'tool_call' || log.type === 'mcp'" class="flex justify-start animate-message-enter">
          <div class="flex items-end gap-2 max-w-[85%] min-w-0">
            <div class="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0 mb-1">
              <Wrench v-if="log.type === 'tool_call'" class="w-3.5 h-3.5 text-purple-600" />
              <Server v-else class="w-3.5 h-3.5 text-purple-600" />
            </div>
            <div class="bg-purple-50 text-purple-800 rounded-2xl rounded-tl-sm shadow-sm border border-purple-100 min-w-0">
              <button
                class="w-full flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-purple-100/50 transition-colors rounded-2xl rounded-bl-sm"
                @click="toggleLogExpand(log.id)"
              >
                <span class="text-xs font-medium text-purple-600">{{ log.type === 'mcp' ? 'MCP' : 'Tool Call' }}</span>
                <ChevronRight v-if="!isLogExpanded(log.id)" class="w-3.5 h-3.5 text-purple-600 shrink-0 ml-2" />
                <ChevronDown v-else class="w-3.5 h-3.5 text-purple-600 shrink-0 ml-2" />
              </button>
              <div v-if="isLogExpanded(log.id)" class="px-4 pb-2.5">
                <p class="text-sm whitespace-pre-wrap break-words leading-relaxed font-mono text-xs">{{ log.content }}</p>
                <div class="flex items-center gap-2 mt-1">
                  <span class="text-[10px] text-purple-400">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Tool Result Message -->
        <div v-else-if="log.type === 'tool_result'" class="flex justify-start animate-message-enter">
          <div class="flex items-end gap-2 max-w-[85%] min-w-0">
            <div class="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0 mb-1">
              <CheckCircle class="w-3.5 h-3.5 text-green-600" />
            </div>
            <div class="bg-green-50 text-green-800 rounded-2xl rounded-tl-sm shadow-sm border border-green-100 min-w-0">
              <button
                class="w-full flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-green-100/50 transition-colors rounded-2xl rounded-bl-sm"
                @click="toggleLogExpand(log.id)"
              >
                <span class="text-xs font-medium text-green-600">Tool Result</span>
                <ChevronRight v-if="!isLogExpanded(log.id)" class="w-3.5 h-3.5 text-green-600 shrink-0 ml-2" />
                <ChevronDown v-else class="w-3.5 h-3.5 text-green-600 shrink-0 ml-2" />
              </button>
              <div v-if="isLogExpanded(log.id)" class="px-4 pb-2.5">
                <p class="text-sm whitespace-pre-wrap break-words leading-relaxed font-mono text-xs">{{ log.content }}</p>
                <div class="flex items-center gap-2 mt-1">
                  <span class="text-[10px] text-green-400">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- System / Error Message -->
        <div v-else class="flex justify-center animate-message-enter">
          <div
            :class="[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs max-w-[90%]',
              log.type === 'error'
                ? 'bg-red-50 text-red-600 border border-red-100'
                : 'bg-gray-100 text-gray-500 border border-gray-200'
            ]"
          >
            <Terminal v-if="log.type === 'system'" class="w-3 h-3 shrink-0" />
            <AlertCircle v-else class="w-3 h-3 shrink-0" />
            <span class="whitespace-pre-wrap">{{ log.content }}</span>
          </div>
        </div>
      </template>

      <!-- Working Indicator -->
      <div v-if="agent.status === 'working'" class="flex justify-start">
        <div class="flex items-end gap-2">
          <div class="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <Bot class="w-3.5 h-3.5 text-blue-600" />
          </div>
          <div class="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm border border-gray-100">
            <div class="flex items-center gap-2">
              <Loader2 class="w-4 h-4 text-blue-500 animate-spin" />
              <span class="text-sm text-gray-500">Agent 正在执行中...</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Input Area -->
    <div class="shrink-0 mt-3 pt-3 border-t border-gray-200">
      <!-- Pending: Start Button -->
      <div v-if="agent.status === 'pending'">
        <button
          :disabled="!engineReady"
          :title="!engineReady ? '引擎启动中…' : ''"
          class="w-full px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-2"
          @click="emit('start', agent.id)"
        >
          <Play class="w-4 h-4" /> 启动 Agent（自动 clone + 启动 CLI）
        </button>
      </div>

      <!-- Cloning -->
      <div v-else-if="agent.status === 'cloning'" class="flex items-center justify-center gap-2 py-3 text-gray-500">
        <Loader2 class="w-4 h-4 animate-spin" />
        <span class="text-sm">正在克隆仓库，请稍候...</span>
      </div>

      <!-- Ready / Stopped / Completed: Chat Input -->
      <div v-else-if="canSendMessage">
        <form class="flex gap-2 items-end" @submit.prevent="handleSendInstruction">
          <textarea
            v-model="instruction"
            :placeholder="agent.status === 'stopped' ? 'Agent 已停止，发送消息将继续执行...' : '输入消息与 Agent 对话...'"
            rows="1"
            class="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-swarm-500 focus:ring-1 focus:ring-swarm-500/30 transition-all resize-none overflow-hidden leading-relaxed"
            @keydown="handleKeydown"
            @input="(e: Event) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = 'auto'
              target.style.height = target.scrollHeight + 'px'
            }"
          />
          <button
            type="submit"
            :disabled="!instruction.trim() || !engineReady"
            :title="!engineReady ? '引擎启动中…' : ''"
            class="px-5 py-2.5 bg-swarm-600 text-white rounded-xl hover:bg-swarm-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium shrink-0"
          >
            <Send class="w-4 h-4" /> 发送
          </button>
        </form>
        <!-- Action Toolbar -->
        <div v-if="agent.changedFiles && agent.changedFiles.length > 0 && agent.status !== 'completed'" class="flex items-center gap-2 mt-2">
          <button
            class="px-3 py-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors text-xs font-medium flex items-center gap-1"
            @click="emit('submitForReview', agent.id)"
          >
            <GitPullRequest class="w-3 h-3" /> 提交审阅
          </button>
        </div>
      </div>

      <!-- Working: Disabled Input + Stop -->
      <div v-else-if="agent.status === 'working'">
        <form class="flex gap-2 items-end" @submit.prevent>
          <textarea
            disabled
            placeholder="Agent 执行中，请等待完成后再发送..."
            rows="1"
            class="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-400 cursor-not-allowed resize-none overflow-hidden leading-relaxed"
          />
          <button
            type="button"
            :disabled="!engineReady"
            :title="!engineReady ? '引擎启动中…' : ''"
            class="px-4 py-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2 shrink-0"
            @click="emit('stop', agent.id)"
          >
            <Square class="w-4 h-4" /> 停止
          </button>
        </form>
        <div class="flex items-center gap-2 mt-2">
          <button
            class="px-3 py-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors text-xs font-medium flex items-center gap-1"
            @click="emit('submitForReview', agent.id)"
          >
            <GitPullRequest class="w-3 h-3" /> 提交审阅
          </button>
        </div>
      </div>

      <!-- Reviewing: No input -->
      <div v-else-if="agent.status === 'reviewing'" class="text-center py-3 text-gray-400 text-sm">
        当前处于审阅阶段，无法进行对话
      </div>
    </div>
  </div>
</template>
