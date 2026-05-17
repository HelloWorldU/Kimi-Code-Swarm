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
    ├─► Agent-01 @ E:/workspace/agent-01  ──► PR #42
    ├─► Agent-02 @ E:/workspace/agent-02  ──► PR #43
    └─► Agent-03 @ E:/workspace/agent-03  ──► PR #44
```

## 核心功能

- 🎯 **任务派发**：点击新建任务，App 自动 clone 仓库、切分支、启动 CLI
- 📝 **指令输入**：指挥官给 Agent 下达自然语言指令
- 📊 **实时监控**：Token 消耗、Git 分支、PR 状态、进程存活
- 🤖 **自动提交审阅**：Agent 完成指令后自动 `git add/commit/push` 并创建 PR；pre-commit 失败时全量日志回传修复（最多 3 轮）
- 🔍 **PR 审阅**：在 App 内查看 diff、合并或打回；全员审阅门控（其余 Agent 必须全部通过）
- ⚡ **并发开发**：多个 Agent 在独立目录互不干扰

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Tailwind CSS |
| 桌面壳 | Tauri v2 (Rust) |
| Agent Engine | Node.js + TypeScript + Zod |
| 图标 | lucide-vue-next |

> ⚠️ **平台限制**：当前代码和验证主要在 **Windows** 上完成。Rust 进程管理含 Windows-only 逻辑（`CREATE_NO_WINDOW`、`taskkill`、nvm-windows 路径探测），macOS/Linux 需适配。浏览器开发模式（`npm run dev`）不受此限制。

---

## 🚀 快速启动

### 前置条件

| 依赖 | 版本/要求 | 用途 | 获取方式 |
|------|----------|------|---------|
| **Node.js** | 22+ | 前端构建与 Agent Engine | [nodejs.org](https://nodejs.org/) |
| **Git** | 任意 | Agent 自动 clone/commit/push | [git-scm.com](https://git-scm.com/) |
| **Kimi CLI** | 最新 | Agent 执行指令的核心工具 | `py -3.12 -m pip install kimi-cli` |
| **Kimi API Key** | 必需 | 登录 App，注入 CLI 进程 | [kimi.com/code/console](https://www.kimi.com/code/console) |
| GitHub Token | 可选 | PR 创建/合并（无 Token 时降级为 Mock） | GitHub Settings → Developer settings → Personal access tokens |
| Rust | 可选 | 仅 Tauri 桌面模式需要 | [rustup.rs](https://rustup.rs/) |

> 💡 **浏览器开发模式**（`npm run dev`）不需要 Rust/Tauri，但核心功能（真实 CLI 调用、Git 自动化）只在 **Tauri 桌面模式** 下生效。

### 安装与启动

```bash
# 1. 克隆仓库
git clone <repo-url>
cd Kimi-Code-Swarm

# 2. 安装前端依赖（自动配置 Git hooks）
cd kimi-code-swarm
npm install

# 3. 启动开发服务器（浏览器模式）
npm run dev    # localhost:5173

# 4. （可选）Tauri 桌面模式
npm run tauri dev
```

### 首次使用流程

1. 打开 App（浏览器或桌面窗口）
2. 在登录页输入 Kimi API Key → 点击验证
   - API Key 从 [Kimi Code 控制台](https://www.kimi.com/code/console) 获取
   - **一个 Key 供所有 Agent 共享**——指挥官输入一次，App 自动注入到每个 Agent 的 CLI 进程中
   - 验证通过后存入系统 Keyring（Tauri）或 localStorage（浏览器），**不会明文保存**
3. 进入 Dashboard → 点击「新建 Agent」→ 输入仓库地址和指令
4. 点击「启动」→ App 自动 clone 仓库到工作目录（Windows 默认 `E:/workspace/{agent-id}`）
5. 在对话窗口中与 Agent 多轮交互

---

## 文档结构

```
AGENTS.md        ← 🗺️ 地图（Agent 启动先读）
docs/            ← 📚 知识库（按需加载）
  ├── DESIGN.md           顶层设计 + Harness 五层架构
  ├── ARCHITECTURE.md     系统架构、数据流、模块边界
  ├── FRONTEND.md         前端编码规范
  ├── COMPONENT_PATTERNS.md  Vue 组件规范
  ├── CONSTRAINTS.md      约束体系（CI / AST / pre-commit）
  ├── STATUS.md           功能实现状态单一事实源
  ├── PLANS.md            执行计划 + 技术债务
  ├── CLI_HARNESS.md      CLI 进程接入设计
  └── product-specs/      产品规格
ast/             ← 🔧 AST 结构约束代码
ci/              ← ✅ CI 配置与 git hooks
scripts/         ← 🤖 自动化脚本（health-check / cleanup）
skills/          ← 🎯 Agent 能力规范（commit / push / debug）
kimi-code-swarm/ ← 💻 前端应用 + Agent Engine
```

## 许可证

MIT
