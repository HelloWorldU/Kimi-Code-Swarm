# FRONTEND

> 前端应用的 Agent 指南。

## 技术栈

Vue 3 + TypeScript + Vite + Tailwind CSS + lucide-vue-next + Tauri v2 + @tauri-apps/plugin-store

## 编码规范

1. `<script setup lang="ts">`，禁止 Options API
2. Tailwind 原子类，禁止 `<style scoped>`
3. 图标从 `lucide-vue-next` 导入
4. 状态色：running=emerald, idle=blue, error=red, queued=amber, stopped=gray
5. 新增组件必须在 App.vue 注册

## 关键文件

- `store/useSwarmStore.ts` — UI 状态管理；业务逻辑委托给 Node.js Agent 引擎
- `agent-engine/src/engine.ts` — Node.js Agent 编排引擎（生命周期 + Kimi CLI + Token 监控）
- `types/index.ts` — AgentTask / LogEntry / CommandCenterStats；修改前检查上下游依赖
- `api/github.ts` — GitHub API 封装（PR 创建/合并/查询）
- `api/ipc.ts` — Tauri IPC 适配层
- `components/LoginView.vue` — API Key 登录页（验证 + keyring 存储）
- `components/AgentDashboard.vue` — Agent 卡片网格（最多 5 个，点击进入详情）
- `components/AgentDetail.vue` — Agent 详情：指令输入 + 日志流 + PR 审阅 + 文件变更
- `components/SettingsPanel.vue` — 系统设置（GitHub Token + Kimi CLI 安装指引）
- `components/AnalyticsPanel.vue` — 监控分析：状态分布、Token 排行、活跃/审阅任务
- `components/TaskCard.vue` — Agent 卡片：状态 + Token 进度 + 审阅徽章

## 快速启动

```bash
cd kimi-code-swarm
npm install         # 自动配置 Git hooks (core.hooksPath = ci/hooks)
npm run dev         # 开发服务器
```

> `npm install` 会自动运行 `postinstall` 脚本配置 Git hooks。如果跳过此步骤，需手动执行 `git config core.hooksPath ci/hooks`。

## 命令

```bash
cd kimi-code-swarm
npm run dev           # 开发服务器
npm run typecheck     # TypeScript 类型检查
npm run lint          # ESLint 代码检查
npm run lint:fix      # ESLint 自动修复
npm run analyze       # AST 结构分析
npm run check-docs    # 文档同步检测（硬约束）
npm run health-check  # 仓库一致性检查（信息供给型）
npm run test          # Vitest 单元测试
npm run test:watch    # Vitest 监听模式
npm run ci            # 完整流水线：typecheck → lint → analyze → check-docs → test → build
npm run build         # 生产构建
```

## 提交前检查

`git commit` 会自动触发 pre-commit hook（`ci/hooks/pre-commit.cmd`），运行 typecheck → lint → analyze → check-docs。任一阶段失败将阻断提交。

## 前端功能状态

> 完整矩阵见 [`docs/STATUS.md`](../STATUS.md)。

| 功能 | 状态 | 备注 |
|------|------|------|
| API Key 登录 | ✅ 真实 | keyring 安全存储，Kimi API 验证 |
| Agent Dashboard（最多5个） | ✅ 真实 | 卡片网格，数量限制，点击进入详情 |
| Agent 详情页 | ✅ 真实 | 指令输入 + 实时日志 + PR 审阅 + 文件变更 |
| 新建 Agent 弹窗 | ✅ 真实 | |
| 实时日志流 | ✅ 真实 | spawn_process + process-output 事件推送 |
| PR 审阅面板 | ✅ 真实 | 含审阅者列表、进度、门控 |
| SettingsPanel（Token 配置） | ✅ 真实 | localStorage 持久化 |
| 监控分析页 | ✅ 真实 | 状态分布、Token 排行、活跃/审阅任务 |
| Agent 状态持久化 | ✅ 真实 | tauri-plugin-store 自动保存/恢复 |

文档同步检测被阻断时，不直接告知需要更新哪个文档——Agent 需回顾本次会话已读文档，或查阅 AGENTS.md 地图自行定位关联文档。
