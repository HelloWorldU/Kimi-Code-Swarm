#!/usr/bin/env tsx
/**
 * AST 分析器主入口
 * 用法: npx tsx ast/analyzer.ts <file|dir> [--fix]
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, extname, relative } from 'path'

import { checkVueStructure } from './rules/vue-structure'
import { checkImports } from './rules/import-restrictions'
import { checkStyle } from './rules/style-constraints'
import { checkDeadCode } from './rules/dead-code'
import { checkErrorHandling } from './rules/error-handling'
import { fixEmptyCatches } from './fixers/error-handling'

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

  // 错误处理规则
  issues.push(...checkErrorHandling(content, filePath))

  return issues
}

function analyzeTsFile(filePath: string, content: string): AstIssue[] {
  const issues: AstIssue[] = []
  issues.push(...checkImports(content, filePath))
  issues.push(...checkErrorHandling(content, filePath))
  return issues
}

function applyFixes(filePath: string, issues: AstIssue[]): string | null {
  if (!SHOULD_FIX) return null
  let content = readFileSync(filePath, 'utf-8')
  let modified = false

  // 按 fixer 类型分组应用
  const hasEmptyCatch = issues.some(i => i.rule === 'error-handling/empty-catch' && i.fixable)
  if (hasEmptyCatch) {
    const fixed = fixEmptyCatches(content)
    if (fixed !== content) {
      content = fixed
      modified = true
    }
  }

  return modified ? content : null
}

function printIssues(issues: AstIssue[], totalRef: { value: number }, fixableRef: { value: number }) {
  for (const issue of issues) {
    const relPath = relative(process.cwd(), issue.file)
    console.log(`\n📄 ${relPath}`)
    const icon = issue.fixable ? '🔧' : '❌'
    const loc = issue.line ? `:${issue.line}` : ''
    console.log(`  ${icon} [${issue.rule}]${loc} ${issue.message}`)
    if (issue.fix) {
      console.log(`     💡 ${issue.fix}`)
    }
    totalRef.value++
    if (issue.fixable) fixableRef.value++
  }
}

function main() {
  const targets = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
  if (targets.length === 0) {
    console.error('用法: npx tsx ast/analyzer.ts <file|dir> ... [--fix]')
    process.exit(1)
  }

  const files: string[] = []
  for (const target of targets) {
    const stat = statSync(target)
    if (stat.isDirectory()) {
      files.push(...findFiles(target))
    } else {
      files.push(target)
    }
  }

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

    if (SHOULD_FIX && issues.some(i => i.fixable)) {
      const fixed = applyFixes(path, issues)
      if (fixed) {
        writeFileSync(path, fixed, 'utf-8')
        console.log(`     ✅ 已自动修复并写回文件`)
      }
    }
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
