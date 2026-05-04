<script setup lang="ts">
import { computed } from 'vue'
import { Play, Square, GitPullRequest, Trash2, Clock, FolderGit, GitBranch } from 'lucide-vue-next'
import type { AgentTask } from '../types'

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

const statusConfig = {
  pending: { label: '待启动', color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/30', dot: 'bg-gray-400' },
  cloning: { label: '克隆中', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', dot: 'bg-blue-400 animate-pulse' },
  ready: { label: '就绪', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  working: { label: '工作中', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', dot: 'bg-amber-400 animate-pulse' },
  reviewing: { label: '待审阅', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30', dot: 'bg-purple-400' },
  completed: { label: '已完成', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  stopped: { label: '已停止', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', dot: 'bg-red-400' },
}

const prConfig = {
  none: { label: '未提 PR', color: 'text-gray-500' },
  open: { label: 'PR Open', color: 'text-purple-400' },
  merged: { label: '已合并', color: 'text-emerald-400' },
  closed: { label: '已关闭', color: 'text-red-400' },
}

const status = computed(() => statusConfig[props.task.status])
const pr = computed(() => prConfig[props.task.prStatus])
const tokenPercent = computed(() => (props.task.tokenUsed / props.task.tokenBudget) * 100)
const reviewProgress = computed(() => {
  if (props.task.status !== 'reviewing' || props.task.reviews.length === 0) return null
  const approved = props.task.reviews.filter(r => r.status === 'approved').length
  return { approved, total: props.task.reviews.length }
})
</script>

<template>
  <div
    :class="[
      'relative rounded-xl border p-4 cursor-pointer transition-all hover:scale-[1.02]',
      isSelected
        ? 'bg-gray-800/80 border-swarm-500/50 ring-1 ring-swarm-500/30'
        : 'bg-gray-800/40 border-gray-700/50 hover:border-gray-600'
    ]"
    @click="emit('select', task.id)"
  >
    <div class="flex items-start justify-between mb-3">
      <div class="flex items-center gap-2">
        <div :class="['w-2 h-2 rounded-full', status.dot]" />
        <h3 class="font-semibold text-sm text-white truncate max-w-[140px]">{{ task.name }}</h3>
        <span
          v-if="reviewProgress" :class="[
            'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
            reviewProgress.approved === reviewProgress.total
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-purple-500/10 text-purple-400'
          ]"
        >
          {{ reviewProgress.approved }}/{{ reviewProgress.total }}
        </span>
      </div>
      <span :class="['text-xs px-2 py-0.5 rounded-full', status.bg, status.color, 'border', status.border]">
        {{ status.label }}
      </span>
    </div>

    <div class="space-y-1.5 mb-3 text-xs text-gray-500">
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
        <span class="text-gray-500">Tokens</span>
        <span class="text-gray-300">{{ task.tokenUsed.toLocaleString() }} / {{ task.tokenBudget.toLocaleString() }}</span>
      </div>
      <div class="w-full bg-gray-700 rounded-full h-1.5">
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
        class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors text-xs font-medium"
        @click="emit('start', task.id)"
      >
        <Play class="w-3 h-3" /> 启动
      </button>
      <button
        v-else-if="task.status === 'working'"
        class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-medium"
        @click="emit('stop', task.id)"
      >
        <Square class="w-3 h-3" /> 停止
      </button>
      <button
        v-else-if="task.status === 'stopped'"
        class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-swarm-500/10 text-swarm-400 hover:bg-swarm-500/20 transition-colors text-xs font-medium"
        @click="emit('start', task.id)"
      >
        <Play class="w-3 h-3" /> 重启
      </button>
      <div
        v-else
        class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-gray-700/50 text-gray-500 text-xs font-medium"
      >
        <Clock class="w-3 h-3" /> {{ status.label }}
      </div>
      <button
        class="px-2 py-1.5 rounded-lg bg-gray-700/30 text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        @click="emit('delete', task.id)"
      >
        <Trash2 class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>
