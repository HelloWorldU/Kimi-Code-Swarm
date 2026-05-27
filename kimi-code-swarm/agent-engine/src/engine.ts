import { Agent } from './agent.js'
import { schedulePersist, type PersistedAgent, type PersistedState } from './persist.js'
import type { AgentState, EngineCommand, EngineEvent } from './types.js'
import { EngineCommandSchema } from './schemas.js'
import { rm } from 'fs/promises'

export class AgentEngine {
  private agents = new Map<string, Agent>()
  private emit: (event: EngineEvent) => void
  // 待审阅 PR 队列：PR 创建时没有 reviewer 的，放入此队列等待新 Agent 接单
  private pendingReviews = new Map<string, { branch: string; githubToken?: string }>()
  // 延后审阅重试定时器：定期把因 reviewer 忙碌而搁置的 pending 审阅重新触发
  private reviewRetryTimer?: NodeJS.Timeout
  private readonly REVIEW_RETRY_INTERVAL_MS = 30000
  // 引擎持久化数据目录；不设则不做持久化（适用开发 / 单元测试模式）
  private dataDir?: string
  // 给 Agent 用的统一持久化回调：state 变更 → debounced 保存
  private agentPersistCallback = () => this.persist()

  constructor(emit: (event: EngineEvent) => void, dataDir?: string) {
    this.emit = emit
    this.dataDir = dataDir
    this.reviewRetryTimer = setInterval(() => this.retryDeferredReviews(), this.REVIEW_RETRY_INTERVAL_MS)
  }

  private broadcast = (event: EngineEvent) => {
    this.emit(event)
  }

  async handleCommand(rawCmd: EngineCommand) {
    // 运行时验证：确保命令格式合法
    const parseResult = EngineCommandSchema.safeParse(rawCmd)
    if (!parseResult.success) {
      this.emit({ type: 'error', message: `命令格式错误: ${parseResult.error.message}` })
      return
    }
    const cmd = parseResult.data

    try {
      switch (cmd.type) {
        case 'create-agent': {
          const agent = new Agent(
            cmd.payload.name,
            cmd.payload.repoUrl,
            cmd.payload.tokenBudget,
            this.broadcast,
            (agentId, branch, token) => this.triggerReviews(agentId, branch, token),
            this.agentPersistCallback,
          )
          this.agents.set(agent.state.id, agent)
          this.broadcast({ type: 'agent-created', agent: agent.state })
          this.persist()

          // 检查是否有待审阅的 PR，自动分配新 Agent 为 reviewer 并触发审阅
          for (const [targetId, pending] of this.pendingReviews) {
            const target = this.agents.get(targetId)
            if (target && target.state.status === 'reviewing') {
              target.state.reviews.push({
                reviewerAgentId: agent.state.id,
                reviewerName: agent.state.name,
                status: 'pending',
              })
              target.syncState()
              this.broadcast({
                type: 'log',
                agentId: targetId,
                entry: {
                  id: 'system',
                  timestamp: new Date().toISOString(),
                  type: 'system',
                  content: `新 Agent「${agent.state.name}」已加入，自动指派审阅 PR`,
                },
              })
              agent.performReview(target.state.branch, target.state.id, this.reviewCompletionHandler(pending.githubToken)).catch((err) => {
                this.broadcast({ type: 'error', message: `自动审阅失败: ${String(err)}` })
              })
            }
          }
          break
        }

        case 'start-agent': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) await agent.start()
          break
        }

        case 'send-instruction': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) await agent.sendInstruction(cmd.instruction, cmd.githubToken)
          break
        }

        case 'stop-agent': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) await agent.stop()
          break
        }

        case 'delete-agent': {
          const agent = this.agents.get(cmd.agentId)
          this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'system', content: `[delete-agent] 开始清理 agent ${cmd.agentId}` } })
          if (!agent) {
            this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'error', content: `[delete-agent] agent ${cmd.agentId} 不存在，跳过停止和目录清理` } })
            this.agents.delete(cmd.agentId)
            break
          }

          // 先停止 CI 轮询，避免 Agent 删除后定时器还在跑
          agent.stopCiMonitor()
          this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'system', content: `[delete-agent] 停止 agent 进程...` } })
          await agent.stop()
          const workspace = agent.state.workspace || `E:/workspace/${agent.state.id}`
          this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'system', content: `[delete-agent] 进程已停止，目标目录: ${workspace}` } })

          // Windows 上进程终止后需要更长时间释放文件句柄
          await new Promise((r) => setTimeout(r, 2000))

          let deleted = false
          let lastError: unknown
          // 先尝试 Node.js 原生删除，最多重试 3 次
          for (let attempt = 1; attempt <= 3; attempt++) {
            this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'system', content: `[delete-agent] 第 ${attempt} 次尝试删除目录...` } })
            try {
              await rm(workspace, { recursive: true, force: true })
              deleted = true
              this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'system', content: `[delete-agent] Node.js rm 删除成功` } })
              break
            } catch (err) {
              lastError = err
              const errMsg = lastError instanceof Error ? lastError.message : String(lastError)
              this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'error', content: `[delete-agent] 第 ${attempt} 次删除失败: ${errMsg}` } })
              if (attempt < 3) {
                await new Promise((r) => setTimeout(r, 1000))
              }
            }
          }

          // fallback: Windows 系统命令（对锁定文件更激进）
          if (!deleted && process.platform === 'win32') {
            this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'system', content: `[delete-agent] fallback: 尝试 rmdir /s /q...` } })
            try {
              const { exec } = await import('child_process')
              await new Promise<void>((resolve, reject) => {
                exec(`rmdir /s /q "${workspace}"`, (err) => {
                  if (err) reject(err)
                  else resolve()
                })
              })
              deleted = true
              this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'system', content: `[delete-agent] rmdir 删除成功` } })
            } catch (err) {
              lastError = err
              const errMsg = lastError instanceof Error ? lastError.message : String(lastError)
              this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'error', content: `[delete-agent] rmdir 也失败了: ${errMsg}` } })
            }
          }

          if (deleted) {
            this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'system', content: `工作目录已清理: ${workspace}` } })
          } else {
            const msg = `清理工作目录失败: ${workspace}，请手动删除。错误: ${lastError instanceof Error ? lastError.message : String(lastError)}`
            console.error(`[engine] ${msg}`)
            this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'error', content: msg } })
          }
          this.pendingReviews.delete(cmd.agentId)
          this.agents.delete(cmd.agentId)
          this.persist()
          break
        }

        case 'submit-for-review': {
          const agent = this.agents.get(cmd.agentId)
          if (!agent || (agent.state.status !== 'working' && agent.state.status !== 'ready')) return
          await agent.submitForReview(cmd.githubToken)
          this.triggerReviews(agent.state.id, agent.state.branch, cmd.githubToken)
          break
        }

        case 'merge-pr': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) await agent.mergePr(cmd.githubToken)
          break
        }

        case 'reject-pr': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) agent.rejectPr()
          break
        }

        case 'submit-review': {
          const agent = this.agents.get(cmd.agentId)
          if (!agent) break
          await this.handleReviewVerdict(agent, cmd.reviewerAgentId, cmd.approved, cmd.comment, cmd.githubToken)
          break
        }

        case 'get-file-diff': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) {
            const diff = await agent.getFileDiff(cmd.filePath)
            this.broadcast({
              type: 'diff-result',
              agentId: cmd.agentId,
              filePath: cmd.filePath,
              diff,
            })
          }
          break
        }

        case 'ping': {
          this.broadcast({ type: 'pong' })
          break
        }

        case 'shutdown': {
          // Stop all agents gracefully
          if (this.reviewRetryTimer) clearInterval(this.reviewRetryTimer)
          await Promise.all(Array.from(this.agents.values()).map((a) => a.stop()))
          this.agents.clear()
          this.broadcast({ type: 'pong', message: 'Engine shutting down' })
          break
        }
      }
    } catch (err) {
      const msg = String(err)
      console.error(`[engine] handleCommand 异常: ${msg}`)
      this.broadcast({ type: 'error', message: msg })
    }
  }

  /**
   * 记录一条审阅结论，并据此决定合并或触发自动修复。
   * 命令路径与两条自动回调路径共用，避免「只合并、不修复」的不对称。
   */
  private async handleReviewVerdict(
    agent: Agent,
    reviewerId: string,
    approved: boolean,
    comment: string | undefined,
    githubToken?: string,
  ): Promise<void> {
    await agent.submitReview(reviewerId, approved, comment)
    if (agent.state.status !== 'reviewing') return

    // 全部 approved → 自动合并
    const canMerge = await agent.canMerge(githubToken)
    if (canMerge) {
      this.pendingReviews.delete(agent.state.id)
      await agent.mergePr(githubToken)
      return
    }

    // 所有 reviewer 都审完且存在 reject → 触发自动修复
    const hasPending = agent.state.reviews.some((r) => r.status === 'pending')
    if (!hasPending) {
      await agent.fixBasedOnReviews(githubToken)
    }
  }

  /** 审阅结论回调：命令路径 / 自动审阅 / 延后重试 三处共用 */
  private reviewCompletionHandler(githubToken?: string) {
    return async (reviewerId: string, targetId: string, approved: boolean, comment: string): Promise<void> => {
      const t = this.agents.get(targetId)
      if (!t) return
      await this.handleReviewVerdict(t, reviewerId, approved, comment, githubToken)
    }
  }

  /**
   * 定期重试因 reviewer 忙碌而搁置的审阅：扫描所有 reviewing 的 Agent，
   * 对其 pending 的审阅条目重新触发对应 reviewer 的 performReview。
   * performReview 自身判断 reviewer 是否可审 + 防重入，不可审则直接返回。
   */
  private retryDeferredReviews(): void {
    for (const target of this.agents.values()) {
      if (target.state.status !== 'reviewing') continue
      for (const review of target.state.reviews) {
        if (review.status !== 'pending') continue
        const reviewer = this.agents.get(review.reviewerAgentId)
        if (!reviewer || reviewer.state.id === target.state.id) continue
        reviewer
          .performReview(target.state.branch, target.state.id, this.reviewCompletionHandler(target.getGithubToken()))
          .catch((err) => {
            this.broadcast({ type: 'error', message: `延后审阅失败: ${String(err)}` })
          })
      }
    }
  }

  private triggerReviews(agentId: string, branch: string, githubToken?: string) {
    const target = this.agents.get(agentId)
    if (!target || target.state.status !== 'reviewing') return

    target.assignReviewers(Array.from(this.agents.values()))

    for (const review of target.state.reviews) {
      const reviewer = this.agents.get(review.reviewerAgentId)
      if (reviewer && reviewer.state.id !== target.state.id) {
        reviewer.performReview(branch, agentId, this.reviewCompletionHandler(githubToken)).catch((err) => {
          this.broadcast({ type: 'error', message: `自动审阅失败: ${String(err)}` })
        })
      }
    }

    if (target.state.reviews.length === 0) {
      this.pendingReviews.set(agentId, { branch, githubToken })
      this.broadcast({
        type: 'log',
        agentId,
        entry: {
          id: 'system',
          timestamp: new Date().toISOString(),
          type: 'system',
          content: 'PR 已创建，当前无可用审阅者，进入待审队列等待新 Agent 加入',
        },
      })
    }
  }

  /**
   * 启动时由 index.ts 用持久化状态重建一个 Agent。
   * emit agent-created，前端按 id 去重处理（已存在则替换，否则 push）。
   */
  restoreAgent(p: PersistedAgent): void {
    const agent = Agent.fromPersisted(
      p,
      this.broadcast,
      (agentId, branch, token) => this.triggerReviews(agentId, branch, token),
      this.agentPersistCallback,
    )
    this.agents.set(agent.state.id, agent)
    this.broadcast({ type: 'agent-created', agent: agent.state })
  }

  /** 没设 dataDir（测试/开发模式）时是 no-op；否则把当前所有 agent 持久化（debounced） */
  private persist(): void {
    if (!this.dataDir) return
    schedulePersist(this.dataDir, this.toPersistedState())
  }

  private toPersistedState(): PersistedState {
    return {
      version: 1,
      agents: Array.from(this.agents.values()).map((a) => this.agentToPersisted(a)),
    }
  }

  private agentToPersisted(a: Agent): PersistedAgent {
    const s = a.state
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      repoUrl: s.repoUrl,
      workspace: s.workspace,
      branch: s.branch,
      prStatus: s.prStatus,
      prNumber: s.prNumber,
      prUrl: s.prUrl,
      prAuthor: s.prAuthor,
      tokenUsed: s.tokenUsed,
      tokenBudget: s.tokenBudget,
      kimiSessionId: s.kimiSessionId,
      reviews: s.reviews,
      changedFiles: s.changedFiles,
      ciStatus: s.ciStatus,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
    }
  }

  getAllStates(): AgentState[] {
    return Array.from(this.agents.values()).map((a) => a.state)
  }

  getState(id: string): AgentState | undefined {
    return this.agents.get(id)?.state
  }
}
