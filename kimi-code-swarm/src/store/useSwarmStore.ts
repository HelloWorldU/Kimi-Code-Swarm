import { reactive, computed } from 'vue'
import type { AgentTask, LogEntry, ReviewEntry } from '../types'
import { isTauri, execGit, execCommand, killProcess } from '../api/ipc'
import { createPullRequest, mergePullRequest, hasToken } from '../api/github'

// Cached Kimi CLI path (detected once per session)
let cachedKimiPath: string | null | undefined = undefined

async function detectKimiCli(): Promise<string | null> {
  if (cachedKimiPath !== undefined) return cachedKimiPath
  const candidates = ['kimi', 'C:\\Python312\\Scripts\\kimi.exe']
  for (const cmd of candidates) {
    try {
      await execCommand(cmd, ['--version'], '.')
      cachedKimiPath = cmd
      return cmd
    } catch { /* try next */ }
  }
  cachedKimiPath = null
  return null
}

const generateId = () => Math.random().toString(36).substring(2, 10)

const mockLogs = (baseContent: string): LogEntry[] => [
  { id: generateId(), timestamp: new Date(Date.now() - 300000), type: 'system', content: 'Kimi Code CLI v2.0.0 已启动' },
  { id: generateId(), timestamp: new Date(Date.now() - 240000), type: 'input', content: '请帮我实现用户登录模块', tokens: 12 },
  { id: generateId(), timestamp: new Date(Date.now() - 180000), type: 'output', content: '好的，我将分析需求并实现登录功能...', tokens: 156 },
  { id: generateId(), timestamp: new Date(Date.now() - 120000), type: 'output', content: baseContent.slice(0, 200), tokens: 342 },
  { id: generateId(), timestamp: new Date(Date.now() - 60000), type: 'system', content: '文件已保存: src/auth/LoginForm.vue' },
]

const branchName = (taskName: string) => {
  const slug = taskName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `agent/${slug}-${generateId().slice(0, 4)}`
}

const initialTasks: AgentTask[] = [
  {
    id: 'task-001',
    name: '登录模块开发',
    status: 'working',
    repoUrl: 'https://github.com/HelloWorldU/Kimi-Code-Swarm',
    workspace: 'E:/workspace/agent-001',
    branch: 'agent/login-module-a3f2',
    instruction: '实现用户登录模块，包含前后端',
    prStatus: 'none',
    tokenUsed: 12400,
    tokenBudget: 50000,
    createdAt: new Date(Date.now() - 3600000),
    lastActivity: new Date(Date.now() - 30000),
    logs: mockLogs('已完成 LoginForm 组件和 auth API 接口...'),
    reviews: [],
  },
  {
    id: 'task-002',
    name: '支付网关对接',
    status: 'reviewing',
    repoUrl: 'https://github.com/HelloWorldU/Kimi-Code-Swarm',
    workspace: 'E:/workspace/agent-002',
    branch: 'agent/payment-gateway-b7e1',
    instruction: '对接 Stripe 支付网关',
    prStatus: 'open',
    prNumber: 42,
    prUrl: 'https://github.com/HelloWorldU/Kimi-Code-Swarm/pull/42',
    tokenUsed: 8900,
    tokenBudget: 50000,
    createdAt: new Date(Date.now() - 2400000),
    lastActivity: new Date(Date.now() - 120000),
    logs: mockLogs('Stripe webhook handler 已编写完成...'),
    reviews: [
      { reviewerTaskId: 'task-001', reviewerName: '登录模块开发', status: 'approved', reviewedAt: new Date(Date.now() - 60000) },
      { reviewerTaskId: 'task-003', reviewerName: 'API 文档生成', status: 'pending' },
      { reviewerTaskId: 'task-004', reviewerName: 'iOS 崩溃修复', status: 'approved', reviewedAt: new Date(Date.now() - 90000) },
    ],
  },
  {
    id: 'task-003',
    name: 'API 文档生成',
    status: 'completed',
    repoUrl: 'https://github.com/HelloWorldU/Kimi-Code-Swarm',
    workspace: 'E:/workspace/agent-003',
    branch: 'agent/api-docs-c5d8',
    instruction: '生成 OpenAPI 文档',
    prStatus: 'merged',
    prNumber: 38,
    prUrl: 'https://github.com/HelloWorldU/Kimi-Code-Swarm/pull/38',
    tokenUsed: 3200,
    tokenBudget: 30000,
    createdAt: new Date(Date.now() - 7200000),
    lastActivity: new Date(Date.now() - 600000),
    logs: mockLogs('文档生成完毕，PR 已合并'),
    reviews: [],
  },
  {
    id: 'task-004',
    name: 'iOS 崩溃修复',
    status: 'stopped',
    repoUrl: 'https://github.com/HelloWorldU/Kimi-Code-Swarm',
    workspace: 'E:/workspace/agent-004',
    branch: 'agent/ios-crash-fix-d2a4',
    instruction: '修复 iOS 上的内存泄漏导致的崩溃',
    prStatus: 'none',
    tokenUsed: 5600,
    tokenBudget: 40000,
    createdAt: new Date(Date.now() - 1800000),
    lastActivity: new Date(Date.now() - 300000),
    logs: [
      ...mockLogs('分析 crash log...'),
      { id: generateId(), timestamp: new Date(Date.now() - 300000), type: 'error', content: 'Error: Connection timeout after 30000ms' },
    ],
    reviews: [],
  },
]

// Global reactive state
const state = reactive({
  tasks: initialTasks,
  selectedTaskId: null as string | null,
  isCreateModalOpen: false,
})

// Simulate token consumption for working tasks
setInterval(() => {
  state.tasks.forEach((t) => {
    if (t.status === 'working') {
      const increment = Math.floor(Math.random() * 50) + 10
      t.tokenUsed = Math.min(t.tokenUsed + increment, t.tokenBudget)
      t.lastActivity = new Date()
    }
  })
}, 3000)

export function useSwarmStore() {
  const stats = computed(() => ({
    totalTasks: state.tasks.length,
    activeTasks: state.tasks.filter(t => t.status === 'working' || t.status === 'cloning').length,
    completedTasks: state.tasks.filter(t => t.status === 'completed').length,
    totalTokensUsed: state.tasks.reduce((sum, t) => sum + t.tokenUsed, 0),
    totalTokenBudget: state.tasks.reduce((sum, t) => sum + t.tokenBudget, 0),
  }))

  const selectedTask = computed(() =>
    state.tasks.find(t => t.id === state.selectedTaskId) || null
  )

  function createTask(name: string, repoUrl: string, instruction: string, tokenBudget: number) {
    const newTask: AgentTask = {
      id: `task-${generateId()}`,
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
      logs: [
        { id: generateId(), timestamp: new Date(), type: 'system', content: '任务已创建，等待启动...' },
      ],
      reviews: [],
    }
    state.tasks.push(newTask)
  }

  async function startTask(id: string) {
    const task = state.tasks.find(t => t.id === id)
    if (!task || task.status !== 'pending') return

    task.status = 'cloning'
    task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: '开始克隆仓库...' })

    if (isTauri) {
      try {
        const parentDir = 'E:/workspace'
        const targetDir = `${parentDir}/${task.id}`
        await execCommand('git', ['clone', task.repoUrl, targetDir], parentDir)
        task.workspace = targetDir
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `仓库已克隆到 ${targetDir}` })

        await execGit(targetDir, ['checkout', '-b', task.branch])
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `已创建分支: ${task.branch}` })

        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: '工作空间就绪，等待指令' })
        task.status = 'ready'
      } catch (err) {
        task.status = 'stopped'
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `启动失败: ${String(err)}` })
      }
    } else {
      // Mock mode for browser dev
      setTimeout(() => {
        const t = state.tasks.find(x => x.id === id)
        if (!t) return
        t.workspace = `E:/workspace/${t.id}`
        t.status = 'ready'
        t.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `仓库已克隆到 ${t.workspace}` })
        t.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `已创建分支: ${t.branch}` })
        t.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: 'CLI 进程已就绪，等待指令' })
      }, 2000)
    }
  }

  async function sendInstruction(id: string, instruction: string) {
    const task = state.tasks.find(t => t.id === id)
    if (!task || task.status !== 'ready') return

    task.status = 'working'
    task.instruction = instruction
    task.logs.push({ id: generateId(), timestamp: new Date(), type: 'input', content: instruction, tokens: Math.floor(instruction.length / 2) })
    task.tokenUsed += Math.floor(instruction.length / 2)
    task.lastActivity = new Date()

    if (isTauri && task.workspace) {
      const kimiPath = await detectKimiCli()
      if (!kimiPath) {
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: 'Kimi CLI 未找到。请安装: py -3.12 -m pip install kimi-cli' })
        task.status = 'ready'
        return
      }

      task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `启动 Kimi CLI: ${kimiPath}` })

      // Simulate progress while waiting for CLI
      const progressMessages = [
        'Agent 正在分析代码库...',
        'Agent 正在规划实现方案...',
        'Agent 正在编写代码...',
        'Agent 正在验证修改...',
      ]
      let progressIdx = 0
      const progressInterval = setInterval(() => {
        if (task.status !== 'working') {
          clearInterval(progressInterval)
          return
        }
        const msg = progressMessages[progressIdx % progressMessages.length]
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: msg })
        progressIdx++
      }, 8000)

      try {
        const output = await execCommand(kimiPath, ['--print', '--quiet', '-w', task.workspace, '-y', instruction], task.workspace)
        clearInterval(progressInterval)
        const tokens = Math.floor(output.length / 4)
        task.tokenUsed += tokens
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'output', content: output || '任务执行完成（无输出）', tokens })
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: 'Agent 执行完毕，可以继续发送指令或提交审阅' })
      } catch (err) {
        clearInterval(progressInterval)
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `执行失败: ${String(err)}` })
      }

      task.status = 'ready'
      task.lastActivity = new Date()
    } else {
      // Mock mode for browser dev
      task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: 'Agent 开始执行任务（模拟）...' })
      setTimeout(() => {
        const t = state.tasks.find(x => x.id === id)
        if (!t || t.status !== 'working') return
        t.logs.push({ id: generateId(), timestamp: new Date(), type: 'output', content: '模拟执行完成。在 Tauri 桌面模式下将调用真实 Kimi CLI。', tokens: 42 })
        t.status = 'ready'
        t.lastActivity = new Date()
      }, 3000)
    }
  }

  async function stopTask(id: string) {
    const task = state.tasks.find(t => t.id === id)
    if (!task) return
    if (isTauri && task.pid) {
      try { await killProcess(task.pid) } catch { /* ignore */ }
    }
    task.status = 'stopped'
    task.pid = undefined
    task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: '任务已停止' })
  }

  async function submitForReview(id: string) {
    const task = state.tasks.find(t => t.id === id)
    if (!task || task.status !== 'working') return

    if (isTauri && task.workspace) {
      try {
        await execGit(task.workspace, ['add', '.'])
        await execGit(task.workspace, ['commit', '-m', `feat: ${task.name}`])
        await execGit(task.workspace, ['push', 'origin', task.branch])
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: '代码已推送至远程' })
      } catch (err) {
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `推送失败: ${String(err)}` })
        return
      }
    }

    // Generate reviewer list from all other tasks
    const reviewers: ReviewEntry[] = state.tasks
      .filter(t => t.id !== task.id)
      .map(t => ({
        reviewerTaskId: t.id,
        reviewerName: t.name,
        status: 'pending' as const,
      }))
    task.reviews = reviewers

    if (reviewers.length > 0) {
      task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `已指派 ${reviewers.length} 个 Agent 进行审阅` })
    }

    if (hasToken()) {
      try {
        const pr = await createPullRequest(task.repoUrl, `feat: ${task.name}`, task.branch)
        task.status = 'reviewing'
        task.prStatus = 'open'
        task.prNumber = pr.number
        task.prUrl = pr.html_url
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `PR #${pr.number} 已创建: ${pr.html_url}` })
      } catch (err) {
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `创建 PR 失败: ${String(err)}` })
      }
    } else {
      task.status = 'reviewing'
      task.prStatus = 'open'
      task.prNumber = Math.floor(Math.random() * 100) + 1
      task.prUrl = `${task.repoUrl.replace(/\.git$/, '')}/pull/${task.prNumber}`
      task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `PR #${task.prNumber} 已创建（模拟，未配置 GitHub Token）` })

      // Mock mode: auto-approve all reviews after delay for quick demo
      if (!isTauri && reviewers.length > 0) {
        setTimeout(() => {
          const t = state.tasks.find(x => x.id === id)
          if (!t || t.status !== 'reviewing') return
          t.reviews.forEach(r => {
            r.status = 'approved'
            r.reviewedAt = new Date()
          })
          t.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `全员审阅通过（${reviewers.length}/${reviewers.length}），等待指挥官合并` })
          t.lastActivity = new Date()
        }, 3000)
      }
    }
  }

  function canMerge(task: AgentTask): boolean {
    if (task.reviews.length === 0) return true
    return task.reviews.every(r => r.status === 'approved')
  }

  async function mergePr(id: string) {
    const task = state.tasks.find(t => t.id === id)
    if (!task || task.status !== 'reviewing') return

    if (!canMerge(task)) {
      const approved = task.reviews.filter(r => r.status === 'approved').length
      task.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `合并被拒绝：需等待全员审阅通过（${approved}/${task.reviews.length}）` })
      return
    }

    if (hasToken() && task.prNumber) {
      try {
        await mergePullRequest(task.repoUrl, task.prNumber)
        task.status = 'completed'
        task.prStatus = 'merged'
        task.reviews = []
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `PR #${task.prNumber} 已合并到 main` })
      } catch (err) {
        task.logs.push({ id: generateId(), timestamp: new Date(), type: 'error', content: `合并失败: ${String(err)}` })
      }
    } else {
      task.status = 'completed'
      task.prStatus = 'merged'
      task.reviews = []
      task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `PR #${task.prNumber} 已合并到 main（模拟）` })
    }
  }

  function rejectPr(id: string) {
    const task = state.tasks.find(t => t.id === id)
    if (!task || task.status !== 'reviewing') return
    task.status = 'working'
    task.prStatus = 'none'
    task.reviews = []
    task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: 'PR 被打回，Agent 继续修改' })
  }

  function submitReview(taskId: string, reviewerTaskId: string, approved: boolean) {
    const task = state.tasks.find(t => t.id === taskId)
    if (!task || task.status !== 'reviewing') return

    const review = task.reviews.find(r => r.reviewerTaskId === reviewerTaskId)
    if (!review) return

    review.status = approved ? 'approved' : 'rejected'
    review.reviewedAt = new Date()
    const action = approved ? '通过' : '拒绝'
    task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: `Agent「${review.reviewerName}」审阅${action}了此 PR` })
    task.lastActivity = new Date()

    const approvedCount = task.reviews.filter(r => r.status === 'approved').length
    if (approvedCount === task.reviews.length) {
      task.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: '全员审阅通过，等待指挥官合并' })
    }
  }

  function deleteTask(id: string) {
    state.tasks = state.tasks.filter(t => t.id !== id)
    if (state.selectedTaskId === id) state.selectedTaskId = null
  }

  return {
    tasks: computed(() => state.tasks),
    stats,
    selectedTaskId: computed(() => state.selectedTaskId),
    selectedTask,
    isCreateModalOpen: computed(() => state.isCreateModalOpen),
    setSelectedTaskId: (id: string | null) => { state.selectedTaskId = id },
    setIsCreateModalOpen: (v: boolean) => { state.isCreateModalOpen = v },
    createTask,
    startTask,
    sendInstruction,
    stopTask,
    submitForReview,
    mergePr,
    rejectPr,
    submitReview,
    deleteTask,
  }
}
