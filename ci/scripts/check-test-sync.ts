#!/usr/bin/env tsx
/**
 * 测试同步检测脚本
 * 检查：src/ 新增代码文件时，tests/ 目录是否也有对应更新
 *
 * 硬性规则：
 *   - src/ 新增 .ts/.vue 文件 → tests/ 必须有新增或修改
 *   - src/ 修改已有文件 → 由 npm run test 保证（已有测试不挂）
 *
 * 豁免场景：
 *   - 删除文件（--diff-filter=A 天然排除）
 *   - 纯类型定义文件（src/types/、.d.ts）
 *   - 纯配置文件改动（无 src/ 代码新增）
 *
 * 用法:
 *   npx tsx ci/scripts/check-test-sync.ts --base origin/main    # CI 模式：对比 base 分支
 *   npx tsx ci/scripts/check-test-sync.ts --staged              # 本地模式：检测暂存区
 */

import { execSync } from 'child_process'

interface TestIssue {
  rule: string
  changedFiles: string[]
  reason: string
  suggestion: string
}

const MODE = process.argv.includes('--staged') ? 'staged' : 'base'
const BASE_REF = (() => {
  const idx = process.argv.indexOf('--base')
  return idx >= 0 ? process.argv[idx + 1] : 'origin/main'
})()

function baseRefExists(): boolean {
  try {
    execSync(`git rev-parse --verify ${BASE_REF}`, { encoding: 'utf-8', cwd: process.cwd(), stdio: 'pipe' })
    return true
  } catch (err) {
    console.error(`[check-test-sync] base ref ${BASE_REF} 不存在: ${String(err)}`)
    return false
  }
}

function getChangedFiles(diffFilter: string = ''): string[] {
  let output: string
  const filter = diffFilter ? `--diff-filter=${diffFilter}` : '--diff-filter=d'

  if (MODE === 'staged') {
    output = execSync(`git diff --cached ${filter} --name-only`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
    })
  } else {
    if (!baseRefExists()) {
      return []
    }
    output = execSync(`git diff ${filter} --name-only ${BASE_REF}...HEAD`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
    })
  }

  return output.split('\n').filter((f) => f.trim() !== '')
}

function isCodeFile(filePath: string): boolean {
  return (
    filePath.startsWith('kimi-code-swarm/src/') &&
    (filePath.endsWith('.ts') || filePath.endsWith('.vue')) &&
    !filePath.endsWith('.d.ts') &&
    !filePath.includes('/types/')
  )
}

function isTestFile(filePath: string): boolean {
  return (
    filePath.includes('tests/') ||
    filePath.includes('.spec.') ||
    filePath.includes('.test.')
  )
}

function checkTestSync(): TestIssue[] {
  const issues: TestIssue[] = []

  // 1️⃣ 检测 src/ 下新增的代码文件
  const newCodeFiles = getChangedFiles('A').filter(isCodeFile)

  if (newCodeFiles.length > 0) {
    // 2️⃣ 检测 tests/ 下是否有新增或修改
    const allChanges = getChangedFiles()
    const testChanges = allChanges.filter(isTestFile)

    if (testChanges.length === 0) {
      issues.push({
        rule: 'test-sync/new-code-requires-test',
        changedFiles: newCodeFiles,
        reason: `src/ 新增了 ${newCodeFiles.length} 个代码文件，但 tests/ 目录没有对应测试新增或修改。`,
        suggestion: '请为新增代码补充单元测试（Vitest）、集成测试或 E2E 测试。',
      })
    }
  }

  return issues
}

function main() {
  const modeLabel = MODE === 'staged' ? '已暂存变更' : `相对于 ${BASE_REF} 的变更`
  console.log(`🔍 测试同步检测 (${modeLabel})\n`)

  const issues = checkTestSync()

  if (issues.length === 0) {
    console.log('✅ 测试同步检查通过（新增代码已有测试覆盖，或无需测试）')
    process.exit(0)
  }

  console.log(`❌ 发现 ${issues.length} 处测试未同步：\n`)

  for (const issue of issues) {
    console.log(`  📄 新增代码文件:`)
    for (const f of issue.changedFiles) {
      console.log(`     - ${f}`)
    }
    console.log(`  📋 规则: [${issue.rule}]`)
    console.log(`  📝 ${issue.reason}`)
    console.log(`  💡 ${issue.suggestion}`)
    console.log()
  }

  console.log('测试同步要求：')
  console.log('  1. 新增 src/ 代码文件时，必须在 tests/ 目录下补充对应测试')
  console.log('  2. 修改现有代码时，需确保 npm run test 通过（已有测试不挂）')
  console.log('  3. 确认无需测试时使用 --no-verify 跳过（不推荐）')
  console.log()

  process.exit(1)
}

main()
