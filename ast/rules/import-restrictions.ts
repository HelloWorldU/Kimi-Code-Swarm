import type { AstIssue } from '../analyzer'

const FORBIDDEN_IMPORTS = [
  'lucide-react',
  'element-plus',
  'vuetify',
  '@element-plus',
]

export function checkImports(content: string, filePath: string): AstIssue[] {
  const issues: AstIssue[] = []
  const lines = content.split('\n')

  // 匹配 import 语句
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"];?/g

  let match: RegExpExecArray | null
  while ((match = importRegex.exec(content)) !== null) {
    const moduleName = match[1]
    const lineIndex = content.slice(0, match.index).split('\n').length

    // 检查黑名单
    for (const forbidden of FORBIDDEN_IMPORTS) {
      if (moduleName === forbidden || moduleName.startsWith(forbidden + '/')) {
        issues.push({
          file: filePath,
          rule: 'import/forbidden',
          message: `禁止导入 "${moduleName}"，此库不在项目白名单中`,
          line: lineIndex,
          fixable: true,
          fix: `移除 import，改用允许的方案替代`,
        })
      }
    }

    // 检查图标库来源
    if (moduleName.includes('lucide') && moduleName !== 'lucide-vue-next') {
      issues.push({
        file: filePath,
        rule: 'import/wrong-icon-lib',
        message: `图标库必须使用 "lucide-vue-next"，当前导入 "${moduleName}"`,
        line: lineIndex,
        fixable: true,
        fix: `改为: import { Icon } from 'lucide-vue-next'`,
      })
    }

    // 检查深层相对路径
    if (moduleName.startsWith('..')) {
      const depth = (moduleName.match(/\.\.\//g) || []).length
      if (depth > 2) {
        issues.push({
          file: filePath,
          rule: 'import/deep-relative',
          message: `相对路径导入层级过深 (${depth} 层): "${moduleName}"，建议使用路径别名`,
          line: lineIndex,
          fixable: true,
          fix: '在 vite.config.ts 中配置路径别名，如 @/components/xxx',
        })
      }
    }
  }

  return issues
}
