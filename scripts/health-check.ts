#!/usr/bin/env tsx
/**
 * 仓库一致性检查器（定期运行，信息供给型）
 *
 * 设计原则：
 * - 不追求 100% 精确匹配，提供高层次概览供 Agent 判断
 * - 消耗 token 换取简单性和扩展性
 * - 不阻断任何流程，只输出报告
 *
 * 检查项：
 * 1. doc-map.json 规则有效性（引用的文档是否存在）
 * 2. 文档引用完整性（docs/ 中的链接是否失效）
 * 3. 覆盖概览（仓库关键目录 vs doc-map.json 规则，高层次对比）
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, dirname } from 'path'

const ROOT = resolve(__dirname, '..')

interface HealthIssue {
  check: string
  file?: string
  message: string
}

// --- 检查 1: doc-map.json 规则有效性 ---

function checkDocMapValidity(): HealthIssue[] {
  const issues: HealthIssue[] = []
  const docMapPath = resolve(ROOT, 'docs', 'doc-map.json')
  const docMap = JSON.parse(readFileSync(docMapPath, 'utf-8'))

  for (const mapping of docMap.mappings) {
    for (const doc of mapping.docs) {
      if (!existsSync(resolve(ROOT, doc))) {
        issues.push({
          check: 'doc-map-invalid-ref',
          file: 'docs/doc-map.json',
          message: `规则 [${mapping.id}] 引用的文档不存在: ${doc}`,
        })
      }
    }
  }

  return issues
}

// --- 检查 2: 文档引用完整性 ---

function checkDocReferences(): HealthIssue[] {
  const issues: HealthIssue[] = []

  function scanDir(dir: string, base: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = resolve(dir, entry)
      const relPath = base ? `${base}/${entry}` : entry
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === '.git') continue
        scanDir(fullPath, relPath)
      } else if (entry.endsWith('.md')) {
        const content = readFileSync(fullPath, 'utf-8')
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
        let match: RegExpExecArray | null

        while ((match = linkRegex.exec(content)) !== null) {
          const linkPath = match[2]
          if (linkPath.startsWith('http') || linkPath.startsWith('#') || linkPath.startsWith('mailto:')) continue

          const docDir = dirname(fullPath)
          const resolvedPath = resolve(docDir, linkPath)
          if (!existsSync(resolvedPath)) {
            issues.push({
              check: 'doc-broken-link',
              file: `docs/${relPath}`,
              message: `链接失效: ${linkPath}`,
            })
          }
        }
      }
    }
  }

  scanDir(resolve(ROOT, 'docs'), '')
  return issues
}

// --- 检查 3: 覆盖概览（高层次对比）---

function checkCoverageOverview(): HealthIssue[] {
  const issues: HealthIssue[] = []
  const docMapPath = resolve(ROOT, 'docs', 'doc-map.json')
  const docMap = JSON.parse(readFileSync(docMapPath, 'utf-8'))

  // 收集 doc-map 中提到的所有目录前缀（高层次）
  const coveredPrefixes = new Set<string>()
  for (const mapping of docMap.mappings) {
    for (const pattern of mapping.paths) {
      const prefix = pattern.split('/')[0]
      coveredPrefixes.add(prefix)
    }
  }

  // 扫描仓库根级目录和关键文件
  const entries = readdirSync(ROOT)
  const keyItems: string[] = []
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue
    const fullPath = resolve(ROOT, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      keyItems.push(`${entry}/`)
    } else {
      keyItems.push(entry)
    }
  }

  // 找出仓库中存在但 doc-map 未提及的目录/文件
  const uncovered = keyItems.filter(item => {
    const dirName = item.replace(/\/$/, '')
    return !coveredPrefixes.has(dirName)
  })

  if (uncovered.length > 0) {
    issues.push({
      check: 'coverage-overview',
      message: `仓库根级未在 doc-map.json 中体现的项目: ${uncovered.join(', ')}`,
    })
  }

  return issues
}

// --- 主入口 ---

function main() {
  console.log('🏥 仓库一致性检查（定期运行 / 信息供给型）\n')

  const allIssues: HealthIssue[] = [
    ...checkDocMapValidity(),
    ...checkDocReferences(),
    ...checkCoverageOverview(),
  ]

  if (allIssues.length === 0) {
    console.log('✅ 未发现明显问题')
    console.log('\n💡 建议：Agent 结合本次会话上下文，判断是否有遗漏的文档同步需求')
    process.exit(0)
  }

  for (const issue of allIssues) {
    console.log(`[${issue.check}] ${issue.file || ''}`)
    console.log(`  ${issue.message}\n`)
  }

  console.log(`💡 总计 ${allIssues.length} 项提醒。`)
  console.log('   本工具为信息供给型，不阻断任何流程。')
  console.log('   Agent 请结合上下文判断是否需要补充 doc-map.json 规则或同步文档。')
  process.exit(0)
}

main()
