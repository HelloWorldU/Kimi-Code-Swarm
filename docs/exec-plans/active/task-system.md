# P0: 任务系统与 CLI 接入（已完成）

> 状态：✅ 已完成（2026-05-12）
> 归档原因：核心功能全部落地，进入维护阶段

## 交付清单

| 功能 | 状态 | 关键文件 |
|------|------|----------|
| Agent Engine (Node.js) | ✅ | `agent-engine/src/engine.ts` |
| Kimi CLI 接入 | ✅ | `agent-engine/src/kimi.ts` |
| Git 自动化 (clone/commit/push) | ✅ | `agent-engine/src/git.ts` |
| Token 预算控制 | ✅ | `agent-engine/src/agent.ts` |
| Zod 运行时验证 | ✅ | `agent-engine/src/schemas.ts` |
| 多轮对话 UI | ✅ | `src/components/AgentDetail.vue` |
| GitHub API 真实路径 | ✅ | `agent-engine/src/github-api.ts` |
| 文件 diff 查看 | ✅ | `agent-engine/src/git.ts` + store 事件驱动 |
| 后端集成测试 | ✅ | `tests/integration/engine.spec.ts` — 覆盖 Engine 完整生命周期及降级行为 |

## 架构演进记录

### 初始设计（v1.0）
直接通过 node-pty spawn Kimi CLI 实例，`harness/new-instance.yaml` 描述此流程。

### 实际落地（v2.0）
改为 **Agent Engine 统一托管** 架构：
- 单一 Node.js 进程管理所有 Agent 生命周期
- Rust 通过 stdin/stdout JSON Lines 与 Engine 通信
- Engine 按需 spawn Kimi CLI 子进程
- 好处：状态集中、便于监控、跨平台兼容性好

### 废弃文件
- `harness/new-instance.yaml` v1.0 已过时，重写为 v2.0 版本
