import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir, rm, access } from 'fs/promises'

const execFileAsync = promisify(execFile)

export interface GitResult {
  stdout: string
  stderr: string
  exitCode: number
}

async function execGitRaw(dir: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd: dir })
    return {
      stdout: stdout.trim(),
      stderr: (stderr?.toString() || '').trim(),
      exitCode: 0,
    }
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; code?: number }
    return {
      stdout: (e.stdout?.toString() || '').trim(),
      stderr: (e.stderr?.toString() || '').trim(),
      exitCode: e.code ?? 1,
    }
  }
}

async function execGit(dir: string, args: string[]): Promise<string> {
  const result = await execGitRaw(dir, args)
  if (result.exitCode !== 0) {
    const message = result.stderr || result.stdout || 'Git command failed'
    throw new Error(message)
  }
  return result.stdout
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    await access(dir)
    return true
  } catch {
    // expected: 目录不存在是正常情况（如首次 clone）
    return false
  }
}

export async function cloneRepo(repoUrl: string, targetDir: string, parentDir: string): Promise<void> {
  await mkdir(parentDir, { recursive: true })
  if (await dirExists(targetDir)) {
    await rm(targetDir, { recursive: true, force: true })
  }
  await execGit(parentDir, ['clone', repoUrl, targetDir])
  // Bug #3 修复：注册 pre-commit hook 路径——agent workspace 不会跑 npm
  // install，不触发 setup-hooks.js postinstall，core.hooksPath 不会自动
  // 设置。不显式注册的话 git commit 走默认 .git/hooks/（空），pre-commit
  // 完全不会跑，agent 改源码忘改文档的情况下本地拦不住，得绕一圈 CI fix。
  // 这里跟 scripts/setup-hooks.js 做的事一样。
  await execGit(targetDir, ['config', 'core.hooksPath', 'ci/hooks'])
}

export async function createBranch(dir: string, branch: string): Promise<void> {
  await execGit(dir, ['checkout', '-b', branch])
}

export async function gitAdd(dir: string): Promise<GitResult> {
  return await execGitRaw(dir, ['add', '.'])
}

export async function gitCommit(dir: string, message: string): Promise<GitResult> {
  return await execGitRaw(dir, ['commit', '-m', message])
}

export async function gitPush(dir: string, branch: string): Promise<GitResult> {
  return await execGitRaw(dir, ['push', 'origin', branch])
}

export async function getChangedFiles(dir: string): Promise<string[]> {
  // 用 git status --porcelain 替代 git diff --name-only：后者只返回已 tracked
  // 文件的修改，**不含 untracked（新增文件）**。agent 新建文件（如 .kimi/skills/
  // pull/SKILL.md）就会被漏检，导致 autoSubmitForReview 不触发、PR 不创建。
  // status --porcelain 输出每行前 2-3 字符是状态标记（'?? ' / ' M ' / 'M  '
  // / 'A  ' / 'D  ' 等），后面是路径；这里只取路径。
  const out = await execGit(dir, ['status', '--porcelain'])
  return out
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim())  // 跳过前 2 字符 status + 1 空格
    .filter((path) => path.length > 0)
}

export async function getStagedFiles(dir: string): Promise<string[]> {
  const out = await execGit(dir, ['diff', '--cached', '--name-only'])
  return out.split('\n').filter((f) => f.trim())
}

export async function getFileDiff(dir: string, filePath: string): Promise<string> {
  return await execGit(dir, ['diff', '--', filePath])
}

export async function gitFetch(dir: string): Promise<void> {
  await execGit(dir, ['fetch', 'origin'])
}

export async function getBranchDiff(dir: string, branch: string): Promise<string> {
  // 用 origin/main 不是本地 main：reviewer workspace 的本地 main 永远停在
  // clone 时的版本（gitFetch 只更新 remote-tracking ref 不动本地分支），
  // merge-base 会算成 reviewer 几天前的 main，diff 被虚假放大到包含所有
  // main 推进的 commit，触发 ENAMETOOLONG（Bug E-1）。
  return await execGit(dir, ['diff', `origin/main...origin/${branch}`])
}

export async function gitDeleteRemoteBranch(dir: string, branch: string): Promise<void> {
  await execGit(dir, ['push', 'origin', '--delete', branch])
}
