import type { AstIssue } from '../analyzer'

export function checkStyle(content: string, filePath: string): AstIssue[] {
  const issues: AstIssue[] = []
  const lines = content.split('\n')

  // 1. 检查 <style> 块中的原始 CSS（非 @apply）
  const styleMatches = content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)
  for (const styleMatch of styleMatches) {
    const styleContent = styleMatch[1]
    const styleStartIdx = content.indexOf(styleMatch[0])
    const lineIndex = content.slice(0, styleStartIdx).split('\n').length

    // 检查是否有原始 CSS 属性（key: value; 格式，排除 @apply 和 CSS 变量）
    const rawCssMatches = styleContent.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)
    for (const cssMatch of rawCssMatches) {
      const prop = cssMatch[1].trim()
      const value = cssMatch[2].trim()
      // 排除 @apply 和 CSS 变量
      if (prop !== '@apply' && !prop.startsWith('--') && !value.startsWith('var(')) {
        issues.push({
          file: filePath,
          rule: 'style/raw-css-detected',
          message: `<style> 中包含原始 CSS: "${prop}: ${value}"，项目规范要求用 Tailwind`,
          line: lineIndex,
          fixable: true,
          fix: `将 "${prop}: ${value}" 替换为等效 Tailwind class`,
        })
        // 只报第一个，避免刷屏
        break
      }
    }
  }

  // 2. 检查模板中的内联 style 属性
  const templateMatch = content.match(/<template>([\s\S]*?)<\/template>/)
  if (templateMatch) {
    const templateContent = templateMatch[1]
    const styleAttrRegex = /\sstyle\s*=\s*["']([^"']*)["']/g
    let attrMatch: RegExpExecArray | null
    while ((attrMatch = styleAttrRegex.exec(templateContent)) !== null) {
      const templateStart = content.indexOf('<template>')
      const attrPos = templateStart + templateContent.indexOf(attrMatch[0])
      const lineIndex = content.slice(0, attrPos).split('\n').length
      issues.push({
        file: filePath,
        rule: 'style/inline-style-attr',
        message: '模板中使用了内联 style 属性，必须使用 Tailwind class',
        line: lineIndex,
        fixable: true,
        fix: '改为 Tailwind 原子类，如 class="bg-gray-800 text-white"',
      })
    }
  }

  return issues
}
