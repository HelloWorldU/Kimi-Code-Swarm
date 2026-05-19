import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── 把 kimi.js 整个 mock 掉，避免真的 spawn kimi 进程 ──
const mockRunKimi = vi.fn()
vi.mock('../../agent-engine/src/kimi.js', async () => {
  return {
    runKimi: mockRunKimi,
    detectKimiCli: vi.fn().mockResolvedValue('kimi'),
  }
})

// ── 伪造一个 spawned 进程 ──
function fakeProcess() {
  const handlers: Record<string, Array<(code: number | null) => void>> = {}
  return {
    pid: 12345,
    stdout: { [Symbol.asyncIterator]: async function* () {} },
    stderr: { [Symbol.asyncIterator]: async function* () {} },
    exitCode: null as number | null,
    signalCode: null as string | null,
    killed: false,
    once: vi.fn(),
    kill: vi.fn(),
    wait: () => {
      return new Promise<number | null>((resolve) => {
        if (!handlers['close']) handlers['close'] = []
        handlers['close'].push(resolve)
      })
    },
    _emitClose: (code: number | null) => {
      ;(handlers['close'] || []).forEach((cb) => cb(code))
    },
  }
}

// ── Test 1: 真实的 SESSION_RESUME_RE（从 agent.ts 导出，非副本）──
describe('SESSION_RESUME_RE（捕获 Kimi session id）', async () => {
  const { SESSION_RESUME_RE } = await import('../../agent-engine/src/agent.js')

  it('从标准 resume 提示里捕获 session id', () => {
    const m = SESSION_RESUME_RE.exec(
      'To resume this session: kimi -r 1ec1a250-9e90-4fd0-8ba3-722e71e6440d',
    )
    expect(m?.[1]).toBe('1ec1a250-9e90-4fd0-8ba3-722e71e6440d')
  })

  it('行内有其他噪音时仍能捕获', () => {
    const m = SESSION_RESUME_RE.exec(
      '[INFO] To resume this session: kimi -r 56d59f9b-19d5-473a-9f0d-1524b2275b79 trailing',
    )
    expect(m?.[1]).toBe('56d59f9b-19d5-473a-9f0d-1524b2275b79')
  })

  it('不匹配无关的 stderr 行', () => {
    for (const line of [
      '--- Logging error ---',
      'Traceback (most recent call last):',
      'Error: invalid session id',
    ]) {
      expect(SESSION_RESUME_RE.exec(line)).toBeNull()
    }
  })
})

// ── Test 2: sendInstruction 的 session / fallback prompt 选择 ──
describe('Agent.sendInstruction —— session 续接与 fallback prompt', async () => {
  const { Agent } = await import('../../agent-engine/src/agent.js')
  let agent: any

  beforeEach(() => {
    mockRunKimi.mockClear()
    agent = new Agent(
      'TestAgent',
      'https://github.com/test/repo.git',
      'initial instruction',
      10000,
      () => {},
    )
    agent.state.workspace = '/tmp/test-workspace'
    agent.state.status = 'ready'
  })

  it('无 session、无历史 → 只发指令本身，不带 sessionId', async () => {
    const proc = fakeProcess()
    mockRunKimi.mockReturnValue(proc)
    setTimeout(() => proc._emitClose(0), 10)

    await agent.sendInstruction('Implement feature X')

    const [, , prompt, options] = mockRunKimi.mock.calls[0]
    expect(prompt).toBe('Implement feature X')
    expect(options.sessionId).toBeUndefined()
    expect(options).toMatchObject({ streamJson: true, thinking: true })
  })

  it('有 session → 只发增量指令，并把 sessionId 传给 runKimi（-r 续接）', async () => {
    agent.state.kimiSessionId = 'test-session-uuid-1234'
    const proc = fakeProcess()
    mockRunKimi.mockReturnValue(proc)
    setTimeout(() => proc._emitClose(0), 10)

    await agent.sendInstruction('Now add tests')

    const [, , prompt, options] = mockRunKimi.mock.calls[0]
    expect(prompt).toBe('Now add tests')
    expect(options.sessionId).toBe('test-session-uuid-1234')
  })

  it('无 session、有历史 → fallback prompt 必须包含当前指令（Finding 1 回归）', async () => {
    // 注入一条历史 output 日志，让 buildContextPrompt 返回非空历史
    agent.state.logs.push({
      id: 'h1',
      timestamp: new Date().toISOString(),
      type: 'output',
      content: '上一轮的回复内容',
    })
    const proc = fakeProcess()
    mockRunKimi.mockReturnValue(proc)
    setTimeout(() => proc._emitClose(0), 10)

    await agent.sendInstruction('请继续修改 B 文件')

    const [, , prompt] = mockRunKimi.mock.calls[0]
    // 当前指令不能丢（修复前 prompt 只有历史、漏掉本轮指令）
    expect(prompt).toContain('请继续修改 B 文件')
    // 历史也应一并带上
    expect(prompt).toContain('上一轮的回复内容')
  })
})
