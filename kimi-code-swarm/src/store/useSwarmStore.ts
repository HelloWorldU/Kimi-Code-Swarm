import { reactive, computed } from 'vue'
import type { AgentTask, ReviewEntry, AppPersistedState } from '../types'
import {
  isTauri,
  execGit,
  execCommand,
  killProcess,
  spawnProcess,
  listenProcessOutput,
  listenProcessExit,
  saveApiKey,
  getApiKey,
  deleteApiKey,
  verifyKimiApiKey,
  loadStoreValue,
  saveStoreValue,
} from '../api/ipc'
import { createPullRequest, mergePullRequest, hasToken } from '../api/github'

// ── Constants ──
const MAX_AGENTS = 5
const STORE_KEY = 'agents'

// ── Kimi CLI path cache ──
let cachedKimiPath: string | null | undefined = undefined

// PID → agentId mapping for routing process output
const pidToAgentId = new Map<number, string>()

// Global process listeners (initialized once per session)
let processListenersInitialized = false
async function initProcessListeners() {
  if (processListenersInitialized) return
  processListenersInitialized = true

  await listenProcessOutput((payload) => {
    const agentId = pidToAgentId.get(payload.pid)
    if (!agentId) return
    const agent = state.agents.find((a) => a.id === agentId)
    if (!agent) return

    const estimatedTokens = Math.max(1, Math.floor(payload.line.length / 4))
    agent.tokenUsed = Math.min(agent.tokenUsed + estimatedTokens, agent.tokenBudget)

    if (agent.tokenUsed >= agent.tokenBudget && agent.pid) {
      killProcess(agent.pid).catch(() => {})
      pidToAgentId.delete(agent.pid)
      agent.pid = undefined
      agent.status = 'ready'
      agent.logs.push({
        id: generateId(),
        timestamp: new Date(),
        type: 'error',
        content: 'Token 预算已耗尽，Agent 执行被中断',
      })
      agent.lastActivity = new Date()
      persistAgents()
      return
    }

    agent.logs.push({
      id: generateId(),
      timestamp: new Date(),
      type: payload.is_stderr ? 'error' : 'output',
      content: payload.line,
    })
    agent.lastActivity = new Date()
    persistAgents()
  })

  await listenProcessExit((payload) => {
    const agentId = pidToAgentId.get(payload.pid)
    if (!agentId) return
    pidToAgentId.delete(payload.pid)
    const agent = state.agents.find((a) => a.id === agentId)
    if (!agent) return
    if (agent.status === 'working') {
      agent.status = 'ready'
      agent.pid = undefined
      agent.logs.push({
        id: generateId(),
        timestamp: new Date(),
        type: 'system',
        content:
          payload.code === 0
            ? 'Agent 执行完毕，可以继续发送指令或提交审阅'
            : `Agent 进程退出 (code: ${payload.code ?? 'unknown'})`,
      })
      agent.lastActivity = new Date()
      if (isTauri && agent.workspace) {
        execGit(agent.workspace, ['diff', '--name-only'])
          .then((files) => {
            const changed = files.split('\n').filter((f) => f.trim())
            agent.changedFiles = changed
            if (changed.length > 0) {
              agent.logs.push({
                id: generateId(),
                timestamp: new Date(),
                type: 'system',
                content: `文件变更: ${changed.length} 个文件`,
              })
            }
            persistAgents()
          })
          .catch(() => {
            /* ignore git diff errors */
          })
      }
      persistAgents()
    }
  })
}

async function detectKimiCli(): Promise<string | null> {
  if (cachedKimiPath !== undefined) return cachedKimiPath
  const candidates = ['kimi', 'C:\\Python312\\Scripts\\kimi.exe']
  for (const cmd of candidates) {
    try {
      await execCommand(cmd, ['--version'], '.')
      cachedKimiPath = cmd
      return cmd
    } catch {
      /* try next */
    }
  }
  cachedKimiPath = null
  return null
}

const generateId = () => Math.random().toString(36).substring(2, 10)

const branchName = (agentName: string) => {
  const slug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `agent/${slug}-${generateId().slice(0, 4)}`
}

// ── Persistence ──
async function persistAgents() {
  const payload: AppPersistedState = { agents: state.agents }
  await saveStoreValue(STORE_KEY, payload)
}

async function loadPersistedAgents(): Promise<AgentTask[]> {
  const data = await loadStoreValue<AppPersistedState>(STORE_KEY)
  if (!data || !data.agents) return []
  // Rehydrate Date objects from JSON
  return data.agents.map((a) => ({
    ...a,
    createdAt: new Date(a.createdAt),
    lastActivity: new Date(a.lastActivity),
    logs: a.logs.map((l) => ({ ...l, timestamp: new Date(l.timestamp) })),
    reviews: a.reviews.map((r) => ({
      ...r,
      reviewedAt: r.reviewedAt ? new Date(r.reviewedAt) : undefined,
    })),
  }))
}

// ── Global reactive state ──
const state = reactive({
  agents: [] as AgentTask[],
  selectedAgentId: null as string | null,
  isCreateModalOpen: false,
  isLoggedIn: false,
  isAuthLoading: false,
  authError: '',
})

// Simulate token consumption for working agents (browser mock mode only)
if (!isTauri) {
  setInterval(() => {
    state.agents.forEach((a) => {
      if (a.status === 'working') {
        const increment = Math.floor(Math.random() * 50) + 10
        a.tokenUsed = Math.min(a.tokenUsed + increment, a.tokenBudget)
        a.lastActivity = new Date()
      }
    })
  }, 3000)
}

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
  }
}
bootstrap()

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
      state.isAuthLoading = false
      return true
    } catch (e) {
      state.authError = `登录错误: ${String(e)}`
      state.isAuthLoading = false
      return false
    }
  }

  async function logout() {
    await deleteApiKey()
    state.isLoggedIn = false
    state.agents = []
    state.selectedAgentId = null
    state.authError = ''
    // Reload to clear all reactive state
    if (isTauri) {
      window.location.reload()
    }
  }

  // ── Agent CRUD ──
  function createAgent(name: string, repoUrl: string, instruction: string, tokenBudget: number) {
    if (state.agents.length >= MAX_AGENTS) return
    const newAgent: AgentTask = {
      id: `agent-${generateId()}`,
      name,
      status: 'pending',
      repoUrl,
      workspace: '',
      branch: branchName(name),
      instruction,
      prStatus: 'none',
      tokenUsed: 0,
      tokenBudget,
      createdAt: new Date(),
      lastActivity: new Date(),
      logs: [{ id: generateId(), timestamp: new Date(), type: 'system', content: 'Agent 已创建，等待启动...' }],
      reviews: [],
    }
    state.agents.push(newAgent)
    persistAgents()
  }

  function deleteAgent(id: string) {
    const agent = state.agents.find((a) => a.id === id)
    if (agent && agent.pid) {
      killProcess(agent.pid).catch(() => {})
      pidToAgentId.delete(agent.pid)
    }
    state.agents = state.agents.filter((a) => a.id !== id)
    if (state.selectedAgentId === id) state.selectedAgentId = null
    persistAgents()
  }

  // ── Agent Lifecycle ──
  async function startAgent(id: string) {
    const agent = state.agents.find((a) => a.id === id)
    if (!agent || agent.status !== 'pending') return

    agent.status = 'cloning'
    agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: '开始克隆仓库...' })

    if (isTauri) {
      try {
        const parentDir = 'E:/workspace'
        const targetDir = `${parentDir}/${agent.id}`
        await execCommand('git', ['clone', agent.repoUrl, targetDir], parentDir)
        agent.workspace = targetDir
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `仓库已克隆到 ${targetDir}` })

        await execGit(targetDir, ['checkout', '-b', agent.branch])
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `已创建分支: ${agent.branch}` })

        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: '工作空间就绪，等待指令' })
        agent.status = 'ready'
        persistAgents()
      } catch (err) {
        agent.status = 'stopped'
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `启动失败: ${String(err)}` })
        persistAgents()
      }
    } else {
      setTimeout(() => {
        const a = state.agents.find((x) => x.id === id)
        if (!a) return
        a.workspace = `E:/workspace/${a.id}`
        a.status = 'ready'
        a.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `仓库已克隆到 ${a.workspace}` })
        a.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `已创建分支: ${a.branch}` })
        a.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: 'CLI 进程已就绪，等待指令' })
        persistAgents()
      }, 2000)
    }
  }

  async function sendInstruction(id: string, instruction: string) {
    const agent = state.agents.find((a) => a.id === id)
    if (!agent || agent.status !== 'ready') return

    agent.status = 'working'
    agent.instruction = instruction
    agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'input', content: instruction, tokens: Math.floor(instruction.length / 2) })
    agent.tokenUsed += Math.floor(instruction.length / 2)
    agent.lastActivity = new Date()

    if (agent.tokenUsed >= agent.tokenBudget) {
      agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: 'Token 预算已耗尽，无法执行新指令' })
      persistAgents()
      return
    }

    if (isTauri && agent.workspace) {
      const kimiPath = await detectKimiCli()
      if (!kimiPath) {
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: 'Kimi CLI 未找到。请安装: py -3.12 -m pip install kimi-cli' })
        agent.status = 'ready'
        persistAgents()
        return
      }

      await initProcessListeners()

      try {
        const pid = await spawnProcess(kimiPath, ['--print', '--quiet', '-w', agent.workspace, '-y', instruction], agent.workspace)
        agent.pid = pid
        pidToAgentId.set(pid, agent.id)
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `Kimi CLI 已启动 (PID: ${pid})` })
        persistAgents()
      } catch (err) {
        agent.status = 'ready'
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `启动失败: ${String(err)}` })
        persistAgents()
      }
    } else {
      agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: 'Agent 开始执行任务（模拟）...' })
      setTimeout(() => {
        const a = state.agents.find((x) => x.id === id)
        if (!a || a.status !== 'working') return
        a.logs.push({ id: generateId(), timestamp: new Date(), type: 'output', content: '模拟执行完成。在 Tauri 桌面模式下将调用真实 Kimi CLI。', tokens: 42 })
        a.status = 'ready'
        a.lastActivity = new Date()
        persistAgents()
      }, 3000)
    }
  }

  async function stopAgent(id: string) {
    const agent = state.agents.find((a) => a.id === id)
    if (!agent) return
    if (isTauri && agent.pid) {
      try {
        await killProcess(agent.pid)
      } catch {
        /* ignore */
      }
      pidToAgentId.delete(agent.pid)
    }
    agent.status = 'stopped'
    agent.pid = undefined
    agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: 'Agent 已停止' })
    persistAgents()
  }

  async function submitForReview(id: string) {
    const agent = state.agents.find((a) => a.id === id)
    if (!agent || agent.status !== 'working') return

    if (isTauri && agent.workspace) {
      try {
        await execGit(agent.workspace, ['add', '.'])
        await execGit(agent.workspace, ['commit', '-m', `feat: ${agent.name}`])
        await execGit(agent.workspace, ['push', 'origin', agent.branch])
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: '代码已推送至远程' })
      } catch (err) {
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `推送失败: ${String(err)}` })
        return
      }
    }

    const reviewers: ReviewEntry[] = state.agents
      .filter((a) => a.id !== agent.id)
      .map((a) => ({
        reviewerTaskId: a.id,
        reviewerName: a.name,
        status: 'pending' as const,
      }))
    agent.reviews = reviewers

    if (reviewers.length > 0) {
      agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `已指派 ${reviewers.length} 个 Agent 进行审阅` })
    }

    if (hasToken()) {
      try {
        const pr = await createPullRequest(agent.repoUrl, `feat: ${agent.name}`, agent.branch)
        agent.status = 'reviewing'
        agent.prStatus = 'open'
        agent.prNumber = pr.number
        agent.prUrl = pr.html_url
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `PR #${pr.number} 已创建: ${pr.html_url}` })
      } catch (err) {
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `创建 PR 失败: ${String(err)}` })
      }
    } else {
      agent.status = 'reviewing'
      agent.prStatus = 'open'
      agent.prNumber = Math.floor(Math.random() * 100) + 1
      agent.prUrl = `${agent.repoUrl.replace(/\.git$/, '')}/pull/${agent.prNumber}`
      agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `PR #${agent.prNumber} 已创建（模拟，未配置 GitHub Token）` })

      if (!isTauri && reviewers.length > 0) {
        setTimeout(() => {
          const a = state.agents.find((x) => x.id === id)
          if (!a || a.status !== 'reviewing') return
          a.reviews.forEach((r) => {
            r.status = 'approved'
            r.reviewedAt = new Date()
          })
          a.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `全员审阅通过（${reviewers.length}/${reviewers.length}），等待指挥官合并` })
          a.lastActivity = new Date()
          persistAgents()
        }, 3000)
      }
    }
    persistAgents()
  }

  function canMerge(agent: AgentTask): boolean {
    if (agent.reviews.length === 0) return true
    return agent.reviews.every((r) => r.status === 'approved')
  }

  async function mergePr(id: string) {
    const agent = state.agents.find((a) => a.id === id)
    if (!agent || agent.status !== 'reviewing') return

    if (!canMerge(agent)) {
      const approved = agent.reviews.filter((r) => r.status === 'approved').length
      agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `合并被拒绝：需等待全员审阅通过（${approved}/${agent.reviews.length}）` })
      return
    }

    if (hasToken() && agent.prNumber) {
      try {
        await mergePullRequest(agent.repoUrl, agent.prNumber)
        agent.status = 'completed'
        agent.prStatus = 'merged'
        agent.reviews = []
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `PR #${agent.prNumber} 已合并到 main` })
      } catch (err) {
        agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `合并失败: ${String(err)}` })
      }
    } else {
      agent.status = 'completed'
      agent.prStatus = 'merged'
      agent.reviews = []
      agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `PR #${agent.prNumber} 已合并到 main（模拟）` })
    }
    persistAgents()
  }

  function rejectPr(id: string) {
    const agent = state.agents.find((a) => a.id === id)
    if (!agent || agent.status !== 'reviewing') return
    agent.status = 'working'
    agent.prStatus = 'none'
    agent.reviews = []
    agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: 'PR 被打回，Agent 继续修改' })
    persistAgents()
  }

  function submitReview(agentId: string, reviewerAgentId: string, approved: boolean) {
    const agent = state.agents.find((a) => a.id === agentId)
    if (!agent || agent.status !== 'reviewing') return

    const review = agent.reviews.find((r) => r.reviewerTaskId === reviewerAgentId)
    if (!review) return

    review.status = approved ? 'approved' : 'rejected'
    review.reviewedAt = new Date()
    const action = approved ? '通过' : '拒绝'
    agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `Agent「${review.reviewerName}」审阅${action}了此 PR` })
    agent.lastActivity = new Date()

    const approvedCount = agent.reviews.filter((r) => r.status === 'approved').length
    if (approvedCount === agent.reviews.length) {
      agent.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: '全员审阅通过，等待指挥官合并' })
    }
    persistAgents()
  }

  async function getFileDiff(agentId: string, filePath: string): Promise<string> {
    const agent = state.agents.find((a) => a.id === agentId)
    if (!agent || !agent.workspace) return ''
    if (!isTauri) return `mock diff for ${filePath}`
    try {
      return await execGit(agent.workspace, ['diff', '--', filePath])
    } catch {
      return ''
    }
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
    canCreateAgent,
    maxAgents: MAX_AGENTS,

    // Actions
    setSelectedAgentId: (id: string | null) => {
      state.selectedAgentId = id
    },
    setIsCreateModalOpen: (v: boolean) => {
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
