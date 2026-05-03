# Kimi-Code-Swarm

> 本地 Agent 指挥中心 App。指挥官通过桌面 UI 派任务、监进度、审 PR，指挥多个 Kimi Code CLI 工人在独立目录并发开发。

## 核心场景

单 Kimi 账号 → 本地 N 个独立目录 → N 个 CLI 工人并发开发 → 各自提 PR → 指挥官审阅合并到 main。

```
指挥官（你）
    │
    ▼
┌─────────────────────────────┐
│  Kimi-Code-Swarm App        │
│  ├── 新建任务（自动 clone）   │
│  ├── 输入指令               │
│  ├── 实时监控进度           │
│  └── 审阅 PR → 合并         │
└─────────────────────────────┘
    │
    ├─► Agent-01 @ ~/workspace/agent-01  ──► PR #42
    ├─► Agent-02 @ ~/workspace/agent-02  ──► PR #43
    └─► Agent-03 @ ~/workspace/agent-03  ──► PR #44
```

## 核心功能

- 🎯 **任务派发**：点击新建任务，App 自动 clone 仓库、切分支、启动 CLI
- 📝 **指令输入**：指挥官给 Agent 下达自然语言指令
- 📊 **实时监控**：Token 消耗、Git 分支、PR 状态、进程存活
- 🔍 **PR 审阅**：在 App 内查看 diff、合并或打回
- ⚡ **并发开发**：多个 Agent 在独立目录互不干扰

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Tailwind CSS |
| 构建 | Vite |
| 图标 | lucide-vue-next |
| 桌面壳 | Tauri v2 / Electron（未来） |

## 快速启动

```bash
cd kimi-code-swarm
npm install    # 自动配置 Git hooks
npm run dev    # localhost:5173
```

## 文档结构

```
AGENTS.md        ← 地图（Agent 启动先读）
docs/            ← 知识库（架构/设计/规范/产品规格）
  ├── DESIGN.md
  ├── ARCHITECTURE.md
  ├── FRONTEND.md
  ├── COMPONENT_PATTERNS.md
  ├── CONSTRAINTS.md
  ├── PLANS.md
  └── product-specs/
ast/             ← AST 结构约束
ci/              ← CI 配置与 hooks
scripts/         ← 自动化脚本（health-check / setup-hooks）
kimi-code-swarm/ ← 前端应用
```

## 许可证

MIT
