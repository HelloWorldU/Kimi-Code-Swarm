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

const statCards = [
  { label: 'Agent 总数', value: () => `${props.agents.length} / ${props.maxAgents}`, sub: () => '最多同时运行 5 个', icon: Users, color: 'bg-swarm-600' },
  { label: '活跃 Agent', value: () => activeCount.value.toString(), sub: () => '正在工作中', icon: Activity, color: 'bg-amber-600' },
  { label: '已完成', value: () => completedCount.value.toString(), sub: () => '累计交付', icon: CheckCircle, color: 'bg-emerald-600' },
  { label: 'Token 消耗', value: () => `${(totalTokens.value / 1000).toFixed(1)}K`, sub: () => `预算 ${(totalBudget.value / 1000).toFixed(0)}K`, icon: Coins, color: 'bg-blue-600' },
]
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Stats Grid -->
    <div class="grid grid-cols-4 gap-4 mb-6">
      <div
        v-for="stat in statCards"
        :key="stat.label"
        class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4 flex items-center gap-4"
      >
        <div :class="['w-12 h-12 rounded-xl flex items-center justify-center', stat.color]">
          <component :is="stat.icon" class="w-6 h-6 text-white" />
        </div>
        <div>
          <p class="text-xs text-gray-500 font-medium">{{ stat.label }}</p>
          <p class="text-2xl font-bold text-white">{{ stat.value() }}</p>
          <p class="text-xs text-gray-500">{{ stat.sub() }}</p>
        </div>
      </div>
    </div>

    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">Agent 列表</h3>
        <span class="text-xs text-gray-600 bg-gray-800/60 px-2 py-0.5 rounded-full">
          {{ agents.length }} / {{ maxAgents }}
        </span>
      </div>
      <div class="flex items-center gap-2 text-xs text-gray-500">
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400" /> 工作中</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-purple-400" /> 待审阅</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-400" /> 已完成</span>
      </div>
    </div>

    <!-- Agents Grid -->
    <div class="flex-1 overflow-y-auto scrollbar-thin">
      <div v-if="agents.length === 0" class="h-full flex flex-col items-center justify-center text-gray-600">
        <Bot class="w-12 h-12 mb-3 opacity-30" />
        <p class="text-sm">还没有 Agent</p>
        <p class="text-xs mt-1">点击右上角按钮创建你的第一个 Agent</p>
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
