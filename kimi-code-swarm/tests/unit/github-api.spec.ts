import { describe, it, expect, beforeEach } from 'vitest'
import { parseRepoUrl, getToken, setToken, hasToken } from '../../src/api/github'

describe('parseRepoUrl', () => {
  it('parses https url without .git suffix', () => {
    const result = parseRepoUrl('https://github.com/HelloWorldU/Kimi-Code-Swarm')
    expect(result).toEqual({ owner: 'HelloWorldU', repo: 'Kimi-Code-Swarm' })
  })

  it('parses https url with .git suffix', () => {
    const result = parseRepoUrl('https://github.com/HelloWorldU/Kimi-Code-Swarm.git')
    expect(result).toEqual({ owner: 'HelloWorldU', repo: 'Kimi-Code-Swarm' })
  })

  it('returns null for invalid url', () => {
    expect(parseRepoUrl('not-a-url')).toBeNull()
    expect(parseRepoUrl('https://example.com/foo/bar')).toBeNull()
  })
})

describe('token management', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores and retrieves token', () => {
    expect(getToken()).toBeNull()
    setToken('ghp_test_token_123')
    expect(getToken()).toBe('ghp_test_token_123')
  })

  it('reports hasToken correctly', () => {
    expect(hasToken()).toBe(false)
    setToken('ghp_test')
    expect(hasToken()).toBe(true)
  })
})
