/**
 * Git 历史分析器
 * 分析 commit / branch / diff，提取 Harness 合规所需信息
 */

import { execSync } from 'child_process'

export interface CommitInfo {
  hash: string
  message: string
  author: string
  date: string
  changedFiles: string[]
}

export interface BranchInfo {
  name: string
  isBugFix: boolean
  isFeature: boolean
}

export interface DiffSummary {
  newFiles: string[]
  modifiedFiles: string[]
  codeFiles: string[]
  testFiles: string[]
  docFiles: string[]
  statusFiles: string[]
}

function execGit(args: string[]): string {
  return execSync(`git ${args.join(' ')}`, { encoding: 'utf-8', cwd: process.cwd() }).trim()
}

/**
 * 获取当前分支信息
 */
export function getCurrentBranch(): BranchInfo {
  const name = execGit(['rev-parse', '--abbrev-ref', 'HEAD'])
  return {
    name,
    isBugFix: /^fix\//i.test(name) || /^bugfix\//i.test(name),
    isFeature: /^feat\//i.test(name) || /^feature\//i.test(name),
  }
}

/**
 * 获取指定 commit 的信息
 */
export function getCommitInfo(commit: string = 'HEAD'): CommitInfo {
  const hash = execGit(['rev-parse', '--short', commit])
  const message = execGit(['log', '-1', '--format=%B', commit])
  const author = execGit(['log', '-1', '--format=%an', commit])
  const date = execGit(['log', '-1', '--format=%ai', commit])
  const changedFiles = execGit(['diff-tree', '--no-commit-id', '--name-only', '-r', commit])
    .split('\n')
    .filter((f) => f.trim() !== '')

  return { hash, message, author, date, changedFiles }
}

/**
 * 获取 commit 的 diff 分类汇总
 */
export function getDiffSummary(commit: string = 'HEAD'): DiffSummary {
  const newFiles = execGit(['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=A', '-r', commit])
    .split('\n')
    .filter((f) => f.trim() !== '')

  const modifiedFiles = execGit(['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=M', '-r', commit])
    .split('\n')
    .filter((f) => f.trim() !== '')

  const allChanged = [...newFiles, ...modifiedFiles]

  const isCodeFile = (f: string) =>
    f.startsWith('kimi-code-swarm/src/') && (f.endsWith('.ts') || f.endsWith('.vue')) && !f.endsWith('.d.ts')

  const isTestFile = (f: string) => f.includes('tests/') || f.includes('.spec.') || f.includes('.test.')

  const isDocFile = (f: string) =>
    f.startsWith('docs/') || f.startsWith('exec-plans/') || f.includes('harness/') || f.endsWith('.md')

  return {
    newFiles,
    modifiedFiles,
    codeFiles: allChanged.filter(isCodeFile),
    testFiles: allChanged.filter(isTestFile),
    docFiles: allChanged.filter(isDocFile),
    statusFiles: allChanged.filter((f) => f.includes('STATUS.md')),
  }
}

/**
 * 检查 commit message 是否包含根因说明
 * harness/bug-fix.yaml: must - 理解根因后再动手、修复后必须留痕
 */
export function hasRootCause(message: string): boolean {
  const keywords = ['根因', '原因', 'cause', 'reason', 'because', '由于', '因为', '修复', 'fix']
  const lower = message.toLowerCase()
  return keywords.some((k) => lower.includes(k.toLowerCase()))
}

/**
 * 检查 commit message 是否符合 conventional commits 规范
 */
export function isConventionalCommit(message: string): boolean {
  const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'ci', 'build']
  const pattern = new RegExp(`^(${types.join('|')})(\\(.+\\))?!?: .+`)
  return pattern.test(message.split('\n')[0])
}

/**
 * 获取 PR 的 commits 列表
 */
export function getPRCommits(base: string = 'origin/main', head: string = 'HEAD'): CommitInfo[] {
  const output = execGit(['log', '--format=%H', `${base}..${head}`])
  if (!output) return []
  return output.split('\n').map((hash) => getCommitInfo(hash))
}
