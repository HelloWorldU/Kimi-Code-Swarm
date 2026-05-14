import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('useToast', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  it('adds a toast with default duration', async () => {
    const { useToast } = await import('../../src/composables/useToast')
    const { toasts, add } = useToast()

    const id = add({ type: 'info', title: 'Hello' })

    expect(toasts.length).toBe(1)
    expect(toasts[0].id).toBe(id)
    expect(toasts[0].type).toBe('info')
    expect(toasts[0].title).toBe('Hello')
    expect(toasts[0].duration).toBe(5000)
  })

  it('adds a toast with custom duration', async () => {
    const { useToast } = await import('../../src/composables/useToast')
    const { toasts, add } = useToast()

    add({ type: 'success', title: 'Done', duration: 3000 })

    expect(toasts[0].duration).toBe(3000)
  })

  it('auto-removes toast after duration', async () => {
    const { useToast } = await import('../../src/composables/useToast')
    const { toasts, add } = useToast()

    add({ type: 'error', title: 'Oops', duration: 1000 })
    expect(toasts.length).toBe(1)

    vi.advanceTimersByTime(1000)
    expect(toasts.length).toBe(0)
  })

  it('removes toast manually', async () => {
    const { useToast } = await import('../../src/composables/useToast')
    const { toasts, add, remove } = useToast()

    const id = add({ type: 'warning', title: 'Careful' })
    expect(toasts.length).toBe(1)

    remove(id)
    expect(toasts.length).toBe(0)
  })

  it('does not throw when removing non-existent toast', async () => {
    const { useToast } = await import('../../src/composables/useToast')
    const { remove } = useToast()

    expect(() => remove('non-existent')).not.toThrow()
  })

  it('does not auto-remove when duration is 0', async () => {
    const { useToast } = await import('../../src/composables/useToast')
    const { toasts, add } = useToast()

    add({ type: 'info', title: 'Sticky', duration: 0 })
    expect(toasts.length).toBe(1)

    vi.advanceTimersByTime(10000)
    expect(toasts.length).toBe(1)
  })
})
