# Backlog: 已知可优化项

> 下次开工的入口。每条包含**现象 / 根因 / 修复方向 / 优先级**四项，落地后从本文件移除。
>
> 不收：已落地项、kimi 工程能力本身的局限（如 commit message 美化）、不在 swarm 方案范围的遗留。

---

## 🎯 架构决策项（最高优先级）

**核心判断**：engine 当前是一个不断 patch 的隐式 PR 状态机，而不是多 Agent 协作的 control plane。

**正确的职责划分**：

| 层 | 负责什么 | 不做什么 |
|---|---|---|
| **engine** | 多 Agent lifecycle / inter-agent routing / token 计量 / 持久化 / 硬门控 | 不主动编排任何 workflow，不追踪 git 细节状态 |
| **Agent + SKILL** | 工作流全程：commit / push / 查 CI / 处理 review / sync / merge | 通过 Kimi CLI 自身工具能力执行 git/gh 命令 |
| **GitHub / Git** | 外部事实源：PR 状态 / CI 结果 / review comment | — |

**PR 状态在 GitHub，agent 去读；PR 工作流在 SKILL，agent 去跑。engine 只看宏观：谁在 reviewing、谁 busy、谁 failed。**

**LLM 在关键决策点介入（RPI）**：Research（只读摸清现状）→ Plan（写出下一步，重大判断等确认）→ Implement（调工具执行）。工具执行本身是确定性代码。

**硬门控永远由 engine 保证**（不可 LLM 绕过）：reviewer failed 上限、merge 资格校验、token 预算。

**完整执行计划**：[`docs/exec-plans/engine-to-control-plane.md`](engine-to-control-plane.md)

**当前阶段**：阶段 0 已完成。下一步 → 阶段 1：写 `.kimi/skills/pr-workflow/SKILL.md`。

---

## 🐛 活跃 Bug

当前无活跃 bug。（#1-#5 已随 PR #29 修复；#4 F5 刷新已随 a4cc2d1 修复）

---

*Updated: 2026-05-29 — Bug #4 F5 刷新已修复并移除；架构决策项关联 exec-plan；活跃 bug 清零。*
