import { describe, it, expect, vi, beforeEach } from 'vitest'

// NOTE: useSwarmStore uses a module-level reactive singleton.
// To make it testable in isolation, the store would need refactoring
// to accept an optional initial state. For now, we test the public
// API behavior and accept that agents persist across tests.

describe('useSwarmStore (integration)', () => {
  // Dynamic import ensures fresh module evaluation attempts.
  // In practice Vue reactive singletons share state across imports.
  beforeEach(async () => {
    vi.resetModules()
  })

  it('creates an agent with pending status', async () => {
    const { useSwarmStore } = await import('../../src/store/useSwarmStore')
    const store = useSwarmStore()
    const initialCount = store.agents.value.length

    store.createAgent('测试Agent', 'https://github.com/owner/repo', '实现登录功能', 50000)

    expect(store.agents.value.length).toBe(initialCount + 1)
    const created = store.agents.value[store.agents.value.length - 1]
    expect(created.name).toBe('测试Agent')
    expect(created.status).toBe('pending')
    expect(created.reviews).toEqual([])
  })

  it('generates reviewers on submitForReview', async () => {
    const { useSwarmStore } = await import('../../src/store/useSwarmStore')
    const store = useSwarmStore()

    // Ensure at least two agents exist so reviews can be generated
    store.createAgent('AgentA', 'https://github.com/owner/repo', '指令A', 50000)
    store.createAgent('AgentB', 'https://github.com/owner/repo', '指令B', 50000)

    const agents = store.agents.value
    const agentA = agents[agents.length - 2]
    const agentB = agents[agents.length - 1]

    // Manually set agentA to working so submitForReview can proceed
    agentA.status = 'working'
    agentA.workspace = '/mock/workspace'
    await store.submitForReview(agentA.id)

    expect(agentA.status).toBe('reviewing')
    expect(agentA.reviews.length).toBeGreaterThan(0)
    expect(agentA.reviews.some(r => r.reviewerTaskId === agentB.id)).toBe(true)
  })
})
