#!/usr/bin/env tsx
/**
 * Harness Bug-Fix 流程回归测试
 * 评估 bug-fix 分支是否符合 harness/bug-fix.yaml 的 must/must-not
 */

import {
  getCurrentBranch,
  getCommitInfo,
  getDiffSummary,
  hasRootCause,
  isConventionalCommit,
} from './utils/git-analyzer.js'

interface EvalResult {
  rule: string
  severity: 'hard' | 'soft'
  passed: boolean
  message: string
}

function evaluate(): EvalResult[] {
  const results: EvalResult[] = []
  const branch = getCurrentBranch()
  const commit = getCommitInfo('HEAD')
  const diff = getDiffSummary('HEAD')
  const firstLine = commit.message.split('\n')[0]

  // ── must: 理解根因后再动手（禁止盲修）──
  results.push({
    rule: 'bug-fix/root-cause-understood',
    severity: 'hard',
    passed: hasRootCause(commit.message),
    message: hasRootCause(commit.message)
      ? '✅ commit message 包含根因说明'
      : '❌ commit message 未包含根因说明（禁止盲修）',
  })

  // ── must: 修复后必须留痕（形式不限）──
  const hasDocTrace = diff.docFiles.length > 0
  const hasCodeComment = false // TODO: 扫描代码中新增的注释
  results.push({
    rule: 'bug-fix/documentation-trace',
    severity: 'hard',
    passed: hasDocTrace,
    message: hasDocTrace
      ? `✅ 伴随文档/计划更新 (${diff.docFiles.length} 个文件)`
      : '❌ 修复后未留痕（docs/、exec-plans/、或 harness/ 无变更）',
  })

  // ── must-not: 修复后不留任何痕迹 ──
  results.push({
    rule: 'bug-fix/no-trace-forbidden',
    severity: 'hard',
    passed: hasDocTrace || diff.codeFiles.length === 0,
    message: diff.codeFiles.length > 0 && !hasDocTrace
      ? '❌ 代码有变更但未留任何痕迹'
      : '✅ 未违反不留痕迹禁令',
  })

  // ── must-not: 同一 bug 反复出现时仍不加日志定位 ──
  // 这个需要跨 commit 分析，单 commit 无法判断，标记为信息性
  results.push({
    rule: 'bug-fix/logger-on-recurring',
    severity: 'soft',
    passed: true,
    message: '⚡ 软性约束：若同一 bug 反复出现，需检查是否增加了 logger 定位（需人工审阅）',
  })

  // ── 分支规范 ──
  results.push({
    rule: 'bug-fix/branch-naming',
    severity: 'soft',
    passed: branch.isBugFix,
    message: branch.isBugFix
      ? `✅ 分支名符合规范 (${branch.name})`
      : `⚡ 分支名建议以 fix/ 或 bugfix/ 开头 (当前: ${branch.name})`,
  })

  // ── commit 规范 ──
  results.push({
    rule: 'bug-fix/conventional-commit',
    severity: 'soft',
    passed: isConventionalCommit(commit.message),
    message: isConventionalCommit(commit.message)
      ? '✅ commit message 符合 conventional commits'
      : `⚡ 建议 commit message 使用 conventional commits 格式 (当前: ${firstLine})`,
  })

  // ── 测试覆盖 ──
  results.push({
    rule: 'bug-fix/test-coverage',
    severity: 'soft',
    passed: diff.testFiles.length > 0 || diff.codeFiles.length === 0,
    message: diff.testFiles.length > 0
      ? `✅ 伴随测试变更 (${diff.testFiles.length} 个文件)`
      : diff.codeFiles.length === 0
        ? '✅ 无代码变更，无需测试'
        : '⚡ 代码有变更但未伴随测试更新',
  })

  // ── STATUS 同步 ──
  results.push({
    rule: 'bug-fix/status-sync',
    severity: 'soft',
    passed: diff.statusFiles.length > 0 || diff.codeFiles.length === 0,
    message: diff.statusFiles.length > 0
      ? '✅ STATUS.md 已更新'
      : diff.codeFiles.length === 0
        ? '✅ 无代码变更，无需 STATUS 更新'
        : '⚡ 代码有变更但未更新 STATUS.md',
  })

  return results
}

function main() {
  console.log('🔍 Harness Bug-Fix 流程回归测试\n')
  const results = evaluate()
  const hardFails = results.filter((r) => r.severity === 'hard' && !r.passed)
  const softWarns = results.filter((r) => r.severity === 'soft' && !r.passed)

  for (const r of results) {
    const icon = r.passed ? '✅' : r.severity === 'hard' ? '❌' : '⚡'
    console.log(`  ${icon} [${r.rule}] ${r.message}`)
  }

  console.log(`\n📊 结果: ${results.filter((r) => r.passed).length}/${results.length} 通过`)

  if (hardFails.length > 0) {
    console.log(`\n❌ 发现 ${hardFails.length} 处硬性偏离，需修复后才能合入：`)
    for (const f of hardFails) {
      console.log(`   - [${f.rule}] ${f.message}`)
    }
    process.exit(1)
  }

  if (softWarns.length > 0) {
    console.log(`\n⚡ 发现 ${softWarns.length} 处软性偏离，建议修复：`)
    for (const w of softWarns) {
      console.log(`   - [${w.rule}] ${w.message}`)
    }
  }

  console.log('\n✅ 硬性约束全部通过')
  process.exit(0)
}

main()
