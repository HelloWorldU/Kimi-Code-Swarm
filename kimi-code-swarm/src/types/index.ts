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
  reviewedAt?: Date
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
  createdAt: Date
  lastActivity: Date
  logs: LogEntry[]
  reviews: ReviewEntry[]
  changedFiles?: string[]
}

export interface LogEntry {
  id: string
  timestamp: Date
  type: 'system' | 'input' | 'output' | 'error'
  content: string
  tokens?: number
}

export interface CommandCenterStats {
  totalTasks: number
  activeTasks: number
  completedTasks: number
  totalTokensUsed: number
  totalTokenBudget: number
}
