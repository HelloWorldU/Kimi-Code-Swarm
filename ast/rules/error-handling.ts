#!/usr/bin/env tsx
/**
 * 错误处理规则（ESTree AST 版）
 *
 * 约束分层设计：
 * - ERROR（红线）: catch 块为空 → 错误被静默吞没，绝对禁止
 * - WARN（建议）: catch 块未记录错误 → 鼓励留痕，但不强制具体工具或格式
 *
 * Agent 可自由选择日志方式：Logger、console（调试用，提交前清理）、注释说明均可。
 * 只要错误不被静默吞没，即满足 harness/bug-fix.yaml 的 must-not 红线。
 */

import { parse } from '@typescript-eslint/typescript-estree'
import type { AstIssue } from '../analyzer'

interface CatchBlock {
  startLine: number
  endLine: number
  content: string
  param?: string
}

// ── 内部 AST 工具 ──

/** 通用 AST 深度遍历 */
function traverseAst(node: any, callback: (node: any) => void) {
  if (!node || typeof node !== 'object') return
  callback(node)
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments')
      continue
    const child = node[key]
    if (Array.isArray(child)) {
      child.forEach((c) => traverseAst(c, callback))
    } else if (child && typeof child === 'object' && child.type) {
      traverseAst(child, callback)
    }
  }
}

/** 从 Vue SFC 中提取所有 <script> 块及其字符/行偏移 */
function extractScriptsFromVue(
  content: string,
): Array<{ code: string; charOffset: number; lineOffset: number }> {
  const scripts: Array<{ code: string; charOffset: number; lineOffset: number }> = []
  const regex = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const tagEndIndex = match.index + match[0].indexOf('>') + 1
    const charOffset = tagEndIndex
    const beforeScript = content.slice(0, charOffset)
    const lineOffset = (beforeScript.match(/\n/g) || []).length
    scripts.push({ code: match[1], charOffset, lineOffset })
  }
  return scripts
}

/** 在一段纯 TS/JS 代码中查找 CatchClause */
function findCatchBlocksInCode(
  code: string,
  charOffset: number,
  lineOffset: number,
  originalContent: string,
): CatchBlock[] {
  try {
    const ast = parse(code, { loc: true, range: true })
    const blocks: CatchBlock[] = []

    traverseAst(ast, (node) => {
      if (node.type !== 'CatchClause') return
      const [start, end] = node.range as [number, number]
      const blockContent = originalContent.slice(charOffset + start, charOffset + end)
      const startLine = node.loc.start.line + lineOffset
      const endLine = node.loc.end.line + lineOffset
      const param: string | undefined = node.param?.name
      blocks.push({ startLine, endLine, content: blockContent, param })
    })

    return blocks
  } catch {
    // 语法错误或空内容：安全降级，返回空列表
    return []
  }
}

// ── 对外接口（保持兼容） ──

/** 从文件内容中提取所有 catch 块 */
export function findCatchBlocks(content: string): CatchBlock[] {
  // 检测 Vue SFC：包含 <template> 或 <script 标签
  const isVue = content.includes('<template>') || content.includes('<script')
  if (isVue) {
    const scripts = extractScriptsFromVue(content)
    const allBlocks: CatchBlock[] = []
    for (const { code, charOffset, lineOffset } of scripts) {
      allBlocks.push(...findCatchBlocksInCode(code, charOffset, lineOffset, content))
    }
    return allBlocks
  }

  // 纯 TS/JS 文件
  return findCatchBlocksInCode(content, 0, 0, content)
}

/** 判断 catch 块是否有明确的"意图注释"（说明为什么不需要日志） */
function hasIntentionalComment(content: string): boolean {
  // 提取所有行注释
  const comments = content.match(/\/\/.*/g) || []
  for (const comment of comments) {
    const text = comment.replace(/\/\//, '').trim().toLowerCase()
    // 长度太短的注释不算（如 "// ok"、"// done"）
    if (text.length < 8) continue
    // 敷衍注释不算
    if (/^(ignore|todo|fixme|hack|temp|tmp)/.test(text)) continue
    // 意图关键字：说明为什么不需要日志
    if (/(expected|intentional|normal|预期|正常|说明|reason|非关键|噪音|noise|try next|polling|重试)/i.test(text)) {
      return true
    }
  }
  return false
}

/** 判断 catch 块是否为空（只有注释、空白、throw）
 *  有明确意图注释的不算空 —— 注释即留痕
 */
export function isEmptyCatch(content: string): boolean {
  // 有明确意图注释 → 不算空 catch
  if (hasIntentionalComment(content)) return false

  let cleaned = content
    .replace(/catch(?:\s*\([^)]*\))?\s*\{/g, '')
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
  return /(?:\b|\.)((?:log|logger)\.(?:error|warn|debug|info)\b|\.log\(['"`][^'"`]*error)/.test(content)
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
        message: "catch 块为空，错误被静默吞没。至少应记录日志：log.error('...', e)",
        line: block.startLine,
        fixable: true,
        fix: "在 catch 块中添加 log.error('描述', e)",
      })
      continue
    }

    // 有明确意图注释 → 注释即留痕，不报 missing-logger
    if (!hasLogger(block.content) && !hasConsole(block.content) && !hasIntentionalComment(block.content)) {
      issues.push({
        file: filePath,
        rule: 'error-handling/missing-logger',
        message: 'catch 块未记录错误且无说明注释。关键路径请加 log.error，非关键路径请加注释说明原因',
        line: block.startLine,
        fixable: true,
        fix: "关键路径：添加 log.error / console.error；非关键路径：添加 // expected: ... 说明为什么忽略",
        severity: 'warn',
      })
    }
  }

  return issues
}
