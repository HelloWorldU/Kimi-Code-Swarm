/**
 * GitHub API 封装（Node.js 端）
 * 通过原生 fetch 调用 GitHub REST API，避免浏览器 CORS 问题
 */

function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

const GITHUB_API = 'https://api.github.com'

function getHeaders(token: string) {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'Kimi-Code-Swarm',
  }
}

/**
 * 创建 Pull Request
 */
export async function createPullRequest(
  token: string,
  repoUrl: string,
  branch: string,
  title: string,
): Promise<{ number: number; html_url: string } | null> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) return null

  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/pulls`
  const body = JSON.stringify({
    title,
    head: branch,
    base: 'main',
    body: `由 Kimi Code Swarm Agent 自动创建`,
  })

  try {
    const res = await fetch(url, { method: 'POST', headers: getHeaders(token), body })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`GitHub API ${res.status}: ${err}`)
    }
    const data = (await res.json()) as { number: number; html_url: string }
    return { number: data.number, html_url: data.html_url }
  } catch (err) {
    const msg = `创建 PR 失败: ${String(err)}`
    console.error(`[github-api] ${msg}`)
    throw new Error(msg)
  }
}

/**
 * 合并 Pull Request
 */
export async function mergePullRequest(
  token: string,
  repoUrl: string,
  prNumber: number,
): Promise<boolean> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) return false

  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/merge`
  const body = JSON.stringify({ merge_method: 'squash' })

  try {
    const res = await fetch(url, { method: 'PUT', headers: getHeaders(token), body })
    return res.ok
  } catch (err) {
    const msg = `GitHub API 合并请求失败: ${String(err)}`
    console.error(`[github-api] ${msg}`)
    throw new Error(msg)
  }
}

/**
 * 查询 Pull Request 状态
 */
export async function getPullRequest(
  token: string,
  repoUrl: string,
  prNumber: number,
): Promise<{ state: string; merged: boolean } | null> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) return null

  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}`

  try {
    const res = await fetch(url, { headers: getHeaders(token) })
    if (!res.ok) return null
    const data = (await res.json()) as { state: string; merged: boolean }
    return data
  } catch (err) {
    const msg = `GitHub API 查询 PR 失败: ${String(err)}`
    console.error(`[github-api] ${msg}`)
    throw new Error(msg)
  }
}
