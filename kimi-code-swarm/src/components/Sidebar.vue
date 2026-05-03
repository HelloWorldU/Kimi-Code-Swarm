<script setup lang="ts">
import { Hexagon, LayoutDashboard, ClipboardList, BarChart3, Settings } from 'lucide-vue-next'

const props = defineProps<{
  activeTab: string
}>()

const emit = defineEmits<{
  (e: 'change', tab: string): void
}>()

const navItems = [
  { id: 'dashboard', label: '任务总览', icon: LayoutDashboard },
  { id: 'tasks', label: '任务管理', icon: ClipboardList },
  { id: 'analytics', label: '监控分析', icon: BarChart3 },
  { id: 'settings', label: '系统设置', icon: Settings },
]
</script>

<template>
  <aside class="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
    <div class="p-6 flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-swarm-600 flex items-center justify-center">
        <Hexagon class="w-6 h-6 text-white" />
      </div>
      <div>
        <h1 class="text-lg font-bold text-white tracking-tight">Kimi-Code-Swarm</h1>
        <p class="text-xs text-gray-500">本地 Agent 指挥中心</p>
      </div>
    </div>

    <nav class="flex-1 px-3 py-4 space-y-1">
      <button
        v-for="item in navItems"
        :key="item.id"
        :class="[
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
          props.activeTab === item.id
            ? 'bg-swarm-600/15 text-swarm-400 border border-swarm-600/30'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
        ]"
        @click="emit('change', item.id)"
      >
        <component :is="item.icon" class="w-5 h-5" />
        {{ item.label }}
      </button>
    </nav>

    <div class="p-4 border-t border-gray-800">
      <div class="bg-gray-800/50 rounded-lg p-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs text-gray-400">Plan</span>
          <span class="text-xs font-semibold text-swarm-400">小快板</span>
        </div>
        <div class="w-full bg-gray-700 rounded-full h-1.5">
          <div class="bg-swarm-500 h-1.5 rounded-full w-[23%]" />
        </div>
        <p class="text-xs text-gray-500 mt-2">46K / 200K tokens 今日</p>
      </div>
    </div>
  </aside>
</template>
