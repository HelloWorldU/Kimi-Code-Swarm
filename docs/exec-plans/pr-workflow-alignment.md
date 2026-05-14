# PR 工作流问题对齐文档

> **用途**: PR #1 ~ PR #3 工作流问题的历史记录与根因分析  
> **生成时间**: 2026-05-13  
> **对应 PR**: [#1](https://github.com/HelloWorldU/Kimi-Code-Swarm/pull/1)、[#3](https://github.com/HelloWorldU/Kimi-Code-Swarm/pull/3)
> **状态**: ✅ 所有问题已解决（见下方更新记录）

---

## 一、当前状态摘要

## 历史背景

PR #1（2026-05-13）创建成功，但 GitHub Actions CI 的 `check-test-sync` 失败——新增 4 个代码文件缺少对应测试。

当时 `autoSubmitForReview` 的重试机制**只覆盖 `git commit` 阶段**，PR 创建后的 CI 失败不会自动修复。后续通过以下改进解决了这个问题：

1. **工具调用式反馈循环**（2026-05-14）：`git.ts` 返回完整 `GitResult`，`autoSubmitForReview` 将 stdout + stderr + exit code 全量回传给 Agent 自主修复
2. **CI 自动监控**（2026-05-14）：`startCiMonitor` 轮询 GitHub Checks API，CI 失败时自动获取日志并调用 `fixBasedOnCiFailure` 修复重试（最多 3 轮）
3. **测试补充**（2026-05-14，PR #3）：为 `useConfirm` / `useToast` 补充了单元测试，check-test-sync 通过

---

## 二、自动提交审阅的重试机制（关键）

### 2.1 预期行为

```
Agent 完成任务
    │
    ▼
autoSubmitForReview(githubToken, maxRetries=3)
    │
    ├── 第 1 次: git add → git commit → ❌ pre-commit 失败
    │            └─▶ Kimi 静默修复 → 重新尝试
    │
    ├── 第 2 次: git add → git commit → ❌ 仍失败
    │            └─▶ Kimi 再修复 → 重新尝试
    │
    ├── 第 3 次: git add → git commit → ❌ 还失败
    │            └─▶ 放弃，提示"请指挥官人工介入"
    │
    └── 预期：pre-commit 的 lint/AST/doc-sync 问题，Kimi 修一次就应该通过
```

**重试的边界**: 只针对 `git commit` 这一步。push 失败、PR 创建失败、PR 创建后的 CI 失败，**均不在重试范围内**。

### 2.2 实际暴露的问题

| 轮次 | 错误 | Kimi 修复结果 |
|------|------|--------------|
| 1/3 | `git commit` 失败，pre-commit `check-docs-sync` 发现 7 处文档未同步 | 修复了部分，降至 2 处 |
| 2/3 | `git commit` 失败，仍有 2 处文档未同步（`CreateTaskModal.vue`, `SwarmConfirmModal.vue`） | 未修复成功 |
| 3/3 | 同上 | 未修复成功，人工介入后 Agent 才补对文档 |

**人工介入后最终通过**，成功 push 并创建 PR。

### 2.3 错误信息示例（供日志检索）

```
[agent-engine] [Review] ERROR 多次尝试后仍无法提交审阅，请指挥官人工介入
[agent-engine] [Kimi] ERROR To resume this session: kimi -r <session-id>
```

```
[agent-engine] [Kimi] ERROR 提交审阅失败 (1/3): Error: Command failed: git commit -m feat: 前端专家
[agent-engine] ❌ 发现 X 处文档未同步
[agent-engine]    规则: [frontend-components] 组件变更需同步编码规范
```

---

## 三、PR 创建后 CI 失败的处理策略（重点）

### 3.1 ~~PR CI 失败 ≠ 重试触发条件~~（已解决）

**旧行为**（PR #1 时期）：`autoSubmitForReview` 的职责在 PR 创建成功那一刻就结束了。后续 GitHub Actions 跑出来的失败不会自动修复。

**新行为**（PR #3 之后）：`submitForReview` 成功后会自动启动 `startCiMonitor`，轮询 GitHub Checks API：
- CI 失败 → `stopCiMonitor` → `fixBasedOnCiFailure` → Kimi CLI 自动修复 → `autoSubmitForReview` 重新提交
- CI 通过 → `stopCiMonitor` → `ciStatus = 'success'`
- 超时（10 分钟）或达最大重试次数 → 停止轮询，提示人工介入

### 3.2 PR #1 的 CI 失败详情（历史记录）

```
Run cd kimi-code-swarm && npx tsx ../ci/scripts/check-test-sync.ts --base origin/main
🔍 测试同步检测 (相对于 origin/main 的变更)

❌ 发现 1 处测试未同步：

  📄 新增代码文件:
     - kimi-code-swarm/src/components/SwarmConfirmModal.vue
     - kimi-code-swarm/src/components/SwarmToast.vue
     - kimi-code-swarm/src/composables/useConfirm.ts
     - kimi-code-swarm/src/composables/useToast.ts
  📋 规则: [test-sync/new-code-requires-test]
  📝 src/ 新增了 4 个代码文件，但 tests/ 目录没有对应测试新增或修改。
  💡 请为新增代码补充单元测试（Vitest）、集成测试或 E2E 测试。

Error: Process completed with exit code 1.
```

### 3.3 修复后的提交流程

Agent 修复代码后，**不能直接等自动重试**，需要：

1. **给 Agent 发新指令**："为 SwarmConfirmModal / SwarmToast / useConfirm / useToast 补充测试"
2. Agent 完成修改后，代码已在工作区
3. 指挥官**手动点击"提交审阅"**（或让 Agent 自动检测到变更后触发 `autoSubmitForReview`）
4. 新的 commit 会追加到 PR #1 中，GitHub Actions 重新运行

---

## 四、问题清单与根因

### 🔴 问题 1: check-docs-sync 频繁阻断 `git commit`

| 项目 | 内容 |
|------|------|
| **现象** | Agent 修改 Vue 组件后，`git commit` 被 pre-commit 拦截，3 次重试后仍失败 |
| **根因** | ~~`doc-map.json` 映射复杂~~ **真实根因：Engine 的错误处理模式缺陷**。`autoSubmitForReview` 只把 `err.message`（一行错误摘要）传给 Kimi CLI，Agent 看不到 pre-commit 的完整输出（哪一步过了、哪一步挂了、具体缺什么文档），导致盲猜修复。`doc-map.json` 只是放大了这个问题 |
| **影响** | **高**。几乎每次前端组件改动都会触发，Agent 无法独立完成 |
| **当前状态** | ✅ **已修复**（2026-05-14）。`git.ts` 改为返回完整 `GitResult`，`agent.ts` 的 `autoSubmitForReview` 将执行日志（stdout + stderr + exit code）全量回传给 Agent 自主修复，不再依赖 Engine 的错误摘要判断 |

### 🔴 问题 2: check-test-sync 阻断 PR CI

| 项目 | 内容 |
|------|------|
| **现象** | PR #1 创建成功，但 GitHub Actions 的 `check-test-sync` 失败 |
| **根因** | 新增 4 个代码文件（2 组件 + 2 composables）未补充对应测试 |
| **影响** | **高**。PR 无法合并 |
| **当前状态** | ✅ **已修复**（PR #3，2026-05-14）。补充了 `useConfirm.spec.ts` 和 `useToast.spec.ts`，check-test-sync 通过 |

### 🟡 问题 3: 引擎 stderr 未输出（非阻塞）

| 项目 | 内容 |
|------|------|
| **现象** | 命令行看不到 `agent-engine` 详细日志 |
| **根因** | `src-tauri/src/lib.rs` 已添加 stderr 捕获，但 Rust 二进制未重新编译 |
| **解决** | 在 `kimi-code-swarm/src-tauri` 执行 `cargo build` |

---

## 五、新 Agent 接入指引

## 五、当前状态（新 Agent 必读）

本文档记录的是 **PR #1 ~ PR #3 时期的问题**，所有问题已通过代码重构解决。新 Agent 无需按下方旧指引操作。

当前系统行为：
1. `autoSubmitForReview` 会自动处理 pre-commit 失败（全量日志回传修复，最多 3 轮）
2. PR 创建后会自动启动 CI 监控，CI 失败时自动修复并重新提交（最多 3 轮）
3. `runInstructionSilent` 设有 120s 超时保护，防止 Kimi CLI 挂死

**避坑**: 
- 修改 Vue 组件时，同步检查 `doc-map.json` 映射的文档，避免 `check-docs-sync` 失败
- 新增 `src/` 代码文件时，**必须**同步在 `tests/` 添加测试，避免 `check-test-sync` 失败
