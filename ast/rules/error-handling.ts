#!/usr/bin/env tsx
/**
 * 错误处理规则
 *
 * 把 harness/bug-fix.yaml 的 instrument 步骤硬化为 AST 约束：
 * - catch 块为空 → error（错误被静默吞没）
 * - catch 块未使用 Logger → warning（建议留痕）
 *
 * 与 ESLint no-console 分工：
 * - ESLint 禁止直接 console.xxx
 * - AST 规则强制错误处理使用 Logger（或至少不空处理）
 */

import type { AstIssue } from '../analyzer'

interface CatchBlock {
  startLine: number
  endLine: number
  content: string
}

/** 从文件内容中提取所有 catch 块 */
function findCatchBlocks(content: string): CatchBlock[] {
  const blocks: CatchBlock[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 匹配 catch (...) {   （支持多行 catch 定义，但要求 { 在同一行）
    const catchMatch = line.match(/catch\s*\([^)]*\)\s*\{/)
    if (!catchMatch) continue

    // 找到这一行中 { 的位置
    let braceIndex = line.indexOf('{', catchMatch.index!)
    if (braceIndex === -1) continue

    let braceCount = 0
    let foundOpen = false
    let endLine = i

    for (let j = i; j < lines.length; j++) {
      const scanLine = lines[j]
      let startIdx = j === i ? braceIndex : 0
      for (let k = startIdx; k < scanLine.length; k++) {
        if (scanLine[k] === '{') {
          braceCount++
          foundOpen = true
        } else if (scanLine[k] === '}') {
          braceCount--
        }
      }
      if (foundOpen && braceCount === 0) {
        endLine = j
        break
      }
    }

    const blockContent = lines.slice(i, endLine + 1).join('\n')
    blocks.push({
      startLine: i + 1, // 1-based
      endLine: endLine + 1,
      content: blockContent,
    })
  }

  return blocks
}

/** 判断 catch 块是否为空（只有注释、空白、throw） */
function isEmptyCatch(content: string): boolean {
  let cleaned = content
    .replace(/catch\s*\([^)]*\)\s*\{/g, '')
    .replace(/\}\s*$/g, '')

  // 移除注释
  cleaned = cleaned
    .replace(/\/\/.*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  // 移除 throw 语句
  cleaned = cleaned.replace(/throw\s+\w+/g, '')

  return cleaned.trim().length === 0
}

/** 检查是否使用了 Logger */
function hasLogger(content: string): boolean {
  return /\blog(?:ger)?\.(?:error|warn|debug|info)\b/.test(content)
}

/** 检查是否直接使用了 console（ESLint 已禁止，作为兜底） */
function hasConsole(content: string): boolean {
  return /\bconsole\.(?:error|warn|log|debug)\b/.test(content)
}

export function checkErrorHandling(content: string, filePath: string): AstIssue[] {
  const issues: AstIssue[] = []
  const blocks = findCatchBlocks(content)

  for (const block of blocks) {
    if (isEmptyCatch(block.content)) {
      issues.push({
        file: filePath,
        rule: 'error-handling/empty-catch',
        message: 'catch 块为空，错误被静默吞没。至少应记录日志：log.error(\'...\', e)',
        line: block.startLine,
        fixable: true,
        fix: '在 catch 块中添加 log.error(\'描述\', e)',
      })
      continue
    }

    if (!hasLogger(block.content) && !hasConsole(block.content)) {
      issues.push({
        file: filePath,
        rule: 'error-handling/missing-logger',
        message: 'catch 块未使用 Logger 记录错误。建议添加 log.error(\'...\', e) 以便后续排查',
        line: block.startLine,
        fixable: true,
        fix: '在 catch 块中添加 log.error(\'描述\', e)',
      })
    }
  }

  return issues
}
