import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('useConfirm', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('opens confirm dialog with default options', async () => {
    const { useConfirm } = await import('../../src/composables/useConfirm')
    const { state, confirm } = useConfirm()

    const promise = confirm({ title: 'Are you sure?' })

    expect(state.isOpen).toBe(true)
    expect(state.title).toBe('Are you sure?')
    expect(state.type).toBe('info')
    expect(state.message).toBe('')
    expect(state.confirmText).toBe('确认')
    expect(state.cancelText).toBe('取消')

    useConfirm().resolve(false)
    await expect(promise).resolves.toBe(false)
  })

  it('opens confirm dialog with custom options', async () => {
    const { useConfirm } = await import('../../src/composables/useConfirm')
    const { state, confirm } = useConfirm()

    const promise = confirm({
      type: 'danger',
      title: 'Delete?',
      message: 'This cannot be undone',
      confirmText: 'Delete',
      cancelText: 'Keep',
    })

    expect(state.isOpen).toBe(true)
    expect(state.title).toBe('Delete?')
    expect(state.type).toBe('danger')
    expect(state.message).toBe('This cannot be undone')
    expect(state.confirmText).toBe('Delete')
    expect(state.cancelText).toBe('Keep')

    useConfirm().resolve(true)
    await expect(promise).resolves.toBe(true)
  })

  it('closes dialog on resolve and returns value', async () => {
    const { useConfirm } = await import('../../src/composables/useConfirm')
    const { confirm, resolve } = useConfirm()

    const promise = confirm({ title: 'Test' })
    resolve(true)

    await expect(promise).resolves.toBe(true)
  })
})
