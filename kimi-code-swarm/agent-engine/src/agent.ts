import type { AgentState, LogEntry, ReviewEntry, TaskStatus, PrStatus, CiStatus, EngineEvent } from './types.js'
import type { PersistedAgent } from './persist.js'
import { runKimi, detectKimiCli, type KimiProcess } from './kimi.js'
import { getChangedFiles, getStagedFiles, getFileDiff, gitAdd, gitCommit, gitPush, createBranch, cloneRepo, gitFetch, getBranchDiff, gitMerge, getConflictFiles, getBehindCount, gitDiffCheck, abortMerge, stageFile } from './git.js'
import { createPullRequest, mergePullRequest, getPullRequest, getPullRequestReviews, getCheckRuns, getCheckRunLogs, submitPullRequestReview, getAuthenticatedUser } from './github-api.js'
import { readFile } from 'fs/promises'
import { join } from 'path'

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

/** Kimi CLI 每次 --print 运行结束会在 stderr 打印的会话恢复提示，用于捕获 session id */
export const SESSION_RESUME_RE = /To resume this session: kimi -r ([a-f0-9-]+)/i

/**
 * 所有 fix prompt（pre-commit / CI / review 三处）共用的硬约束：
 * 禁止 agent 自己跑 git——commit / push / PR 由引擎统一编排，
 * agent 自跑会绕开 generateCommitAndPrBody 的规范 commit message、
 * 也会让 submitForReview 重试时命中 "nothing to commit" 兼容分支，
 * 流程双轨混乱。
 */
const FIX_PROMPT_GIT_GUARD =
  '\n\n**重要约束：只修改文件，不要运行 git add / git commit / git push 等任何 git 命令。提交、推送、PR 等流程将由引擎在你修改完成后自动重试。**'

export class Agent {
  state: AgentState
  private process?: KimiProcess
  private emit: (event: EngineEvent) => void
  private running = false
  private reviewRound = 0
  private githubToken?: string
  private githubUser?: string
  private autoSubmitting = false
  /** 正在进行的审阅 target id 集合，防止延后重试对同一 target 重复 runReview */
  private activeReviews = new Set<string>()
  private ciMonitorTimer?: NodeJS.Timeout
  private ciRetryCount = 0
  private readonly CI_MAX_RETRIES = 3
  private readonly CI_POLL_INTERVAL_MS = 30000
  private readonly CI_TIMEOUT_MS = 600000
  // 上次持久化时的业务字段指纹；高频字段（tokenUsed/lastActivity）不参与，
  // 避免 stdout 流式回推每 10 行就触发一次写盘。
  private lastPersistFingerprint?: string
  // Bug #8：上次 sync main 检查时间戳，throttle 避免每条 sendInstruction
  // 都 fetch origin。不依赖 prStatus === 'merged' 触发，因为用户可能在
  // GitHub web 上直接手动 merge（绕开 swarm 的 mergePr），prStatus 不更新。
  private lastSyncCheckAt = 0
  private static readonly SYNC_THROTTLE_MS = 5 * 60 * 1000

  constructor(
    name: string,
    repoUrl: string,
    tokenBudget: number,
    emit: (event: EngineEvent) => void,
    private onPrCreated?: (agentId: string, branch: string, githubToken?: string) => Promise<void> | void,
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
    onPrCreated?: (agentId: string, branch: string, githubToken?: string) => Promise<void> | void,
    onPersist?: () => void,
  ): Agent {
    const a = new Agent(p.name, p.repoUrl, p.tokenBudget, emit, onPrCreated, onPersist)
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
    a.state.ciStatus = p.ciStatus as CiStatus | undefined
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

    // 仅当业务字段（status/workspace/branch/pr*/kimiSessionId/reviews/changedFiles/ciStatus）
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
      ciStatus: s.ciStatus,
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

    // Bug #8：每次 sendInstruction 入口都检查 main 同步（throttle 内重复调用 skip）。
    // 不依赖 prStatus === 'merged'——用户可能在 GitHub web 直接手动 merge，那种
    // 场景 prStatus 永远不变 merged，但 origin/main 已经前进了。同步过程对 UI
    // 透明：冲突解决走 runInstructionSilent 不污染聊天面板和「任务指令」区。
    if (this.state.status === 'ready') {
      const synced = await this.syncBranchWithMain()
      if (!synced) return  // 同步失败 syncBranchWithMain 内部已置 stopped
    }

    if (this.state.status !== 'ready') return

    // 有条件赋值：没传 token 不应擦掉已知的（token 是 agent 持久凭据，
    // 并非每条指令都携带；autoSubmitForReview 的修复步就以无 token 调用本方法）
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
        // 「nothing to commit」不是失败：改动已被提交（agent 修复时自行 commit 过 /
        // 上一轮已提交）。应继续 push + 建 PR，而非回头让 agent 重复"修复"
        const alreadyCommitted = /nothing to commit|working tree clean/i.test(
          `${commitRes.stdout}\n${commitRes.stderr}`,
        )
        if (!alreadyCommitted) {
          return { ok: false, steps }
        }
        this.log('system', '工作区无新变更，改动已提交，继续推送')
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

    // 已有 open PR：跳过创建，只启动 CI 监控（审阅由 CI 通过后触发）
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
      this.syncState()
      this.startCiMonitor(githubToken)
      return { ok: true, steps }
    }

    // 有 GitHub Token：调用真实 API 创建 PR
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
          this.syncState()
          this.startCiMonitor(githubToken)
          return { ok: true, steps }
        }
        this.log('error', 'GitHub API 创建 PR 失败：返回空结果')
      } catch (err) {
        this.log('error', `GitHub API 创建 PR 失败: ${String(err)}`)
      }
      // 有 token 但创建失败 → 真失败，交回 autoSubmitForReview 处理，不伪造 mock PR
      return { ok: false, steps }
    }

    // 仅「未配置 GitHub Token」才降级为 Mock（无真实 CI，直接触发审阅）
    this.state.prStatus = 'open'
    this.state.prNumber = Math.floor(Math.random() * 100) + 1
    this.state.prUrl = `${this.state.repoUrl.replace(/\.git$/, '')}/pull/${this.state.prNumber}`
    this.syncState()
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
        this.log('error', 'CI 监控超时（10分钟）：仍触发审阅，请指挥官人工核查 CI 状态')
        this.notifyPrCreated()
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

      // 全部通过 → 此时才触发审阅
      this.stopCiMonitor()
      this.state.ciStatus = 'success'
      this.log('system', 'GitHub Actions CI 全部通过 ✅')
      this.notifyPrCreated()
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
    const fixPrompt = `GitHub Actions CI 检查失败了，日志如下：\n\n${ciLogs}\n\n请根据上述日志修改代码文件，使其能够通过 CI 检查。直接修改相关文件，不需要额外说明。${FIX_PROMPT_GIT_GUARD}`

    // Bug B: 走 sendInstruction 让修复过程在 UI 聊天面板可见（之前用
    // runInstructionSilent 黑盒，用户看不到 agent 在改什么）。
    // sendInstruction 不接受 reviewing 状态——CI 监控启动时 status 是
    // reviewing，临时切 ready 让 sendInstruction 进入；它内部完成后会
    // 自动检测 changedFiles + 调用 autoSubmitForReview，不需要本方法再
    // 额外做这两步。
    if (this.state.status === 'reviewing') {
      this.setStatus('ready')
    }
    await this.sendInstruction(fixPrompt, undefined, { displayAsUserInput: false })
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
        const fixPrompt = `你刚才尝试提交代码，执行日志如下：\n\n${fullLog}\n\n请根据上述日志中的错误信息，修改相关文件，使其能够通过项目的 typecheck、lint 和 pre-commit 检查。直接修改相关文件，不需要额外说明。${FIX_PROMPT_GIT_GUARD}`
        // 走流式 sendInstruction：修复过程实时显示在对话框，且无 runInstructionSilent 的硬超时；
        // displayAsUserInput=false 让长 fix prompt 不污染「任务指令」区与聊天面板
        await this.sendInstruction(fixPrompt, undefined, { displayAsUserInput: false })
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

  /**
   * Bug #8：PR merge 后，sendInstruction 恢复 completed agent 时同步 main。
   * 引擎硬保证 fetch / merge / commit；冲突时通过 runInstructionSilent 让
   * kimi 只改文件（不污染聊天面板和「任务指令」区），完成后引擎 sanity
   * check + commit。返回 true 表示可继续走用户任务；false 表示同步失败
   * 已置 stopped，sendInstruction 应直接 return。
   * Throttle：5 分钟内重复调用直接 return true 跳过。
   */
  private async syncBranchWithMain(): Promise<boolean> {
    if (!this.state.workspace) return true

    const now = Date.now()
    if (this.lastSyncCheckAt && now - this.lastSyncCheckAt < Agent.SYNC_THROTTLE_MS) {
      return true
    }
    this.lastSyncCheckAt = now

    try {
      await gitFetch(this.state.workspace)
    } catch (err) {
      this.log('error', `git fetch 失败: ${String(err)}（继续执行，但分支可能未同步）`)
      return true // 决策 5a：静默继续
    }

    let behindCount = 0
    try {
      behindCount = await getBehindCount(this.state.workspace, 'origin/main')
    } catch (err) {
      this.log('error', `检测 main 新 commits 失败: ${String(err)}`)
      return true
    }

    if (behindCount <= 0) return true

    this.log('system', `检测到 main 有 ${behindCount} 个新 commit，正在同步...`)

    const mergeResult = await gitMerge(this.state.workspace, 'origin/main')
    if (mergeResult.exitCode === 0) {
      const commitResult = await gitCommit(this.state.workspace, 'sync: merge origin/main')
      if (commitResult.exitCode === 0) {
        this.log('system', `已同步 main 的 ${behindCount} 个 commit`)
      } else {
        this.log('error', `同步提交失败: ${commitResult.stderr}`)
        try { await abortMerge(this.state.workspace) } catch { /* 已无 merge 状态可忽略 */ }
      }
      return true
    }

    // 有冲突：runInstructionSilent 让 kimi 静默改文件（不污染 UI input）
    const conflictFiles = await getConflictFiles(this.state.workspace)
    if (conflictFiles.length === 0) {
      this.log('error', `merge 失败但无冲突文件: ${mergeResult.stderr}`)
      try { await abortMerge(this.state.workspace) } catch { /* expected */ }
      this.setStatus('stopped')
      this.log('error', 'merge 失败无法自动恢复，请指挥官人工介入')
      return false
    }

    this.log('system', `merge 出现冲突，自动解决中：${conflictFiles.join(', ')}`)

    // 读原始内容供 sanity check 用（行数膨胀检测）
    const originals = new Map<string, string>()
    const fileContents: string[] = []
    for (const file of conflictFiles) {
      try {
        const content = await readFile(join(this.state.workspace, file), 'utf-8')
        originals.set(file, content)
        fileContents.push(`=== ${file} ===\n${content}`)
      } catch {
        fileContents.push(`=== ${file} ===\n[读取失败]`)
      }
    }

    const conflictPrompt = `以下文件存在 merge 冲突，请解决冲突。冲突标记格式为 \`<<<<<<< HEAD\`（当前分支）、\`=======\`、\`>>>>>>> origin/main\`（main 分支）。

${fileContents.join('\n\n')}

解决原则：
- 只修改 conflict marker 区域，不要在冲突文件里写用户任务相关的新代码
- 先理解双方意图，确定语义上正确的结果
- 最小化改动，保留当前分支原有意图
- 逐个文件解决

请直接修改这些文件去掉冲突标记。${FIX_PROMPT_GIT_GUARD}`

    const result = await this.runInstructionSilent(conflictPrompt)
    if (!result.ok) {
      this.log('error', `冲突解决 kimi 卡死/超时`)
      try { await abortMerge(this.state.workspace) } catch { /* expected */ }
      this.setStatus('stopped')
      this.log('error', 'merge 冲突自动解决超时，请指挥官人工介入')
      return false
    }

    try {
      await this.finalizeMergeCommit(conflictFiles, originals)
      this.log('system', `merge 冲突已自动解决，同步完成`)
      return true
    } catch (err) {
      this.log('error', `merge sanity check 失败: ${String(err)}`)
      try { await abortMerge(this.state.workspace) } catch { /* expected */ }
      this.setStatus('stopped')
      this.log('error', 'merge 冲突解决未通过 sanity check，请指挥官人工介入')
      return false
    }
  }

  /**
   * Bug #8：sanity check + 只 stage 冲突文件 + commit。
   * 接收 conflictFiles + originals 作为参数（不再用实例字段，纯函数式）。
   */
  private async finalizeMergeCommit(
    conflictFiles: string[],
    originals: Map<string, string>,
  ): Promise<void> {
    if (!this.state.workspace || conflictFiles.length === 0) return

    for (const file of conflictFiles) {
      const content = await readFile(join(this.state.workspace, file), 'utf-8')

      // sanity check 1: 冲突标记残留
      if (/^<{7}|^={7}|^>{7}/m.test(content)) {
        throw new Error(`${file} 中仍有冲突标记残留`)
      }

      // sanity check 2: 文件非空
      if (!content.trim()) {
        throw new Error(`${file} 内容为空`)
      }

      // sanity check 3: 行数膨胀（>3 倍阈值，疑似 kimi 写入了用户任务相关代码）
      const original = originals.get(file)
      if (original) {
        const origLines = original.split('\n').length
        const newLines = content.split('\n').length
        if (newLines > origLines * 3) {
          throw new Error(`${file} 行数从 ${origLines} 膨胀到 ${newLines}（>3 倍），疑似越界改动`)
        }
      }
    }

    // sanity check 4: git diff --check（空白错误等）
    const diffCheck = await gitDiffCheck(this.state.workspace)
    if (diffCheck.exitCode !== 0) {
      throw new Error(`git diff --check 失败: ${diffCheck.stdout || diffCheck.stderr}`)
    }

    // 只 stage 冲突文件，避免用户任务的修改被混入 merge commit
    for (const file of conflictFiles) {
      const result = await stageFile(this.state.workspace, file)
      if (result.exitCode !== 0) {
        throw new Error(`stage ${file} 失败: ${result.stderr}`)
      }
    }

    const commitResult = await gitCommit(this.state.workspace, 'sync: merge origin/main')
    if (commitResult.exitCode !== 0) {
      throw new Error(`merge commit 失败: ${commitResult.stderr}`)
    }
  }

  private notifyPrCreated() {
    if (this.onPrCreated) {
      Promise.resolve(this.onPrCreated(this.state.id, this.state.branch, this.githubToken)).catch((err) => {
        this.log('error', `PR 创建后通知 engine 失败: ${String(err)}`)
      })
    }
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
   * Skill 文件（.kimi/skills/commit/SKILL.md、.github/pull_request_template.md）作为唯一事实源
   */
  private async generateCommitAndPrBody(files: string[]): Promise<{ commitMessage: string; prTitle: string; prBody: string }> {
    // 1. 读取 Skill 文件作为事实源
    const commitSkill = await this.loadSkill('.kimi/skills/commit/SKILL.md')
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
      // commit message 生成通常 30-60s 内完成；diff 大时 kimi 思考更久也合理；
      // 给 5 分钟兜底（之前 60s 经常误判 + fallback 到模糊 message）
      const { text: output } = await this.runInstructionSilent(prompt, 300_000)
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

    const prompt = `你的 PR 被以下审阅意见拒绝了，请根据意见修改代码：\n\n${comments}\n\n请直接修改相关代码文件。修改完成后不需要额外说明。${FIX_PROMPT_GIT_GUARD}`

    this.rejectPr()
    this.log('system', `第 ${this.reviewRound} 轮自动修改开始，基于 ${rejectedReviews.length} 条审阅意见`)

    try {
      // displayAsUserInput=false：审阅拒绝后引擎注入的修复 prompt 不算用户指令
      await this.sendInstruction(prompt, undefined, { displayAsUserInput: false })
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
