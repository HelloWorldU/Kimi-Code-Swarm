#!/usr/bin/env tsx
/**
 * 文档同步检测脚本
 * 检查：代码变更后，关联文档是否也同步更新
 *
 * 用法:
 *   npx tsx ci/scripts/check-docs-sync.ts           # 检查已暂存(staged)的变更
 *   npx tsx ci/scripts/check-docs-sync.ts --all     # 检查工作区所有变更
 *   npx tsx ci/scripts/check-docs-sync.ts --staged  # 检查已暂存的变更（默认）
 */

import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

interface DocMapping {
  id: string
  paths: string[]
  docs: string[]
  reason: string
}

interface DocMap {
  mappings: DocMapping[]
}

interface SyncIssue {
  rule: string
  changedFile: string
  missingDocs: string[]
  reason: string
}

const MODE = process.argv.includes('--all') ? 'all' : 'staged'

function getChangedFiles(): string[] {
  let output: string
  if (MODE === 'staged') {
    output = execSync('git diff --cached --name-only', { encoding: 'utf-8', cwd: process.cwd() })
  } else {
    output = execSync('git diff --name-only HEAD', { encoding: 'utf-8', cwd: process.cwd() })
  }
  return output.split('\n').filter(f => f.trim() !== '')
}

function getRepoRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', cwd: process.cwd() }).trim()
  } catch {
    console.error('❌ 无法找到 git 仓库根目录')
    process.exit(1)
  }
}

function loadDocMap(): DocMapping[] {
  const repoRoot = getRepoRoot()
  const mapPath = resolve(repoRoot, 'docs', 'doc-map.json')
  if (!existsSync(mapPath)) {
    console.error('❌ 找不到 docs/doc-map.json')
    process.exit(1)
  }
  const content = readFileSync(mapPath, 'utf-8')
  const map = JSON.parse(content) as DocMap
  return map.mappings || []
}

function matchGlob(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(filePath)
}

function isDocUpdated(docPath: string, changedFiles: string[]): boolean {
  return changedFiles.some(f => f === docPath)
}

function checkSync(): SyncIssue[] {
  const changedFiles = getChangedFiles()
  const mappings = loadDocMap()
  const issues: SyncIssue[] = []

  for (const mapping of mappings) {
    for (const changedFile of changedFiles) {
      const matched = mapping.paths.some(pattern => matchGlob(changedFile, pattern))
      if (!matched) continue

      const missingDocs = mapping.docs.filter(doc => !isDocUpdated(doc, changedFiles))
      if (missingDocs.length > 0) {
        issues.push({
          rule: mapping.id,
          changedFile,
          missingDocs,
          reason: mapping.reason,
        })
      }
    }
  }

  return issues
}

function main() {
  console.log(`🔍 文档同步检测 (${MODE === 'staged' ? '已暂存' : '全部'}变更)\n`)

  const issues = checkSync()

  if (issues.length === 0) {
    console.log('✅ 文档同步检查通过（所有变更都有对应文档更新，或无需更新）')
    process.exit(0)
  }

  console.log(`❌ 发现 ${issues.length} 处文档未同步：\n`)

  for (const issue of issues) {
    console.log(`  📄 代码变更: ${issue.changedFile}`)
    console.log(`     规则: [${issue.rule}] ${issue.reason}`)
    console.log(`     需要同步更新:`)
    for (const doc of issue.missingDocs) {
      console.log(`       - ${doc}`)
    }
    console.log()
  }

  console.log('💡 修复方法：')
  console.log('   1. 修改对应文档，说明本次代码变更的影响')
  console.log('   2. git add 文档文件')
  console.log('   3. 重新提交')
  console.log()
  console.log('   如果确认无需更新文档，使用 --no-verify 跳过（不推荐）')

  process.exit(1)
}

main()
