/**
 * Zod 运行时验证 Schema
 * 校验 Rust → Node.js 的入站命令（EngineCommand）
 */

import { z } from 'zod'

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
    githubToken: z.string().optional(),
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
    comment: z.string().optional(),
    githubToken: z.string().optional(),
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
