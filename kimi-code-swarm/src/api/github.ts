// const GITHUB_API = 'https://api.github.com'
// 已随 GitHub API 函数一起清理，如需恢复 PR 功能，从 git history 回滚即可。
export function getToken(): string | null {
  return localStorage.getItem('github-token')
}

export function setToken(token: string): void {
  localStorage.setItem('github-token', token)
}

export function hasToken(): boolean {
  return !!getToken()
}

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

