#!/usr/bin/env tsx
/**
 * AST 分析器主入口
 * 用法: npx tsx ast/analyzer.ts <file|dir> [--fix]
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, extname, relative } from 'path'

import { checkVueStructure } from './rules/vue-structure'
import { checkImports } from './rules/import-restrictions'
import { checkStyle } from './rules/style-constraints'
import { checkDeadCode } from './rules/dead-code'

export interface AstIssue {
  file: string
  rule: string
  message: string
  line?: number
  fixable: boolean
  fix?: string
}

const SHOULD_FIX = process.argv.includes('--fix')

function findFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...findFiles(full))
    } else if (stat.isFile() && ['.vue', '.ts'].includes(extname(entry))) {
      results.push(full)
    }
  }
  return results
}

function analyzeVueFile(filePath: string, content: string): AstIssue[] {
  const issues: AstIssue[] = []

  // Vue 结构规则
  issues.push(...checkVueStructure(content, filePath))

  // 导入限制规则（script 内容）
  issues.push(...checkImports(content, filePath))

  // 样式约束规则
  issues.push(...checkStyle(content, filePath))

  return issues
}

function analyzeTsFile(filePath: string, content: string): AstIssue[] {
  const issues: AstIssue[] = []
  issues.push(...checkImports(content, filePath))
  return issues
}

function printIssues(issues: AstIssue[], totalRef: { value: number }, fixableRef: { value: number }) {
  for (const issue of issues) {
    const relPath = relative(process.cwd(), issue.file)
    console.log(`\n📄 ${relPath}`)
    const icon = issue.fixable ? '🔧' : '❌'
    const loc = issue.line ? `:${issue.line}` : ''
    console.log(`  ${icon} [${issue.rule}]${loc} ${issue.message}`)
    if (issue.fix && SHOULD_FIX) {
      console.log(`     💡 ${issue.fix}`)
    }
    totalRef.value++
    if (issue.fixable) fixableRef.value++
  }
}

function main() {
  const target = process.argv.find((_, i, arr) => i > 1 && !arr[i].startsWith('--'))
  if (!target) {
    console.error('用法: npx tsx ast/analyzer.ts <file|dir> [--fix]')
    process.exit(1)
  }

  const stat = statSync(target)
  const files: string[] = stat.isDirectory() ? findFiles(target) : [target]

  const total = { value: 0 }
  const fixable = { value: 0 }

  // 收集所有文件内容（用于跨文件 dead-code 分析）
  const fileContents = files.map((f) => ({
    path: f,
    content: readFileSync(f, 'utf-8'),
  }))

  // ── 单文件规则 ──
  for (const { path, content } of fileContents) {
    const ext = extname(path)
    const issues = ext === '.vue'
      ? analyzeVueFile(path, content)
      : analyzeTsFile(path, content)
    printIssues(issues, total, fixable)
  }

  // ── 跨文件规则（dead code） ──
  const deadCodeIssues = checkDeadCode(fileContents, process.cwd())
  printIssues(deadCodeIssues, total, fixable)

  if (total.value === 0) {
    console.log('✅ 所有 AST 检查通过')
    process.exit(0)
  } else {
    console.log(`\n📊 总计: ${total.value} 个问题，${fixable.value} 个可修复`)
    process.exit(1)
  }
}

main()
