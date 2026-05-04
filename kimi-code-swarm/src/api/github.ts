const GITHUB_API = 'https://api.github.com'

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
  try {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  } catch {
    return null
  }
}

async function githubFetch<T = Record<string, unknown>>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  if (!token) throw new Error('GitHub Token 未配置')

  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `GitHub API ${res.status}: ${res.statusText}`)
  }

  return res.json() as Promise<T>
}

export async function createPullRequest(
  repoUrl: string,
  title: string,
  head: string,
  base: string = 'main',
  body: string = ''
): Promise<{ number: number; html_url: string }> {
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) throw new Error('无法解析仓库地址')

  return githubFetch(`/repos/${parsed.owner}/${parsed.repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, head, base, body }),
  })
}

export async function mergePullRequest(
  repoUrl: string,
  number: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash'
): Promise<{ sha: string; message: string }> {
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) throw new Error('无法解析仓库地址')

  return githubFetch(`/repos/${parsed.owner}/${parsed.repo}/pulls/${number}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ merge_method: method }),
  })
}

export async function getPullRequest(repoUrl: string, number: number): Promise<Record<string, unknown>> {
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) throw new Error('无法解析仓库地址')

  return githubFetch(`/repos/${parsed.owner}/${parsed.repo}/pulls/${number}`)
}
