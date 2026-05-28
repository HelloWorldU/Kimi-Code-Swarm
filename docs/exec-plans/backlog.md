# Backlog: 已知可优化项

> 下次开工的入口。每条包含**现象 / 根因 / 修复方向 / 优先级**四项，落地后从本文件移除。
>
> 不收：已落地项、kimi 工程能力本身的局限（如 commit message 美化）、不在 swarm 方案范围的遗留。

---

## 🎯 架构决策项（最高优先级）

**方向**：engine 收缩为运行时，git/PR 全流程交给 agent 通过 SKILL 自管。

**动因**：累积的 git 相关 engine bug（#4 / #5 / #6 / #7 都是 engine 替 agent 操心 git 状态机的副作用）证明 "engine 越打补丁越多" 的论断。每次 squash merge / 异常 review / 用户打断都对应一个新的 edge case，engine 永远追不齐。

**思路**：
- engine 保留：进程生命周期 / Kimi CLI spawn / stdout 流转 / token 计量 / 持久化
- engine 移出：自动 git add/commit/push / autoSubmitForReview / syncBranchWithMain / fixBasedOnReviews / mergePr
- 上述行为下放到 `.kimi/skills/` 下的工作流 skill（commit / push / sync / review-fix / merge），agent 自己判断、自己执行

**下一步**：先写一份 exec-plan 列出当前 engine 里所有 git 触点 + 拟下放路径 + 保留的兜底集合，对齐后再动代码。

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
