import { reactive, computed } from 'vue'
import type { AgentTask, ReviewEntry, LogEntry } from '../types'
import { createLogger } from '../utils/logger'
import { useToast } from '../composables/useToast'
import {
  isTauri,
  spawnAgentEngine,
  stopAgentEngine,
  sendToEngine,
  listenAgentEngineEvent,
  listenAgentEngineExit,
  saveApiKey,
  getApiKey,
  deleteApiKey,
  verifyKimiApiKey,
  loadStoreValue,
  saveStoreValue,
  isEngineRunning,
} from '../api/ipc'
import { getToken as getGitHubToken } from '../api/github'

const log = createLogger('SwarmStore')
const toast = useToast()

const MAX_AGENTS = 5
const STORE_KEY = 'agents'

// ── 持久化缓存：保存上次 localStorage 里的 agents，等 engine-restored 后
// 给「孤儿」补 entry、给 agent-created 拼回 logs（引擎不持久化 logs） ──
const persistedAgentsCache = new Map<string, AgentTask>()

// ── Bootstrap: check auth on load ──
let bootstrapped = false
async function bootstrap() {
  if (bootstrapped) return
  bootstrapped = true
  const key = await getApiKey()
  if (key) {
    state.isLoggedIn = true
    // Phase 1：不再把 persisted 直接塞 state.agents；引擎是事实源。
    // 缓存起来，等 engine-restored 后给「孤儿」补 entry、给 agent-created 拼回 logs。
    const persisted = await loadPersistedAgents()
    persistedAgentsCache.clear()
    for (const a of persisted) persistedAgentsCache.set(a.id, a)
    state.engineReady = false
    // Auto-start agent engine if logged in
    startAgentEngine()
  }
}

async function startAgentEngine() {
  if (!isTauri) return
  try {
    const running = await isEngineRunning()
    if (running) {
      // 引擎已存在（HMR / 多次 bootstrap）：仍需保证监听器注册，
      // 否则 engine-restored 已发出会被错过
      await initEngineListeners()
      return
    }
    // 必须先注册监听器再 spawn：引擎启动后立刻 emit engine-restored / pong，
    // 如果监听器晚于 spawn 注册，会错过 engine-restored，engineReady 永远 false
    await initEngineListeners()
    await spawnAgentEngine()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log.error('Failed to start agent engine:', e)
    toast.add({
      type: 'error',
      title: 'Agent 引擎启动失败',
      message: msg,
    })
  }
}

// ── Engine event listener ──
// 必须 async：listen() 是 Promise，没等它 resolve 就 spawn 引擎会丢启动期事件
// （engine-restored / pong 在 Node 进程起来后 ~100ms 内就 emit 到 stdout）
let engineListenersInitialized = false
async function initEngineListeners() {
  if (engineListenersInitialized) return
  engineListenersInitialized = true

  await listenAgentEngineEvent((payload) => {
    try {
      const event = JSON.parse(payload.line)
      handleEngineEvent(event)
    } catch {
      // engine 可能输出非 JSON 行（如 console.log），属于正常噪音，无需处理
    }
  })

  await listenAgentEngineExit(() => {
    engineListenersInitialized = false
    state.engineConnected = false
    // 引擎崩了 → 必须把 engineReady 也置 false，否则按钮门控会失效
    state.engineReady = false
  })
}

function handleEngineEvent(event: Record<string, unknown>) {
  const type = event.type as string

  switch (type) {
    case 'agent-created': {
      const agent = event.agent as AgentTask
      // 引擎不持久化 logs；如果 localStorage 有缓存就拼回
      if ((!agent.logs || agent.logs.length === 0) && persistedAgentsCache.has(agent.id)) {
        agent.logs = persistedAgentsCache.get(agent.id)!.logs ?? []
      }
      // 去重：已存在则替换（restore 时引擎对每个恢复的 agent 都 emit 一次，避免重复 push）
      const i = state.agents.findIndex((a) => a.id === agent.id)
      if (i >= 0) state.agents[i] = agent
      else state.agents.push(agent)
      persistAgents()
      break
    }
    case 'engine-restored': {
      state.engineReady = true
      const restored = new Set((event.restoredAgentIds as string[]) ?? [])
      // localStorage 里有、引擎没恢复 → 孤儿（用户手删了 engine-state.json，或别的什么）
      for (const cached of persistedAgentsCache.values()) {
        if (restored.has(cached.id)) continue
        if (state.agents.find((a) => a.id === cached.id)) continue
        state.agents.push({ ...cached, status: 'orphan' })
      }
      persistAgents()
      break
    }
    case 'agent-output': {
      // Raw stdout line — engine now streams structured chunks via agent-stream,
      // so no-op here to avoid duplicate rendering.
      break
    }
    case 'agent-stream': {
      const agent = state.agents.find((a) => a.id === event.agentId)
      if (!agent) return
      const chunk = event.chunk as { type: string; content?: string; name?: string; arguments?: string }
      if (chunk.type === 'text' && chunk.content) {
        const lastLog = agent.logs[agent.logs.length - 1]
        if (lastLog && lastLog.type === 'output') {
          lastLog.content += chunk.content
        } else {
          agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'output', content: chunk.content })
        }
      } else if (chunk.type === 'think' && chunk.content) {
        const lastLog = agent.logs[agent.logs.length - 1]
        if (lastLog && lastLog.type === 'think') {
          lastLog.content += chunk.content
        } else {
          agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'think', content: chunk.content })
        }
      } else if (chunk.type === 'tool_call' || chunk.type === 'mcp') {
        const display = chunk.name
          ? `${chunk.name}(${chunk.arguments || '{}'})`
          : String(chunk.content || '')
        agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: chunk.type as LogEntry['type'], content: display })
      } else if (chunk.type === 'tool_result' && chunk.content) {
        agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'tool_result', content: chunk.content })
      }
      agent.lastActivity = new Date().toISOString()
      break
    }
    case 'agent-exit': {
      // Phase 3：业务字段（status/pid）以引擎事实源为准；本 case 仍补一条用户可见
      // 的「执行完毕/进程退出」日志，所以需要 persist 把 logs 落盘。
      const agent = state.agents.find((a) => a.id === event.agentId)
      if (!agent) return
      agent.pid = undefined
      if (agent.status === 'working') {
        agent.status = 'ready'
        agent.logs.push({
          id: generateId(),
          timestamp: new Date().toISOString(),
          type: 'system',
          content: event.code === 0
            ? 'Agent 执行完毕，可以继续发送指令或提交审阅'
            : `Agent 进程退出 (code: ${event.code ?? 'unknown'})`,
        })
        persistAgents()
      }
      break
    }
    case 'agent-status': {
      // Phase 3：纯业务字段事件 → 不落盘（引擎已写 engine-state.json）
      const agent = state.agents.find((a) => a.id === event.agentId)
      if (agent) agent.status = event.status as AgentTask['status']
      break
    }
    case 'agent-state': {
      // Phase 3：纯业务字段事件 → 不落盘（引擎已写 engine-state.json）
      const agent = state.agents.find((a) => a.id === event.agentId)
      if (!agent) break
      const incoming = event.state as Record<string, unknown>
      if (incoming.status !== undefined) agent.status = incoming.status as AgentTask['status']
      if (incoming.workspace !== undefined) agent.workspace = String(incoming.workspace)
      if (incoming.branch !== undefined) agent.branch = String(incoming.branch)
      if (incoming.prStatus !== undefined) agent.prStatus = incoming.prStatus as AgentTask['prStatus']
      if (incoming.prNumber !== undefined) agent.prNumber = Number(incoming.prNumber)
      if (incoming.prUrl !== undefined) agent.prUrl = String(incoming.prUrl)
      if (incoming.pid !== undefined) agent.pid = Number(incoming.pid)
      if (incoming.tokenUsed !== undefined) agent.tokenUsed = Number(incoming.tokenUsed)
      if (incoming.lastActivity !== undefined) agent.lastActivity = String(incoming.lastActivity)
      if (Array.isArray(incoming.reviews)) {
        agent.reviews = incoming.reviews.map((r: Record<string, unknown>) => ({
          reviewerTaskId: String(r.reviewerTaskId ?? r.reviewerAgentId),
          reviewerName: String(r.reviewerName),
          status: r.status as ReviewEntry['status'],
          comment: r.comment ? String(r.comment) : undefined,
          reviewedAt: r.reviewedAt ? String(r.reviewedAt) : undefined,
        }))
      }
      if (Array.isArray(incoming.changedFiles)) {
        agent.changedFiles = incoming.changedFiles.map(String)
      }
      if (incoming.kimiSessionId !== undefined) {
        agent.kimiSessionId = String(incoming.kimiSessionId)
      }
      break
    }
    case 'log': {
      const agent = state.agents.find((a) => a.id === event.agentId)
      if (agent) {
        agent.logs.push(event.entry as AgentTask['logs'][0])
        agent.lastActivity = new Date().toISOString()
        persistAgents()
      }
      break
    }
    case 'file-changed': {
      // Phase 3：changedFiles 是业务字段 → 不落盘
      const agent = state.agents.find((a) => a.id === event.agentId)
      if (agent) agent.changedFiles = event.files as string[]
      break
    }
    case 'diff-result': {
      const diffAgent = state.agents.find((a) => a.id === event.agentId)
      if (diffAgent) {
        diffAgent.logs.push({
          id: generateId(),
          timestamp: new Date().toISOString(),
          type: 'system',
          content: `=== ${event.filePath} ===\n${event.diff || '无变更内容'}`,
        })
        persistAgents()
      }
      break
    }
    case 'pong': {
      state.engineConnected = true
      break
    }
    case 'error': {
      log.error('Agent engine error:', event.message)
      toast.add({
        type: 'error',
        title: 'Agent 引擎错误',
        message: String(event.message || '未知错误'),
      })
      break
    }
  }
}

// ── Persistence ──
// Phase 3：前端只持久化 logs + 身份/UI 必要的最小元数据（id/name/repoUrl/branch
// /createdAt/lastActivity/tokenBudget）。业务字段（status / pr* / kimiSessionId /
// reviews / changedFiles / tokenUsed 等）一律由引擎 `engine-state.json` 推回，
// 前端不再做双源。orphan 卡片复用这份 slim 数据展示标识/分支/时间。
interface PersistedAgentSlim {
  id: string
  name: string
  repoUrl: string
  branch: string
  createdAt: string
  lastActivity: string
  tokenBudget: number
  logs: LogEntry[]
}

async function persistAgents() {
  const slim: PersistedAgentSlim[] = state.agents.map((a) => ({
    id: a.id,
    name: a.name,
    repoUrl: a.repoUrl,
    branch: a.branch,
    createdAt: a.createdAt,
    lastActivity: a.lastActivity,
    tokenBudget: a.tokenBudget,
    logs: a.logs,
  }))
  await saveStoreValue(STORE_KEY, { agents: slim })
}

async function loadPersistedAgents(): Promise<AgentTask[]> {
  // 兼容旧数据：旧版存的是完整 AgentTask，新版是 slim；只读 slim 字段，多余字段忽略。
  const data = await loadStoreValue<{ agents: Partial<AgentTask>[] }>(STORE_KEY)
  if (!data || !data.agents) return []
  return data.agents.map((a) => ({
    id: String(a.id),
    name: String(a.name ?? ''),
    repoUrl: String(a.repoUrl ?? ''),
    branch: String(a.branch ?? ''),
    createdAt: typeof a.createdAt === 'string' ? a.createdAt : new Date().toISOString(),
    lastActivity: typeof a.lastActivity === 'string' ? a.lastActivity : new Date().toISOString(),
    tokenBudget: typeof a.tokenBudget === 'number' && a.tokenBudget > 0 ? a.tokenBudget : 1,
    logs: a.logs ?? [],
    // 业务字段默认值——以引擎 restore 推送的 agent-state / agent-created 为准；
    // orphan 卡（引擎没认领）也用这份默认值，TaskCard 按 status='orphan' 灰显
    status: 'pending' as const,
    workspace: '',
    prStatus: 'none' as const,
    tokenUsed: 0,
    reviews: [],
  }))
}

const generateId = () => Math.random().toString(36).substring(2, 10)

// ── Global reactive state ──
const state = reactive({
  agents: [] as AgentTask[],
  selectedAgentId: null as string | null,
  isCreateModalOpen: false,
  isLoggedIn: false,
  isAuthLoading: false,
  authError: '',
  engineConnected: false,
  // 引擎是否已 restore 完毕：bootstrap/login 后置 false，
  // 收到 engine-restored 事件后置 true；UI 可据此禁掉「发送/创建/删除」按钮
  engineReady: false,
})

bootstrap()

// ── Browser mock mode: simulate token consumption ──
if (!isTauri) {
  setInterval(() => {
    state.agents.forEach((a) => {
      if (a.status === 'working') {
        // 基于最近 input log 长度估算工作期间的 token 消耗，避免纯随机
        const lastInput = a.logs.slice().reverse().find((l) => l.type === 'input')
        const base = lastInput ? Math.floor(lastInput.content.length / 4) : 0
        const increment = Math.max(5, Math.floor(base * 0.1) + Math.floor(Math.random() * 10))
        a.tokenUsed = Math.min(a.tokenUsed + increment, a.tokenBudget)
        a.lastActivity = new Date().toISOString()
      }
    })
  }, 5000)
}

export function useSwarmStore() {
  const stats = computed(() => ({
    totalAgents: state.agents.length,
    activeAgents: state.agents.filter((a) => a.status === 'working' || a.status === 'cloning').length,
    completedAgents: state.agents.filter((a) => a.status === 'completed').length,
    totalTokensUsed: state.agents.reduce((sum, a) => sum + a.tokenUsed, 0),
    totalTokenBudget: state.agents.reduce((sum, a) => sum + a.tokenBudget, 0),
  }))

  const selectedAgent = computed(() =>
    state.agents.find((a) => a.id === state.selectedAgentId) || null
  )

  const canCreateAgent = computed(() => state.agents.length < MAX_AGENTS)

  // ── Auth ──
  async function login(apiKey: string) {
    state.isAuthLoading = true
    state.authError = ''
    try {
      const result = await verifyKimiApiKey(apiKey)
      if (!result.valid) {
        state.authError = result.error || 'API Key 验证失败'
        state.isAuthLoading = false
        return false
      }
      await saveApiKey(apiKey)
      state.isLoggedIn = true
      // 同 bootstrap：不直接塞 state.agents；引擎是事实源
      const persisted = await loadPersistedAgents()
      persistedAgentsCache.clear()
      for (const a of persisted) persistedAgentsCache.set(a.id, a)
      state.engineReady = false
      await startAgentEngine()
      state.isAuthLoading = false
      return true
    } catch (e) {
      log.error('Login failed:', e)
      state.authError = `登录错误: ${String(e)}`
      state.isAuthLoading = false
      return false
    }
  }

  async function logout() {
    // 1. Stop the agent engine first
    try {
      await stopAgentEngine()
    } catch (e) {
      log.error('Failed to stop engine during logout:', e)
    }
    // 2. Delete API key from keyring
    try {
      await deleteApiKey()
    } catch (e) {
      log.error('Failed to delete API key during logout:', e)
    }
    // 3. Phase 3 后不再清空 store：引擎 engine-state.json 是业务字段事实源，
    //    store 只缓存 slim+logs（logs 引擎不存）。退登清掉 = 重登看不到历史对话。
    //    退登只需停引擎 + 删 API Key + reset 内存态 + reload，store 留着供下次登录续看。
    // 4. Reset all reactive state
    state.isLoggedIn = false
    state.agents = []
    state.selectedAgentId = null
    state.authError = ''
    state.engineConnected = false
    state.engineReady = false
    persistedAgentsCache.clear()
    // 5. Reset bootstrap flags so next login re-initializes
    bootstrapped = false
    engineListenersInitialized = false
    // 6. Force page reload to ensure clean slate
    if (isTauri) {
      window.location.reload()
    }
  }

  // ── Agent CRUD (delegated to Node.js engine) ──
  function createAgent(name: string, repoUrl: string, tokenBudget: number) {
    if (state.agents.length >= MAX_AGENTS) return
    if (!isTauri) {
      // Browser mock mode: create directly
      const newAgent: AgentTask = {
        id: `agent-${generateId()}`,
        name,
        status: 'pending',
        repoUrl,
        workspace: '',
        branch: `agent/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${generateId().slice(0, 4)}`,
        prStatus: 'none',
        tokenUsed: 0,
        tokenBudget,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        logs: [{ id: generateId(), timestamp: new Date().toISOString(), type: 'system', content: 'Agent 已创建（模拟模式）' }],
        reviews: [],
      }
      state.agents.push(newAgent)
      persistAgents()
      return
    }
    sendToEngine({
      type: 'create-agent',
      payload: { name, repoUrl, tokenBudget },
    }).catch((e) => {
      log.error('createAgent failed:', e)
      toast.add({
        type: 'error',
        title: '创建 Agent 失败',
        message: `${e instanceof Error ? e.message : String(e)}\n可能原因: Agent 引擎未启动。请检查终端日志。`,
      })
    })
  }

  function deleteAgent(id: string) {
    if (!isTauri) {
      state.agents = state.agents.filter((a) => a.id !== id)
      if (state.selectedAgentId === id) state.selectedAgentId = null
      persistAgents()
      return
    }
    sendToEngine({ type: 'delete-agent', agentId: id })
    state.agents = state.agents.filter((a) => a.id !== id)
    if (state.selectedAgentId === id) state.selectedAgentId = null
    persistAgents()
  }

  async function startAgent(id: string) {
    if (!isTauri) {
      const agent = state.agents.find((a) => a.id === id)
      if (!agent) return
      agent.status = 'ready'
      agent.workspace = `E:/workspace/${agent.id}`
      agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'system', content: '模拟：Agent 已就绪' })
      persistAgents()
      return
    }
    try {
      log.info('Sending start-agent command for', id)
      await sendToEngine({ type: 'start-agent', agentId: id })
    } catch (e) {
      log.error('Failed to send start-agent command:', e)
      const agent = state.agents.find((a) => a.id === id)
      if (agent) {
        agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'error', content: `启动失败: ${e instanceof Error ? e.message : String(e)}` })
        persistAgents()
      }
      toast.add({
        type: 'error',
        title: '启动 Agent 失败',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  function sendInstruction(id: string, instruction: string) {
    if (!isTauri) {
      const agent = state.agents.find((a) => a.id === id)
      if (!agent) return
      // Allow continuing conversation from stopped or completed state
      if (agent.status === 'stopped' || agent.status === 'completed') {
        agent.status = 'ready'
        agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'system', content: 'Agent 已恢复，继续对话' })
      }
      agent.status = 'working'
      agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'input', content: instruction, tokens: Math.floor(instruction.length / 2) })
      agent.tokenUsed += Math.floor(instruction.length / 2)
      agent.lastActivity = new Date().toISOString()
      setTimeout(() => {
        agent.status = 'ready'
        const outputContent = '模拟执行完成。在 Tauri 桌面模式下将调用真实 Kimi CLI。'
        const outputTokens = Math.floor(outputContent.length / 2)
        agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'output', content: outputContent, tokens: outputTokens })
        agent.tokenUsed += outputTokens
        persistAgents()
      }, 3000)
      persistAgents()
      return
    }
    sendToEngine({ type: 'send-instruction', agentId: id, instruction, githubToken: getGitHubToken() || undefined })
  }

  async function stopAgent(id: string) {
    const agent = state.agents.find((a) => a.id === id)
    if (!agent) return

    // 乐观更新：立即改 UI 状态，不再等待后端确认
    const previousStatus = agent.status
    agent.status = 'stopped'
    agent.pid = undefined
    agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'system', content: 'Agent 已停止' })
    persistAgents()

    if (!isTauri) return

    try {
      await sendToEngine({ type: 'stop-agent', agentId: id })
    } catch (err) {
      log.error('停止 Agent 失败:', err)
      // 后端调用失败时恢复状态
      agent.status = previousStatus
      persistAgents()
      toast.add({
        type: 'error',
        title: '停止 Agent 失败',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  function submitForReview(id: string) {
    const token = getGitHubToken()
    if (!isTauri) {
      const agent = state.agents.find((a) => a.id === id)
      if (!agent || agent.status !== 'working') return
      const reviewers: ReviewEntry[] = state.agents
        .filter((a) => a.id !== agent.id)
        .map((a) => ({
          reviewerTaskId: a.id,
          reviewerName: a.name,
          status: 'pending' as const,
        }))
      agent.reviews = reviewers
      agent.status = 'reviewing'
      agent.prStatus = 'open'
      agent.prNumber = Math.floor(Math.random() * 100) + 1
      agent.prUrl = `${agent.repoUrl.replace(/\.git$/, '')}/pull/${agent.prNumber}`
      agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'system', content: `PR #${agent.prNumber} 已创建（浏览器模式模拟）` })
      if (reviewers.length > 0) {
        agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'system', content: `已指派 ${reviewers.length} 个 Agent 审阅此 PR，等待全员通过后方可合并` })
      } else {
        agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'system', content: '当前无其他 Agent 可指派审阅，指挥官可直接合并' })
      }
      persistAgents()
      return
    }
    sendToEngine({ type: 'submit-for-review', agentId: id, githubToken: token || undefined })
  }

  function mergePr(id: string) {
    const token = getGitHubToken()
    if (!isTauri) {
      const agent = state.agents.find((a) => a.id === id)
      if (!agent || agent.status !== 'reviewing') return
      const canMerge = agent.reviews.length === 0 || agent.reviews.every((r) => r.status === 'approved')
      if (!canMerge) {
        const approved = agent.reviews.filter((r) => r.status === 'approved').length
        agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'error', content: `合并被拒绝：需等待全员审阅通过（${approved}/${agent.reviews.length}）` })
        persistAgents()
        return
      }
      agent.status = 'completed'
      agent.prStatus = 'merged'
      agent.reviews = []
      agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'system', content: `PR #${agent.prNumber} 已合并到 main（浏览器模式模拟）` })
      persistAgents()
      return
    }
    sendToEngine({ type: 'merge-pr', agentId: id, githubToken: token || undefined })
  }

  function rejectPr(id: string) {
    if (!isTauri) {
      const agent = state.agents.find((a) => a.id === id)
      if (!agent || agent.status !== 'reviewing') return
      agent.status = 'working'
      agent.prStatus = 'none'
      agent.reviews = []
      agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'system', content: 'PR 被打回，Agent 继续修改' })
      persistAgents()
      return
    }
    sendToEngine({ type: 'reject-pr', agentId: id })
  }

  function submitReview(agentId: string, reviewerAgentId: string, approved: boolean) {
    if (!isTauri) {
      const agent = state.agents.find((a) => a.id === agentId)
      if (!agent || agent.status !== 'reviewing') return
      const review = agent.reviews.find((r) => r.reviewerTaskId === reviewerAgentId)
      if (!review) return
      review.status = approved ? 'approved' : 'rejected'
      review.reviewedAt = new Date().toISOString()
      const action = approved ? '通过' : '拒绝'
      agent.logs.push({ id: generateId(), timestamp: new Date().toISOString(), type: 'system', content: `Agent「${review.reviewerName}」审阅${action}了此 PR` })
      persistAgents()
      return
    }
    sendToEngine({ type: 'submit-review', agentId, reviewerAgentId, approved })
  }

  async function getFileDiff(agentId: string, filePath: string): Promise<string> {
    const agent = state.agents.find((a) => a.id === agentId)
    if (!agent) return ''
    if (!isTauri) return `mock diff for ${filePath}`
    // 发送命令给 engine，diff 结果通过 diff-result 事件异步返回
    sendToEngine({ type: 'get-file-diff', agentId, filePath })
    return ''
  }

  return {
    // State
    agents: computed(() => state.agents),
    stats,
    selectedAgentId: computed(() => state.selectedAgentId),
    selectedAgent,
    isCreateModalOpen: computed(() => state.isCreateModalOpen),
    isLoggedIn: computed(() => state.isLoggedIn),
    isAuthLoading: computed(() => state.isAuthLoading),
    authError: computed(() => state.authError),
    engineConnected: computed(() => state.engineConnected),
    engineReady: computed(() => state.engineReady),
    canCreateAgent,
    maxAgents: MAX_AGENTS,

    // Actions
    setSelectedAgentId: (id: string | null) => { state.selectedAgentId = id },
    setIsCreateModalOpen: (v: boolean) => {
      log.debug('setIsCreateModalOpen called:', v, 'current:', state.isCreateModalOpen)
      state.isCreateModalOpen = v
    },
    login,
    logout,
    createAgent,
    startAgent,
    sendInstruction,
    stopAgent,
    submitForReview,
    mergePr,
    rejectPr,
    submitReview,
    getFileDiff,
    deleteAgent,
  }
}
