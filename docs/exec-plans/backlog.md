# Backlog: 已知可优化项

> 下次开工的入口。每条包含**现象 / 根因 / 修复方向 / 优先级**四项，落地后从本文件移除。
>
> 不收：已落地项、kimi 工程能力本身的局限（如 commit message 美化）、不在 swarm 方案范围的遗留。

---

## 🎯 架构决策项（最高优先级）

**核心判断**：当前 engine 不是在做"运行时"，而是在充当一个不断 patch 的隐式 PR 状态机。每遇到一个边界场景就继续打补丁，是症状，不是根因。

**正确的职责划分**：

| 层 | 职责 | 不做 |
|---|---|---|
| **engine** | 多 Agent 宿主：lifecycle / inter-agent routing / token 计量 / 持久化 / 工具执行 | 不主动编排任何 workflow |
| **Agent + SKILL** | 工作流主体：决定何时 commit / push / 读 CI / 处理 review / merge | 不绑定 engine 内部状态 |
| **GitHub/Git** | 外部事实源 | — |

**设计原则**：

- **engine = 有原则的工具箱，不是有主见的助手**。git 操作由 agent 发起调用，engine 提供工具、执行验证、报错清楚，不替 agent 决定"该不该 commit"。
- **PR 状态在 GitHub，agent 去读**。engine 不需要追踪 CI 是否失败、reviewer 说了什么——那些在 GitHub API 上，agent 用工具去查。
- **协调路由是 engine 真正该做的**。"谁有空来审这个 PR"、"哪个 agent 在 reviewing"——这类多 Agent 调度才是 engine 的独特价值。
- **硬门控仍由 engine 保证**。reviewer failed 上限、merge 资格校验——这些确定性规则不能依赖 LLM 自觉，engine 硬保证。
- **LLM 只在关键决策点介入（RPI 框架）**。agent 先 Research（只读，摸清现状），再 Plan（写出下一步），再 Implement（调工具执行）。业务规则是确定性代码，判断时机是 LLM。

**动因**（为什么现在要改）：
- autoSubmitForReview 无法区分"agent 本轮产物"和"旧 working tree 残留" → 残留文件被强推 PR
- syncBranchWithMain 在 squash merge 后调多余的 gitCommit → 误报"同步失败"
- stop() 只 kill 叶子进程，不取消外层 async chain → 按钮假死
- 这些 bug 每一个都是 engine 替 agent 做编排决策的副作用，patch 没有终点

**迁移路径（渐进，不一刀切）**：
1. 先写 PR 工作流 SKILL，把 autoSubmitForReview / fixBasedOnReviews / syncBranchWithMain 的行为转成 agent 可读的自然语言规范
2. engine 暴露细粒度工具命令（git_add / git_commit / git_push / get_ci_status / get_pr_reviews）
3. 逐步撤掉 engine 的自动触发逻辑，改由 agent 通过 SKILL 主动调用
4. 最终 engine 只保留：lifecycle + routing + 工具执行 + 硬门控

**下一步**：写一份 exec-plan，列出 engine 当前所有 workflow 触点 + 拟暴露的工具 API + 保留的硬门控集合，对齐后再动代码。

---

## 🐛 活跃 Bug

### #4 — F5 刷新 dashboard 后 agents 不可见

**现象**
登录后按 F5，所有 agent 卡片消失。需「退出 → 重登」或杀 engine 重启 App 才能恢复。

**根因**
F5 走 `bootstrap()`，`isEngineRunning()=true` → `startAgentEngine` 跳过 spawn → engine 不会重发 `agent-created` 序列 → `state.agents` 空。前端没有「engine 已活着，把 agents 拉回来」的命令。

**修复方向**
engine 新增 `list-agents` 命令：收到后全量 emit `agent-created` + `engine-restored`，复用现有事件链；前端在 `running=true` 分支里发这条命令。

**优先级**：中。开发体验 + 生产用户都会踩。

---

*Updated: 2026-05-28 — 架构决策项保留；#1 review.comment / #2 stop 不级联 / #3 sync 误报 / #5 CI log 截断方向 已随 PR 修复并移除；当前活跃 1 个 bug（#4 F5 失踪）。*
