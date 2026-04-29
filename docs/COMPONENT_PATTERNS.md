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
| 组件 | PascalCase.vue | `InstanceCard.vue` |
| Composable | camelCase.ts | `useSwarmStore.ts` |
| 事件 | kebab-case | `@send-command` |
