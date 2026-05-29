<div align="center">

# Kimi-Code-Swarm

### Local Agent Command Center for Kimi CLI

**Dispatch tasks, monitor progress, review PRs — direct N Kimi CLI workers from one desktop UI.**

One Kimi account → N isolated workspaces → N concurrent CLI workers → each submits a PR → you review and merge.

[![Release](https://img.shields.io/github/v/release/HelloWorldU/Kimi-Code-Swarm?include_prereleases&label=release)](https://github.com/HelloWorldU/Kimi-Code-Swarm/releases/latest)
[![License](https://img.shields.io/github/license/HelloWorldU/Kimi-Code-Swarm)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-blue)](https://github.com/HelloWorldU/Kimi-Code-Swarm/releases/latest)
[![Stars](https://img.shields.io/github/stars/HelloWorldU/Kimi-Code-Swarm?style=flat)](https://github.com/HelloWorldU/Kimi-Code-Swarm/stargazers)

**[⬇ Download v0.1.0](https://github.com/HelloWorldU/Kimi-Code-Swarm/releases/latest)** · **[📖 Docs](docs/)** · **[🐛 Backlog](docs/exec-plans/backlog.md)** · **[简体中文](README.zh-CN.md)**

</div>

---

> ⚠️ **Not a commercial product** — this is a proving ground for **Harness Engineering** methodology.
> The core value isn't the features themselves; it's the loop of *practice → discover problems → abstract definitions → solve problems*.

## How It Works

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

## Core Features

- 🎯 **Task Dispatch** — Click "New Task"; the App auto-clones the repo, switches branches, and launches the CLI
- 📝 **Instruction Interaction** — Natural-language multi-turn dialogue with each Agent
- 🤖 **Auto Submit & Review** — Agent runs `git commit/push` and opens a PR on completion; auto-fixes pre-commit failures (up to 3 rounds)
- 🔍 **PR Review** — View diffs, merge or reject in-app; all-hands review gate (all other Agents must pass)
- 📊 **Real-time Monitoring** — Token consumption, Git branches, PR status, process liveness

> 🪟 **Windows-first**. Rust process management contains Windows-only logic; macOS/Linux requires adaptation. Browser dev mode is unaffected.

## 🚀 Quick Start

### Option A — Install pre-built (recommended)

Download the installer from [Releases](https://github.com/HelloWorldU/Kimi-Code-Swarm/releases/latest):

| Platform | Installer | Notes |
|----------|-----------|-------|
| Windows | `kimi-code-swarm_*_x64-setup.exe` (NSIS) | ~10 MB, recommended |
| Windows | `kimi-code-swarm_*_x64_en-US.msi` | ~15 MB, for enterprise GPO |

> First run may trigger Windows SmartScreen (binaries are unsigned). Click **More info → Run anyway**.

### Option B — Build from source

```bash
git clone https://github.com/HelloWorldU/Kimi-Code-Swarm.git
cd Kimi-Code-Swarm/kimi-code-swarm
npm install          # auto-configures Git hooks
npm run dev          # browser mode, localhost:5173
npm run tauri dev    # desktop mode (requires Rust)
```

### Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| Kimi CLI | Agent execution engine | `py -3.12 -m pip install kimi-cli` |
| Kimi API Key | App login + CLI injection | https://www.kimi.com/code/console |
| Node.js 22+ | Frontend + Agent Engine | https://nodejs.org/ |
| Git | Agent clone/commit/push | https://git-scm.com/ |
| GitHub Token *(optional)* | Real PR ops (else Mock) | GitHub Settings → PAT |
| Rust *(source build only)* | Tauri desktop shell | https://rustup.rs/ |

**First time use**: Open the App → Enter Kimi API Key → Verify → Create Agent → Enter repo URL and instructions → Launch.

Core features (real CLI invocation, Git automation) only work in **Tauri desktop mode**.

## Documentation

- [`AGENTS.md`](AGENTS.md) — Agent startup map (rules + index)
- [`docs/DESIGN.md`](docs/DESIGN.md) — Top-level design, Harness 5-layer architecture
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Data flow, state layering, module boundaries
- [`docs/STATUS.md`](docs/STATUS.md) — Single source of truth for feature implementation status
- [`docs/exec-plans/backlog.md`](docs/exec-plans/backlog.md) — Known issues and architectural decisions

## License

[MIT](LICENSE)
