import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// Project-level tests for GitHub API integration.
// Frontend-specific tests live in kimi-code-swarm/tests/unit/.

describe('github api (project-level)', () => {
  it('github-api module exists and exports createPR / mergePR', () => {
    const apiPath = resolve(process.cwd(), 'kimi-code-swarm/agent-engine/src/github-api.ts')
    expect(existsSync(apiPath)).toBe(true)
    const content = readFileSync(apiPath, 'utf-8')
    expect(content).toContain('export async function createPullRequest')
    expect(content).toContain('export async function mergePullRequest')
  })

  it('github-api uses native fetch and Bearer token auth', () => {
    const apiPath = resolve(process.cwd(), 'agent-engine/src/github-api.ts')
    const content = readFileSync(apiPath, 'utf-8')
    expect(content).toContain('fetch(')
    expect(content).toContain('Authorization')
    expect(content).toContain('token')
  })
})
