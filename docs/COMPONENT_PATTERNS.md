# COMPONENT_PATTERNS

## 组件模板

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { SomeIcon } from 'lucide-vue-next'

const props = defineProps<{...}>()
const emit = defineEmits<{...}>()
</script>

<template>
  <div class="...">
    <!-- -->
  </div>
</template>
```

**禁止**：Options API、scoped style、非 lucide 图标。

## 命名

| 类型 | 规则 | 示例 |
|------|------|------|
| 组件 | PascalCase.vue | `TaskCard.vue`, `TaskDetail.vue`, `SettingsPanel.vue` |
| Composable | camelCase.ts | `useSwarmStore.ts` |
| 事件 | kebab-case | `@send-command` |

## 组件类型示例

- `TaskDetail.vue` — 复合面板组件：Header + Info + PR 审阅 + 文件变更 + Action + Logs
- `AnalyticsPanel.vue` — 数据展示型组件：状态分布、Token 排行、任务列表
- `SettingsPanel.vue` — 纯信息展示型设置面板，使用 lucide 图标 + code 标签展示命令指引
