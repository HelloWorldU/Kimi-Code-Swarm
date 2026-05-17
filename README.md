# Kimi-Code-Swarm

> **本地 Agent 指挥中心 App**。指挥官通过桌面 UI 派任务、监进度、审 PR，指挥多个 Kimi Code CLI 工人在独立目录并发开发。

单 Kimi 账号 → 本地 N 个独立目录 → N 个 CLI 工人并发开发 → 各自提 PR → 指挥官审阅合并。

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
- 📝 **指令交互**：指挥官给 Agent 下达自然语言指令，多轮对话
- 🤖 **自动提交审阅**：Agent 完成后自动 `git commit/push` 并创建 PR；pre-commit 失败时自动修复（最多 3 轮）
- 🔍 **PR 审阅**：App 内查看 diff、合并或打回；全员审阅门控（其余 Agent 需全部通过）
- 📊 **实时监控**：Token 消耗、Git 分支、PR 状态、进程存活

> ⚠️ **Windows 为主**。Rust 进程管理含 Windows-only 逻辑，macOS/Linux 需适配。浏览器开发模式不受影响。

---

## 🚀 快速启动

**需要**：Node.js 22+、Git、[Kimi CLI](https://www.kimi.com/code/console)、Kimi API Key。Tauri 桌面模式额外需要 Rust。

```bash
git clone <repo-url>
cd Kimi-Code-Swarm/kimi-code-swarm
npm install          # 自动配置 Git hooks
npm run dev          # 浏览器模式，localhost:5173
npm run tauri dev    # 桌面模式（需 Rust）
```

**首次使用**：打开 App → 输入 Kimi API Key → 验证 → 新建 Agent → 输入仓库地址和指令 → 启动。

核心功能（真实 CLI 调用、Git 自动化）仅在 **Tauri 桌面模式** 下生效。

---

## 文档

- [`AGENTS.md`](AGENTS.md) — Agent 启动地图（规则 + 索引）
- [`docs/`](docs/) — 完整知识库：架构、设计、规范、产品规格、功能状态
- [`docs/STATUS.md`](docs/STATUS.md) — 功能实现状态单一事实源

## 许可证

MIT
