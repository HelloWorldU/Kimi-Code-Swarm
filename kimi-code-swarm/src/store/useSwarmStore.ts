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

// ── Bootstrap: check auth on load ──
let bootstrapped = false
async function bootstrap() {
  if (bootstrapped) return
  bootstrapped = true
  const key = await getApiKey()
  if (key) {
    state.isLoggedIn = true
    const persisted = await loadPersistedAgents()
    if (persisted.length > 0) {
      state.agents = persisted
    }
    // Auto-start agent engine if logged in
    startAgentEngine()
  }
}

async function startAgentEngine() {
  if (!isTauri) return
  try {
    const running = await isEngineRunning()
    if (running) return
    await spawnAgentEngine()
    initEngineListeners()
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
let engineListenersInitialized = false
function initEngineListeners() {
  if (engineListenersInitialized) return
  engineListenersInitialized = true

  listenAgentEngineEvent((payload) => {
    try {
      const event = JSON.parse(payload.line)
      handleEngineEvent(event)
    } catch {
      // engine 可能输出非 JSON 行（如 console.log），属于正常噪音，无需处理
    }
  })

  listenAgentEngineExit(() => {
    engineListenersInitialized = false
    state.engineConnected = false
  })
}

function handleEngineEvent(event: Record<string, unknown>) {
  const type = event.type as string

  switch (type) {
    case 'agent-created': {
      const agent = event.agent as AgentTask
      state.agents.push(agent)
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
      }
      persistAgents()
      break
    }
    case 'agent-status': {
      const agent = state.agents.find((a) => a.id === event.agentId)
      if (agent) {
        agent.status = event.status as AgentTask['status']
        persistAgents()
      }
      break
    }
    case 'agent-state': {
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
      persistAgents()
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
      const agent = state.agents.find((a) => a.id === event.agentId)
      if (agent) {
        agent.changedFiles = event.files as string[]
        persistAgents()
      }
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
async function persistAgents() {
  await saveStoreValue(STORE_KEY, { agents: state.agents })
}

async function loadPersistedAgents(): Promise<AgentTask[]> {
  const data = await loadStoreValue<{ agents: AgentTask[] }>(STORE_KEY)
  if (!data || !data.agents) return []
  return data.agents.map((a) => ({
    ...a,
    createdAt: typeof a.createdAt === 'string' ? a.createdAt : new Date(a.createdAt).toISOString(),
    lastActivity: typeof a.lastActivity === 'string' ? a.lastActivity : new Date(a.lastActivity).toISOString(),
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
})

bootstrap()

// ── Browser mock mode: simulate token consumption ──
if (!isTauri) {
  setInterval(() => {
    state.agents.forEach((a) => {
      if (a.status === 'working') {
        // 基于当前 instruction 长度估算工作期间的 token 消耗，避免纯随机
        const base = a.instruction ? Math.floor(a.instruction.length / 4) : 0
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
      const persisted = await loadPersistedAgents()
      if (persisted.length > 0) {
        state.agents = persisted
      }
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
    // 3. Clear persisted store data
    try {
      await saveStoreValue(STORE_KEY, { agents: [] })
    } catch (e) {
      log.error('Failed to clear store during logout:', e)
    }
    // 4. Reset all reactive state
    state.isLoggedIn = false
    state.agents = []
    state.selectedAgentId = null
    state.authError = ''
    state.engineConnected = false
    // 5. Reset bootstrap flags so next login re-initializes
    bootstrapped = false
    engineListenersInitialized = false
    // 6. Force page reload to ensure clean slate
    if (isTauri) {
      window.location.reload()
    }
  }

  // ── Agent CRUD (delegated to Node.js engine) ──
  function createAgent(name: string, repoUrl: string, instruction: string, tokenBudget: number) {
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
        instruction,
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
      payload: { name, repoUrl, instruction, tokenBudget },
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
      agent.instruction = instruction
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
