<script setup lang="ts">
import { computed } from 'vue'
import { Play, Square, RotateCcw, Trash2, Activity, Clock, Cpu } from 'lucide-vue-next'
import type { CliInstance } from '../types'

const props = defineProps<{
  instance: CliInstance
  isSelected: boolean
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'stop', id: string): void
  (e: 'restart', id: string): void
  (e: 'delete', id: string): void
}>()

const statusConfig = {
  running: { label: '运行中', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  idle: { label: '空闲', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', dot: 'bg-blue-400' },
  error: { label: '错误', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', dot: 'bg-red-400' },
  stopped: { label: '已停止', color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/30', dot: 'bg-gray-400' },
  queued: { label: '排队中', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', dot: 'bg-amber-400' },
}

const status = computed(() => statusConfig[props.instance.status])
const tokenPercent = computed(() => (props.instance.tokenUsed / props.instance.tokenLimit) * 100)
const runtimeMinutes = computed(() => Math.round((Date.now() - props.instance.createdAt.getTime()) / 60000))
</script>

<template>
  <div
    @click="emit('select', instance.id)"
    :class="[
      'relative rounded-xl border p-4 cursor-pointer transition-all hover:scale-[1.02]',
      isSelected
        ? 'bg-gray-800/80 border-swarm-500/50 ring-1 ring-swarm-500/30'
        : 'bg-gray-800/40 border-gray-700/50 hover:border-gray-600'
    ]"
  >
    <div class="flex items-start justify-between mb-3">
      <div class="flex items-center gap-2">
        <div :class="['w-2 h-2 rounded-full', status.dot, instance.status === 'running' ? 'animate-pulse' : '']" />
        <h3 class="font-semibold text-sm text-white truncate max-w-[140px]">{{ instance.name }}</h3>
      </div>
      <span :class="['text-xs px-2 py-0.5 rounded-full', status.bg, status.color, 'border', status.border]">
        {{ status.label }}
      </span>
    </div>

    <p class="text-xs text-gray-500 mb-3 truncate">{{ instance.taskDescription || '无任务描述' }}</p>

    <div class="space-y-2 mb-3">
      <div class="flex items-center justify-between text-xs">
        <span class="text-gray-500 flex items-center gap-1">
          <Activity class="w-3 h-3" /> Tokens
        </span>
        <span class="text-gray-300">{{ instance.tokenUsed.toLocaleString() }} / {{ instance.tokenLimit.toLocaleString() }}</span>
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

    <div class="flex items-center justify-between text-xs text-gray-500 mb-3">
      <span class="flex items-center gap-1">
        <Cpu class="w-3 h-3" /> PID: {{ instance.pid || '-' }}
      </span>
      <span class="flex items-center gap-1">
        <Clock class="w-3 h-3" /> {{ runtimeMinutes }}m
      </span>
    </div>

    <div class="flex items-center gap-1" @click.stop>
      <button
        v-if="instance.status === 'running'"
        @click="emit('stop', instance.id)"
        class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-medium"
      >
        <Square class="w-3 h-3" /> 停止
      </button>
      <button
        v-else-if="instance.status === 'stopped' || instance.status === 'error'"
        @click="emit('restart', instance.id)"
        class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-swarm-500/10 text-swarm-400 hover:bg-swarm-500/20 transition-colors text-xs font-medium"
      >
        <RotateCcw class="w-3 h-3" /> 重启
      </button>
      <button
        v-else
        class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-gray-700/50 text-gray-500 text-xs font-medium cursor-not-allowed"
      >
        <Play class="w-3 h-3" /> 等待中
      </button>
      <button
        @click="emit('delete', instance.id)"
        class="px-2 py-1.5 rounded-lg bg-gray-700/30 text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <Trash2 class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>
