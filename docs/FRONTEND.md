# FRONTEND

> 前端应用的 Agent 指南。

## 技术栈

Vue 3 + TypeScript + Vite + Tailwind CSS + lucide-vue-next + Tauri v2 + @tauri-apps/plugin-store + marked + dompurify + highlight.js

## 编码规范

1. `<script setup lang="ts">`，禁止 Options API
2. Tailwind 原子类，禁止 `<style scoped>`
3. 图标从 `lucide-vue-next` 导入
4. 状态色：running=emerald, idle=blue, error=red, queued=amber, stopped=gray；统一使用 `-600` 文字 + `-50` 背景，白色简约主题
5. 新增组件必须在 App.vue 注册
6. 问题暴露但代码不明显时，优先加 Logger 日志定位，禁止盲猜（`src/utils/logger.ts`）
7. E2E 测试依赖的元素须加 `data-testid` 属性，禁止用 class 或文本来定位

## 关键文件

- `store/useSwarmStore.ts` — UI 状态管理；业务逻辑委托给 Node.js Agent 引擎
- `kimi-code-swarm/agent-engine/src/engine.ts` — Node.js Agent 编排引擎（生命周期 + Kimi CLI + Token 监控）
- `types/index.ts` — AgentTask / LogEntry（含 think / tool_call / tool_result / mcp 类型）/ CommandCenterStats；`AgentTask` 不再直接存储 `instruction`，指令信息从 `logs` 中 `type === 'input'` 的条目获取；修改前检查上下游依赖
- `api/github.ts` — GitHub API 封装（PR 创建/合并/查询）
- `api/ipc.ts` — Tauri IPC 适配层
- `components/LoginView.vue` — API Key 登录页（验证 + keyring 存储）
- `components/AgentDashboard.vue` — Agent 卡片网格（最多 5 个，点击进入详情）；统计卡片带渐变背景 + 进度条
- `components/CreateTaskModal.vue` — 新建 Agent 弹窗：收集 name / repoUrl / tokenBudget，Vue `<Transition>` 淡入淡出动画
- `components/SwarmConfirmModal.vue` — 确认弹窗组件：支持 danger/warning/info 类型，配合 useConfirm 使用
- `components/SwarmToast.vue` — Toast 通知组件：支持 error/success/info/warning，自动消失
- `App.vue` — 主入口：布局框架 + 视图路由（dashboard/agent-detail/analytics）+ 全局事件处理（如文件 diff 查看）
- `components/AgentDetail.vue` — Agent 详情：`<textarea>` 指令输入（Enter 发送 / Shift+Enter 换行，自动增高）+ 日志流（含 think / tool_call / mcp / tool_result 可折叠气泡，默认收起，点击展开查看完整内容，智能滚动：通过 `scroll` 事件跟踪用户位置，若用户之前在底部 50px 内则即时跟进，已上滚则保持阅读位置）+ PR 审阅 + 文件变更（点击通过 engine 获取 diff）。**聊天消息气泡（input / output / think）支持 Markdown 渲染 + 代码语法高亮**，基于 `marked` + `highlight.js` + `dompurify`（XSS 过滤）。**滚动到底部按钮**：用户上滚离开底部后，聊天区右下角显示浮动下箭头按钮（白色圆形 + 阴影 + 淡入淡出动画），点击平滑滚动至底部；空对话或已处于底部时自动隐藏。按钮放在滚动容器的 **relative wrapper 兄弟节点** 而非 overflow-y-auto 子节点内（避免随消息滚出视口），切换 Agent 时清零 `showScrollToBottom`，带 `aria-label`/`title="滚动到底部"`。输入框草稿通过 `useSwarmStore.draftInputs` 做内存级缓存，切视图/切 Agent 时不丢失未发送内容。所有消息气泡带 `animate-message-enter` 进入动画。「打回」按钮 tooltip 说明：只切回就绪态、不自动触发修改。Reviewer 行支持 `failed` 状态展示（amber 配色 + 失败原因）。Info 区「任务指令」用 `line-clamp-2` 限高，长消息不会撑大挤掉聊天面板
- `composables/useConfirm.ts` — 全局确认弹窗状态管理（命令式 API）
- `composables/useToast.ts` — 全局 Toast 通知状态管理（命令式 API）
- `components/SettingsPanel.vue` — 系统设置（GitHub Token + Kimi CLI 安装指引）
- `components/AnalyticsPanel.vue` — 监控分析：状态分布、Token 排行、活跃/审阅任务；任务列表通过 `getLastInput(task.logs)` 展示最后一条 input 指令摘要
- `components/TaskCard.vue` — Agent 卡片：状态 + Token 进度 + 审阅徽章

## 环境准备

| 依赖 | 版本 | 用途 | 获取 |
|------|------|------|------|
| Node.js | 22+ | 前端构建 + Agent Engine | [nodejs.org](https://nodejs.org/) |
| Git | 任意 | Agent clone/commit/push | [git-scm.com](https://git-scm.com/) |
| Kimi CLI | 最新 | Agent 执行指令 | `py -3.12 -m pip install kimi-cli` |
| Kimi API Key | 必需 | App 登录 + CLI 进程注入 | [kimi.com/code/console](https://www.kimi.com/code/console) |
| GitHub Token | 可选 | PR 真实操作（否则 Mock） | GitHub Settings → PAT |
| Rust | 可选 | Tauri 桌面模式 | [rustup.rs](https://rustup.rs/) |
| marked | ^14.x | Markdown 渲染（Agent 消息） | npm install 自动安装 |
| dompurify | ^3.x | XSS 过滤 | npm install 自动安装 |
| highlight.js | ^11.x | 代码语法高亮 | npm install 自动安装 |

> **浏览器模式**（`npm run dev`）不需要 Rust。核心功能（真实 CLI 调用、Git 自动化）仅在 **Tauri 桌面模式** 生效。

## 快速启动

```bash
cd kimi-code-swarm
npm install         # 自动配置 Git hooks (core.hooksPath = ci/hooks)
npm run dev         # 开发服务器（浏览器模式）
```

首次打开后在登录页输入 Kimi API Key（所有 Agent 共享同一个 Key），验证通过后存入系统 Keyring。

> `npm install` 会自动运行 `postinstall` 脚本配置 Git hooks。如果跳过此步骤，需手动执行 `git config core.hooksPath ci/hooks`。
>
> `ast/` 子包独立管理依赖，运行 `npm run analyze` 前需确保 `cd ast && npm install` 已执行（CI 已同步配置该步骤）。

## 命令

```bash
cd kimi-code-swarm
npm run dev           # 开发服务器
npm run typecheck        # TypeScript 类型检查（前端 src/）
npm run typecheck:engine # TypeScript 类型检查（agent-engine 子包，独立 tsc）
npm run lint             # ESLint 代码检查（含自定义规则：前端禁 spawn）
npm run lint:fix      # ESLint 自动修复
npm run analyze       # AST 结构分析（扫描 src + tests）
npm run check-docs    # 文档同步检测 + Harness 合规检查（硬约束）
npm run health-check  # 仓库一致性检查（信息供给型）
npm run test          # Vitest 单元测试
npm run test:watch    # Vitest 监听模式
npx playwright test   # E2E 测试（需先 cargo tauri dev）
npm run ci            # 完整流水线：typecheck → lint → analyze → test → check-docs → check-test-sync → build
npm run build         # 生产构建（前端）
npm run build:engine  # 生产构建（agent-engine 子包，tsc 编译到 dist/）
```

## 提交前检查

`git commit` 会自动触发 pre-commit hook（`ci/hooks/pre-commit.cmd`），运行 typecheck → lint → analyze → check-docs。任一阶段失败将阻断提交。

> **注意**：测试（`npm run test`）**不在 pre-commit 中运行**，原因：
> 1. 完整测试耗时较长，不应阻塞本地提交
> 2. 本地环境可能缺少 Tauri 等运行时依赖
> 3. 测试放在 **PR CI（GitHub Actions）** 中执行，作为硬性合入门控

pre-commit 中的 `check-docs` 除文档同步外，还包含 **Harness 流程合规检查**：
- 若当前分支名为 `fix/*` / `bugfix/*`，必须伴随 `docs/`、`exec-plans/` 或 `harness/bug-fix.yaml` 的变更
- **文档是单一事实源**：bug-fix 的根因和修复方案优先收敛到 `docs/`，而非散落在代码注释或 commit message 中

PR CI 中额外运行 `check-test-sync`：若 `src/` 新增代码文件，`tests/` 必须有对应测试新增或修改，未同步则阻断合入。

> **error-handling 约束分层**：关键路径（外部调用/状态变更）的 catch 块必须有 `log.error`；非关键路径（存在性检测/轮询重试）允许用 `// expected: ...` 意图注释替代日志，敷衍注释（`// ignore` / `// TODO`）不算。

## 前端功能状态

> 完整矩阵见 [`docs/STATUS.md`](./STATUS.md)。

| 功能 | 状态 | 备注 |
|------|------|------|
| API Key 登录 | ✅ 真实 | keyring 安全存储，Kimi CLI 存在性验证，退出完整重置 |
| Agent Dashboard（最多5个） | ✅ 真实 | 卡片网格，数量限制，点击进入详情；白色简约 UI |
| Agent 详情页 | ✅ 真实 | 指令输入 + 实时日志 + PR 审阅 + 文件变更；白色简约 UI |
| 新建 Agent 弹窗 | ✅ 真实 | 白色简约 UI |
| 实时日志流 | ✅ 真实 | spawn_process + agent-stream 事件推送（支持 text / think / tool_call / mcp / tool_result 分片）；智能滚动，通过 `scroll` 事件跟踪用户位置，底部即时跟进，上滚时不打扰；消息气泡带进入动画；**支持 Markdown 渲染与代码高亮** |
| PR 审阅面板 | ✅ 真实 | 含审阅者列表、进度、门控；白色简约 UI |
| SettingsPanel（Token 配置） | ✅ 真实 | localStorage 持久化；白色简约 UI |
| 监控分析页 | ✅ 真实 | 状态分布、Token 排行、活跃/审阅任务；白色简约 UI |
| 删除 Agent 确认 | ✅ 真实 | `confirm()` 弹窗提示，明确告知工作目录将被一并删除；未启动的 Agent 根据命名规则推断路径显示 |
| Agent 状态持久化 | ✅ 真实 | 引擎自持久化 `engine-state.json`（事实源；按业务字段指纹去重，token 抖动不触发写盘）+ `tauri-plugin-store` 缓存 logs/UI；启动后 `engine-restored` 事件 diff 出本地多余项标 `orphan`；窗口期内所有「向引擎发命令」按钮按 `engineReady` 禁用 |

文档同步检测被阻断时，不直接告知需要更新哪个文档——Agent 需回顾本次会话已读文档，或查阅 AGENTS.md 地图自行定位关联文档。
