import { Agent } from './agent.js'
import type { AgentState, EngineCommand, EngineEvent } from './types.js'
import { EngineCommandSchema } from './schemas.js'
import { rm } from 'fs/promises'

export class AgentEngine {
  private agents = new Map<string, Agent>()
  private emit: (event: EngineEvent) => void

  constructor(emit: (event: EngineEvent) => void) {
    this.emit = emit
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
            cmd.payload.instruction,
            cmd.payload.tokenBudget,
            this.broadcast,
          )
          this.agents.set(agent.state.id, agent)
          this.broadcast({ type: 'agent-created', agent: agent.state })
          break
        }

        case 'start-agent': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) await agent.start()
          break
        }

        case 'send-instruction': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) await agent.sendInstruction(cmd.instruction)
          break
        }

        case 'stop-agent': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) await agent.stop()
          break
        }

        case 'delete-agent': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) {
            await agent.stop()
            const workspace = agent.state.workspace || `E:/workspace/${agent.state.id}`
            // Windows 上进程终止后需要更长时间释放文件句柄
            await new Promise((r) => setTimeout(r, 2000))

            let deleted = false
            let lastError: unknown
            // 先尝试 Node.js 原生删除，最多重试 3 次
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                await rm(workspace, { recursive: true, force: true })
                deleted = true
                break
              } catch (err) {
                lastError = err
                if (attempt < 3) {
                  await new Promise((r) => setTimeout(r, 1000))
                }
              }
            }

            // fallback: Windows 系统命令（对锁定文件更激进）
            if (!deleted && process.platform === 'win32') {
              try {
                const { exec } = await import('child_process')
                await new Promise<void>((resolve, reject) => {
                  exec(`rmdir /s /q "${workspace}"`, (err) => {
                    if (err) reject(err)
                    else resolve()
                  })
                })
                deleted = true
              } catch (err) {
                lastError = err
              }
            }

            if (deleted) {
              this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'system', content: `工作目录已清理: ${workspace}` } })
            } else {
              const msg = `清理工作目录失败: ${workspace}，请手动删除。错误: ${lastError instanceof Error ? lastError.message : String(lastError)}`
              console.error(`[engine] ${msg}`)
              this.broadcast({ type: 'log', agentId: cmd.agentId, entry: { id: 'system', timestamp: new Date().toISOString(), type: 'error', content: msg } })
            }
          }
          this.agents.delete(cmd.agentId)
          break
        }

        case 'submit-for-review': {
          const agent = this.agents.get(cmd.agentId)
          if (!agent || (agent.state.status !== 'working' && agent.state.status !== 'ready')) return
          agent.assignReviewers(Array.from(this.agents.values()))
          await agent.submitForReview(cmd.githubToken)

          // 触发自动审阅：让每个 reviewer Agent 异步执行审阅
          for (const review of agent.state.reviews) {
            const reviewer = this.agents.get(review.reviewerAgentId)
            if (reviewer && reviewer.state.id !== agent.state.id) {
              reviewer.performReview(agent.state.branch, agent.state.id, (reviewerId, targetId, approved) => {
                const target = this.agents.get(targetId)
                if (!target) return
                target.submitReview(reviewerId, approved)
                // 全部 approved 后自动合并
                if (target.canMerge() && target.state.status === 'reviewing') {
                  target.mergePr(cmd.githubToken).catch((err) => {
                    this.broadcast({ type: 'error', message: `自动合并失败: ${String(err)}` })
                  })
                }
              }).catch((err) => {
                this.broadcast({ type: 'error', message: `自动审阅失败: ${String(err)}` })
              })
            }
          }
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
          agent.submitReview(cmd.reviewerAgentId, cmd.approved)

          if (agent.state.status !== 'reviewing') break

          // 全部 approved → 自动合并
          if (agent.canMerge()) {
            await agent.mergePr(cmd.githubToken)
            break
          }

          // 所有 reviewer 都审完了且有 reject → 触发自动修改
          const hasPending = agent.state.reviews.some((r) => r.status === 'pending')
          if (!hasPending) {
            await agent.fixBasedOnReviews(cmd.githubToken)
          }
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

  getAllStates(): AgentState[] {
    return Array.from(this.agents.values()).map((a) => a.state)
  }

  getState(id: string): AgentState | undefined {
    return this.agents.get(id)?.state
  }
}
