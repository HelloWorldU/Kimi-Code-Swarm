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
  body?: string,
): Promise<{ number: number; html_url: string } | null> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) return null

  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/pulls`
  const payload = JSON.stringify({
    title,
    head: branch,
    base: 'main',
    body: body || `由 Kimi Code Swarm Agent 自动创建`,
  })

  try {
    const res = await fetch(url, { method: 'POST', headers: getHeaders(token), body: payload })
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
): Promise<{ state: string; merged: boolean; head: { sha: string }; user: { login: string } } | null> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) return null

  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}`

  try {
    const res = await fetch(url, { headers: getHeaders(token) })
    if (!res.ok) return null
    const data = (await res.json()) as { state: string; merged: boolean; head: { sha: string }; user: { login: string } }
    return data
  } catch (err) {
    const msg = `GitHub API 查询 PR 失败: ${String(err)}`
    console.error(`[github-api] ${msg}`)
    throw new Error(msg)
  }
}

/**
 * 获取当前 Token 对应的 GitHub 用户名
 */
export async function getAuthenticatedUser(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${GITHUB_API}/user`, { headers: getHeaders(token) })
    if (!res.ok) return null
    const data = (await res.json()) as { login: string }
    return data.login
  } catch (err) {
    console.error(`[github-api] getAuthenticatedUser 异常: ${String(err)}`)
    return null
  }
}

export interface CheckRun {
  id: number
  name: string
  status: string
  conclusion: string | null
  html_url: string
  details_url?: string
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
 * 获取 Pull Request 的所有 reviews
 */
export async function getPullRequestReviews(
  token: string,
  repoUrl: string,
  prNumber: number,
): Promise<{ id: number; state: string; user: { login: string }; body: string; submitted_at: string }[] | null> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) return null

  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/reviews`

  try {
    const res = await fetch(url, { headers: getHeaders(token) })
    if (!res.ok) {
      console.error(`[github-api] getReviews ${res.status}`)
      return null
    }
    return (await res.json()) as { id: number; state: string; user: { login: string }; body: string; submitted_at: string }[]
  } catch (err) {
    console.error(`[github-api] getReviews 异常: ${String(err)}`)
    return null
  }
}

/**
 * 提交 Pull Request Review（approve / request_changes / comment）
 */
export async function submitPullRequestReview(
  token: string,
  repoUrl: string,
  prNumber: number,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
  body?: string,
): Promise<{ ok: boolean; error?: string }> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) return { ok: false }

  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/reviews`
  const payload = JSON.stringify({ event, body: body || '' })

  try {
    const res = await fetch(url, { method: 'POST', headers: getHeaders(token), body: payload })
    if (!res.ok) {
      const err = await res.text()
      console.error(`[github-api] submitReview ${res.status}: ${err}`)
      return { ok: false, error: err }
    }
    return { ok: true }
  } catch (err) {
    console.error(`[github-api] submitReview 异常: ${String(err)}`)
    return { ok: false, error: String(err) }
  }
}

/**
 * 获取失败 check run 的日志文本
 * 优先使用 GitHub Actions job logs API（check-runs 的 logs_url 经常为 null）
 */
export async function getCheckRunLogs(
  token: string,
  repoUrl: string,
  checkRunId: number,
  detailsUrl?: string,
): Promise<string | null> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) return null

  // 方案 A: 从 details_url 提取 job_id，调用 Actions job logs API
  if (detailsUrl) {
    const match = detailsUrl.match(/\/job\/(\d+)$/)
    if (match) {
      const jobId = match[1]
      const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/actions/jobs/${jobId}/logs`
      try {
        const res = await fetch(url, { headers: getHeaders(token) })
        if (res.ok) {
          const text = await res.text()
          return text.length > 8000 ? text.slice(0, 8000) + '\n...[truncated]' : text
        }
        console.error(`[github-api] job logs ${res.status}`)
      } catch (err) {
        console.error(`[github-api] job logs 异常: ${String(err)}`)
      }
    }
  }

  // 方案 B: fallback 到 check-runs logs 端点
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
    const text = await res.text()
    return text.length > 8000 ? text.slice(0, 8000) + '\n...[truncated]' : text
  } catch (err) {
    console.error(`[github-api] getCheckRunLogs 异常: ${String(err)}`)
    return null
  }
}
