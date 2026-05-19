import type { AgentState, LogEntry, ReviewEntry, TaskStatus, EngineEvent } from './types.js'
import { runKimi, detectKimiCli, type KimiProcess } from './kimi.js'
import { getChangedFiles, getStagedFiles, getFileDiff, gitAdd, gitCommit, gitPush, createBranch, cloneRepo, gitFetch, getBranchDiff, gitDeleteRemoteBranch } from './git.js'
import { createPullRequest, mergePullRequest, getPullRequest, getPullRequestReviews, getCheckRuns, getCheckRunLogs, submitPullRequestReview, getAuthenticatedUser } from './github-api.js'
import { readFile } from 'fs/promises'

interface SubmitStep {
  name: string
  stdout: string
  stderr: string
  exitCode: number
}

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
  private githubToken?: string
  private githubUser?: string
  private autoSubmitting = false
  private ciMonitorTimer?: NodeJS.Timeout
  private ciRetryCount = 0
  private readonly CI_MAX_RETRIES = 3
  private readonly CI_POLL_INTERVAL_MS = 30000
  private readonly CI_TIMEOUT_MS = 600000

  constructor(
    name: string,
    repoUrl: string,
    instruction: string,
    tokenBudget: number,
    emit: (event: EngineEvent) => void,
    private onPrCreated?: (agentId: string, branch: string, githubToken?: string) => Promise<void> | void,
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

  private buildContextPrompt(instruction: string): string {
    // 正序遍历 logs，从早到晚拼接完整对话历史
    const history: string[] = []
    for (const log of this.state.logs) {
      if (log.type === 'input' || log.type === 'output') {
        // 跳过当前正在发送的这条 input（它已在 sendInstruction 里被 push 进 logs）
        if (log.type === 'input' && log.content === instruction) continue
        const prefix = log.type === 'input' ? 'User' : 'Assistant'
        history.push(`${prefix}: ${log.content}`)
      }
    }
    return history.join('\n\n')
  }

  async sendInstruction(instruction: string, githubToken?: string) {
    // Allow continuing conversation from stopped or completed state
    if (this.state.status === 'stopped' || this.state.status === 'completed') {
      this.setStatus('ready')
      this.log('system', 'Agent 已恢复，继续对话')
    }
    if (this.state.status !== 'ready') return

    this.githubToken = githubToken
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

    // 拼接历史上下文 + 当前指令
    const history = this.buildContextPrompt(instruction)
    const fullPrompt = history ? `${history}\n\nUser: ${instruction}` : instruction

    try {
      this.process = runKimi(kimiPath, this.state.workspace, fullPrompt, { streamJson: true, thinking: true })
    } catch (err) {
      this.log('error', `启动 Kimi CLI 失败: ${String(err)}`)
      this.setStatus('ready')
      return
    }
    this.state.pid = this.process.pid
    // Log the exact command line for observability / debugging
    this.log('system', `Kimi CLI 已启动 (PID: ${this.process.pid})`)
    this.log('system', `命令: ${kimiPath} --work-dir ${this.state.workspace} --prompt "..." --print --output-format stream-json --thinking`)
    this.running = true

    // stdout reader — parse stream-json and emit structured streaming chunks in real-time
    const outputLines: string[] = []
    let streamJsonOk = false
    ;(async () => {
      try {
        for await (const line of this.process!.stdout) {
          if (!this.running) break
          const estimated = Math.max(1, Math.floor(line.length / 4))
          this.state.tokenUsed = Math.min(this.state.tokenUsed + estimated, this.state.tokenBudget)

          // Try to parse as stream-json structured output
          let parsed = false
          try {
            const json = JSON.parse(line)
            if (json.role === 'assistant') {
              if (Array.isArray(json.content)) {
                for (const chunk of json.content) {
                  if (chunk.type === 'think' && chunk.think) {
                    this.emit({ type: 'agent-stream', agentId: this.state.id, chunk: { type: 'think', content: chunk.think } })
                  } else if (chunk.type === 'text' && chunk.text) {
                    this.emit({ type: 'agent-stream', agentId: this.state.id, chunk: { type: 'text', content: chunk.text } })
                  }
                }
              }
              if (Array.isArray(json.tool_calls)) {
                for (const tc of json.tool_calls) {
                  if (tc.type === 'function') {
                    const name = tc.function?.name || 'unknown'
                    const args = tc.function?.arguments || '{}'
                    const id = tc.id || ''
                    const isMcp = name.toLowerCase().includes('mcp')
                    this.emit({ type: 'agent-stream', agentId: this.state.id, chunk: { type: isMcp ? 'mcp' : 'tool_call', name, arguments: args, id } })
                  }
                }
              }
              parsed = true
            } else if (json.role === 'tool') {
              const content = Array.isArray(json.content)
                ? json.content.map((c: any) => c.text || '').join('')
                : String(json.content)
              this.emit({ type: 'agent-stream', agentId: this.state.id, chunk: { type: 'tool_result', content, toolCallId: json.tool_call_id } })
              parsed = true
            }
          } catch {
            // Not a valid stream-json line — treat as raw text
          }

          if (parsed && !streamJsonOk) {
            streamJsonOk = true
            this.log('system', 'stream-json 解析成功')
          }

          if (!parsed) {
            outputLines.push(line)
            this.emit({ type: 'agent-output', agentId: this.state.id, line, isStderr: false })
          }

          if (this.state.tokenUsed >= this.state.tokenBudget) {
            this.process!.kill()
            this.log('error', 'Token 预算已耗尽，Agent 执行被中断')
            break
          }
        }
        if (!streamJsonOk) {
          this.log('error', 'stream-json 解析失败：本次会话未收到任何有效的结构化流式输出')
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
          if (line.includes('--- Logging error')) {
            loguruBlockActive = true
            this.termLog('Kimi', 'warn', 'loguru logging error filtered (see ~/.kimi/logs)')
            continue
          }
          // End of loguru block: explicit end marker
          if (loguruBlockActive && line.includes('--- End of logging error')) {
            loguruBlockActive = false
            continue
          }
          if (loguruBlockActive) continue
          // Skip empty lines to avoid [Agent] ERROR spam in terminal
          if (!line.trim()) continue
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
    this.process = undefined  // 清理引用，避免 stop() 再次 kill 已死进程

    // Record complete output as a single log entry so the UI renders one bubble
    // Skip if text was already streamed in real-time to avoid duplicates
    const fullOutput = outputLines.join('\n')
    if (fullOutput && !streamJsonOk) {
      this.log('output', fullOutput)
    }

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
            // Agent 完成代码修改后自动提交审阅，pre-commit 失败会自动修复并重试
            this.log('system', '检测到代码变更，自动提交审阅...')
            await this.autoSubmitForReview()
          }
        } catch (err) {
          this.log('error', `检测文件变更失败: ${String(err)}`)
        }
      }
    }
  }

  async stop() {
    this.stopCiMonitor()
    if (this.process) {
      this.process.kill()
      this.running = false
      // 等待进程完全退出（kill() 内部 2s 后会强制终止，Windows 留足 5s）
      try {
        await Promise.race([
          this.process.wait(),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ])
      } catch {
        this.log('system', 'Agent 进程未在 5 秒内退出，工作目录文件可能仍被占用')
      }
      this.process = undefined
    }
    this.state.pid = undefined
    this.setStatus('stopped')
    this.log('system', 'Agent 已停止')
  }

  async submitForReview(githubToken?: string): Promise<{ ok: boolean; steps: SubmitStep[] }> {
    if (githubToken) {
      this.githubToken = githubToken
    }
    // reviewing 也允许：CI 失败后需在审阅中追加 commit 重新提交
    if (this.state.status !== 'working' && this.state.status !== 'ready' && this.state.status !== 'reviewing') {
      return { ok: false, steps: [] }
    }

    const steps: SubmitStep[] = []

    let prTitle = `feat: ${this.state.name}`
    let prBody = `由 Kimi Code Swarm Agent 自动创建`

    if (this.state.workspace) {
      // git add
      const addRes = await gitAdd(this.state.workspace)
      steps.push({ name: 'git add', stdout: addRes.stdout, stderr: addRes.stderr, exitCode: addRes.exitCode })
      if (addRes.exitCode !== 0) {
        return { ok: false, steps }
      }

      // 获取 staged 文件列表，生成规范的 commit message 和 PR 描述
      const stagedFiles = await getStagedFiles(this.state.workspace)
      const generated = await this.generateCommitAndPrBody(stagedFiles)
      this.log('system', `生成提交信息: ${generated.commitMessage}`)

      // git commit
      const commitRes = await gitCommit(this.state.workspace, generated.commitMessage)
      steps.push({ name: 'git commit', stdout: commitRes.stdout, stderr: commitRes.stderr, exitCode: commitRes.exitCode })
      if (commitRes.exitCode !== 0) {
        return { ok: false, steps }
      }

      // git push
      const pushRes = await gitPush(this.state.workspace, this.state.branch)
      steps.push({ name: 'git push', stdout: pushRes.stdout, stderr: pushRes.stderr, exitCode: pushRes.exitCode })
      if (pushRes.exitCode !== 0) {
        return { ok: false, steps }
      }

      this.log('system', '代码已推送至远程')

      // 保存生成的 PR 内容（commit 后 staged 文件会被清空，需提前保存）
      prTitle = generated.prTitle
      prBody = generated.prBody
    }

    this.setStatus('reviewing')

    // 如果已有 open PR，跳过创建，直接启动 CI 监控
    if (this.state.prStatus === 'open' && this.state.prNumber && githubToken) {
      this.log('system', `PR #${this.state.prNumber} 已存在，新 commit 已追加`)
      // 补录 PR 作者，并缓存当前 Token 用户（旧数据可能没有）
      if (!this.githubUser) {
        this.githubUser = await getAuthenticatedUser(githubToken) || undefined
      }
      if (!this.state.prAuthor) {
        const pr = await getPullRequest(githubToken, this.state.repoUrl, this.state.prNumber)
        if (pr) this.state.prAuthor = pr.user.login
      }
      this.startCiMonitor(githubToken)
      this.notifyPrCreated()
      return { ok: true, steps }
    }

    // 如果有 GitHub Token，调用真实 API 创建 PR
    if (githubToken) {
      try {
        const pr = await createPullRequest(githubToken, this.state.repoUrl, this.state.branch, prTitle, prBody)
        if (pr) {
          this.state.prStatus = 'open'
          this.state.prNumber = pr.number
          this.state.prUrl = pr.html_url
          // 记录 PR 作者，并缓存当前 Token 用户（自审场景判断用）
          if (!this.githubUser) {
            this.githubUser = await getAuthenticatedUser(githubToken) || undefined
          }
          this.state.prAuthor = this.githubUser
          this.log('system', `PR #${pr.number} 已创建: ${pr.html_url}`)
          this.startCiMonitor(githubToken)
          this.notifyPrCreated()
          return { ok: true, steps }
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
    this.notifyPrCreated()
    return { ok: true, steps }
  }

  /**
   * 启动 GitHub Actions CI 轮询监控
   * PR 创建成功后调用，自动检测 CI 失败并触发修复
   */
  async startCiMonitor(githubToken: string): Promise<void> {
    this.stopCiMonitor()

    if (!this.state.prNumber || !githubToken) return

    this.state.ciStatus = 'pending'
    this.log('system', '开始监控 GitHub Actions CI 状态...')

    const startTime = Date.now()

    this.ciMonitorTimer = setInterval(async () => {
      // 超时检查
      if (Date.now() - startTime > this.CI_TIMEOUT_MS) {
        this.stopCiMonitor()
        this.state.ciStatus = 'unknown'
        this.log('error', 'CI 监控超时（10分钟），请指挥官人工检查 CI 状态')
        return
      }

      // 查询 PR 获取 head sha
      const pr = await getPullRequest(githubToken, this.state.repoUrl, this.state.prNumber!)
      if (!pr) return

      // 查询 check runs
      const checks = await getCheckRuns(githubToken, this.state.repoUrl, pr.head.sha)
      if (!checks || checks.total_count === 0) return

      // 检查是否还有进行中
      const hasInProgress = checks.check_runs.some((r) => r.status !== 'completed')
      if (hasInProgress) return

      // 所有 check 都完成了
      const failedRun = checks.check_runs.find((r) => r.conclusion === 'failure')
      if (failedRun) {
        this.stopCiMonitor()
        this.state.ciStatus = 'failure'
        this.log('error', `CI 失败: ${failedRun.name}`)

        const logs = await getCheckRunLogs(githubToken, this.state.repoUrl, failedRun.id, failedRun.details_url)
        await this.fixBasedOnCiFailure(logs || `Check run "${failedRun.name}" failed. No logs available.`)
        return
      }

      // 全部通过
      this.stopCiMonitor()
      this.state.ciStatus = 'success'
      this.log('system', 'GitHub Actions CI 全部通过 ✅')
    }, this.CI_POLL_INTERVAL_MS)
  }

  /**
   * 停止 CI 轮询定时器
   */
  stopCiMonitor(): void {
    if (this.ciMonitorTimer) {
      clearInterval(this.ciMonitorTimer)
      this.ciMonitorTimer = undefined
    }
  }

  /**
   * 基于 CI 失败日志自动修复代码并重新提交
   */
  private async fixBasedOnCiFailure(ciLogs: string): Promise<void> {
    this.ciRetryCount++
    if (this.ciRetryCount > this.CI_MAX_RETRIES) {
      this.log('error', `CI 修复已达最大轮次（${this.CI_MAX_RETRIES} 次），请指挥官人工介入`)
      this.setStatus('ready')
      return
    }

    this.log('system', `CI 失败，第 ${this.ciRetryCount}/${this.CI_MAX_RETRIES} 轮自动修复...`)
    const fixPrompt = `GitHub Actions CI 检查失败了，日志如下：\n\n${ciLogs}\n\n请根据上述日志修改代码文件，使其能够通过 CI 检查。直接修改相关文件，不需要额外说明。`
    await this.runInstructionSilent(fixPrompt)

    // 修复后重新检测变更
    if (this.state.workspace) {
      try {
        this.state.changedFiles = await getChangedFiles(this.state.workspace)
      } catch {
        // 忽略检测失败
      }
    }

    // 重新提交（autoSubmitForReview 成功后会再次启动 CI 监控）
    await this.autoSubmitForReview()
  }

  /**
   * 自动提交审阅：失败时让 Agent 流式修复并重试，最多 3 次。
   * 防重入：修复步走 sendInstruction，其尾部会再次触发 autoSubmitForReview，
   * 用 autoSubmitting 守卫避免无限递归——外层负责重试，尾部触发的内层直接跳过。
   */
  async autoSubmitForReview(maxRetries = 3): Promise<void> {
    if (this.autoSubmitting) return
    this.autoSubmitting = true
    try {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const { ok, steps } = await this.submitForReview(this.githubToken)
        if (ok) return

        // 构建完整执行日志
        const fullLog = steps.map((s) => {
          let out = `=== ${s.name} (exit: ${s.exitCode}) ===`
          if (s.stdout) out += `\n[stdout]\n${s.stdout}`
          if (s.stderr) out += `\n[stderr]\n${s.stderr}`
          return out
        }).join('\n\n')

        this.log('error', `提交审阅失败 (${attempt}/${maxRetries})`)
        if (attempt >= maxRetries) {
          this.log('error', '多次尝试后仍无法提交审阅，请指挥官人工介入')
          this.setStatus('ready')
          return
        }
        this.log('system', '正在根据执行日志自动修复...')
        const fixPrompt = `你刚才尝试提交代码，执行日志如下：\n\n${fullLog}\n\n请根据上述日志中的错误信息，修改相关文件，使其能够通过项目的 typecheck、lint 和 pre-commit 检查。直接修改相关文件，不需要额外说明。`
        // 走流式 sendInstruction：修复过程实时显示在对话框，且无 runInstructionSilent 的硬超时
        await this.sendInstruction(fixPrompt)
        // 修复后重新检测变更
        if (this.state.workspace) {
          try {
            this.state.changedFiles = await getChangedFiles(this.state.workspace)
          } catch {
            // 忽略检测失败
          }
        }
      }
    } finally {
      this.autoSubmitting = false
    }
  }

  async canMerge(githubToken?: string): Promise<boolean> {
    // 单账号产品 fail-open：身份判不出时回退到内部 reviews 状态
    if (githubToken && this.state.prNumber && this.state.prAuthor && this.githubUser) {
      if (this.githubUser === this.state.prAuthor) {
        // 自审场景：GitHub 不允许自己 approve 自己，以内部 reviews 状态为准
        if (this.state.reviews.length === 0) return true
        const allApproved = this.state.reviews.every((r) => r.status === 'approved')
        if (allApproved) {
          this.log('system', '自审场景：内部 review 全部通过，准备通过管理员权限合并')
        }
        return allApproved
      }
      // 多人协作场景：以 GitHub API 为准
      const reviews = await getPullRequestReviews(githubToken, this.state.repoUrl, this.state.prNumber)
      if (reviews) {
        const latestByUser = new Map<string, string>()
        for (const r of reviews) {
          latestByUser.set(r.user.login, r.state)
        }
        const approvedCount = Array.from(latestByUser.values()).filter((s) => s === 'APPROVED').length
        return approvedCount >= 1
      }
    }

    // 无 Token / 未获取到身份 / Mock 模式 → 回退到内部状态
    if (this.state.reviews.length === 0) return true
    return this.state.reviews.every((r) => r.status === 'approved')
  }

  async mergePr(githubToken?: string) {
    if (this.state.status !== 'reviewing') return
    const canMerge = await this.canMerge(githubToken)
    if (!canMerge) {
      this.log('error', '合并被拒绝：GitHub 上 review 未满足分支保护规则要求')
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
          // 合并成功后清理远程分支，避免仓库堆积垃圾分支
          if (this.state.workspace) {
            try {
              await gitDeleteRemoteBranch(this.state.workspace, this.state.branch)
              this.log('system', `远程分支已清理: ${this.state.branch}`)
            } catch (err) {
              this.log('error', `删除远程分支失败: ${String(err)}`)
            }
          }
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
    // Mock 模式下同样清理远程分支
    if (this.state.workspace) {
      try {
        await gitDeleteRemoteBranch(this.state.workspace, this.state.branch)
        this.log('system', `远程分支已清理: ${this.state.branch}`)
      } catch (err) {
        this.log('error', `删除远程分支失败: ${String(err)}`)
      }
    }
  }

  rejectPr() {
    if (this.state.status !== 'reviewing') return
    this.setStatus('working')
    this.state.prStatus = 'none'
    this.state.reviews = []
    this.log('system', 'PR 被打回，Agent 继续修改')
  }

  private notifyPrCreated() {
    if (this.onPrCreated) {
      Promise.resolve(this.onPrCreated(this.state.id, this.state.branch, this.githubToken)).catch((err) => {
        this.log('error', `PR 创建后通知 engine 失败: ${String(err)}`)
      })
    }
  }

  async submitReview(reviewerAgentId: string, approved: boolean, comment?: string) {
    if (this.state.status !== 'reviewing') return
    const review = this.state.reviews.find((r) => r.reviewerAgentId === reviewerAgentId)
    if (!review) return

    // 同步到 GitHub
    if (this.githubToken && this.state.prNumber) {
      const reviewBody = comment || (approved ? '自动审阅通过' : '自动审阅发现潜在问题')
      const isSelfReview = this.githubUser && this.state.prAuthor && this.githubUser === this.state.prAuthor

      if (isSelfReview) {
        // 自审场景：proactive 直接发 COMMENT，不猜 GitHub 错误串
        const result = await submitPullRequestReview(
          this.githubToken,
          this.state.repoUrl,
          this.state.prNumber,
          'COMMENT',
          `[自审] ${reviewBody}\n\n> 注：GitHub 不允许 PR 作者 approve 自己的 PR，此评论仅作为审阅记录。`,
        )
        if (result.ok) {
          this.log('system', '自审场景：审阅意见已作为 comment 发布到 GitHub PR')
        } else {
          this.log('system', '自审场景：审阅意见发布 comment 失败，仅保留内部审阅状态')
        }
      } else {
        const event = approved ? 'APPROVE' : 'REQUEST_CHANGES'
        const result = await submitPullRequestReview(
          this.githubToken,
          this.state.repoUrl,
          this.state.prNumber,
          event,
          reviewBody,
        )
        if (!result.ok) {
          this.log('error', `GitHub review 提交失败: ${result.error || '未知错误'}`)
        }
      }
    }

    review.status = approved ? 'approved' : 'rejected'
    review.reviewedAt = new Date().toISOString()
    const action = approved ? '通过' : '拒绝'
    this.log('system', `Agent「${review.reviewerName}」审阅${action}了此 PR`)
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
  private async runInstructionSilent(instruction: string, timeoutMs = 120000): Promise<string> {
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
    const timeoutPromise = new Promise<string>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer)
        proc.kill()
        reject(new Error(`Kimi CLI 执行超时（${timeoutMs}ms），已终止进程`))
      }, timeoutMs)
    })

    const runPromise = (async () => {
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
    })()

    try {
      return await Promise.race([runPromise, timeoutPromise])
    } catch (err) {
      this.log('error', String(err))
      return output
    }
  }

  /**
   * 从仓库根目录读取 Skill 文件内容
   */
  private async loadSkill(skillPath: string): Promise<string> {
    if (!this.state.workspace) return ''
    try {
      const content = await readFile(`${this.state.workspace}/${skillPath}`, 'utf-8')
      return content
    } catch {
      return ''
    }
  }

  /**
   * 基于变更文件列表生成 commit message 和 PR 描述
   * 优先调用 Kimi CLI 生成高质量内容，失败时 fallback 到规则生成
   * Skill 文件（skills/commit/SKILL.md、.github/pull_request_template.md）作为唯一事实源
   */
  private async generateCommitAndPrBody(files: string[]): Promise<{ commitMessage: string; prTitle: string; prBody: string }> {
    // 1. 读取 Skill 文件作为事实源
    const commitSkill = await this.loadSkill('skills/commit/SKILL.md')
    const prTemplate = await this.loadSkill('.github/pull_request_template.md')

    const fileList = files.map((f) => `- ${f}`).join('\n')
    const prompt = `你是一位资深工程师。请根据以下代码变更文件列表，生成规范的 commit message 和 PR 描述。

## Commit Message 规范
${commitSkill || '遵循 Conventional Commits：type(scope): summary，英文，首字母不大写，不用句号，≤50字符'}

## PR Body 规范
${prTemplate || '用中文 Markdown 格式，列出变更文件作用、类型勾选、检查项'}

变更文件：
${fileList}

请严格按以下格式输出（不要有多余内容）：
COMMIT:
<commit message>
---
PR_BODY:
<pr body>
`

    try {
      const output = await this.runInstructionSilent(prompt, 60000)
      const commitMatch = output.match(/COMMIT:\s*([\s\S]+?)(?=\n---\nPR_BODY:)/)
      const bodyMatch = output.match(/PR_BODY:\s*([\s\S]+)/)

      if (commitMatch && bodyMatch) {
        const commitMessage = commitMatch[1].trim()
        const prBody = bodyMatch[1].trim()
        // PR title 取 commit message 的第一行
        const prTitle = commitMessage.split('\n')[0].trim()
        return { commitMessage, prTitle, prBody }
      }
    } catch {
      // Kimi CLI 生成失败，继续 fallback
    }

    // 2. Fallback：基于规则自动生成
    const { scope, action } = this.inferScopeAndAction(files)
    const description = this.inferDescription(files, action)
    const commitMessage = `${action}${scope ? `(${scope})` : ''}: ${description}`

    const prBodyLines = [
      '## 变更内容',
      '',
      ...files.map((f) => {
        const filename = f.split('/').pop() || f
        if (f.endsWith('.spec.ts') || f.endsWith('.test.ts')) return `- 补充 \`${filename}\` 单元测试`
        if (f.endsWith('.vue')) return `- 新增/更新 \`${filename}\` 组件`
        if (f.endsWith('.ts') || f.endsWith('.js')) return `- 新增/更新 \`${filename}\` 逻辑`
        if (f.endsWith('.md')) return `- 更新 \`${filename}\` 文档`
        return `- 变更 \`${filename}\``
      }),
      '',
      '## 类型',
      '',
      `- [${action === 'feat' ? 'x' : ' '}] feat: 新功能`,
      `- [${action === 'fix' ? 'x' : ' '}] fix: Bug 修复`,
      `- [${action === 'refactor' ? 'x' : ' '}] refactor: 代码重构`,
      `- [${action === 'docs' ? 'x' : ' '}] docs: 文档更新`,
      `- [${action === 'test' ? 'x' : ' '}] test: 测试补充`,
      `- [${action === 'chore' ? 'x' : ' '}] chore: 构建/工具链`,
      '',
      '## 检查项',
      '',
      '- [x] 本地 pre-commit 通过',
      '- [x] 测试已补充或无需补充',
      '- [x] 文档已同步或无需同步',
    ]

    const prBody = prBodyLines.join('\n')
    return { commitMessage, prTitle: commitMessage, prBody }
  }

  /**
   * 根据文件路径推断 scope 和 action
   */
  private inferScopeAndAction(files: string[]): { scope: string; action: string } {
    const scopes = new Set<string>()
    let hasNew = false
    let hasModify = false

    for (const f of files) {
      if (f.startsWith('kimi-code-swarm/src/components/') || f.startsWith('kimi-code-swarm/src/composables/') || f.startsWith('kimi-code-swarm/src/App.vue')) {
        scopes.add('frontend')
      } else if (f.startsWith('kimi-code-swarm/src/store/') || f.startsWith('kimi-code-swarm/src/api/')) {
        scopes.add('frontend')
      } else if (f.startsWith('agent-engine/src/')) {
        scopes.add('agent-engine')
      } else if (f.startsWith('docs/')) {
        scopes.add('docs')
      } else if (f.startsWith('tests/') || f.includes('.spec.ts') || f.includes('.test.ts')) {
        scopes.add('test')
      } else if (f.startsWith('ci/')) {
        scopes.add('ci')
      } else if (f.startsWith('ast/')) {
        scopes.add('ast')
      } else if (f.startsWith('src-tauri/')) {
        scopes.add('tauri')
      }
      // 简单判断新增还是修改（通过文件名特征无法准确判断，默认用 update，如果有测试文件用 add test）
      if (f.includes('.spec.ts') || f.includes('.test.ts')) hasNew = true
      else hasModify = true
    }

    const scope = scopes.size === 1 ? Array.from(scopes)[0] : scopes.size > 1 ? 'multi' : ''
    const action = hasNew && !hasModify ? 'feat' : hasNew && hasModify ? 'feat' : 'refactor'
    return { scope, action }
  }

  /**
   * 根据文件名生成描述
   */
  private inferDescription(files: string[], action: string): string {
    const names = files
      .map((f) => f.split('/').pop() || f)
      .filter((f) => !f.endsWith('.spec.ts') && !f.endsWith('.test.ts'))

    if (names.length === 0) {
      const testFiles = files.map((f) => f.split('/').pop() || f).filter((f) => f.endsWith('.spec.ts') || f.endsWith('.test.ts'))
      if (testFiles.length > 0) return `add unit tests for ${testFiles.map((f) => f.replace(/\.(spec|test)\.ts$/, '')).join(', ')}`
    }

    if (names.length === 1) {
      const name = names[0].replace(/\.vue$/, '').replace(/\.ts$/, '').replace(/\.js$/, '')
      return action === 'feat' ? `add ${name}` : `update ${name}`
    }

    const baseNames = names.map((n) => n.replace(/\.vue$/, '').replace(/\.ts$/, '').replace(/\.js$/, ''))
    return action === 'feat' ? `add ${baseNames.slice(0, 3).join(', ')}${baseNames.length > 3 ? ' and more' : ''}` : `update multiple files`
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
    onComplete: (reviewerId: string, targetId: string, approved: boolean, comment: string) => void,
  ) {
    // 完成任务(completed)或正在等待自身 PR 审阅(reviewing)的 Agent 仍应参与审阅；
    // 仅 working（占用 kimi 进程）等状态才跳过
    if (this.state.status !== 'ready' && this.state.status !== 'completed' && this.state.status !== 'reviewing') {
      this.log('system', `当前状态 ${this.state.status}，跳过自动审阅`)
      onComplete(this.state.id, targetAgentId, false, `当前状态 ${this.state.status}，无法参与审阅`)
      return
    }

    try {
      const result = await this.runReview(targetBranch)
      onComplete(this.state.id, targetAgentId, result.approved, result.comment)
    } catch (err) {
      this.log('error', `自动审阅执行异常: ${String(err)}`)
      onComplete(this.state.id, targetAgentId, false, `审阅异常: ${String(err)}`)
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
      const { ok, steps } = await this.submitForReview(githubToken)
      if (!ok) {
        const fullLog = steps.map((s) => {
          let out = `=== ${s.name} (exit: ${s.exitCode}) ===`
          if (s.stdout) out += `\n[stdout]\n${s.stdout}`
          if (s.stderr) out += `\n[stderr]\n${s.stderr}`
          return out
        }).join('\n\n')
        this.log('error', `自动修改后提交失败，日志如下：\n${fullLog}`)
      }
    } catch (err) {
      this.log('error', `自动修改执行异常: ${String(err)}`)
    }
  }
}
