import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

async function execGit(dir: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync('git', args, { cwd: dir })
  if (stderr && !stdout) {
    throw new Error(`git error: ${stderr.trim()}`)
  }
  return stdout.trim()
}

export async function cloneRepo(repoUrl: string, targetDir: string, parentDir: string): Promise<void> {
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
  try {
    const out = await execGit(dir, ['diff', '--name-only'])
    return out.split('\n').filter((f) => f.trim())
  } catch {
    return []
  }
}

export async function getFileDiff(dir: string, filePath: string): Promise<string> {
  try {
    return await execGit(dir, ['diff', '--', filePath])
  } catch {
    return ''
  }
}
