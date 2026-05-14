import { reactive } from 'vue'

export type ConfirmType = 'danger' | 'warning' | 'info'

interface ConfirmState {
  isOpen: boolean
  type: ConfirmType
  title: string
  message: string
  confirmText: string
  cancelText: string
  resolve: ((value: boolean) => void) | null
}

const state = reactive<ConfirmState>({
  isOpen: false,
  type: 'info',
  title: '',
  message: '',
  confirmText: '确认',
  cancelText: '取消',
  resolve: null,
})

export function useConfirm() {
  function confirm(options: {
    type?: ConfirmType
    title: string
    message?: string
    confirmText?: string
    cancelText?: string
  }): Promise<boolean> {
    return new Promise((resolve) => {
      state.type = options.type ?? 'info'
      state.title = options.title
      state.message = options.message ?? ''
      state.confirmText = options.confirmText ?? '确认'
      state.cancelText = options.cancelText ?? '取消'
      state.resolve = resolve
      state.isOpen = true
    })
  }

  function resolve(value: boolean) {
    state.isOpen = false
    state.resolve?.(value)
    state.resolve = null
  }

  return { state, confirm, resolve }
}
