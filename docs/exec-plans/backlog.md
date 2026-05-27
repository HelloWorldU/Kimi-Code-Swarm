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

## #3 — Agent commit 走 Node child_process 时 pre-commit hook 是否漏跑（D，根因待复现）

**现象**
PR #18 commit 5abd95d 只改了 `AgentDetail.vue` + `useSwarmStore.ts`，按 doc-map 必触发 frontend-components + frontend-store 文档同步规则——但 commit 通过推到了 GitHub。CI 上的 check-docs 拦住了，本地 pre-commit hook 当时没拦。

**根因调查（不明）**
最初假设：Node `execFileAsync('git', ...)` 派生的子进程在 Tauri GUI app 启动场景下 PATH 不含 `sh.exe` → shell hook 静默跳过。但 agent workspace 实测两路径都跑通 hook + 被拦：
- `git commit` 交互式：被拦，exit 1
- `node -e "execFile('git', ['commit', ...])"`：被拦，exit 1

复现失败。剩下候选假设：
1. agent 在 fix 阶段用 Bash 工具调了 `git commit --no-verify`（FIX_PROMPT_GIT_GUARD 是软约束，kimi 可无视）
2. PR #18 commit 那一刻 `core.hooksPath` 配置丢了（config 修改 reflog 看不出来）
3. `pre-commit` 文件在那一刻被替换 / 缺失

**下次复现时主动收集**
- agent commit 前后的 `git config --get core.hooksPath` 输出
- `ci/hooks/pre-commit` 的 `ls -la` + mtime
- agent commit 命令完整 stderr（hook 跳过时 git 有诊断）
- 可能在 git.ts `gitCommit` 加 `GIT_TRACE=1` 临时环境变量调试

**优先级**：低-中。当前 CI 兜底拦得住，本地 hook 漏拦只是浪费一次 push；但下次再发生时应该立刻抓数据。

---

*Updated: 2026-05-27 — 完成 review/merge 流程六个 bug（A/B/C-1/C-2/E/F，见 `review-flow-fixes.md`）；D 转入本文件待复现*
