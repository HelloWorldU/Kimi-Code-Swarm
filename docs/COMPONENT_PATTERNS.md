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
- `CreateTaskModal.vue` — 表单弹窗组件：收集 name / repoUrl / tokenBudget 创建 Agent，Vue `<Transition>` 原生过渡动画
- `SwarmConfirmModal.vue` — 确认弹窗组件：类型化图标 + 双按钮确认/取消，配合 useConfirm composable
- `SwarmToast.vue` — Toast 通知组件：类型化图标 + 进度条 + 自动消失，配合 useToast composable
- `AgentDetail.vue` — 聊天式多轮对话组件：Header + Info + PR 审阅 + 文件变更 + 聊天消息区（input/output/system/error 直接渲染；think/tool_call/mcp/tool_result 为可折叠气泡，默认收起，点击展开查看完整内容）+ `<textarea>` 输入框（Enter 发送 / Shift+Enter 换行，自动增高）。Info 区任务指令从 `logs` 倒序查找最近 `input` 类型条目渲染，不再依赖 `agent.instruction`。日期字段通过 new Date(string).toLocaleTimeString() 显示。滚动行为：通过 `scroll` 事件监听跟踪用户是否在底部 50px 范围内；当新消息到达或内容流式追加时，若用户之前处于底部则即时滚至底部，若用户已主动上滚则保持当前浏览位置。可折叠消息展开/收起后同样会跟进滚动。**输入框草稿缓存**：通过 `useSwarmStore` 的 `draftInputs` 在组件挂载时恢复、卸载时保存、切换 Agent 时自动迁移草稿内容，避免切视图丢失未发送的输入。所有消息气泡均带 `animate-message-enter` 进入动画（fade-in + slide-up）。PR 审阅区「打回」按钮带 tooltip 说明语义——清空审阅状态、切回就绪态等待用户发新指令，**不会自动让 Agent 修改**（避免历史文案「Agent 继续修改」的误导）。Reviewer 行额外支持 `failed` 状态：自动审阅多次失败（kimi 启动失败 / 卡死等）后用 amber AlertCircle 图标 + 「失败 (×N)」标签 + 截断展示 failureReason，鼠标悬停看完整原因；语义跟「已拒绝」不同——审阅没跑通而非内容被拒，需要人工处置
- `TaskCard.vue` — 卡片组件：Agent 状态 + Token 进度 + 审阅徽章；状态枚举含 `orphan`（已失效，表示本地缓存中存在但引擎 restore 列表中无对应 ID 的 agent）；启动/停止/重启/删除按钮均按 `engineReady` prop 禁用，引擎 restore 完成前置灰；删除操作通过 `useConfirm()` 调用自定义确认弹窗
- `AnalyticsPanel.vue` — 数据展示型组件：状态分布、Token 排行、任务列表；列表项通过 `getLastInput(task.logs)` 展示最后一条 input 指令摘要，与 `AgentDetail.vue` 的 Info 区指令展示逻辑一致
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
- **引擎窗口期门控**：所有「向 Node.js Agent 引擎发命令」的按钮（创建/启动/停止/重启/删除/发送指令）须以 `store.engineReady.value` 作禁用条件，配 `title="引擎启动中…"` tooltip。组件通过 `engineReady` prop 接收（带默认 `true` 兼容非 Tauri/Storybook），由 `App.vue` 透传 store 值

## E2E 测试标识

Playwright 通过 `data-testid` 定位元素。交互组件的核心元素须加测试标识：
- 表单输入框：`data-testid="xxx-input"`
- 提交按钮：`data-testid="xxx-submit"`
- 触发按钮：`data-testid="xxx-button"`
- 禁止用 class 名或文本内容定位（易因重构失效）
