import type { AgentState, LogEntry, ReviewEntry, TaskStatus, PrStatus, EngineEvent } from './types.js'
import type { PersistedAgent } from './persist.js'
import { runKimi, detectKimiCli, type KimiProcess } from './kimi.js'
import { getChangedFiles, getFileDiff, createBranch, cloneRepo, gitFetch, getBranchDiff } from './git.js'
import { mergePullRequest, getPullRequestReviews, submitPullRequestReview, getPullRequestByBranch, getAuthenticatedUser } from './github-api.js'


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

/** Kimi CLI 每次 --print 运行结束会在 stderr 打印的会话恢复提示，用于捕获 session id */
export const SESSION_RESUME_RE = /To resume this session: kimi -r ([a-f0-9-]+)/i

export class Agent {
  state: AgentState
  private process?: KimiProcess
  private emit: (event: EngineEvent) => void
  private running = false
  private githubToken?: string
  private githubUser?: string
  /** 正在进行的审阅 target id 集合，防止延后重试对同一 target 重复 runReview */
  private activeReviews = new Set<string>()
  // 上次持久化时的业务字段指纹；高频字段（tokenUsed/lastActivity）不参与，
  // 避免 stdout 流式回推每 10 行就触发一次写盘。
  private lastPersistFingerprint?: string
  constructor(
    name: string,
    repoUrl: string,
    tokenBudget: number,
    emit: (event: EngineEvent) => void,
    private onPersist?: () => void,
  ) {
    this.emit = emit
    this.state = {
      id: generateId(),
      name,
      status: 'pending',
      repoUrl,
      workspace: '',
      branch: branchName(name),
      prStatus: 'none',
      tokenUsed: 0,
      tokenBudget,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      logs: [this.makeLog('system', 'Agent 已创建，等待启动...')],
      reviews: [],
    }
  }

  /**
   * 从持久化状态恢复一个 Agent —— 用于引擎重启后的 restore。
   * Logs 不恢复（由前端缓存）；status / kimiSessionId / PR 等业务字段还原。
   */
  static fromPersisted(
    p: PersistedAgent,
    emit: (event: EngineEvent) => void,
    onPersist?: () => void,
  ): Agent {
    const a = new Agent(p.name, p.repoUrl, p.tokenBudget, emit, onPersist)
    a.state.id = p.id
    a.state.status = p.status as TaskStatus
    a.state.workspace = p.workspace
    a.state.branch = p.branch
    a.state.prStatus = p.prStatus as PrStatus
    a.state.prNumber = p.prNumber
    a.state.prUrl = p.prUrl
    a.state.prAuthor = p.prAuthor
    a.state.tokenUsed = p.tokenUsed
    a.state.kimiSessionId = p.kimiSessionId
    a.state.reviews = (p.reviews as ReviewEntry[]) ?? []
    a.state.changedFiles = p.changedFiles
    a.state.createdAt = p.createdAt
    a.state.lastActivity = p.lastActivity
    a.state.logs = []   // logs 来自前端缓存
    return a
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
      '文件变更',
      '检测到代码变更',
      '代码已推送',
      '推送失败',
      'PR #',
      '已合并到 main',
      'PR 被打回',
      '合并被拒绝',
      '审阅通过了此 PR',
      '审阅拒绝了此 PR',
      // 引擎自动修复触发提示：让用户在 UI 看到「不是我发的指令，是引擎在修」
      '自动修复',
      '自动修改开始',
      '正在根据执行日志自动修复',
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
    this.syncState()
  }

  syncState() {
    // 只发送 Store 实际消费的字段；reviews/changedFiles 深拷贝，避免 Store 端
    // 修改反向污染引擎状态；不带 logs 等大字段，避免长 run 反复全量深拷贝
    const s = this.state
    this.emit({
      type: 'agent-state',
      agentId: s.id,
      state: {
        status: s.status,
        workspace: s.workspace,
        branch: s.branch,
        prStatus: s.prStatus,
        prNumber: s.prNumber,
        prUrl: s.prUrl,
        pid: s.pid,
        tokenUsed: s.tokenUsed,
        lastActivity: s.lastActivity,
        reviews: structuredClone(s.reviews),
        changedFiles: structuredClone(s.changedFiles),
        kimiSessionId: s.kimiSessionId,
      },
    })

    // 仅当业务字段（status/workspace/branch/pr*/kimiSessionId/reviews/changedFiles）
    // 发生变化时才触发持久化；tokenUsed/lastActivity 高频抖动不参与，避免流式回推每 10 行写一次盘。
    const fp = this.businessFingerprint()
    if (fp !== this.lastPersistFingerprint) {
      this.lastPersistFingerprint = fp
      this.onPersist?.()
    }
  }

  /** 业务字段指纹：只取重启 restore 真正需要的字段，剔除高频抖动字段 */
  private businessFingerprint(): string {
    const s = this.state
    return JSON.stringify({
      status: s.status,
      workspace: s.workspace,
      branch: s.branch,
      prStatus: s.prStatus,
      prNumber: s.prNumber,
      prUrl: s.prUrl,
      prAuthor: s.prAuthor,
      kimiSessionId: s.kimiSessionId,
      reviews: s.reviews,
      changedFiles: s.changedFiles,
    })
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
      this.syncState()
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

  async sendInstruction(
    instruction: string,
    githubToken?: string,
    opts: { displayAsUserInput?: boolean } = {},
  ) {
    // Allow continuing conversation from stopped or completed state
    if (this.state.status === 'stopped' || this.state.status === 'completed') {
      this.setStatus('ready')
      this.log('system', 'Agent 已恢复，继续对话')
    }

    if (this.state.status !== 'ready') return

    // token 是 agent 持久凭据，并非每条指令都携带，有条件赋值避免覆盖已知值
    if (githubToken) this.githubToken = githubToken
    this.setStatus('working')
    const inputTokens = Math.floor(instruction.length / 2)
    this.state.tokenUsed += inputTokens
    // displayAsUserInput: true（默认）→ 写 'input' log，UI 显示成用户气泡 +
    // 被 lastInput computed pick 到，作为「任务指令」展示。
    // false → 引擎内部注入（CI 自动修复 / 审阅拒绝后的修复 prompt），写 'system'
    // log，避免污染「任务指令」区 + 不在聊天面板显示巨大的注入 prompt；
    // kimi 的 think / output 流仍通过 agent-stream 事件实时显示，用户照样看得见
    // agent 在做什么。
    const displayAsInput = opts.displayAsUserInput !== false
    this.log(displayAsInput ? 'input' : 'system', instruction, inputTokens)
    this.syncState()

    if (this.state.tokenUsed >= this.state.tokenBudget) {
      this.log('error', 'Token 预算已耗尽，无法执行新指令')
      this.syncState()
      return
    }

    const kimiPath = await detectKimiCli()
    if (!kimiPath) {
      this.log('error', 'Kimi CLI 未找到。请安装: py -3.12 -m pip install kimi-cli')
      this.setStatus('ready')
      return
    }

    // 如果有 Kimi 原生 session，只发增量指令；否则 fallback：平铺历史 + 当前指令
    // （buildContextPrompt 只返回历史、不含当前指令，必须自己补回，否则这一轮丢失）
    const hasSession = !!this.state.kimiSessionId
    let prompt: string
    if (hasSession) {
      prompt = instruction
    } else {
      const history = this.buildContextPrompt(instruction)
      prompt = history ? `${history}\n\nUser: ${instruction}` : instruction
    }

    try {
      this.process = runKimi(kimiPath, this.state.workspace, prompt, {
        streamJson: true,
        thinking: true,
        sessionId: this.state.kimiSessionId,
      })
    } catch (err) {
      this.log('error', `启动 Kimi CLI 失败: ${String(err)}`)
      this.setStatus('ready')
      return
    }
    this.state.pid = this.process.pid
    // Log the exact command line for observability / debugging
    this.log('system', `Kimi CLI 已启动 (PID: ${this.process.pid})`)
    const cmdParts = [kimiPath, '--work-dir', this.state.workspace, '--prompt', '"..."', '--print']
    if (this.state.kimiSessionId) cmdParts.push('-r', this.state.kimiSessionId)
    cmdParts.push('--output-format', 'stream-json', '--thinking')
    this.log('system', `命令: ${cmdParts.join(' ')}`)
    this.running = true

    // stdout reader — parse stream-json and emit structured streaming chunks in real-time
    const outputLines: string[] = []
    let streamJsonOk = false
    let linesSinceSync = 0
    let tokensSinceSync = 0
    const SYNC_EVERY_LINES = 10
    const SYNC_EVERY_TOKENS = 500
    ;(async () => {
      try {
        for await (const line of this.process!.stdout) {
          if (!this.running) break
          const estimated = Math.max(1, Math.floor(line.length / 4))
          this.state.tokenUsed = Math.min(this.state.tokenUsed + estimated, this.state.tokenBudget)
          linesSinceSync++
          tokensSinceSync += estimated

          if (linesSinceSync >= SYNC_EVERY_LINES || tokensSinceSync >= SYNC_EVERY_TOKENS) {
            this.syncState()
            linesSinceSync = 0
            tokensSinceSync = 0
          }

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
            this.syncState()
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

          // Capture Kimi session id from resume hint (not an error)
          const sessionMatch = SESSION_RESUME_RE.exec(line)
          if (sessionMatch) {
            this.state.kimiSessionId = sessionMatch[1]
            this.syncState()
            this.termLog('Kimi', 'info', `Session captured: ${this.state.kimiSessionId}`)
            continue
          }

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

  async submitForReview(githubToken?: string): Promise<{ ok: boolean }> {
    if (githubToken) {
      this.githubToken = githubToken
    }
    if (this.state.status !== 'working' && this.state.status !== 'ready' && this.state.status !== 'reviewing') {
      return { ok: false }
    }

    if (githubToken) {
      const pr = await getPullRequestByBranch(githubToken, this.state.repoUrl, this.state.branch)
      if (pr) {
        this.state.prStatus = 'open'
        this.state.prNumber = pr.number
        this.state.prUrl = pr.html_url
        if (!this.githubUser) {
          this.githubUser = await getAuthenticatedUser(githubToken) || undefined
        }
        this.state.prAuthor = pr.user.login
      }
    } else if (this.state.prStatus !== 'open') {
      this.state.prStatus = 'open'
      this.state.prNumber = Math.floor(Math.random() * 100) + 1
      this.state.prUrl = `${this.state.repoUrl.replace(/\.git$/, '')}/pull/${this.state.prNumber}`
      this.log('system', `PR #${this.state.prNumber} 已创建（模拟，未配置 GitHub Token）`)
    }

    this.setStatus('reviewing')
    this.syncState()
    return { ok: true }
  }

  async canMerge(githubToken?: string): Promise<boolean> {
    // 排除 failed reviewer——reviewer 跑不起来（kimi 卡死 / 启动失败）≠ 内容被拒，
    // 不该阻塞合并。activeReviews 是「实际给出过裁决的 reviewer」。
    const activeReviews = this.state.reviews.filter((r) => r.status !== 'failed')

    // 单账号产品 fail-open：身份判不出时回退到内部 reviews 状态
    if (githubToken && this.state.prNumber && this.state.prAuthor && this.githubUser) {
      if (this.githubUser === this.state.prAuthor) {
        // 自审场景：GitHub 不允许自己 approve 自己，以内部 active reviews 为准
        if (activeReviews.length === 0) return true
        const allApproved = activeReviews.every((r) => r.status === 'approved')
        if (allApproved) {
          this.log('system', '自审场景：active reviewer 全部通过，准备通过管理员权限合并')
        }
        return allApproved
      }
      // 多人协作场景：以 GitHub API 为准（API 返回不含 failed 状态，本身就是 active）
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

    // 无 Token / 未获取到身份 / Mock 模式 → 回退到内部 active reviews 状态
    if (activeReviews.length === 0) return true
    return activeReviews.every((r) => r.status === 'approved')
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
          this.state.prStatus = 'merged'
          this.state.reviews = []
          this.setStatus('completed')
          this.log('system', `PR #${this.state.prNumber} 已合并到 main（GitHub）`)
          // 保留远程分支，便于后续 Agent 在同一分支上继续推送工作
          return
        }
        this.log('error', `GitHub API 合并 PR 失败，可能 PR 尚未就绪`)
      } catch (err) {
        this.log('error', `GitHub API 合并失败: ${String(err)}`)
      }
    }

    // 无 Token 时降级为 Mock
    this.state.prStatus = 'merged'
    this.state.reviews = []
    this.setStatus('completed')
    this.log('system', `PR #${this.state.prNumber} 已合并到 main（模拟）`)
    // 保留远程分支，便于后续 Agent 在同一分支上继续推送工作
  }

  rejectPr() {
    if (this.state.status !== 'reviewing') return
    // 不清 prStatus：PR 在 GitHub 上仍是 open，重新提交应追加 commit 到原 PR，
    // 而非重建（重建会撞「分支已有 PR」422 并降级 mock）
    this.state.reviews = []
    // 切 ready（不是 working）：本方法只切状态、不触发任何 agent 动作，
    // 需要用户主动发新指令。ready 让 AgentDetail.canSendMessage 通过，输入框可用；
    // working 会让输入框消失，跟「请发送新指令继续」的提示矛盾。
    this.setStatus('ready')
    this.log('system', 'PR 已打回，请发送新指令继续')
  }

  /** 暴露给引擎：延后审阅重试时取回 PR 操作所需的 GitHub Token */
  getGithubToken(): string | undefined {
    return this.githubToken
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
    if (comment !== undefined) review.comment = comment
    this.syncState()
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
    this.syncState()
    if (reviewers.length > 0) {
      this.log('system', `已指派 ${reviewers.length} 个 Agent 进行审阅`)
    }
  }

  /**
   * 运行 kimi CLI 执行一次"静默"指令，返回完整 stdout
   * 不修改 running 状态，不 emit agent-output 事件
   */
  /**
   * 后台静默运行一次 kimi（审阅 / CI 修复 / 生成 commit message 等）。
   * 流式模式 + 空闲超时：有 stdout 活动就续命，仅在连续 idleMs 无任何输出时
   * 判定卡死并 kill。返回 { ok, text }——ok 表示进程正常跑完（非卡死被 kill）。
   */
  private async runInstructionSilent(
    instruction: string,
    // Kimi CLI 不是逐 token 流式输出，而是「长 think → 一批 tool call → 一段
    // text」分批吐到 stdout，间隙经常 60-180s 没动静但 kimi 是好的；之前
    // 默认 120s 在 runReview / fix loop 经常误判卡死 → 把上限提到 10 分钟。
    // wall-clock 上限通过外层 setTimeout 由调用方按需附加（本函数只管 idle）。
    idleMs = 600_000,
  ): Promise<{ ok: boolean; text: string }> {
    const kimiPath = await detectKimiCli()
    if (!kimiPath) {
      this.log('error', 'Kimi CLI 未找到，无法执行')
      return { ok: false, text: '' }
    }

    let proc: ReturnType<typeof runKimi>
    try {
      // runInstructionSilent 服务 review / commit message 生成 / 其他可能带大 diff
      // 的场景，prompt 通过 stdin 传以避开 Windows --prompt 命令行 32767 字符上限
      // (Bug E-2)。用户聊天的 sendInstruction 路径走 --prompt 保持不变（短指令）。
      proc = runKimi(kimiPath, this.state.workspace, instruction, { streamJson: true, thinking: true, promptViaStdin: true })
    } catch (err) {
      this.log('error', `启动 Kimi CLI 失败: ${String(err)}`)
      return { ok: false, text: '' }
    }

    let text = ''
    let timedOut = false
    let idleTimer: NodeJS.Timeout | undefined
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        timedOut = true
        proc.kill()
        this.log('error', `Kimi CLI 连续 ${idleMs}ms 无输出，判定卡死并终止`)
      }, idleMs)
    }

    armIdle()
    try {
      for await (const line of proc.stdout) {
        armIdle()
        // 解析 stream-json，累积 assistant 的 text 内容
        try {
          const json = JSON.parse(line)
          if (json.role === 'assistant' && Array.isArray(json.content)) {
            for (const chunk of json.content) {
              if (chunk.type === 'text' && chunk.text) text += chunk.text
            }
          }
        } catch {
          // 非 stream-json 行（少见）：原样收集兜底
          if (line.trim()) text += line + '\n'
        }
      }
    } catch (err) {
      this.log('error', `读取 kimi stdout 失败: ${String(err)}`)
    }
    if (idleTimer) clearTimeout(idleTimer)

    try {
      await proc.wait()
    } catch (err) {
      this.log('error', `等待 kimi 进程退出失败: ${String(err)}`)
    }

    return { ok: !timedOut, text }
  }



  /**
   * 自动审阅指定分支的代码变更
   * 返回 { approved, comment }
   */
  async runReview(targetBranch: string): Promise<{ status: 'approved' | 'rejected' | 'failed'; comment: string }> {
    if (!this.state.workspace) {
      return { status: 'failed', comment: '工作空间未就绪' }
    }

    try {
      await gitFetch(this.state.workspace)
    } catch (err) {
      this.log('error', `fetch 失败: ${String(err)}`)
    }

    const diff = await getBranchDiff(this.state.workspace, targetBranch)
    if (!diff.trim()) {
      return { status: 'approved', comment: '无代码变更需要审阅' }
    }

    // 发全量 diff（不截断）——截断会让审阅基于半截改动、结论不可靠
    const prompt = `请审阅以下代码变更（分支 ${targetBranch}）。\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n请检查是否有 bug、安全隐患或规范问题。如果有问题请详细说明；如果没有问题请回复 "LGTM"。`

    this.log('system', `开始对分支 ${targetBranch} 执行自动审阅...`)
    const { ok, text } = await this.runInstructionSilent(prompt)

    // 区分「审阅没跑完」和「跑完有结论」：卡死/超时/空输出 → failed，不当成裁决
    if (!ok || !text.trim()) {
      this.log('error', '审阅未完成：kimi 卡死/超时或无有效输出')
      return { status: 'failed', comment: '审阅未完成（kimi 卡死/超时或无有效输出）' }
    }

    const approved = /LGTM|lgtm|approve|通过|无问题|没问题/i.test(text)
    const comment = approved
      ? '自动审阅通过（LGTM）'
      : `审阅发现潜在问题，kimi 输出如下：\n${text}`
    this.log('system', comment)
    return { status: approved ? 'approved' : 'rejected', comment }
  }

  /**
   * 执行自动审阅并回调结果
   *
   * @param onFailed - 单次跑不出裁决时的回调（kimi 卡死 / 启动失败 / 异常），
   *   engine 用它累加 review entry 的 attempts，达上限标 status='failed'（Bug F）
   */
  async performReview(
    targetBranch: string,
    targetAgentId: string,
    onComplete: (reviewerId: string, targetId: string, approved: boolean, comment: string) => void,
    onFailed?: (reviewerId: string, targetId: string, reason: string) => void,
  ) {
    // 不可审状态（working 占用 kimi 进程 / cloning / stopped / pending）→ 延后：
    // 不裁决、不评论，审阅条目保持 pending，由引擎定时器在本 Agent 空闲后重试。
    // completed / reviewing 仍可参与审阅。
    if (this.state.status !== 'ready' && this.state.status !== 'completed' && this.state.status !== 'reviewing') {
      return
    }
    // 防重入：同一 target 的审阅已在进行（定时器可能重复触发）→ 跳过
    if (this.activeReviews.has(targetAgentId)) return
    this.activeReviews.add(targetAgentId)

    try {
      const result = await this.runReview(targetBranch)
      if (result.status === 'failed') {
        // 审阅没跑完 → 不出裁决，审阅条目保持 pending，由引擎定时器稍后重试
        this.log('system', `${result.comment}，将稍后重试`)
        onFailed?.(this.state.id, targetAgentId, result.comment)
        return
      }
      onComplete(this.state.id, targetAgentId, result.status === 'approved', result.comment)
    } catch (err) {
      // 审阅异常同样按「未完成」处理：不出假裁决，留 pending 等重试
      this.log('error', `自动审阅执行异常：${String(err)}，将稍后重试`)
      onFailed?.(this.state.id, targetAgentId, `异常: ${String(err)}`)
    } finally {
      this.activeReviews.delete(targetAgentId)
    }
  }

}
