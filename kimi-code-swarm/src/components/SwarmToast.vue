<script setup lang="ts">
import { X, AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-vue-next'
import { useToast, type ToastType } from '../composables/useToast'

const { toasts, remove } = useToast()

const config: Record<ToastType, { icon: typeof AlertCircle; color: string; bg: string; border: string; bar: string }> = {
  error: {
    icon: AlertCircle,
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    bar: 'bg-red-500',
  },
  success: {
    icon: CheckCircle2,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    bar: 'bg-emerald-500',
  },
  info: {
    icon: Info,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    bar: 'bg-blue-500',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    bar: 'bg-amber-500',
  },
}

function getConfig(type: ToastType) {
  return config[type]
}
</script>

<template>
  <div class="fixed top-4 right-4 z-[100] flex flex-col gap-3 pointer-events-none">
    <TransitionGroup
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="translate-x-8 opacity-0 scale-95"
      enter-to-class="translate-x-0 opacity-100 scale-100"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="translate-x-0 opacity-100 scale-100"
      leave-to-class="translate-x-8 opacity-0 scale-95"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto w-80 bg-white rounded-xl border shadow-lg overflow-hidden flex flex-col"
        :class="[getConfig(toast.type).border]"
      >
        <div class="flex items-start gap-3 p-4">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            :class="getConfig(toast.type).bg"
          >
            <component :is="getConfig(toast.type).icon" class="w-4 h-4" :class="getConfig(toast.type).color" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-gray-900">{{ toast.title }}</p>
            <p v-if="toast.message" class="text-xs text-gray-500 mt-0.5 leading-relaxed">{{ toast.message }}</p>
          </div>
          <button
            class="text-gray-300 hover:text-gray-600 transition-colors shrink-0 mt-0.5"
            @click="remove(toast.id)"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
        <!-- Progress bar -->
        <div class="h-0.5 w-full bg-gray-100">
          <div
            class="h-full"
            :class="getConfig(toast.type).bar"
            :style="{ animation: `shrink ${toast.duration}ms linear forwards`, width: '100%' }"
          />
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>
