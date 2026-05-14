import { reactive } from 'vue'

export type ToastType = 'error' | 'success' | 'info' | 'warning'

export interface ToastItem {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
}

const toasts = reactive<ToastItem[]>([])

let idCounter = 0

export function useToast() {
  function add(toast: Omit<ToastItem, 'id'>) {
    const id = `toast-${++idCounter}`
    const item = { ...toast, id, duration: toast.duration ?? 5000 }
    toasts.push(item)

    if (item.duration > 0) {
      setTimeout(() => remove(id), item.duration)
    }
    return id
  }

  function remove(id: string) {
    const index = toasts.findIndex((t) => t.id === id)
    if (index > -1) toasts.splice(index, 1)
  }

  return { toasts, add, remove }
}
