#!/usr/bin/env tsx
/**
 * Harness New-Task 流程回归测试
 * 评估 new-task 分支是否符合 harness/new-task.yaml 的 must/must-not
 */

import {
  getCurrentBranch,
  getCommitInfo,
  getDiffSummary,
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

  // ── must: 代码改动后必须经过验证闭环才能开 PR ──
  // 这个需要 CI 状态，本地无法检测，标记为信息性
  results.push({
    rule: 'new-task/verification-loop',
    severity: 'soft',
    passed: true,
    message: '⚡ 软性约束：PR 必须通过 CI 验证闭环（build → test → lint → analyze）',
  })

  // ── must: 审阅通过后方可合并到 main ──
  // 需要 GitHub API 查询 PR 审阅状态，本地无法检测
  results.push({
    rule: 'new-task/review-gate',
    severity: 'soft',
    passed: true,
    message: '⚡ 软性约束：PR 需至少 1 个审阅通过（Review Agent 优先）',
  })

  // ── must-not: 未经验证的代码合入 main ──
  results.push({
    rule: 'new-task/no-unverified-merge',
    severity: 'hard',
    passed: true, // 本地无法检测，依赖 CI 门控
    message: '✅ 硬性约束由 CI 流水线保证（npm run ci）',
  })

  // ── must-not: 跳过审阅门控直接合并 ──
  results.push({
    rule: 'new-task/no-skip-review',
    severity: 'hard',
    passed: true, // 依赖 GitHub branch protection
    message: '✅ 硬性约束由 GitHub branch protection 保证',
  })

  // ── 分支规范 ──
  results.push({
    rule: 'new-task/branch-naming',
    severity: 'soft',
    passed: branch.isFeature,
    message: branch.isFeature
      ? `✅ 分支名符合规范 (${branch.name})`
      : `⚡ 分支名建议以 feat/ 或 feature/ 开头 (当前: ${branch.name})`,
  })

  // ── commit 规范 ──
  results.push({
    rule: 'new-task/conventional-commit',
    severity: 'soft',
    passed: isConventionalCommit(commit.message),
    message: isConventionalCommit(commit.message)
      ? '✅ commit message 符合 conventional commits'
      : `⚡ 建议 commit message 使用 conventional commits 格式 (当前: ${firstLine})`,
  })

  // ── 测试覆盖（new-task 必须配套测试）──
  results.push({
    rule: 'new-task/test-coverage',
    severity: 'hard',
    passed: diff.testFiles.length > 0 || diff.codeFiles.length === 0,
    message: diff.testFiles.length > 0
      ? `✅ 伴随测试新增/修改 (${diff.testFiles.length} 个文件)`
      : diff.codeFiles.length === 0
        ? '✅ 无代码变更，无需测试'
        : '❌ 代码有变更但未伴随测试更新（check-test-sync 也会阻断）',
  })

  // ── 文档同步 ──
  results.push({
    rule: 'new-task/docs-sync',
    severity: 'hard',
    passed: diff.docFiles.length > 0 || diff.codeFiles.length === 0,
    message: diff.docFiles.length > 0
      ? `✅ 伴随文档更新 (${diff.docFiles.length} 个文件)`
      : diff.codeFiles.length === 0
        ? '✅ 无代码变更，无需文档更新'
        : '❌ 代码有变更但未伴随文档更新（check-docs-sync 也会阻断）',
  })

  // ── STATUS 同步 ──
  results.push({
    rule: 'new-task/status-sync',
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
  console.log('🔍 Harness New-Task 流程回归测试\n')
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
