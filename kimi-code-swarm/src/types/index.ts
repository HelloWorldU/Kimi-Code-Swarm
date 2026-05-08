export type TaskStatus =
  | 'pending'
  | 'cloning'
  | 'ready'
  | 'working'
  | 'reviewing'
  | 'completed'
  | 'stopped'

export type PrStatus = 'none' | 'open' | 'merged' | 'closed'

export interface ReviewEntry {
  reviewerTaskId: string
  reviewerName: string
  status: 'pending' | 'approved' | 'rejected'
  reviewedAt?: string
}

export interface AgentTask {
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
}

export interface LogEntry {
  id: string
  timestamp: string
  type: 'system' | 'input' | 'output' | 'error'
  content: string
  tokens?: number
}

// CommandCenterStats / AppPersistedState 已清理：
// 当前 Dashboard 直接消费 AgentTask[]，不再经过中间聚合类型。
// 如需恢复，从 git history 回滚即可。
