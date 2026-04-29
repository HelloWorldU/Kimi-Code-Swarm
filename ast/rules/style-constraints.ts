/**
 * 样式约束规则
 * TODO: 实现 <style> 节点和内联 style 属性的检查
 */

import type { SFCDescriptor } from '@vue/compiler-sfc'

export interface StyleIssue {
  rule: string
  message: string
  line?: number
  fixable: boolean
}

export function checkStyle(descriptor: SFCDescriptor): StyleIssue[] {
  const issues: StyleIssue[] = []
  // TODO: 检查 <style> 中的原始 CSS，模板中的内联 style 属性
  return issues
}
