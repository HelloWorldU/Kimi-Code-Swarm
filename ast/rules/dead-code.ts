#!/usr/bin/env tsx
/**
 * Dead Code 检测规则（跨模块）
 *
 * 检测范围：
 * 1. 孤立文件 — 未被任何本地模块引用的 .ts/.vue 文件（排除入口/声明白名单）
 * 2. 未使用导出 — 被 export 但未被 import，且在本模块内也未被引用的符号
 *
 * 策略：
 * - 先扫全仓库 import/export，建立引用图谱
 * - 文件级孤立检测（零外部引用 → 整文件可删）
 * - 符号级未使用导出（非孤立文件中的 dead export，且内部也未使用）
 */

import { existsSync } from 'fs'
import { dirname, extname, join, relative } from 'path'
import type { AstIssue } from '../analyzer'

// 白名单：即使未被引用也不报孤立的文件
const ORPHAN_IGNORE_PATTERNS = [
  /[/\\]main\.ts$/,
  /[/\\]vite-env\.d\.ts$/,
  /[/\\]index\.html$/,
  /(^|[/\\])tests($|[/\\])/,
]

// ── 工具函数 ──

/** 把 import source 解析为绝对文件路径（仅处理相对路径） */
function resolveImportSource(importerPath: string, source: string): string | null {
  if (!source.startsWith('.') && !source.startsWith('/')) {
    return null // node_modules 或路径别名，暂不分析
  }

  const dir = dirname(importerPath)
  let resolved = join(dir, source)

  if (extname(resolved)) {
    return existsSync(resolved) ? resolved : null
  }

  for (const ext of ['.ts', '.vue', '.js']) {
    if (existsSync(resolved + ext)) return resolved + ext
  }

  const indexTs = join(resolved, 'index.ts')
  if (existsSync(indexTs)) return indexTs

  return null
}

/** 提取文件内容中所有 import 声明（过滤单行注释，支持多行 import） */
function parseImports(
  content: string,
): Array<{ source: string; names: string[]; line: number }> {
  const imports: Array<{ source: string; names: string[]; line: number }> = []

  // 先把单行注释替换为空行，保留行号对齐；避免 // import ... 被误解析
  const cleaned = content.replace(/^\s*\/\/.*$/gm, '')

  let match: RegExpExecArray | null

  // 多行命名导入: import { a, b } from './x'  或  import type { a } from './x'
  const namedRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s+['"]([^'"]+)['"]/g
  while ((match = namedRe.exec(cleaned)) !== null) {
    const names = match[1]
      .split(',')
      .map((s) => s.trim().replace(/^type\s+/, ''))
      .filter(Boolean)
    const lineIndex = cleaned.slice(0, match.index).split('\n').length
    imports.push({ source: match[2], names, line: lineIndex })
  }

  // 默认导入: import X from './x'
  const defaultRe = /import\s+([A-Za-z0-9_]+)\s+from\s+['"]([^'"]+)['"]/g
  while ((match = defaultRe.exec(cleaned)) !== null) {
    const lineIndex = cleaned.slice(0, match.index).split('\n').length
    imports.push({ source: match[2], names: ['default'], line: lineIndex })
  }

  // namespace 导入: import * as X from './x'
  const nsRe = /import\s+\*\s+as\s+[A-Za-z0-9_]+\s+from\s+['"]([^'"]+)['"]/g
  while ((match = nsRe.exec(cleaned)) !== null) {
    const lineIndex = cleaned.slice(0, match.index).split('\n').length
    imports.push({ source: match[1], names: ['*'], line: lineIndex })
  }

  // 动态导入: import('./x') — 视为引用该模块所有导出（保守策略）
  const dynamicRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = dynamicRe.exec(cleaned)) !== null) {
    const lineIndex = cleaned.slice(0, match.index).split('\n').length
    imports.push({ source: match[1], names: ['*'], line: lineIndex })
  }

  return imports
}

/** 解析显式 export 声明（命名导出 + 默认导出） */
function parseExplicitExports(
  content: string,
): Array<{ name: string; type: 'named' | 'default'; line: number }> {
  const exports: Array<{ name: string; type: 'named' | 'default'; line: number }> = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // export function/class/interface/type/const/let/var name
    // export async function name
    const declMatch = line.match(
      /^\s*export\s+(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z0-9_]+)/,
    )
    if (declMatch) {
      exports.push({ name: declMatch[1], type: 'named', line: lineNum })
      continue
    }

    // export { name1, name2, name as alias }
    const namedMatch = line.match(/^\s*export\s*\{([^}]+)\}/)
    if (namedMatch) {
      const items = namedMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      for (const item of items) {
        const name = item.split(/\s+as\s+/i)[0].trim()
        if (name) exports.push({ name, type: 'named', line: lineNum })
      }
      continue
    }

    // export default ...
    if (/^\s*export\s+default\b/.test(line)) {
      exports.push({ name: 'default', type: 'default', line: lineNum })
    }
  }

  return exports
}

/** 获取文件的所有导出（Vue SFC 隐式包含 default） */
function getFileExports(
  filePath: string,
  content: string,
): Array<{ name: string; type: 'named' | 'default'; line: number }> {
  const isVue = extname(filePath) === '.vue'
  const explicit = parseExplicitExports(content)

  if (isVue && !explicit.some((e) => e.name === 'default')) {
    // Vue <script setup> 隐式导出组件对象
    explicit.push({ name: 'default', type: 'default', line: 1 })
  }

  return explicit
}

/** 检查符号在文件内部是否被引用（排除声明行与注释行） */
function isUsedInternally(content: string, symbol: string, exportLine: number): boolean {
  const lines = content.split('\n')
  const regex = new RegExp(`\\b${symbol}\\b`)

  for (let i = 0; i < lines.length; i++) {
    if (i + 1 === exportLine) continue
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    if (regex.test(lines[i])) return true
  }
  return false
}

// ── 主检测逻辑 ──

export function checkDeadCode(
  allFiles: Array<{ path: string; content: string }>,
  projectRoot: string,
): AstIssue[] {
  const issues: AstIssue[] = []
  const localSet = new Set(allFiles.map((f) => f.path))

  // 1️⃣ 解析每个文件的导入 & 导出
  const fileImports = new Map<string, ReturnType<typeof parseImports>>()
  const fileExports = new Map<string, ReturnType<typeof getFileExports>>()

  for (const f of allFiles) {
    fileImports.set(f.path, parseImports(f.content))
    fileExports.set(f.path, getFileExports(f.path, f.content))
  }

  // 2️⃣ 统计引用次数（用于孤立文件检测）
  const refCount = new Map<string, number>()
  for (const f of allFiles) refCount.set(f.path, 0)

  for (const f of allFiles) {
    for (const imp of fileImports.get(f.path)!) {
      const resolved = resolveImportSource(f.path, imp.source)
      if (resolved && localSet.has(resolved)) {
        refCount.set(resolved, (refCount.get(resolved) || 0) + 1)
      }
    }
  }

  // 3️⃣ 孤立文件检测
  const orphanFiles = new Set<string>()
  for (const [path, count] of refCount) {
    if (count > 0) continue
    if (ORPHAN_IGNORE_PATTERNS.some((p) => p.test(path))) continue

    const rel = relative(projectRoot, path).replace(/\\/g, '/')
    orphanFiles.add(path)
    issues.push({
      file: path,
      rule: 'dead-code/orphan-file',
      message: `孤立文件: "${rel}" 未被任何本地模块引用`,
      line: 1,
      fixable: true,
      fix: `确认无用后删除文件: ${rel}`,
    })
  }

  // 4️⃣ 构建「每个文件被 import 了哪些符号」的映射
  const importedNames = new Map<string, Set<string>>()
  for (const f of allFiles) importedNames.set(f.path, new Set())

  for (const f of allFiles) {
    for (const imp of fileImports.get(f.path)!) {
      const resolved = resolveImportSource(f.path, imp.source)
      if (!resolved || !localSet.has(resolved)) continue
      for (const name of imp.names) {
        importedNames.get(resolved)!.add(name)
      }
    }
  }

  // 5️⃣ 未使用命名导出检测（孤立文件已整删，不再重复报符号）
  for (const f of allFiles) {
    const ext = extname(f.path)
    if (ext !== '.ts' && ext !== '.vue') continue
    if (orphanFiles.has(f.path)) continue
    if (ORPHAN_IGNORE_PATTERNS.some((p) => p.test(f.path))) continue

    const exports = fileExports.get(f.path)!
    const refs = importedNames.get(f.path)!

    for (const exp of exports) {
      const isReferenced =
        exp.type === 'default'
          ? refs.has('default') || refs.has('*')
          : refs.has(exp.name) || refs.has('*')

      if (isReferenced) continue

      // 模块内部也未被引用 → 真正的 dead code
      if (!isUsedInternally(f.content, exp.name, exp.line)) {
        issues.push({
          file: f.path,
          rule: 'dead-code/unused-export',
          message: `未使用导出: "${exp.name}" 未被任何模块引用，且在本模块内也未使用`,
          line: exp.line,
          fixable: true,
          fix: `删除未使用的导出: ${exp.name}`,
        })
      }
    }
  }

  return issues
}
