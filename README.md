# Kimi-Code-Swarm

> **Local Agent Command Center App**. The commander dispatches tasks, monitors progress, and reviews PRs through a desktop UI, directing multiple Kimi Code CLI workers to develop concurrently in isolated directories.

One Kimi account → N local isolated directories → N CLI workers developing concurrently → each submits a PR → the commander reviews and merges.

> ⚠️ **This is not a commercial product, but a proving ground for Harness Engineering methodology.**
> The core value lies not in the features themselves, but in the high-value loop of **"practice → discover problems → abstract definitions → solve problems"**.

```
Commander (You)
    │
    ▼
┌─────────────────────────────┐
│  Kimi-Code-Swarm App        │
│  ├── New Task (auto clone)  │
│  ├── Enter Instructions     │
│  ├── Real-time Monitoring   │
│  └── Review PR → Merge      │
└─────────────────────────────┘
    │
    ├─► Agent-01 @ ~/workspace/agent-01  ──► PR #42
    ├─► Agent-02 @ ~/workspace/agent-02  ──► PR #43
    └─► Agent-03 @ ~/workspace/agent-03  ──► PR #44
```

<p align="right">
  <a href="README.zh-CN.md">简体中文</a>
</p>

## Core Features

- 🎯 **Task Dispatch**: Click "New Task", the App automatically clones the repo, switches branches, and launches the CLI
- 📝 **Instruction Interaction**: The commander gives natural language instructions to the Agent for multi-round dialogue
- 🤖 **Auto Submit & Review**: When the Agent finishes, it automatically runs `git commit/push` and creates a PR; auto-fixes pre-commit failures (up to 3 rounds)
- 🔍 **PR Review**: View diffs, merge or reject within the App; all-hands review gate (all other Agents must pass)
- 📊 **Real-time Monitoring**: Token consumption, Git branches, PR status, process liveness

> ⚠️ **Windows-first**. Rust process management contains Windows-only logic; macOS/Linux requires adaptation. Browser dev mode is unaffected.

---

## 🚀 Quick Start

**Requirements**: Node.js 22+, Git, [Kimi CLI](https://www.kimi.com/code/console), Kimi API Key. Tauri desktop mode additionally requires Rust.

```bash
git clone <repo-url>
cd Kimi-Code-Swarm/kimi-code-swarm
npm install          # auto-configures Git hooks
npm run dev          # browser mode, localhost:5173
npm run tauri dev    # desktop mode (requires Rust)
```

**First time use**: Open the App → Enter Kimi API Key → Verify → Create Agent → Enter repo URL and instructions → Launch.

Core features (real CLI invocation, Git automation) only work in **Tauri desktop mode**.

---

## Documentation

- [`AGENTS.md`](AGENTS.md) — Agent startup map (rules + index)
- [`docs/`](docs/) — Full knowledge base: architecture, design, conventions, product specs, feature status
- [`docs/STATUS.md`](docs/STATUS.md) — Single source of truth for feature implementation status

## License

MIT
