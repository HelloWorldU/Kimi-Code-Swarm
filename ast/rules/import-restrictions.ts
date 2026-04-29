/**
 * 导入限制规则
 * TODO: 实现 import 语句的 AST 检查
 */

export interface ImportIssue {
  rule: string
  message: string
  line?: number
  fixable: boolean
}

export function checkImports(content: string, filePath: string): ImportIssue[] {
  const issues: ImportIssue[] = []
  // TODO: 检查禁止导入的库，图标库来源，深层相对路径等
  return issues
}
