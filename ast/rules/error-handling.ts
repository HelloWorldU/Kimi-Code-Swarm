#!/usr/bin/env tsx
/**
 * 错误处理规则
 *
 * 约束分层设计：
 * - ERROR（红线）: catch 块为空 → 错误被静默吞没，绝对禁止
 * - WARN（建议）: catch 块未记录错误 → 鼓励留痕，但不强制具体工具或格式
 *
 * Agent 可自由选择日志方式：Logger、console（调试用，提交前清理）、注释说明均可。
 * 只要错误不被静默吞没，即满足 harness/bug-fix.yaml 的 must-not 红线。
 */

import type { AstIssue } from '../analyzer'

interface CatchBlock {
  startLine: number
  endLine: number
  content: string
}

/** 从文件内容中提取所有 catch 块 */
export function findCatchBlocks(content: string): CatchBlock[] {
  const blocks: CatchBlock[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 先移除字符串/注释/正则字面量，避免误匹配其中的 catch 关键字
    // 顺序很重要：先字符串（避免误伤字符串中的 //），再注释，再正则
    const codeOnly = line
      .replace(/(['"`])[^'"`]*\1/g, (m) => ' '.repeat(m.length))
      .replace(/\/\/.*$/g, '')
      .replace(/\/[^/]+\//g, (m) => ' '.repeat(m.length))
    // 匹配 catch (...) { 或 catch { （支持可选 catch binding）
    const catchMatch = codeOnly.match(/catch(?:\s*\([^)]*\))?\s*\{/)
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
export function isEmptyCatch(content: string): boolean {
  let cleaned = content
    .replace(/catch\s*\([^)]*\)\s*\{/g, '')
    .replace(/^\s*\}\s*/g, '')
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
export function hasLogger(content: string): boolean {
  return /(?:\b|\.)(?:log|logger)\.(?:error|warn|debug|info)\b|\.log\(['"`][^'"`]*error/.test(content)
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
      // warning 级别：鼓励使用 Logger，但不强制具体工具或格式
      // Agent 可自由选择日志方式，只要错误不被静默吞没即可
      issues.push({
        file: filePath,
        rule: 'error-handling/missing-logger',
        message: 'catch 块未记录错误。建议增加日志以便后续排查（log.error / console.error / 注释说明均可）',
        line: block.startLine,
        fixable: true,
        fix: '在 catch 块中记录错误信息（Logger、console 或注释均可）',
      })
    }
  }

  return issues
}
