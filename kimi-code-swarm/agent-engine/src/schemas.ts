/**
 * Zod 运行时验证 Schema
 * 为 AgentState / EngineCommand / EngineEvent 提供运行时类型安全
 */

import { z } from 'zod'

// ── 基础枚举 ──
export const TaskStatusSchema = z.enum([
  'pending', 'cloning', 'ready', 'working', 'reviewing', 'completed', 'stopped',
])

export const PrStatusSchema = z.enum(['none', 'open', 'merged', 'closed'])

// ── LogEntry ──
export const LogEntrySchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().datetime(),
  type: z.enum(['system', 'input', 'output', 'error']),
  content: z.string(),
  tokens: z.number().int().nonnegative().optional(),
})

// ── ReviewEntry ──
export const ReviewEntrySchema = z.object({
  reviewerAgentId: z.string().min(1),
  reviewerName: z.string().min(1),
  status: z.enum(['pending', 'approved', 'rejected']),
  reviewedAt: z.string().datetime().optional(),
})

// ── AgentState ──
export const AgentStateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: TaskStatusSchema,
  repoUrl: z.string().url(),
  workspace: z.string(),
  branch: z.string().min(1),
  instruction: z.string(),
  prStatus: PrStatusSchema,
  prNumber: z.number().int().positive().optional(),
  prUrl: z.string().url().optional(),
  tokenUsed: z.number().int().nonnegative(),
  tokenBudget: z.number().int().positive(),
  pid: z.number().int().positive().optional(),
  createdAt: z.string().datetime(),
  lastActivity: z.string().datetime(),
  logs: z.array(LogEntrySchema),
  reviews: z.array(ReviewEntrySchema),
  changedFiles: z.array(z.string()).optional(),
})

// ── EngineCommand (Discriminated Union) ──
export const EngineCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create-agent'),
    payload: z.object({
      name: z.string().min(1),
      repoUrl: z.string().url(),
      instruction: z.string(),
      tokenBudget: z.number().int().positive(),
    }),
  }),
  z.object({
    type: z.literal('start-agent'),
    agentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('send-instruction'),
    agentId: z.string().min(1),
    instruction: z.string().min(1),
  }),
  z.object({
    type: z.literal('stop-agent'),
    agentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('submit-for-review'),
    agentId: z.string().min(1),
    githubToken: z.string().optional(),
  }),
  z.object({
    type: z.literal('merge-pr'),
    agentId: z.string().min(1),
    githubToken: z.string().optional(),
  }),
  z.object({
    type: z.literal('reject-pr'),
    agentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('submit-review'),
    agentId: z.string().min(1),
    reviewerAgentId: z.string().min(1),
    approved: z.boolean(),
  }),
  z.object({
    type: z.literal('get-file-diff'),
    agentId: z.string().min(1),
    filePath: z.string().min(1),
  }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('shutdown') }),
  z.object({
    type: z.literal('delete-agent'),
    agentId: z.string().min(1),
  }),
])

// ── EngineEvent (Discriminated Union) ──
export const EngineEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent-created'),
    agent: AgentStateSchema,
  }),
  z.object({
    type: z.literal('agent-output'),
    agentId: z.string().min(1),
    line: z.string(),
    isStderr: z.boolean(),
  }),
  z.object({
    type: z.literal('agent-exit'),
    agentId: z.string().min(1),
    code: z.number().int().nullable(),
  }),
  z.object({
    type: z.literal('agent-status'),
    agentId: z.string().min(1),
    status: TaskStatusSchema,
  }),
  z.object({
    type: z.literal('log'),
    agentId: z.string().min(1),
    entry: LogEntrySchema,
  }),
  z.object({
    type: z.literal('file-changed'),
    agentId: z.string().min(1),
    files: z.array(z.string()),
  }),
  z.object({
    type: z.literal('diff-result'),
    agentId: z.string().min(1),
    filePath: z.string(),
    diff: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
  }),
  z.object({
    type: z.literal('pong'),
    message: z.string().optional(),
  }),
])
