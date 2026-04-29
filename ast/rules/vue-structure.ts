/**
 * Vue SFC 结构规则
 * TODO: 实现 AST 级别的 Vue 文件结构检查
 */

import type { SFCDescriptor } from '@vue/compiler-sfc'

export interface VueIssue {
  rule: string
  message: string
  line?: number
  fixable: boolean
}

export function checkVueStructure(descriptor: SFCDescriptor): VueIssue[] {
  const issues: VueIssue[] = []
  // TODO: 检查 scriptSetup, 禁止 scoped style, 检查 Options API 关键字等
  return issues
}
