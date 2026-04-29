import type { AstIssue } from '../analyzer'

export function checkVueStructure(content: string, filePath: string): AstIssue[] {
  const issues: AstIssue[] = []
  const lines = content.split('\n')

  // 1. 必须包含 <script setup lang="ts">
  const hasScriptSetup = /<script\s+setup\s+lang\s*=\s*["']ts["']/.test(content)
  const hasPlainScript = /<script\s*(?!setup)[^>]*lang\s*=\s*["']ts["']/.test(content)

  if (!hasScriptSetup) {
    const line = hasPlainScript
      ? lines.findIndex(l => /<script(?!\s+setup)/.test(l)) + 1
      : lines.findIndex(l => /<script/.test(l)) + 1
    issues.push({
      file: filePath,
      rule: 'vue/no-script-setup',
      message: '必须使用 <script setup lang="ts">',
      line: line || 1,
      fixable: true,
      fix: '将 <script> 改为 <script setup lang="ts">',
    })
  }

  // 2. 禁止 <style scoped>
  const scopedMatch = content.match(/<style\s+scoped/)
  if (scopedMatch) {
    const line = lines.findIndex(l => /<style\s+scoped/.test(l)) + 1
    issues.push({
      file: filePath,
      rule: 'vue/no-scoped-style',
      message: '禁止 <style scoped>，统一使用 Tailwind 原子类',
      line: line || 1,
      fixable: true,
      fix: '删除 <style scoped> 块',
    })
  }

  // 3. 禁止 Options API 关键字在 <script setup> 中
  const setupStart = lines.findIndex(l => /<script\s+setup/.test(l))
  const setupEnd = lines.findIndex((l, i) => i > setupStart && /<\/script>/.test(l))

  if (setupStart >= 0 && setupEnd > setupStart) {
    const setupContent = lines.slice(setupStart + 1, setupEnd).join('\n')
    const forbiddenPatterns = [
      { pattern: /\bdata\s*\(\s*\)/, name: 'data()' },
      { pattern: /\bcomputed\s*:\s*\{/, name: 'computed: {...}' },
      { pattern: /\bmethods\s*:\s*\{/, name: 'methods: {...}' },
      { pattern: /\bwatch\s*:\s*\{/, name: 'watch: {...}' },
      { pattern: /\bcreated\s*\(\s*\)/, name: 'created()' },
      { pattern: /\bmounted\s*\(\s*\)/, name: 'mounted()' },
    ]

    for (const { pattern, name } of forbiddenPatterns) {
      if (pattern.test(setupContent)) {
        const matchLine = setupStart + 1 + lines.slice(setupStart + 1, setupEnd).findIndex(l => pattern.test(l))
        issues.push({
          file: filePath,
          rule: 'vue/no-options-api',
          message: `检测到 Options API 用法: "${name}"，<script setup> 中禁止使用`,
          line: matchLine + 1,
          fixable: false,
          fix: `改用 Composition API 等价写法替换 "${name}"`,
        })
      }
    }
  }

  // 4. 检查模板根节点（Vue 3 支持 Fragment，此规则仅作为警告，不强制）
  // Vue 3 允许多根节点，所以此规则不报错，仅记录
  // 如果需要强制单根，取消下面的注释
  // const templateMatch = content.match(/<template>([\s\S]*?)<\/template>/)
  // if (templateMatch) { ... }

  return issues
}
