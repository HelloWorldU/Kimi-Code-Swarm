<div align="center">

# Kimi-Code-Swarm

### Kimi CLI 的本地 Agent 指挥中心

**桌面 UI 派任务、监进度、审 PR —— 单人指挥多个 Kimi CLI 工人并发开发。**

单 Kimi 账号 → 本地 N 个独立工作区 → N 个 CLI 工人并发开发 → 各自提 PR → 你审阅合并。

[![Release](https://img.shields.io/github/v/release/HelloWorldU/Kimi-Code-Swarm?include_prereleases&label=release)](https://github.com/HelloWorldU/Kimi-Code-Swarm/releases/latest)
[![License](https://img.shields.io/github/license/HelloWorldU/Kimi-Code-Swarm)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-blue)](https://github.com/HelloWorldU/Kimi-Code-Swarm/releases/latest)
[![Stars](https://img.shields.io/github/stars/HelloWorldU/Kimi-Code-Swarm?style=flat)](https://github.com/HelloWorldU/Kimi-Code-Swarm/stargazers)

**[⬇ 下载 v0.1.0](https://github.com/HelloWorldU/Kimi-Code-Swarm/releases/latest)** · **[📖 文档](docs/)** · **[🐛 Backlog](docs/exec-plans/backlog.md)** · **[English](README.md)**

</div>

---

> ⚠️ **不是商业产品** —— 这是 **Harness Engineering** 方法论的实践场。
> 核心价值不在功能本身，而在 *实践发现问题 → 抽象定义 → 解决问题* 的高价值回路。

## 工作方式

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

- 🎯 **任务派发** —— 点击「新建任务」，App 自动 clone 仓库、切分支、启动 CLI
- 📝 **指令交互** —— 对每个 Agent 用自然语言多轮对话
- 🤖 **自动提交审阅** —— Agent 完成后自动 `git commit/push` 并创建 PR；pre-commit 失败自动修复（最多 3 轮）
- 🔍 **PR 审阅** —— App 内查看 diff、合并或打回；全员审阅门控（其余 Agent 需全部通过）
- 📊 **实时监控** —— Token 消耗、Git 分支、PR 状态、进程存活

> 🪟 **Windows 为主**。Rust 进程管理含 Windows-only 逻辑，macOS/Linux 需适配。浏览器开发模式不受影响。

## 🚀 快速启动

### 方式 A —— 装预编译包（推荐）

到 [Releases](https://github.com/HelloWorldU/Kimi-Code-Swarm/releases/latest) 下载安装包：

| 平台 | 安装包 | 备注 |
|------|--------|------|
| Windows | `kimi-code-swarm_*_x64-setup.exe`（NSIS） | ~10 MB，推荐 |
| Windows | `kimi-code-swarm_*_x64_en-US.msi` | ~15 MB，企业 GPO 部署用 |

> 首次运行可能触发 Windows SmartScreen（安装包未签名）。点 **「更多信息 → 仍要运行」** 即可。

### 方式 B —— 从源码构建

```bash
git clone https://github.com/HelloWorldU/Kimi-Code-Swarm.git
cd Kimi-Code-Swarm/kimi-code-swarm
npm install          # 自动配置 Git hooks
npm run dev          # 浏览器模式，localhost:5173
npm run tauri dev    # 桌面模式（需 Rust）
```

### 前置依赖

| 依赖 | 用途 | 安装 |
|------|------|------|
| Kimi CLI | Agent 执行引擎 | `py -3.12 -m pip install kimi-cli` |
| Kimi API Key | App 登录 + CLI 注入 | https://www.kimi.com/code/console |
| Node.js 22+ | 前端 + Agent Engine | https://nodejs.org/ |
| Git | Agent clone/commit/push | https://git-scm.com/ |
| GitHub Token *(可选)* | 真实 PR 操作（否则 Mock） | GitHub Settings → PAT |
| Rust *(仅源码构建需要)* | Tauri 桌面壳层 | https://rustup.rs/ |

**首次使用**：打开 App → 输入 Kimi API Key → 验证 → 新建 Agent → 输入仓库地址和指令 → 启动。

核心功能（真实 CLI 调用、Git 自动化）仅在 **Tauri 桌面模式** 下生效。

## 文档

- [`AGENTS.md`](AGENTS.md) — Agent 启动地图（规则 + 索引）
- [`docs/DESIGN.md`](docs/DESIGN.md) — 顶层设计、Harness 五层架构
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 数据流、状态分层、模块边界
- [`docs/STATUS.md`](docs/STATUS.md) — 功能实现状态单一事实源
- [`docs/exec-plans/backlog.md`](docs/exec-plans/backlog.md) — 已知问题与架构决策
- [**配套博文** — 在智能体优先的世界中实践 Harness Engineering](https://swiftact.cn/articles/kimi-code.html) — 从这个项目里踩过的坑、失败模式与方法论总结

## 许可证

[MIT](LICENSE)
