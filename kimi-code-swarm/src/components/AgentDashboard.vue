<script setup lang="ts">
import { computed } from 'vue'
import { Activity, Users, Coins, CheckCircle, Bot } from 'lucide-vue-next'
import type { AgentTask } from '../types'
import TaskCard from './TaskCard.vue'

const props = defineProps<{
  agents: AgentTask[]
  canCreate: boolean
  maxAgents: number
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'create'): void
  (e: 'start', id: string): void
  (e: 'stop', id: string): void
  (e: 'delete', id: string): void
}>()

const activeCount = computed(() => props.agents.filter((a) => a.status === 'working' || a.status === 'cloning').length)
const completedCount = computed(() => props.agents.filter((a) => a.status === 'completed').length)
const totalTokens = computed(() => props.agents.reduce((sum, a) => sum + a.tokenUsed, 0))
const totalBudget = computed(() => props.agents.reduce((sum, a) => sum + a.tokenBudget, 0))

const statCards = computed(() => [
  {
    label: 'Agent 总数',
    value: `${props.agents.length} / ${props.maxAgents}`,
    sub: '最多同时运行 5 个',
    icon: Users,
    gradient: 'from-swarm-500 to-emerald-400',
    accent: 'bg-swarm-500',
    progress: props.maxAgents > 0 ? (props.agents.length / props.maxAgents) * 100 : 0,
  },
  {
    label: '活跃 Agent',
    value: activeCount.value.toString(),
    sub: '正在工作中',
    icon: Activity,
    gradient: 'from-amber-500 to-orange-400',
    accent: 'bg-amber-500',
    progress: props.agents.length > 0 ? (activeCount.value / Math.max(props.agents.length, 1)) * 100 : 0,
  },
  {
    label: '已完成',
    value: completedCount.value.toString(),
    sub: '累计交付',
    icon: CheckCircle,
    gradient: 'from-emerald-500 to-teal-400',
    accent: 'bg-emerald-500',
    progress: props.agents.length > 0 ? (completedCount.value / Math.max(props.agents.length, 1)) * 100 : 0,
  },
  {
    label: 'Token 消耗',
    value: `${(totalTokens.value / 1000).toFixed(1)}K`,
    sub: `预算 ${(totalBudget.value / 1000).toFixed(0)}K`,
    icon: Coins,
    gradient: 'from-blue-500 to-indigo-400',
    accent: 'bg-blue-500',
    progress: totalBudget.value > 0 ? (totalTokens.value / totalBudget.value) * 100 : 0,
  },
])
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Stats Grid -->
    <div class="grid grid-cols-4 gap-4 mb-6">
      <div
        v-for="stat in statCards"
        :key="stat.label"
        class="group relative bg-white border border-gray-200 rounded-2xl p-5 flex items-center gap-4 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 overflow-hidden"
      >
        <!-- Background gradient decoration -->
        <div
          class="absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-40 bg-gradient-to-br"
          :class="stat.gradient"
        />

        <!-- Icon -->
        <div
          class="relative w-12 h-12 rounded-xl flex items-center justify-center shadow-sm bg-gradient-to-br text-white shrink-0"
          :class="stat.gradient"
        >
          <component :is="stat.icon" class="w-6 h-6" />
        </div>

        <!-- Content -->
        <div class="relative flex-1 min-w-0">
          <p class="text-xs text-gray-400 font-medium mb-0.5">{{ stat.label }}</p>
          <p class="text-2xl font-bold text-gray-900 tracking-tight">{{ stat.value }}</p>
          <p class="text-[11px] text-gray-400 mt-0.5">{{ stat.sub }}</p>
        </div>

        <!-- Bottom progress accent -->
        <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-100">
          <div
            class="h-full rounded-full transition-all duration-700 ease-out"
            :class="stat.accent"
            :style="{ width: `${Math.min(stat.progress, 100)}%` }"
          />
        </div>
      </div>
    </div>

    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wider">Agent 列表</h3>
        <span class="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
          {{ agents.length }} / {{ maxAgents }}
        </span>
      </div>
      <div class="flex items-center gap-3 text-xs text-gray-400">
        <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-500" /> 工作中</span>
        <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-purple-500" /> 待审阅</span>
        <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-500" /> 已完成</span>
      </div>
    </div>

    <!-- Agents Grid -->
    <div class="flex-1 overflow-y-auto scrollbar-thin">
      <div v-if="agents.length === 0" class="h-full flex flex-col items-center justify-center text-gray-400">
        <div class="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
          <Bot class="w-10 h-10 text-gray-300" />
        </div>
        <p class="text-sm font-medium text-gray-500">还没有 Agent</p>
        <p class="text-xs mt-1.5 text-gray-400">点击右上角按钮创建你的第一个 Agent</p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 pb-4">
        <TaskCard
          v-for="agent in agents"
          :key="agent.id"
          :task="agent"
          :is-selected="false"
          @select="emit('select', $event)"
          @start="emit('start', $event)"
          @stop="emit('stop', $event)"
          @delete="emit('delete', $event)"
        />
      </div>
    </div>
  </div>
</template>
