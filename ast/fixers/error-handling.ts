#!/usr/bin/env tsx
/**
 * 错误处理自动修复器
 * 将空的 catch 块自动填充为最小可用的日志记录
 */

import { findCatchBlocks, isEmptyCatch } from '../rules/error-handling'

/**
 * 修复文件内容中所有空的 catch 块
 * 策略：在 catch 参数后插入一行基础日志，保留原有缩进
 */
export function fixEmptyCatches(content: string): string {
  const blocks = findCatchBlocks(content)
  if (blocks.length === 0) return content

  const lines = content.split('\n')
  const fixes: { startLine: number; endLine: number; insertLine: number; indent: string; param: string }[] = []

  for (const block of blocks) {
    if (!isEmptyCatch(block.content)) continue

    // 提取 catch 参数名（AST 版已直接提供）
    const param = block.param ?? 'e'

    // 计算插入位置（catch 块 opening brace 的下一行）和缩进
    const openLine = lines[block.startLine - 1]
    const baseIndentMatch = openLine.match(/^(\s*)/)
    const baseIndent = baseIndentMatch?.[1] ?? ''
    const innerIndent = baseIndent + '  '

    fixes.push({
      startLine: block.startLine,
      endLine: block.endLine,
      insertLine: block.startLine, // 1-based: 在 catch 行之后插入
      indent: innerIndent,
      param,
    })
  }

  if (fixes.length === 0) return content

  // 从后往前修复，避免行号偏移
  const sorted = [...fixes].sort((a, b) => b.insertLine - a.insertLine)
  for (const fix of sorted) {
    const logLine = `${fix.indent}log.error('Error occurred', ${fix.param})`
    lines.splice(fix.insertLine, 0, logLine)
  }

  return lines.join('\n')
}
