# CLI Harness

## 目标

后台 spawn Node.js Agent 引擎，引擎再 spawn Kimi CLI 子进程。Rust 与引擎通过 stdin/stdout JSON Lines 通信，引擎与 CLI 通过实时 stdout/stderr 捕获通信。

## 实际架构

```
UI (Vue) ←→ Tauri IPC ←→ Rust Main Process
  ←→ stdin/stdout JSON Lines ←→ Node.js Agent Engine
    ←→ spawn Kimi CLI (real-time stdout capture)
    ←→ Git operations (clone/commit/push)
    ←→ Token budget monitoring
```

### Agent Engine 启动流程

1. Rust `spawn_agent_engine()` 探测 `agent-engine` 目录（开发/生产多路径 fallback）
2. 从 keyring 读取 API Key，注入 `KIMI_API_KEY` 环境变量
3. 启动 Node.js 进程，stdin 写入 JSON Lines 命令
4. stdout 解析 JSON 事件，通过 Tauri `agent-engine-event` 推送到前端

## Node.js TypeScript 执行方案选型（踩坑记录）

### 背景

Agent Engine 用 TypeScript 编写，需要被 Rust 在运行时直接启动，无预编译步骤。

### 方案对比

| 方案 | 命令 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| Node.js Type Stripping | `node --experimental-strip-types src/index.ts` | 零依赖，Node 22 原生 | **Windows ESM 下 `.js` import 不映射到 `.ts`**；裸导入也不支持 | ❌ 放弃 |
| tsx | `npx tsx src/index.ts` |  seamless `.js`→`.ts` 映射；esbuild 极速；零配置 | 多一个 devDependency | ✅ 采用 |
| 预编译 | `tsc` → `dist/index.js` | 最标准 | 开发需额外 watch 进程；启动多一步 | ⚡ 备选 |

### 踩坑详情：Node.js 22 `--experimental-strip-types`

**错误现象**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../engine.js'
  imported from .../index.ts
```

**根因分析**

Agent Engine 是 ESM（`"type": "module"`），import 路径带 `.js` 扩展名（TypeScript `NodeNext` moduleResolution 要求）：

```ts
// agent-engine/src/index.ts
import { AgentEngine } from './engine.js'
```

Node.js 22 `--experimental-strip-types` 的行为：
- 遇到 `.js` import → **直接找 `.js` 文件**，不会自动映射到 `.ts`
- 裸导入 `./engine` → ESM 解析器**不会自动尝试 `.ts` 扩展名**

这就形成了一个死锁：TypeScript 编译要求 `.js`，Node.js 运行时又不认 `.js`→`.ts` 映射。

**尝试过的中间方案**

1. 去掉 `.js` 扩展名，`moduleResolution: "bundler"`
   - TypeScript 编译通过
   - Node.js 运行时：`Cannot find module './engine'`（Windows 上裸导入不解析 `.ts`）
   - **失败**

2. 保留 `.js` 扩展名，`moduleResolution: "NodeNext"`
   - TypeScript 编译通过
   - Node.js 运行时：`Cannot find module './engine.js'`（文件是 `.ts`）
   - **失败**

3. 改用 `.ts` 扩展名
   - TypeScript `NodeNext` / `bundler` 均不支持 `.ts` import 路径
   - **失败**

**最终方案：tsx**

```rust
// src-tauri/src/lib.rs
let mut cmd_builder = Command::new("npx");
cmd_builder.args(["tsx", "src/index.ts"])
```

- `tsx` 基于 esbuild，会自动把 ESM import 中的 `.js` 映射到 `.ts`
- 开发体验无缝，不需要预编译 watch
- `package.json` 中已声明 `"dev": "tsx src/index.ts"`

### 经验教训

1. **Node.js 的实验性功能不要用于生产关键路径**。`--experimental-strip-types` 在 Windows + ESM + 相对路径导入的组合下存在明显缺口。
2. **tsx 是当前 Node.js TypeScript 执行的最优解**。它比 `ts-node` 快，比 `vite-node` 轻，比实验性功能稳。
3. **ESM + TypeScript 的扩展名问题在 2025 年仍然是痛点**。TypeScript 团队正在推进的 `rewriteRelativeImportExtensions` 和 `--modulePreserve` 可能未来会改善，但现阶段 tsx 是最务实的选择。
4. **跨平台测试必须覆盖 Windows**。`--experimental-strip-types` 在 macOS/Linux 的某些场景下可能工作正常，但 Windows 文件系统语义不同。

## 引擎 ↔ Rust 通信协议

### 命令（Rust → Engine，JSON Lines over stdin）

```ts
type EngineCommand =
  | { type: 'create-agent'; payload: { name, repoUrl, instruction, tokenBudget } }
  | { type: 'start-agent'; agentId: string }
  | { type: 'send-instruction'; agentId: string; instruction: string }
  | { type: 'stop-agent'; agentId: string }
  | { type: 'delete-agent'; agentId: string }
  | { type: 'submit-for-review'; agentId: string }
  | { type: 'merge-pr'; agentId: string }
  | { type: 'reject-pr'; agentId: string }
  | { type: 'submit-review'; agentId, reviewerAgentId, approved }
  | { type: 'get-file-diff'; agentId, filePath }
  | { type: 'ping' }
  | { type: 'shutdown' }
```

### 事件（Engine → Rust，JSON Lines over stdout）

```ts
type EngineEvent =
  | { type: 'agent-created'; agent: AgentState }
  | { type: 'agent-output'; agentId, line, isStderr }
  | { type: 'agent-exit'; agentId, code }
  | { type: 'agent-status'; agentId, status }
  | { type: 'log'; agentId, entry }
  | { type: 'file-changed'; agentId, files }
  | { type: 'diff-result'; agentId, filePath, diff }
  | { type: 'error'; message }
  | { type: 'pong' }
```

## Kimi CLI 接入

### CLI 检测

```ts
// 优先级：直接可执行文件 → Python 模块调用
const CANDIDATES = ['kimi', 'C:\\Python312\\Scripts\\kimi.exe']
const PYTHON_CANDIDATES = [
  { python: 'py', args: ['-3.12', '-m', 'kimi'] },
  { python: 'python3.12', args: ['-m', 'kimi'] },
]
```

### 环境变量注入

Rust 启动引擎时从 keyring 读取 API Key，通过 `env("KIMI_API_KEY", key)` 注入。引擎 spawn Kimi CLI 时透传该变量：

```ts
const child = spawn(kimiPath, args, {
  cwd: workspace,
  env: { ...process.env, KIMI_API_KEY: process.env.KIMI_API_KEY },
})
```

### 验证逻辑（重要教训）

**错误做法**：用 `kimi --version` + `KIMI_API_KEY` 验证 Key 有效性。`--version` 不读取 API Key，无论 Key 对错都返回 0。

**正确做法**：
1. 验证 Key 格式（`sk-` 开头）
2. 检测 Kimi CLI 是否安装（`kimi --version`）
3. **不提前验证 Key 是否有效** —— CLI 执行时自然会报错（401/403），错误信息通过 stderr 流式返回给前端
4. 如果 CLI 未安装，返回明确错误提示，而不是 fallback 通过

## 状态机

```
pending ──start──→ cloning ──git clone──→ ready ──send instruction──→ working
  │                                                      │
  └──restart─────────────────────────────────────────────┘
  │                  │
  └──stop────────────→ stopped
                     │
  working ──auto submit review──→ reviewing ──all approved──→ completed
    │                                 │
    │    ┌─ CI pass ─────────────────┘
    │    │
    │    └─ CI fail ──auto-fix (×3)──→ reviewing (re-push)
    │         │
    │         └─ max retries ──→ ready (manual fallback)
    │
    └──reject PR─────────────────────┘
    │
    └──pre-commit fail (auto-fix ×3)──→ ready (manual fallback)
```
