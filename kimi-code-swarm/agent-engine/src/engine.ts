import { Agent } from './agent.js'
import type { AgentState, EngineCommand, EngineEvent } from './types.js'
import { EngineCommandSchema } from './schemas.js'

export class AgentEngine {
  private agents = new Map<string, Agent>()
  private emit: (event: EngineEvent) => void

  constructor(emit: (event: EngineEvent) => void) {
    this.emit = emit
  }

  private broadcast(event: EngineEvent) {
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
          if (agent) agent.stop()
          break
        }

        case 'delete-agent': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) agent.stop()
          this.agents.delete(cmd.agentId)
          break
        }

        case 'submit-for-review': {
          const agent = this.agents.get(cmd.agentId)
          if (!agent || agent.state.status !== 'working') return
          agent.assignReviewers(Array.from(this.agents.values()))
          await agent.submitForReview()
          break
        }

        case 'merge-pr': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) agent.mergePr()
          break
        }

        case 'reject-pr': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) agent.rejectPr()
          break
        }

        case 'submit-review': {
          const agent = this.agents.get(cmd.agentId)
          if (agent) agent.submitReview(cmd.reviewerAgentId, cmd.approved)
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
          for (const agent of this.agents.values()) {
            agent.stop()
          }
          this.agents.clear()
          this.broadcast({ type: 'pong', message: 'Engine shutting down' })
          break
        }
      }
    } catch (err) {
      this.broadcast({ type: 'error', message: String(err) })
    }
  }

  getAllStates(): AgentState[] {
    return Array.from(this.agents.values()).map((a) => a.state)
  }

  getState(id: string): AgentState | undefined {
    return this.agents.get(id)?.state
  }
}
