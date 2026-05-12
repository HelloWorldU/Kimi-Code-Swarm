import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// Project-level tests for store logic.
// Frontend-specific tests live in kimi-code-swarm/tests/unit/.

describe('store (project-level)', () => {
  it('useSwarmStore source file exists and exports the composable', () => {
    const storePath = resolve(process.cwd(), 'kimi-code-swarm/src/store/useSwarmStore.ts')
    expect(existsSync(storePath)).toBe(true)
    const content = readFileSync(storePath, 'utf-8')
    expect(content).toContain('export function useSwarmStore')
  })

  it('store module uses reactive state and defines agent status types', () => {
    const storePath = resolve(process.cwd(), 'kimi-code-swarm/src/store/useSwarmStore.ts')
    const content = readFileSync(storePath, 'utf-8')
    expect(content).toContain('reactive')
    expect(content).toMatch(/status\s*=\s*['"]ready['"]/)
    expect(content).toMatch(/status\s*=\s*['"]working['"]/)
  })
})
