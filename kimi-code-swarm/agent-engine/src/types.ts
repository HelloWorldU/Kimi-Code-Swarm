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
  type: 'system' | 'input' | 'output' | 'error'
  content: string
  tokens?: number
}

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
  | { type: 'agent-exit'; agentId: string; code: number | null }
  | { type: 'agent-status'; agentId: string; status: TaskStatus }
  | { type: 'log'; agentId: string; entry: LogEntry }
  | { type: 'file-changed'; agentId: string; files: string[] }
  | { type: 'diff-result'; agentId: string; filePath: string; diff: string }
  | { type: 'error'; message: string }
  | { type: 'pong'; message?: string }
