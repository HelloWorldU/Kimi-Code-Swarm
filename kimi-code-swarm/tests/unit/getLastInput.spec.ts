import { describe, it, expect } from 'vitest'
import { getLastInput } from '../../src/utils/getLastInput'
import type { LogEntry } from '../../src/types'

function makeLog(type: LogEntry['type'], content: string): LogEntry {
  return { id: '1', timestamp: new Date().toISOString(), type, content }
}

describe('getLastInput', () => {
  it('returns empty string for empty logs', () => {
    expect(getLastInput([])).toBe('')
  })

  it('returns empty string when no input logs exist', () => {
    const logs: LogEntry[] = [
      makeLog('system', 'Agent 已创建'),
      makeLog('output', 'Hello'),
      makeLog('error', 'Oops'),
    ]
    expect(getLastInput(logs)).toBe('')
  })

  it('returns the only input log content', () => {
    const logs: LogEntry[] = [
      makeLog('system', 'Ready'),
      makeLog('input', 'fix the bug'),
    ]
    expect(getLastInput(logs)).toBe('fix the bug')
  })

  it('returns the latest input when multiple inputs exist', () => {
    const logs: LogEntry[] = [
      makeLog('input', 'first instruction'),
      makeLog('output', 'Done'),
      makeLog('input', 'second instruction'),
      makeLog('system', 'Auto-submit'),
    ]
    expect(getLastInput(logs)).toBe('second instruction')
  })

  it('ignores non-input logs after the last input', () => {
    const logs: LogEntry[] = [
      makeLog('input', 'do work'),
      makeLog('output', 'result'),
      makeLog('error', 'something failed'),
    ]
    expect(getLastInput(logs)).toBe('do work')
  })
})
