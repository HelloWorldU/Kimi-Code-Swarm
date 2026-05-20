<script setup lang="ts">
import { computed } from 'vue'
import { Play, Square, GitPullRequest, Trash2, Clock, FolderGit, GitBranch } from 'lucide-vue-next'
import type { AgentTask } from '../types'
import { useConfirm } from '../composables/useConfirm'

const props = defineProps<{
  task: AgentTask
  isSelected: boolean
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'start', id: string): void
  (e: 'stop', id: string): void
  (e: 'delete', id: string): void
}>()

const { confirm } = useConfirm()

const statusConfig = {
  pending: { label: '待启动', color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-200', dot: 'bg-gray-400' },
  cloning: { label: '克隆中', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500 animate-pulse' },
  ready: { label: '就绪', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  working: { label: '工作中', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500 animate-pulse' },
  reviewing: { label: '待审阅', color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', dot: 'bg-purple-500' },
  completed: { label: '已完成', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  stopped: { label: '已停止', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500' },
  orphan: { label: '已失效', color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-300', dot: 'bg-gray-400' },
}

const prConfig = {
  none: { label: '未提 PR', color: 'text-gray-400' },
  open: { label: 'PR Open', color: 'text-purple-600' },
  merged: { label: '已合并', color: 'text-emerald-600' },
  closed: { label: '已关闭', color: 'text-red-600' },
}

const status = computed(() => statusConfig[props.task.status])
const pr = computed(() => prConfig[props.task.prStatus])
const tokenPercent = computed(() => (props.task.tokenUsed / props.task.tokenBudget) * 100)
const reviewProgress = computed(() => {
  if (props.task.status !== 'reviewing' || props.task.reviews.length === 0) return null
  const approved = props.task.reviews.filter(r => r.status === 'approved').length
  return { approved, total: props.task.reviews.length }
})

async function handleDelete() {
  const agent = props.task
  const workspace = agent.workspace || `E:/workspace/${agent.id}`
  const confirmed = await confirm({
    type: 'danger',
    title: `删除 Agent「${agent.name}」`,
    message: `其工作目录将被一并删除：\n${workspace}\n\n此操作不可撤销。`,
    confirmText: '确认删除',
    cancelText: '取消',
  })
  if (confirmed) {
    emit('delete', agent.id)
  }
}
</script>

<template>
  <div
    :class="[
      'relative rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md',
      isSelected
        ? 'bg-white border-swarm-300 ring-1 ring-swarm-200'
        : 'bg-white border-gray-200 hover:border-gray-300'
    ]"
    @click="emit('select', task.id)"
  >
    <div class="flex items-start justify-between mb-3">
      <div class="flex items-center gap-2">
        <div :class="['w-2 h-2 rounded-full', status.dot]" />
        <h3 class="font-semibold text-sm text-gray-900 truncate max-w-[140px]">{{ task.name }}</h3>
        <span
          v-if="reviewProgress" :class="[
            'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
            reviewProgress.approved === reviewProgress.total
              ? 'bg-emerald-50 text-emerald-600'
              : 'bg-purple-50 text-purple-600'
          ]"
        >
          {{ reviewProgress.approved }}/{{ reviewProgress.total }}
        </span>
      </div>
      <span :class="['text-xs px-2 py-0.5 rounded-full', status.bg, status.color, 'border', status.border]">
        {{ status.label }}
      </span>
    </div>

    <div class="space-y-1.5 mb-3 text-xs text-gray-400">
      <div class="flex items-center gap-1.5 truncate">
        <FolderGit class="w-3 h-3 shrink-0" />
        <span class="truncate">{{ task.workspace || '未分配' }}</span>
      </div>
      <div class="flex items-center gap-1.5 truncate">
        <GitBranch class="w-3 h-3 shrink-0" />
        <span class="truncate">{{ task.branch }}</span>
      </div>
      <div class="flex items-center gap-1.5">
        <GitPullRequest class="w-3 h-3 shrink-0" />
        <span :class="pr.color">{{ pr.label }}{{ task.prNumber ? ` #${task.prNumber}` : '' }}</span>
      </div>
    </div>

    <div class="space-y-2 mb-3">
      <div class="flex items-center justify-between text-xs">
        <span class="text-gray-400">Tokens</span>
        <span class="text-gray-700">{{ task.tokenUsed.toLocaleString() }} / {{ task.tokenBudget.toLocaleString() }}</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-1.5">
        <div
          :class="[
            'h-1.5 rounded-full transition-all',
            tokenPercent > 80 ? 'bg-red-500' : tokenPercent > 50 ? 'bg-amber-500' : 'bg-swarm-500'
          ]"
          :style="{ width: Math.min(tokenPercent, 100) + '%' }"
        />
      </div>
    </div>

    <div class="flex items-center gap-1" @click.stop>
      <button
        v-if="task.status === 'pending'"
        class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors text-xs font-medium"
        @click="emit('start', task.id)"
      >
        <Play class="w-3 h-3" /> 启动
      </button>
      <button
        v-else-if="task.status === 'working'"
        class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors text-xs font-medium"
        @click="emit('stop', task.id)"
      >
        <Square class="w-3 h-3" /> 停止
      </button>
      <button
        v-else-if="task.status === 'stopped'"
        class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-swarm-50 text-swarm-600 hover:bg-swarm-100 transition-colors text-xs font-medium"
        @click="emit('start', task.id)"
      >
        <Play class="w-3 h-3" /> 重启
      </button>
      <div
        v-else
        class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-gray-100 text-gray-400 text-xs font-medium"
      >
        <Clock class="w-3 h-3" /> {{ status.label }}
      </div>
      <button
        class="px-2 py-1.5 rounded-lg bg-gray-50 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
        @click="handleDelete"
      >
        <Trash2 class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>
