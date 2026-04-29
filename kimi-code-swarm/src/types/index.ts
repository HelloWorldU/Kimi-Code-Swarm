export interface CliInstance {
  id: string;
  name: string;
  status: 'running' | 'idle' | 'error' | 'stopped' | 'queued';
  pid?: number;
  workspace: string;
  model: string;
  tokenUsed: number;
  tokenLimit: number;
  createdAt: Date;
  lastActivity: Date;
  logs: LogEntry[];
  taskDescription?: string;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'system' | 'input' | 'output' | 'error';
  content: string;
  tokens?: number;
}

export interface SwarmStats {
  totalInstances: number;
  activeInstances: number;
  totalTokensUsed: number;
  totalTokenLimit: number;
  queueLength: number;
}
