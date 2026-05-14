<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Info, AlertCircle, X } from 'lucide-vue-next'
import { useConfirm } from '../composables/useConfirm'

const { state, resolve } = useConfirm()

const config = computed(() => {
  switch (state.type) {
    case 'danger':
      return {
        icon: AlertTriangle,
        iconBg: 'bg-red-50',
        iconColor: 'text-red-600',
        confirmBg: 'bg-red-600 hover:bg-red-700',
        confirmText: 'text-white',
        border: 'border-red-200',
      }
    case 'warning':
      return {
        icon: AlertCircle,
        iconBg: 'bg-amber-50',
        iconColor: 'text-amber-600',
        confirmBg: 'bg-amber-600 hover:bg-amber-700',
        confirmText: 'text-white',
        border: 'border-amber-200',
      }
    default:
      return {
        icon: Info,
        iconBg: 'bg-blue-50',
        iconColor: 'text-blue-600',
        confirmBg: 'bg-swarm-600 hover:bg-swarm-700',
        confirmText: 'text-white',
        border: 'border-gray-200',
      }
  }
})
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-150"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div v-if="state.isOpen" class="fixed inset-0 z-[90] flex items-center justify-center">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="resolve(false)" />

      <!-- Modal -->
      <Transition
        enter-active-class="transition-all duration-300 ease-out"
        enter-from-class="opacity-0 scale-95 translate-y-2"
        enter-to-class="opacity-100 scale-100 translate-y-0"
        leave-active-class="transition-all duration-200 ease-in"
        leave-from-class="opacity-100 scale-100 translate-y-0"
        leave-to-class="opacity-0 scale-95 translate-y-2"
      >
        <div
          v-if="state.isOpen"
          class="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden border"
          :class="config.border"
        >
          <div class="p-6">
            <div class="flex items-start gap-4">
              <div
                class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                :class="config.iconBg"
              >
                <component :is="config.icon" class="w-5 h-5" :class="config.iconColor" />
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-base font-semibold text-gray-900">{{ state.title }}</h3>
                <p v-if="state.message" class="text-sm text-gray-500 mt-1 leading-relaxed whitespace-pre-line">
                  {{ state.message }}
                </p>
              </div>
              <button
                class="text-gray-300 hover:text-gray-600 transition-colors shrink-0"
                @click="resolve(false)"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
          </div>

          <div class="px-6 pb-6 flex items-center justify-end gap-3">
            <button
              class="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
              @click="resolve(false)"
            >
              {{ state.cancelText }}
            </button>
            <button
              :class="['px-4 py-2 rounded-lg text-sm font-medium transition-colors', config.confirmBg, config.confirmText]"
              @click="resolve(true)"
            >
              {{ state.confirmText }}
            </button>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>
