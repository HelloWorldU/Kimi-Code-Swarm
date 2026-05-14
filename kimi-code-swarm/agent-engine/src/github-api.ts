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
): Promise<{ state: string; merged: boolean; head: { sha: string } } | null> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) return null

  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}`

  try {
    const res = await fetch(url, { headers: getHeaders(token) })
    if (!res.ok) return null
    const data = (await res.json()) as { state: string; merged: boolean; head: { sha: string } }
    return data
  } catch (err) {
    const msg = `GitHub API 查询 PR 失败: ${String(err)}`
    console.error(`[github-api] ${msg}`)
    throw new Error(msg)
  }
}

export interface CheckRun {
  id: number
  name: string
  status: string
  conclusion: string | null
  html_url: string
  started_at: string | null
}

export interface CheckRunsResult {
  total_count: number
  check_runs: CheckRun[]
}

/**
 * 查询指定 commit 的 check runs（CI 状态）
 */
export async function getCheckRuns(
  token: string,
  repoUrl: string,
  ref: string,
): Promise<CheckRunsResult | null> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) return null

  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/commits/${ref}/check-runs`

  try {
    const res = await fetch(url, { headers: getHeaders(token) })
    if (!res.ok) {
      const err = await res.text()
      console.error(`[github-api] getCheckRuns ${res.status}: ${err}`)
      return null
    }
    return (await res.json()) as CheckRunsResult
  } catch (err) {
    console.error(`[github-api] getCheckRuns 异常: ${String(err)}`)
    return null
  }
}

/**
 * 获取失败 check run 的日志文本
 * GitHub 返回的是 text/plain 的日志文件，跟随重定向获取
 */
export async function getCheckRunLogs(
  token: string,
  repoUrl: string,
  checkRunId: number,
): Promise<string | null> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) return null

  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/check-runs/${checkRunId}/logs`

  try {
    const res = await fetch(url, {
      headers: { ...getHeaders(token), Accept: 'application/vnd.github.v3+json' },
      redirect: 'follow',
    })
    if (!res.ok) {
      console.error(`[github-api] getCheckRunLogs ${res.status}`)
      return null
    }
    // 日志可能很大，截断到 8000 字符以内
    const text = await res.text()
    return text.length > 8000 ? text.slice(0, 8000) + '\n...[truncated]' : text
  } catch (err) {
    console.error(`[github-api] getCheckRunLogs 异常: ${String(err)}`)
    return null
  }
}
