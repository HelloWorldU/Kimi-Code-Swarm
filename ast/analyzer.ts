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

function main() {
  const target = process.argv.find((_, i, arr) => i > 1 && !arr[i].startsWith('--'))
  if (!target) {
    console.error('用法: npx tsx ast/analyzer.ts <file|dir> [--fix]')
    process.exit(1)
  }

  const stat = statSync(target)
  const files: string[] = stat.isDirectory() ? findFiles(target) : [target]

  let total = 0
  let fixable = 0

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const ext = extname(file)

    const issues = ext === '.vue'
      ? analyzeVueFile(file, content)
      : analyzeTsFile(file, content)

    if (issues.length > 0) {
      const relPath = relative(process.cwd(), file)
      console.log(`\n📄 ${relPath}`)
      for (const issue of issues) {
        const icon = issue.fixable ? '🔧' : '❌'
        const loc = issue.line ? `:${issue.line}` : ''
        console.log(`  ${icon} [${issue.rule}]${loc} ${issue.message}`)
        if (issue.fix && SHOULD_FIX) {
          console.log(`     💡 ${issue.fix}`)
        }
        total++
        if (issue.fixable) fixable++
      }
    }
  }

  if (total === 0) {
    console.log('✅ 所有 AST 检查通过')
    process.exit(0)
  } else {
    console.log(`\n📊 总计: ${total} 个问题，${fixable} 个可修复`)
    process.exit(1)
  }
}

main()
