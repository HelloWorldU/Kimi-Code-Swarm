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

- `LoginView.vue` — 独立页面组件：登录表单 + API Key 验证 + Kimi Code 控制台外链
- `AgentDashboard.vue` — 列表容器组件：统计卡片 + Agent 网格 + 空状态
- `AgentDetail.vue` — 聊天式多轮对话组件：Header + Info + PR 审阅 + 文件变更 + 聊天消息区（input/output/system/error 气泡）+ 输入框。日期字段通过 new Date(string).toLocaleTimeString() 显示
- `AnalyticsPanel.vue` — 数据展示型组件：状态分布、Token 排行、任务列表
- `SettingsPanel.vue` — 纯信息展示型设置面板，使用 lucide 图标 + code 标签展示命令指引

## 视觉风格

- **白色简约主题**：全局白底（`bg-white` / `bg-gray-50`），深灰文字（`text-gray-900` / `text-gray-700`），浅灰边框（`border-gray-200`）
- **状态色**：深色饱和（`-600`）+ 浅色背景（`-50`），避免半透明 overlay
- **阴影**：仅在卡片/弹窗使用 `shadow-sm` 或 `shadow-md`，不用 heavy shadow

## E2E 测试标识

Playwright 通过 `data-testid` 定位元素。交互组件的核心元素须加测试标识：
- 表单输入框：`data-testid="xxx-input"`
- 提交按钮：`data-testid="xxx-submit"`
- 触发按钮：`data-testid="xxx-button"`
- 禁止用 class 名或文本内容定位（易因重构失效）
