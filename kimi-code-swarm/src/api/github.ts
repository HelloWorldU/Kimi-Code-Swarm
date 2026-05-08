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

// parseRepoUrl 已清理：原用于 PR 相关函数，现随 createPullRequest / mergePullRequest / getPullRequest 一起移除。
// 如需恢复，从 git history 回滚即可。
// GitHub API 核心 fetch 工具，当前随 PR 相关函数一起移除。
// 如需恢复 GitHub 集成功能，从 git history 回滚即可。

