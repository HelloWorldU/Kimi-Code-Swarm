<script setup lang="ts">
import { computed } from 'vue'
import {
  ClipboardList, CheckCircle, Clock, AlertTriangle,
  GitPullRequest, Coins, Activity, TrendingUp,
} from 'lucide-vue-next'
import type { AgentTask } from '../types'

const props = defineProps<{
  tasks: AgentTask[]
}>()

const statusCounts = computed(() => {
  const counts: Record<string, number> = {}
  props.tasks.forEach(t => {
    counts[t.status] = (counts[t.status] || 0) + 1
  })
  return counts
})

const statusConfig = [
  { key: 'working', label: '工作中', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  { key: 'ready', label: '就绪', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  { key: 'reviewing', label: '待审阅', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  { key: 'completed', label: '已完成', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  { key: 'stopped', label: '已停止', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  { key: 'pending', label: '待启动', color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/20' },
]

const tokenRanking = computed(() => {
  return [...props.tasks]
    .sort((a, b) => b.tokenUsed - a.tokenUsed)
    .slice(0, 5)
})

const totalBudget = computed(() => props.tasks.reduce((s, t) => s + t.tokenBudget, 0))
const totalUsed = computed(() => props.tasks.reduce((s, t) => s + t.tokenUsed, 0))
const budgetPercent = computed(() => totalBudget.value > 0 ? (totalUsed.value / totalBudget.value) * 100 : 0)

const reviewingTasks = computed(() => props.tasks.filter(t => t.status === 'reviewing'))
const workingTasks = computed(() => props.tasks.filter(t => t.status === 'working'))
</script>

<template>
  <div class="h-full overflow-y-auto scrollbar-thin space-y-6">
    <!-- Overview Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
        <div class="flex items-center gap-2 mb-2">
          <ClipboardList class="w-4 h-4 text-swarm-400" />
          <span class="text-xs text-gray-400">总任务</span>
        </div>
        <p class="text-2xl font-bold text-white">{{ tasks.length }}</p>
      </div>
      <div class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
        <div class="flex items-center gap-2 mb-2">
          <Activity class="w-4 h-4 text-amber-400" />
          <span class="text-xs text-gray-400">活跃</span>
        </div>
        <p class="text-2xl font-bold text-white">{{ workingTasks.length }}</p>
      </div>
      <div class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
        <div class="flex items-center gap-2 mb-2">
          <CheckCircle class="w-4 h-4 text-emerald-400" />
          <span class="text-xs text-gray-400">已完成</span>
        </div>
        <p class="text-2xl font-bold text-white">{{ statusCounts['completed'] || 0 }}</p>
      </div>
      <div class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
        <div class="flex items-center gap-2 mb-2">
          <GitPullRequest class="w-4 h-4 text-purple-400" />
          <span class="text-xs text-gray-400">待审阅</span>
        </div>
        <p class="text-2xl font-bold text-white">{{ reviewingTasks.length }}</p>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Status Distribution -->
      <div class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-5">
        <h3 class="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <TrendingUp class="w-4 h-4 text-swarm-400" /> 任务状态分布
        </h3>
        <div class="space-y-2">
          <div
            v-for="cfg in statusConfig"
            :key="cfg.key"
            class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/40"
          >
            <div class="flex items-center gap-2">
              <span :class="['w-2 h-2 rounded-full', cfg.bg.replace('/10', '')]" />
              <span class="text-xs text-gray-300">{{ cfg.label }}</span>
            </div>
            <span :class="['text-sm font-medium', cfg.color]">{{ statusCounts[cfg.key] || 0 }}</span>
          </div>
        </div>
      </div>

      <!-- Token Consumption Ranking -->
      <div class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-5">
        <h3 class="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Coins class="w-4 h-4 text-swarm-400" /> Token 消耗排行
        </h3>
        <div class="space-y-3">
          <div v-for="task in tokenRanking" :key="task.id" class="space-y-1">
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-300 truncate max-w-[180px]">{{ task.name }}</span>
              <span class="text-gray-400">{{ task.tokenUsed.toLocaleString() }} / {{ task.tokenBudget.toLocaleString() }}</span>
            </div>
            <div class="w-full bg-gray-700 rounded-full h-1.5">
              <div
                :class="['h-1.5 rounded-full', (task.tokenUsed / task.tokenBudget) > 0.8 ? 'bg-red-500' : 'bg-swarm-500']"
                :style="{ width: Math.min((task.tokenUsed / task.tokenBudget) * 100, 100) + '%' }"
              />
            </div>
          </div>
          <div v-if="tokenRanking.length === 0" class="text-xs text-gray-500 text-center py-4">
            暂无任务数据
          </div>
        </div>

        <!-- Total Budget -->
        <div class="mt-4 pt-4 border-t border-gray-700/50">
          <div class="flex items-center justify-between text-xs mb-1.5">
            <span class="text-gray-400">总预算使用</span>
            <span :class="budgetPercent > 80 ? 'text-red-400' : 'text-gray-300'">
              {{ totalUsed.toLocaleString() }} / {{ totalBudget.toLocaleString() }}
            </span>
          </div>
          <div class="w-full bg-gray-700 rounded-full h-2">
            <div
              :class="['h-2 rounded-full', budgetPercent > 80 ? 'bg-red-500' : 'bg-swarm-500']"
              :style="{ width: Math.min(budgetPercent, 100) + '%' }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Active Tasks -->
    <div v-if="workingTasks.length > 0" class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-5">
      <h3 class="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        <Clock class="w-4 h-4 text-amber-400" /> 活跃任务
      </h3>
      <div class="space-y-2">
        <div
          v-for="task in workingTasks"
          :key="task.id"
          class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/40"
        >
          <div class="min-w-0">
            <p class="text-xs text-white truncate">{{ task.name }}</p>
            <p class="text-[10px] text-gray-500 truncate">{{ task.instruction }}</p>
          </div>
          <div class="text-right shrink-0">
            <p class="text-xs text-amber-400">{{ task.tokenUsed.toLocaleString() }} tokens</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Review Queue -->
    <div v-if="reviewingTasks.length > 0" class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-5">
      <h3 class="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        <GitPullRequest class="w-4 h-4 text-purple-400" /> 审阅队列
      </h3>
      <div class="space-y-2">
        <div
          v-for="task in reviewingTasks"
          :key="task.id"
          class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/40"
        >
          <div class="min-w-0">
            <p class="text-xs text-white truncate">{{ task.name }}</p>
            <p class="text-[10px] text-gray-500">PR #{{ task.prNumber }}</p>
          </div>
          <div class="text-right shrink-0">
            <p class="text-xs text-purple-400">
              {{ task.reviews.filter(r => r.status === 'approved').length }}/{{ task.reviews.length }} 通过
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- No Data -->
    <div v-if="tasks.length === 0" class="flex items-center justify-center py-20 text-gray-500">
      <div class="text-center">
        <AlertTriangle class="w-12 h-12 mx-auto mb-3 text-gray-700" />
        <p class="text-sm">暂无任务数据</p>
        <p class="text-xs mt-1">创建任务后将显示监控分析</p>
      </div>
    </div>
  </div>
</template>
