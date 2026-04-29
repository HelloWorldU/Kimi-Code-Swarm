# Fixers（自动修复器）

> 报错只是第一步，告诉 Agent 怎么改才是 Harness。

每个标记为 `fixable: true` 的规则必须有对应的修复器。

## 修复器清单

| 规则 | 修复方式 | 状态 |
|------|---------|------|
| `vue/no-script-setup` | 替换 `<script>` 为 `<script setup>` | ⏳ 待实现 |
| `vue/no-scoped-style` | 删除 `<style scoped>` 块 | ⏳ 待实现 |
| `import/wrong-icon-lib` | 替换为 `lucide-vue-next` | ⏳ 待实现 |

## 实现方式

Fixer 接收原始代码 + Issue，输出修复后的代码：

```ts
interface Fixer {
  (source: string, issue: AstIssue): string | null
}
```
