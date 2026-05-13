import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir, rm, access } from 'fs/promises'

const execFileAsync = promisify(execFile)

async function execGit(dir: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: dir })
    return stdout.trim()
  } catch (err: any) {
    const stderr = err.stderr?.toString() || ''
    const message = stderr ? `${err.message}\n${stderr}` : err.message
    throw new Error(message)
  }
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
}

export async function createBranch(dir: string, branch: string): Promise<void> {
  await execGit(dir, ['checkout', '-b', branch])
}

export async function gitAdd(dir: string): Promise<void> {
  await execGit(dir, ['add', '.'])
}

export async function gitCommit(dir: string, message: string): Promise<void> {
  await execGit(dir, ['commit', '-m', message])
}

export async function gitPush(dir: string, branch: string): Promise<void> {
  await execGit(dir, ['push', 'origin', branch])
}

export async function getChangedFiles(dir: string): Promise<string[]> {
  const out = await execGit(dir, ['diff', '--name-only'])
  return out.split('\n').filter((f) => f.trim())
}

export async function getFileDiff(dir: string, filePath: string): Promise<string> {
  return await execGit(dir, ['diff', '--', filePath])
}

export async function gitFetch(dir: string): Promise<void> {
  await execGit(dir, ['fetch', 'origin'])
}

export async function getBranchDiff(dir: string, branch: string): Promise<string> {
  return await execGit(dir, ['diff', `main...origin/${branch}`])
}

export async function gitDeleteRemoteBranch(dir: string, branch: string): Promise<void> {
  await execGit(dir, ['push', 'origin', '--delete', branch])
}
