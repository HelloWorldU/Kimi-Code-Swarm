#!/usr/bin/env tsx
/**
 * AST 分析器主入口
 * 用法: npx tsx ast/analyzer.ts <file|dir> [--fix]
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
import { parse as parseVue } from '@vue/compiler-sfc'

// TODO: 导入规则模块
// import { checkVueStructure } from './rules/vue-structure'
// import { checkImports } from './rules/import-restrictions'

export interface AstIssue {
  file: string
  rule: string
  message: string
  line?: number
  fixable: boolean
}

function findFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory() && entry !== 'node_modules') {
      results.push(...findFiles(full))
    } else if (stat.isFile() && ['.vue', '.ts'].includes(extname(entry))) {
      results.push(full)
    }
  }
  return results
}

function analyzeFile(filePath: string, content: string): AstIssue[] {
  const issues: AstIssue[] = []
  const ext = extname(filePath)

  if (ext === '.vue') {
    const { descriptor, errors } = parseVue(content)
    if (errors.length) {
      issues.push({ file: filePath, rule: 'vue/parse-error', message: String(errors[0]), fixable: false })
      return issues
    }

    // TODO: 接入规则检查
    // issues.push(...checkVueStructure(descriptor))
    // issues.push(...checkImports(content, filePath))

    // 临时占位检查
    if (!descriptor.scriptSetup) {
      issues.push({ file: filePath, rule: 'vue/no-script-setup', message: '必须使用 <script setup lang="ts">', line: 1, fixable: true })
    }
    if (descriptor.styles.some(s => s.scoped)) {
      issues.push({ file: filePath, rule: 'vue/no-scoped-style', message: '禁止 <style scoped>，用 Tailwind', fixable: true })
    }
  }

  return issues
}

function main() {
  const target = process.argv.find((_, i, arr) => i > 1 && !arr[i].startsWith('--'))
  if (!target) {
    console.error('用法: npx tsx ast/analyzer.ts <file|dir> [--fix]')
    process.exit(1)
  }

  const files = statSync(target).isDirectory() ? findFiles(target) : [target]
  let total = 0

  for (const file of files) {
    const issues = analyzeFile(file, readFileSync(file, 'utf-8'))
    if (issues.length) {
      console.log(`\n📄 ${file}`)
      issues.forEach(i => console.log(`  ${i.fixable ? '🔧' : '❌'} [${i.rule}] ${i.message}`))
      total += issues.length
    }
  }

  console.log(`\n📊 总计: ${total} 个问题`)
  process.exit(total > 0 ? 1 : 0)
}

main()
