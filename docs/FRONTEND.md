# FRONTEND

> 前端应用的 Agent 指南。

## 技术栈

Vue 3 + TypeScript + Vite + Tailwind CSS + lucide-vue-next + Tauri v2

## 编码规范

1. `<script setup lang="ts">`，禁止 Options API
2. Tailwind 原子类，禁止 `<style scoped>`
3. 图标从 `lucide-vue-next` 导入
4. 状态色：running=emerald, idle=blue, error=red, queued=amber, stopped=gray
5. 新增组件必须在 App.vue 注册

## 关键文件

- `store/useSwarmStore.ts` — 状态必须通过方法修改；核心模型 AgentTask 含状态机 + PR 追踪
- `types/index.ts` — AgentTask / LogEntry / CommandCenterStats；修改前检查上下游依赖
- `api/github.ts` — GitHub API 封装（PR 创建/合并/查询）
- `api/ipc.ts` — Tauri IPC 适配层
- `components/SettingsPanel.vue` — 系统设置（GitHub Token 配置）
- `components/TaskDetail.vue` — PR 审阅面板：审阅者列表、进度条、合并门控
- `components/TaskCard.vue` — 任务卡片：审阅进度徽章

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
| 任务列表 / 卡片 / 详情 | ✅ 真实 | 完整交互 |
| 新建任务弹窗 | ✅ 真实 | |
| 实时日志流 | ⚡ 模拟 | 真实 CLI 接入后变为真实 |
| PR 审阅面板 | ✅ 真实 | 含审阅者列表、进度、门控 |
| SettingsPanel（Token 配置） | ✅ 真实 | localStorage 持久化 |
| 监控分析页 | ❌ 占位 | Tab 存在，内容待实现 |

文档同步检测被阻断时，不直接告知需要更新哪个文档——Agent 需回顾本次会话已读文档，或查阅 AGENTS.md 地图自行定位关联文档。
