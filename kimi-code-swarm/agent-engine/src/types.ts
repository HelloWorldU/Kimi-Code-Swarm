export type TaskStatus =
  | 'pending'
  | 'cloning'
  | 'ready'
  | 'working'
  | 'reviewing'
  | 'completed'
  | 'stopped'

export type PrStatus = 'none' | 'open' | 'merged' | 'closed'

export type CiStatus = 'pending' | 'success' | 'failure' | 'unknown'

export interface ReviewEntry {
  reviewerAgentId: string
  reviewerName: string
  status: 'pending' | 'approved' | 'rejected'
  comment?: string
  reviewedAt?: string
}

export interface LogEntry {
  id: string
  timestamp: string
  type: 'system' | 'input' | 'output' | 'error' | 'think' | 'tool_call' | 'tool_result' | 'mcp'
  content: string
  tokens?: number
}

/** 流式内容片段，由 Agent Engine 实时解析 stream-json 后 emit */
export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'think'; content: string }
  | { type: 'tool_call'; name: string; arguments: string; id: string }
  | { type: 'tool_result'; content: string; toolCallId?: string }
  | { type: 'mcp'; name: string; arguments: string; id: string }

export interface AgentState {
  id: string
  name: string
  status: TaskStatus
  repoUrl: string
  workspace: string
  branch: string
  instruction: string
  prStatus: PrStatus
  prNumber?: number
  prUrl?: string
  prAuthor?: string
  tokenUsed: number
  tokenBudget: number
  pid?: number
  createdAt: string
  lastActivity: string
  logs: LogEntry[]
  reviews: ReviewEntry[]
  changedFiles?: string[]
  ciStatus?: CiStatus
}

// ── Commands from Rust → Node.js ──

export type EngineCommand =
  | { type: 'create-agent'; payload: { name: string; repoUrl: string; instruction: string; tokenBudget: number } }
  | { type: 'start-agent'; agentId: string }
  | { type: 'send-instruction'; agentId: string; instruction: string; githubToken?: string }
  | { type: 'stop-agent'; agentId: string }
  | { type: 'delete-agent'; agentId: string }
  | { type: 'submit-for-review'; agentId: string; githubToken?: string }
  | { type: 'merge-pr'; agentId: string; githubToken?: string }
  | { type: 'reject-pr'; agentId: string }
  | { type: 'submit-review'; agentId: string; reviewerAgentId: string; approved: boolean; githubToken?: string }
  | { type: 'get-file-diff'; agentId: string; filePath: string }
  | { type: 'ping' }
  | { type: 'shutdown' }

// ── Events from Node.js → Rust ──

export type EngineEvent =
  | { type: 'agent-created'; agent: AgentState }
  | { type: 'agent-output'; agentId: string; line: string; isStderr: boolean }
  | { type: 'agent-stream'; agentId: string; chunk: StreamChunk }
  | { type: 'agent-exit'; agentId: string; code: number | null }
  | { type: 'agent-status'; agentId: string; status: TaskStatus }
| { type: 'agent-state'; agentId: string; state: AgentState }
  | { type: 'log'; agentId: string; entry: LogEntry }
  | { type: 'file-changed'; agentId: string; files: string[] }
  | { type: 'diff-result'; agentId: string; filePath: string; diff: string }
  | { type: 'error'; message: string }
  | { type: 'pong'; message?: string }
