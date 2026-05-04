import { describe, it, expect, vi, beforeEach } from 'vitest'

// NOTE: useSwarmStore uses a module-level reactive singleton.
// To make it testable in isolation, the store would need refactoring
// to accept an optional initial state. For now, we test the public
// API behavior and accept that tasks persist across tests.

describe('useSwarmStore (integration)', () => {
  // Dynamic import ensures fresh module evaluation attempts.
  // In practice Vue reactive singletons share state across imports.
  beforeEach(async () => {
    vi.resetModules()
  })

  it('creates a task with pending status', async () => {
    const { useSwarmStore } = await import('../../src/store/useSwarmStore')
    const store = useSwarmStore()
    const initialCount = store.tasks.value.length

    store.createTask('测试任务', 'https://github.com/owner/repo', '实现登录功能', 50000)

    expect(store.tasks.value.length).toBe(initialCount + 1)
    const created = store.tasks.value[store.tasks.value.length - 1]
    expect(created.name).toBe('测试任务')
    expect(created.status).toBe('pending')
    expect(created.reviews).toEqual([])
  })

  it('generates reviewers on submitForReview', async () => {
    const { useSwarmStore } = await import('../../src/store/useSwarmStore')
    const store = useSwarmStore()

    // Ensure at least two tasks exist so reviews can be generated
    store.createTask('任务A', 'https://github.com/owner/repo', '指令A', 50000)
    store.createTask('任务B', 'https://github.com/owner/repo', '指令B', 50000)

    const tasks = store.tasks.value
    const taskA = tasks[tasks.length - 2]
    const taskB = tasks[tasks.length - 1]

    // Manually set taskA to working so submitForReview can proceed
    taskA.status = 'working'
    taskA.workspace = '/mock/workspace'
    await store.submitForReview(taskA.id)

    expect(taskA.status).toBe('reviewing')
    expect(taskA.reviews.length).toBeGreaterThan(0)
    expect(taskA.reviews.some(r => r.reviewerTaskId === taskB.id)).toBe(true)
  })
})
