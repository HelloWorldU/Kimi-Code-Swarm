import type { AgentState, LogEntry, ReviewEntry, TaskStatus, EngineEvent } from './types.js'
import { runKimi, detectKimiCli, type KimiProcess } from './kimi.js'
import { getChangedFiles, getFileDiff, gitAdd, gitCommit, gitPush, createBranch, cloneRepo, gitFetch, getBranchDiff } from './git.js'
import { createPullRequest, mergePullRequest } from './github-api.js'

let idCounter = 0
const generateId = () => `agent-${Date.now().toString(36)}${(idCounter++).toString(36)}`

const branchName = (name: string) => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `agent/${slug}-${generateId().slice(-4)}`
}

const termColors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

export class Agent {
  state: AgentState
  private process?: KimiProcess
  private emit: (event: EngineEvent) => void
  private running = false
  private reviewRound = 0

  constructor(
    name: string,
    repoUrl: string,
    instruction: string,
    tokenBudget: number,
    emit: (event: EngineEvent) => void,
  ) {
    this.emit = emit
    this.state = {
      id: generateId(),
      name,
      status: 'pending',
      repoUrl,
      workspace: '',
      branch: branchName(name),
      instruction,
      prStatus: 'none',
      tokenUsed: 0,
      tokenBudget,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      logs: [this.makeLog('system', 'Agent 已创建，等待启动...')],
      reviews: [],
    }
  }

  private makeLog(type: LogEntry['type'], content: string, tokens?: number): LogEntry {
    return {
      id: generateId(),
      timestamp: new Date().toISOString(),
      type,
      content,
      tokens,
    }
  }

  private termLog(component: string, level: 'info' | 'warn' | 'error', message: string) {
    const c = level === 'error' ? termColors.red : level === 'warn' ? termColors.yellow : termColors.cyan
    const tag = level === 'info' ? '' : `${c}${level.toUpperCase()}${termColors.reset} `
    console.error(`${c}[${component}]${termColors.reset} ${tag}${message}`)
  }

  private isUserVisibleLog(type: LogEntry['type'], content: string): boolean {
    if (type === 'input' || type === 'output') return true
    const patterns = [
      'Agent 已恢复',
      '工作空间就绪',
      '启动失败',
      'Token 预算已耗尽',
      'Kimi CLI 未找到',
      '启动 Kimi CLI 失败',
      'Agent 执行完毕',
      'Agent 执行失败',
      'Agent 已停止',
      '代码已推送',
      '推送失败',
      'PR #',
      '已合并到 main',
      'PR 被打回',
      '合并被拒绝',
      '审阅通过了此 PR',
      '审阅拒绝了此 PR',
      '全员审阅通过',
      '已指派',
      '自动修改已达最大轮次',
    ]
    return patterns.some((p) => content.includes(p))
  }

  private inferComponent(content: string): string {
    if (content.includes('Kimi') || content.includes('kimi')) return 'Kimi'
    if (content.includes('GitHub') || content.includes('github')) return 'GitHub'
    if (content.includes('git ') || content.includes('仓库') || content.includes('分支') || content.includes('推送') || content.includes('代码') || content.includes('克隆')) return 'Git'
    if (content.includes('审阅')) return 'Review'
    return 'Agent'
  }

  private log(type: LogEntry['type'], content: string, tokens?: number) {
    const entry = this.makeLog(type, content, tokens)
    this.state.logs.push(entry)
    this.state.lastActivity = new Date().toISOString()

    const showInUi = this.isUserVisibleLog(type, content)
    if (showInUi) {
      this.emit({ type: 'log', agentId: this.state.id, entry })
    }

    // system/error 都输出到终端（带颜色、组件前缀）
    if (type === 'system' || type === 'error') {
      const level = type === 'error' ? 'error' : 'info'
      const component = this.inferComponent(content)
      this.termLog(component, level, content)
    }
  }

  private setStatus(status: TaskStatus) {
    this.state.status = status
    this.emit({ type: 'agent-status', agentId: this.state.id, status })
  }

  async start() {
    if (this.state.status !== 'pending' && this.state.status !== 'stopped') return

    const parentDir = 'E:/workspace'
    const targetDir = `${parentDir}/${this.state.id}`

    // 如果 workspace 已存在且有效，复用它（支持从 stopped 恢复）
    if (this.state.workspace && this.state.status === 'stopped') {
      this.log('system', 'Agent 恢复中，复用已有工作空间')
      this.setStatus('ready')
      this.log('system', 'Agent 已恢复，继续对话')
      return
    }

    this.setStatus('cloning')
    this.log('system', '开始克隆仓库...')

    try {
      await cloneRepo(this.state.repoUrl, targetDir, parentDir)
      this.state.workspace = targetDir
      this.log('system', `仓库已克隆到 ${targetDir}`)

      await createBranch(targetDir, this.state.branch)
      this.log('system', `已创建分支: ${this.state.branch}`)

      this.log('system', '工作空间就绪，等待指令')
      this.setStatus('ready')
    } catch (err) {
      this.setStatus('stopped')
      this.log('error', `启动失败: ${String(err)}`)
    }
  }

  async sendInstruction(instruction: string) {
    // Allow continuing conversation from stopped or completed state
    if (this.state.status === 'stopped' || this.state.status === 'completed') {
      this.setStatus('ready')
      this.log('system', 'Agent 已恢复，继续对话')
    }
    if (this.state.status !== 'ready') return

    this.setStatus('working')
    this.state.instruction = instruction
    const inputTokens = Math.floor(instruction.length / 2)
    this.state.tokenUsed += inputTokens
    this.log('input', instruction, inputTokens)

    if (this.state.tokenUsed >= this.state.tokenBudget) {
      this.log('error', 'Token 预算已耗尽，无法执行新指令')
      return
    }

    const kimiPath = await detectKimiCli()
    if (!kimiPath) {
      this.log('error', 'Kimi CLI 未找到。请安装: py -3.12 -m pip install kimi-cli')
      this.setStatus('ready')
      return
    }

    try {
      this.process = runKimi(kimiPath, this.state.workspace, instruction)
    } catch (err) {
      this.log('error', `启动 Kimi CLI 失败: ${String(err)}`)
      this.setStatus('ready')
      return
    }
    this.state.pid = this.process.pid
    // Log the exact command line for observability / debugging
    this.log('system', `Kimi CLI 已启动 (PID: ${this.process.pid})`)
    this.log('system', `命令: ${kimiPath} --work-dir ${this.state.workspace} --prompt "..." --print --final-message-only`)
    this.running = true

    // stdout reader
    ;(async () => {
      try {
        for await (const line of this.process!.stdout) {
          if (!this.running) break
          const estimated = Math.max(1, Math.floor(line.length / 4))
          this.state.tokenUsed = Math.min(this.state.tokenUsed + estimated, this.state.tokenBudget)
          this.log('output', line)
          this.emit({ type: 'agent-output', agentId: this.state.id, line, isStderr: false })

          if (this.state.tokenUsed >= this.state.tokenBudget) {
            this.process!.kill()
            this.log('error', 'Token 预算已耗尽，Agent 执行被中断')
            break
          }
        }
      } catch (err) {
        this.log('error', `stdout reader 异常: ${String(err)}`)
      }
    })()

    // stderr reader — filter out kimi CLI internal loguru errors (Windows known issue)
    let loguruBlockActive = false
    ;(async () => {
      try {
        for await (const line of this.process!.stderr) {
          if (!this.running) break
          // Detect start of loguru error block
          if (line.includes('--- Logging error') && line.includes('Loguru')) {
            loguruBlockActive = true
            this.log('system', '[kimi stderr] loguru logging error filtered (see ~/.kimi/logs)')
            continue
          }
          // End of loguru block: empty line or non-traceback line after PermissionError
          if (loguruBlockActive && (line.trim() === '' || (!line.startsWith('  ') && !line.includes('Traceback')))) {
            loguruBlockActive = false
            continue
          }
          if (loguruBlockActive) continue
          this.log('error', line)
          this.emit({ type: 'agent-output', agentId: this.state.id, line, isStderr: true })
        }
      } catch (err) {
        this.log('error', `stderr reader 异常: ${String(err)}`)
      }
    })()

    // wait for exit
    const code = await this.process.wait()
    this.running = false
    this.state.pid = undefined

    // Use a fresh read because setStatus mutated state but TS narrowed it earlier
    const finalStatus = this.state.status as TaskStatus
    if (finalStatus === 'working') {
      this.setStatus('ready')
      if (code === 0) {
        this.log('system', 'Agent 执行完毕，可以继续发送指令或提交审阅')
      } else {
        this.log('error', `Agent 执行失败，exit code: ${code ?? 'unknown'}。请检查上方日志中的错误信息。`)
      }

      // detect changed files
      if (this.state.workspace) {
        try {
          const files = await getChangedFiles(this.state.workspace)
          this.state.changedFiles = files
          if (files.length > 0) {
            this.log('system', `文件变更: ${files.length} 个文件`)
            this.emit({ type: 'file-changed', agentId: this.state.id, files })
          }
        } catch (err) {
          this.log('error', `检测文件变更失败: ${String(err)}`)
        }
      }
    }
  }

  async stop() {
    if (this.process) {
      this.process.kill()
      this.running = false
      // 等待进程完全退出（kill() 内部 2s 后会 SIGKILL，这里最多等 3s）
      try {
        await Promise.race([
          this.process.wait(),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ])
      } catch {
        // 超时或异常，忽略
      }
    }
    this.state.pid = undefined
    this.setStatus('stopped')
    this.log('system', 'Agent 已停止')
  }

  async submitForReview(githubToken?: string) {
    if (this.state.status !== 'working' && this.state.status !== 'ready') return

    if (this.state.workspace) {
      try {
        await gitAdd(this.state.workspace)
        await gitCommit(this.state.workspace, `feat: ${this.state.name}`)
        await gitPush(this.state.workspace, this.state.branch)
        this.log('system', '代码已推送至远程')
      } catch (err) {
        this.log('error', `推送失败: ${String(err)}`)
        return
      }
    }

    this.setStatus('reviewing')

    // 如果有 GitHub Token，调用真实 API 创建 PR
    if (githubToken) {
      try {
        const pr = await createPullRequest(githubToken, this.state.repoUrl, this.state.branch, `feat: ${this.state.name}`)
        if (pr) {
          this.state.prStatus = 'open'
          this.state.prNumber = pr.number
          this.state.prUrl = pr.html_url
          this.log('system', `PR #${pr.number} 已创建: ${pr.html_url}`)
          return
        }
      } catch (err) {
        this.log('error', `GitHub API 创建 PR 失败: ${String(err)}`)
      }
    }

    // 无 Token 或 API 失败时降级为 Mock
    this.state.prStatus = 'open'
    this.state.prNumber = Math.floor(Math.random() * 100) + 1
    this.state.prUrl = `${this.state.repoUrl.replace(/\.git$/, '')}/pull/${this.state.prNumber}`
    this.log('system', `PR #${this.state.prNumber} 已创建（模拟，未配置 GitHub Token）`)
  }

  canMerge(): boolean {
    if (this.state.reviews.length === 0) return true
    return this.state.reviews.every((r) => r.status === 'approved')
  }

  async mergePr(githubToken?: string) {
    if (this.state.status !== 'reviewing') return
    if (!this.canMerge()) {
      const approved = this.state.reviews.filter((r) => r.status === 'approved').length
      this.log('error', `合并被拒绝：需等待全员审阅通过（${approved}/${this.state.reviews.length}）`)
      return
    }

    // 如果有 GitHub Token，调用真实 API 合并 PR
    if (githubToken && this.state.prNumber) {
      try {
        const ok = await mergePullRequest(githubToken, this.state.repoUrl, this.state.prNumber)
        if (ok) {
          this.setStatus('completed')
          this.state.prStatus = 'merged'
          this.state.reviews = []
          this.log('system', `PR #${this.state.prNumber} 已合并到 main（GitHub）`)
          return
        }
        this.log('error', `GitHub API 合并 PR 失败，可能 PR 尚未就绪`)
      } catch (err) {
        this.log('error', `GitHub API 合并失败: ${String(err)}`)
      }
    }

    // 无 Token 时降级为 Mock
    this.setStatus('completed')
    this.state.prStatus = 'merged'
    this.state.reviews = []
    this.log('system', `PR #${this.state.prNumber} 已合并到 main（模拟）`)
  }

  rejectPr() {
    if (this.state.status !== 'reviewing') return
    this.setStatus('working')
    this.state.prStatus = 'none'
    this.state.reviews = []
    this.log('system', 'PR 被打回，Agent 继续修改')
  }

  submitReview(reviewerAgentId: string, approved: boolean) {
    if (this.state.status !== 'reviewing') return
    const review = this.state.reviews.find((r) => r.reviewerAgentId === reviewerAgentId)
    if (!review) return

    review.status = approved ? 'approved' : 'rejected'
    review.reviewedAt = new Date().toISOString()
    const action = approved ? '通过' : '拒绝'
    this.log('system', `Agent「${review.reviewerName}」审阅${action}了此 PR`)

    const approvedCount = this.state.reviews.filter((r) => r.status === 'approved').length
    if (approvedCount === this.state.reviews.length) {
      this.log('system', '全员审阅通过，等待指挥官合并')
    }
  }

  async getFileDiff(filePath: string): Promise<string> {
    if (!this.state.workspace) return ''
    try {
      return await getFileDiff(this.state.workspace, filePath)
    } catch (err) {
      this.log('error', `获取文件 diff 失败 (${filePath}): ${String(err)}`)
      return ''
    }
  }

  assignReviewers(allAgents: Agent[]) {
    const reviewers: ReviewEntry[] = allAgents
      .filter((a) => a.state.id !== this.state.id)
      .map((a) => ({
        reviewerAgentId: a.state.id,
        reviewerName: a.state.name,
        status: 'pending' as const,
      }))
    this.state.reviews = reviewers
    if (reviewers.length > 0) {
      this.log('system', `已指派 ${reviewers.length} 个 Agent 进行审阅`)
    }
  }

  /**
   * 运行 kimi CLI 执行一次"静默"指令，返回完整 stdout
   * 不修改 running 状态，不 emit agent-output 事件
   */
  private async runInstructionSilent(instruction: string): Promise<string> {
    const kimiPath = await detectKimiCli()
    if (!kimiPath) {
      this.log('error', 'Kimi CLI 未找到，无法执行自动审阅')
      return ''
    }

    let proc: ReturnType<typeof runKimi>
    try {
      proc = runKimi(kimiPath, this.state.workspace, instruction)
    } catch (err) {
      this.log('error', `启动 Kimi CLI 失败: ${String(err)}`)
      return ''
    }

    let output = ''
    try {
      for await (const line of proc.stdout) {
        output += line + '\n'
      }
    } catch (err) {
      this.log('error', `读取 kimi stdout 失败: ${String(err)}`)
    }

    try {
      await proc.wait()
    } catch (err) {
      this.log('error', `等待 kimi 进程退出失败: ${String(err)}`)
    }
    return output
  }

  /**
   * 自动审阅指定分支的代码变更
   * 返回 { approved, comment }
   */
  async runReview(targetBranch: string): Promise<{ approved: boolean; comment: string }> {
    if (!this.state.workspace) {
      return { approved: false, comment: '工作空间未就绪' }
    }

    try {
      await gitFetch(this.state.workspace)
    } catch (err) {
      this.log('error', `fetch 失败: ${String(err)}`)
    }

    const diff = await getBranchDiff(this.state.workspace, targetBranch)
    if (!diff.trim()) {
      return { approved: true, comment: '无代码变更需要审阅' }
    }

    const truncatedDiff = diff.slice(0, 4000)
    const prompt = `请审阅以下代码变更（分支 ${targetBranch}）。\n\n\`\`\`diff\n${truncatedDiff}\n\`\`\`\n\n请检查是否有 bug、安全隐患或规范问题。如果有问题请详细说明；如果没有问题请回复 "LGTM"。`

    this.log('system', `开始对分支 ${targetBranch} 执行自动审阅...`)
    const output = await this.runInstructionSilent(prompt)

    const approved = /LGTM|lgtm|approve|通过|无问题|没问题/i.test(output)
    const comment = approved
      ? '自动审阅通过（LGTM）'
      : `审阅发现潜在问题，kimi 输出如下：\n${output}`

    this.log('system', comment)
    return { approved, comment }
  }

  /**
   * 执行自动审阅并回调结果
   */
  async performReview(
    targetBranch: string,
    targetAgentId: string,
    onComplete: (reviewerId: string, targetId: string, approved: boolean) => void,
  ) {
    if (this.state.status !== 'ready') {
      this.log('system', `当前状态 ${this.state.status}，跳过自动审阅`)
      onComplete(this.state.id, targetAgentId, false)
      return
    }

    try {
      const result = await this.runReview(targetBranch)
      onComplete(this.state.id, targetAgentId, result.approved)
    } catch (err) {
      this.log('error', `自动审阅执行异常: ${String(err)}`)
      onComplete(this.state.id, targetAgentId, false)
    }
  }

  /**
   * 根据审阅意见自动修改代码并重新提交审阅
   * 最多循环 3 轮，超过后停止并通知指挥官
   */
  async fixBasedOnReviews(githubToken?: string) {
    if (this.reviewRound >= 3) {
      this.log('error', '自动修改已达最大轮次（3 次），请指挥官人工介入')
      return
    }
    this.reviewRound++

    const rejectedReviews = this.state.reviews.filter((r) => r.status === 'rejected')
    if (rejectedReviews.length === 0) return

    const comments = rejectedReviews
      .map((r) => `-${r.reviewerName}: ${r.comment || '审阅未通过'}`)
      .join('\n')

    const prompt = `你的 PR 被以下审阅意见拒绝了，请根据意见修改代码：\n\n${comments}\n\n请直接修改相关代码文件。修改完成后不需要额外说明。`

    this.rejectPr()
    this.log('system', `第 ${this.reviewRound} 轮自动修改开始，基于 ${rejectedReviews.length} 条审阅意见`)

    try {
      await this.sendInstruction(prompt)
      // sendInstruction 完成后状态为 ready，改回 working 以符合 submitForReview 前置条件
      this.state.status = 'working'
      await this.submitForReview(githubToken)
    } catch (err) {
      this.log('error', `自动修改执行异常: ${String(err)}`)
    }
  }
}
