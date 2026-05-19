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
- `AgentDashboard.vue` — 列表容器组件：渐变背景统计卡片（含底部进度条）+ Agent 网格 + 空状态
- `CreateTaskModal.vue` — 表单弹窗组件：新建 Agent 的信息收集与提交，Vue `<Transition>` 原生过渡动画
- `SwarmConfirmModal.vue` — 确认弹窗组件：类型化图标 + 双按钮确认/取消，配合 useConfirm composable
- `SwarmToast.vue` — Toast 通知组件：类型化图标 + 进度条 + 自动消失，配合 useToast composable
- `AgentDetail.vue` — 聊天式多轮对话组件：Header + Info + PR 审阅 + 文件变更 + 聊天消息区（input/output/system/error 直接渲染；think/tool_call/mcp/tool_result 为可折叠气泡，默认收起，点击展开查看完整内容）+ `<textarea>` 输入框（Enter 发送 / Shift+Enter 换行，自动增高）。日期字段通过 new Date(string).toLocaleTimeString() 显示
- `TaskCard.vue` — 卡片组件：Agent 状态 + Token 进度 + 审阅徽章；删除操作通过 `useConfirm()` 调用自定义确认弹窗
- `AnalyticsPanel.vue` — 数据展示型组件：状态分布、Token 排行、任务列表
- `SettingsPanel.vue` — 纯信息展示型设置面板，使用 lucide 图标 + code 标签展示命令指引

## Composables

- `useConfirm.ts` — 命令式确认弹窗：全局 reactive 状态，支持 Promise 化调用
- `useToast.ts` — 命令式 Toast 通知：全局 reactive 数组，支持自动定时移除

## 视觉风格

- **白色简约主题**：全局白底（`bg-white` / `bg-gray-50`），深灰文字（`text-gray-900` / `text-gray-700`），浅灰边框（`border-gray-200`）
- **状态色**：深色饱和（`-600`）+ 浅色背景（`-50`），避免半透明 overlay
- **阴影**：仅在卡片/弹窗使用 `shadow-sm` 或 `shadow-md`，不用 heavy shadow

## 交互规范

- **危险操作须确认**：删除 Agent 等不可逆操作须通过 `confirm()` 弹窗提示用户，明确告知影响范围（如工作目录将被一并删除）。即使 `workspace` 字段为空，也应根据命名规则（`E:/workspace/{agentId}`）推断并显示路径

## E2E 测试标识

Playwright 通过 `data-testid` 定位元素。交互组件的核心元素须加测试标识：
- 表单输入框：`data-testid="xxx-input"`
- 提交按钮：`data-testid="xxx-submit"`
- 触发按钮：`data-testid="xxx-button"`
- 禁止用 class 名或文本内容定位（易因重构失效）
