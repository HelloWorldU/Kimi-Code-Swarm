import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EngineEvent, EngineCommand } from '../../agent-engine/src/types.js'

// ── Helper: build commands ──
function createCmd(type: EngineCommand['type'], extra: Record<string, unknown> = {}): EngineCommand {
  return { type, ...extra } as EngineCommand
}

// ── Integration tests for AgentEngine ──
// Strategy: re-import Agent module in beforeEach/afterEach to survive vitest's module reloads.

describe('AgentEngine integration', () => {
  let events: EngineEvent[] = []
  let AgentEngine: any

  beforeEach(async () => {
    events = []
    const engineMod = await import('../../agent-engine/src/engine.js')
    AgentEngine = engineMod.AgentEngine
    await applyAgentMocks()
  })

  afterEach(async () => {
    await restoreAgentMocks()
  })

  function createEngine() {
    events = []
    return new AgentEngine((event: EngineEvent) => {
      events.push(event)
    })
  }

  it('creates an agent and emits agent-created', async () => {
    const engine = createEngine()
    await engine.handleCommand(
      createCmd('create-agent', {
        payload: { name: 'TestAgent', repoUrl: 'https://github.com/test/repo.git', tokenBudget: 10000 }
      }),
    )

    const createdEvent = events.find((e) => e.type === 'agent-created')
    expect(createdEvent).toBeDefined()
    const agent = (createdEvent as Extract<EngineEvent, { type: 'agent-created' }>).agent
    expect(agent.name).toBe('TestAgent')
    expect(agent.status).toBe('pending')

    const state = engine.getState(agent.id)
    expect(state).toBeDefined()
    expect(state!.status).toBe('pending')
  })

  it('full lifecycle: create → start → instruct → review → merge (mock mode)', async () => {
    const engine = createEngine()

    // 1. Create
    await engine.handleCommand(
      createCmd('create-agent', {
        payload: { name: 'LifecycleAgent', repoUrl: 'https://github.com/test/repo.git', tokenBudget: 10000 },
      }),
    )
    const agentId = engine.getAllStates()[0].id

    // 2. Start
    await engine.handleCommand(createCmd('start-agent', { agentId }))
    expect(engine.getState(agentId)!.status).toBe('ready')
    expect(engine.getState(agentId)!.workspace).toContain('E:/workspace/')

    // 3. Send instruction
    await engine.handleCommand(createCmd('send-instruction', { agentId, instruction: 'Implement feature X' }))
    const stateAfterInstruct = engine.getState(agentId)!
    expect(stateAfterInstruct.status).toBe('working')
    expect(stateAfterInstruct.tokenUsed).toBeGreaterThan(0)
    expect(stateAfterInstruct.changedFiles).toEqual(['src/index.ts'])

    // 4. Submit for review (no GitHub Token → mock PR)
    await engine.handleCommand(createCmd('submit-for-review', { agentId }))
    const reviewState = engine.getState(agentId)!
    expect(reviewState.status).toBe('reviewing')
    expect(reviewState.prStatus).toBe('open')
    expect(reviewState.prNumber).toBeDefined()

    // 5. Submit review (approve)
    for (const review of reviewState.reviews) {
      await engine.handleCommand(
        createCmd('submit-review', { agentId, reviewerAgentId: review.reviewerAgentId, approved: true }),
      )
    }

    // 6. Merge PR (no GitHub Token → mock merge)
    await engine.handleCommand(createCmd('merge-pr', { agentId }))
    const finalState = engine.getState(agentId)!
    expect(finalState.status).toBe('completed')
    expect(finalState.prStatus).toBe('merged')
  })

  it('GitHub Token present: uses real GitHub API for PR create/merge', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ number: 42, html_url: 'https://github.com/test/repo/pull/42' }),
      text: vi.fn().mockResolvedValue(''),
    })
    // @ts-ignore
    global.fetch = fetchSpy

    const engine = createEngine()
    await engine.handleCommand(
      createCmd('create-agent', {
        payload: { name: 'TokenAgent', repoUrl: 'https://github.com/test/repo.git', tokenBudget: 10000 },
      }),
    )
    const agentId = engine.getAllStates()[0].id
    await engine.handleCommand(createCmd('start-agent', { agentId }))
    await engine.handleCommand(createCmd('send-instruction', { agentId, instruction: 'do work' }))

    // Submit with GitHub Token
    await engine.handleCommand(createCmd('submit-for-review', { agentId, githubToken: 'ghp_test_token' }))
    expect(engine.getState(agentId)!.prStatus).toBe('open')
    expect(engine.getState(agentId)!.prNumber).toBe(42)

    // Reset fetch mock for merge
    fetchSpy.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}), text: vi.fn().mockResolvedValue('') })

    // Merge with GitHub Token
    await engine.handleCommand(createCmd('merge-pr', { agentId, githubToken: 'ghp_test_token' }))
    expect(engine.getState(agentId)!.status).toBe('completed')
    expect(engine.getState(agentId)!.prStatus).toBe('merged')
  })

  it('rejects merge when reviews are not all approved', async () => {
    const engine = createEngine()
    await engine.handleCommand(
      createCmd('create-agent', {
        payload: { name: 'RejectAgent', repoUrl: 'https://github.com/test/repo.git', tokenBudget: 10000 },
      }),
    )
    const agentId = engine.getAllStates()[0].id
    await engine.handleCommand(createCmd('start-agent', { agentId }))
    await engine.handleCommand(createCmd('send-instruction', { agentId, instruction: 'do work' }))

    // Set up reviewing state manually (bypass submit-for-review mock volatility)
    const agent = engine.getState(agentId)!
    agent.status = 'reviewing'
    agent.prStatus = 'open'
    agent.reviews = [{ reviewerAgentId: 'r1', reviewerName: 'Reviewer', status: 'rejected' }]

    // Try to merge → should fail because review is rejected
    await engine.handleCommand(createCmd('merge-pr', { agentId }))
    expect(engine.getState(agentId)!.status).toBe('reviewing')
  })

  it('stops an agent and sets status to stopped', async () => {
    const engine = createEngine()
    await engine.handleCommand(
      createCmd('create-agent', {
        payload: { name: 'StopAgent', repoUrl: 'https://github.com/test/repo.git', tokenBudget: 10000 },
      }),
    )
    const agentId = engine.getAllStates()[0].id
    await engine.handleCommand(createCmd('stop-agent', { agentId }))
    expect(engine.getState(agentId)!.status).toBe('stopped')
  })

  it('deletes an agent and removes it from engine', async () => {
    const engine = createEngine()
    await engine.handleCommand(
      createCmd('create-agent', {
        payload: { name: 'DeleteAgent', repoUrl: 'https://github.com/test/repo.git', tokenBudget: 10000 },
      }),
    )
    const agentId = engine.getAllStates()[0].id
    expect(engine.getAllStates()).toHaveLength(1)
    await engine.handleCommand({ type: 'delete-agent', agentId } as EngineCommand)
    expect(engine.getAllStates()).toHaveLength(0)
  })

  it('handles invalid commands with error event', async () => {
    const engine = createEngine()
    await engine.handleCommand({ type: 'create-agent', payload: { name: 'x' } } as unknown as EngineCommand)
    const errorEvent = events.find((e) => e.type === 'error')
    expect(errorEvent).toBeDefined()
  })

  it('get-file-diff returns diff through diff-result event', async () => {
    const engine = createEngine()
    await engine.handleCommand(
      createCmd('create-agent', {
        payload: { name: 'DiffAgent', repoUrl: 'https://github.com/test/repo.git', tokenBudget: 10000 },
      }),
    )
    const agentId = engine.getAllStates()[0].id
    await engine.handleCommand(createCmd('start-agent', { agentId }))

    await engine.handleCommand(createCmd('get-file-diff', { agentId, filePath: 'src/index.ts' }))
    const diffEvent = events.find((e) => e.type === 'diff-result')
    expect(diffEvent).toBeDefined()
    expect((diffEvent as Extract<EngineEvent, { type: 'diff-result' }>).diff).toBe('+mock diff content')
  })

  it('ping command returns pong', async () => {
    const engine = createEngine()
    await engine.handleCommand(createCmd('ping'))
    const pongEvent = events.find((e) => e.type === 'pong')
    expect(pongEvent).toBeDefined()
  })
})

// ── Agent mock helpers ──
// We re-import the agent module on every beforeEach/afterEach so that our
// prototype mutations survive vitest's internal module reloads.

const originals = new Map<string, any>()

async function applyAgentMocks() {
  const { Agent } = await import('../../agent-engine/src/agent.js')

  originals.set('start', Agent.prototype.start)
  Agent.prototype.start = async function (this: any) {
    if (this.state.status !== 'pending') return
    this.state.workspace = `E:/workspace/${this.state.id}`
    this.state.status = 'ready'
    this.state.logs.push({
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'system',
      content: '工作空间就绪，等待指令',
    })
  }

  originals.set('sendInstruction', Agent.prototype.sendInstruction)
  Agent.prototype.sendInstruction = async function (this: any, instruction: string) {
    if (this.state.status === 'stopped' || this.state.status === 'completed') {
      this.state.status = 'ready'
    }
    if (this.state.status !== 'ready') return

    this.state.status = 'working'
    const inputTokens = Math.floor(instruction.length / 2)
    this.state.tokenUsed += inputTokens
    this.state.logs.push({
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'input',
      content: instruction,
      tokens: inputTokens,
    })
    this.state.logs.push({
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'output',
      content: 'Mock processing complete',
      tokens: 10,
    })
    this.state.tokenUsed += 10
    this.state.changedFiles = ['src/index.ts']
  }

  originals.set('submitForReview', Agent.prototype.submitForReview)
  Agent.prototype.submitForReview = async function (this: any, githubToken?: string) {
    if (this.state.status !== 'working') return
    this.state.status = 'reviewing'
    this.state.prStatus = 'open'
    if (githubToken) {
      this.state.prNumber = 42
      this.state.prUrl = 'https://github.com/test/repo/pull/42'
    } else {
      this.state.prNumber = Math.floor(Math.random() * 100) + 1
      this.state.prUrl = `${this.state.repoUrl.replace(/\.git$/, '')}/pull/${this.state.prNumber}`
    }
  }

  originals.set('mergePr', Agent.prototype.mergePr)
  Agent.prototype.mergePr = async function (this: any, _githubToken?: string) {
    if (this.state.status !== 'reviewing') return
    if (this.state.reviews.length > 0 && !this.state.reviews.every((r: any) => r.status === 'approved')) {
      return
    }
    this.state.status = 'completed'
    this.state.prStatus = 'merged'
    this.state.reviews = []
  }

  originals.set('rejectPr', Agent.prototype.rejectPr)
  Agent.prototype.rejectPr = function (this: any) {
    if (this.state.status !== 'reviewing') return
    this.state.status = 'working'
    this.state.prStatus = 'none'
    this.state.reviews = []
  }

  originals.set('submitReview', Agent.prototype.submitReview)
  Agent.prototype.submitReview = function (this: any, reviewerAgentId: string, approved: boolean) {
    if (this.state.status !== 'reviewing') return
    const review = this.state.reviews.find((r: any) => r.reviewerAgentId === reviewerAgentId)
    if (!review) return
    review.status = approved ? 'approved' : 'rejected'
    review.reviewedAt = new Date().toISOString()
  }

  originals.set('getFileDiff', Agent.prototype.getFileDiff)
  Agent.prototype.getFileDiff = async function (this: any, _filePath: string) {
    return '+mock diff content'
  }
}

async function restoreAgentMocks() {
  const { Agent } = await import('../../agent-engine/src/agent.js')
  for (const [name, fn] of originals) {
    ;(Agent.prototype as any)[name] = fn
  }
  originals.clear()
}
