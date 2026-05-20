# Backlog: 已知可优化项

> 下次开工的入口。每条包含**现象 / 根因猜测 / 修复方向 / 优先级**四项，落地后从本文件移除（迁入对应 exec-plan 或随 PR 一起删）。
>
> 不收：已落地项、kimi 工程能力本身的局限（如 commit message 美化）、不在 swarm 方案范围的遗留（见 `engine-persistence.md` § 不在本方案范围）。

---

## #1 — F5 刷新 dashboard 后 agents 不可见

**现象**
登录后在 dashboard 按 F5 整页刷新，所有 agent 卡片消失。需重新「退出登录 → 重登」或杀 engine 重启 App 才能恢复。

**根因猜测**
F5 走的是 `bootstrap()`，但 `isEngineRunning()` 返回 true → `startAgentEngine` 跳过 `spawnAgentEngine` → engine 子进程不会重新 emit `agent-created` 序列 → `state.agents` 永远是空数组。前端没有「engine 已活着、把当前 agents 拉回来」的命令。

**修复方向**
任选其一：
- engine 端新增 `list-agents` 命令：收到后把当前 `this.agents` 全量 emit `agent-created` + 末尾 emit `engine-restored`，复用现有事件链
- 或：复用 `ping`，让 engine 回 pong 时附带 agent id 列表，前端缺啥再发 `get-agent-state`
- 前端 `startAgentEngine` 在 `running=true` 分支里发上面任一命令拉回数据

**优先级**:中。影响开发体验（每次 HMR / 调试刷新都丢卡片），生产用户也会踩。

---

## #2 — orphan agent 删除时工作目录不清

**现象**
对 orphan 状态的 agent 点删除，前端从列表移除了，但 `E:/workspace/<agent-id>` 工作目录仍然在磁盘上。

**根因猜测**
`delete-agent` 命令发到 engine 后，engine 在 `this.agents` Map 里查不到这个 id（orphan 本来就是「引擎不认」的状态），早期分支直接 `agents.delete + break`，不触发目录清理那一段（[engine.ts:104-108](kimi-code-swarm/agent-engine/src/engine.ts#L104-L108)）。

**修复方向**
engine 收到未知 id 的 `delete-agent` 时，按命名规则 `E:/workspace/<agentId>` 兜底走一次目录清理流程（已有的 `rm -rf` + Windows fallback 那段抽出来复用），不依赖 `agent.state.workspace`。

**优先级**：低。orphan 本身就是边缘场景（用户手动删 `engine-state.json` 或 cache/engine 不一致才会出现），磁盘残留可手动清理。

---

*Updated: 2026-05-20*
