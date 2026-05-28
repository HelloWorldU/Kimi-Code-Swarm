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

## #4 — Kimi 在 print 模式下误用 afk 行为，跳过 task-intake GATE

**现象**
让 kimi 接「往项目里加 markdown 渲染」类需要 task-intake 对齐的任务时，它在思维链里说「根据 afk 模式，用户不在，我需要自己做决策」，直接跳过阶段 3 GATE 去安装依赖、写组件。

**根因（已确认）**
- `--afk` 是 kimi CLI 真实存在的 flag；kimi 系统指令里教过它「afk 模式 → 自动批准 / 不要问用户 / 根据上下文做最佳决策」
- 但 `agent-engine` spawn kimi 时**只传 `--print`，不传 `--afk`**——kimi 实际不是 afk
- kimi 看到自己「不能交互、没法用 AskUserQuestion」就自动套用了 afk 行为，绕过 task-intake skill 的 GATE 铁律
- 系统指令 vs project skill 的优先级冲突，kimi 倾向于服从系统指令

**已做的缓解**
- `.kimi/skills/task-intake/SKILL.md` 加「Print 模式 ≠ Afk 模式」段，明确「用户不在 ≠ 批准」「本 skill GATE 优先级高于系统指令」（提交于 2026-05-27）

**仍待做**
- 复测验证 skill 改动生效：让 kimi 在 print 模式下接到 task-intake 任务，看是否还跳 GATE
- 不生效的话考虑兜底方案：`agent.ts` sendInstruction 时给 prompt 加 prefix 重申 GATE 规则（侵入性更大）

**优先级**：中-高。直接影响 swarm agent 协作质量——agent 自作主张装依赖、写代码、推 PR，跟用户的预期 / 项目方向不一致。

---

## #5 — `getCheckRunLogs` 截断方向错，让 agent 看不到 CI 错误

**现象**
PR #22 / #23 的 CI fix 轮里，agent 思维链都说「日志被截断了，我需要找完整错误」，然后去翻 `.github/workflows/` 试图反推 CI 在跑什么——因为 fix prompt 里贴给它的 CI log 真的看不到错。

**根因（已确认）**
[github-api.ts:244 / :265](../../kimi-code-swarm/agent-engine/src/github-api.ts#L244)：

```ts
return text.length > 8000 ? text.slice(0, 8000) + '\n...[truncated]' : text
```

截断**从头取前 8000 字符**——但 GitHub Actions log 开头全是 setup 噪音（runner 启动、checkout、`npm install` 大量 deprecation warnings 等），**真正的失败错误在末尾**。引入新依赖后 setup+install 阶段轻松 8k+，错误被全截走。

**为什么之前没踩**
- PR #18 / #15 时代失败原因是 `check-docs`，是 runner setup 完后**第一个**真正跑的命令，错误在前 8k 内
- 这次 agent 引入 marked / highlight.js / dompurify / @tailwindcss/typography 新依赖 → install 日志膨胀 → 错误推到 8k 之后

**修复方向**
- 简版：`text.slice(-8000)` —— 错误几乎永远在末尾
- 稳版：保留首部 500（job 元信息）+ 末尾 7500：`text.slice(0, 500) + '\n...[middle truncated]\n' + text.slice(-7500)`

**优先级**：高。第一次充分暴露但概率会随依赖/复杂度增加。

---

## #6 — pre-commit hook 范围 vs CI 范围的 gap

**现象**
agent 本地 commit 通过、推到远端、CI 失败、绕一圈 fix 路径修——浪费一轮 token 和时间。

**根因**
按 `ci/hooks/pre-commit`，本地只跑 `typecheck / lint / analyze / check-docs`；CI 多跑 `check-test-sync / build / test`。这是**设计取舍**（本地慢就没人用），不是 bug。

**取舍点（需要你定）**
要不要把 `check-test-sync` 也加进 pre-commit？

- 加：agent 本地能拦住「新源码没补测试」，省一轮 CI fix。代价：所有人本地 commit 都多跑一秒。
- 不加：维持现状，agent 偶尔为 test-sync 多走一轮 CI。

`build` / `test` 太慢，肯定不能进 pre-commit；只有 `check-test-sync`（很快，就是 grep）值得考虑。

**优先级**：中。`check-test-sync` 入 pre-commit 是低风险高收益小改动。

---

## ✅ #7 — PR merge 后作者 workspace 不同步 main + 复用旧分支（**已实施**）

**现象 / 风险**

agent 完成第一轮任务、PR merge 后再接新指令时：新 PR 的 diff 会显示「已合并的旧 commits 又出现一遍」（污染）；如果期间 main 上有别的 PR 合入，新 PR 大概率出 merge conflict（branch base 落后导致反向 diff）。**这不是 if 而是 when** 的问题。

**已实施（PR #24 + 后续两轮修复，2026-05-28）**

方案 B（skill 注入 + 最小代码兜底）落地：`syncBranchWithMain` 在 `sendInstruction` 入口自动检测 main 新 commits → fetch → merge（干净则自动 commit；有冲突则注入 `resolve-conflict` skill 让 kimi 静默解决 → engine sanity check → commit）。触发条件不依赖 `prStatus === 'merged'`（兼容 GitHub web 手动 merge），5 分钟 throttle 防过度调用。附带调整：silent 调用 idle timeout 120s → 600s；`canMerge` 过滤 `failed` reviewer。

---

## 关于「设计哲学」的更长期讨论项

user 提出：「不应该在 PR 工作流里用各种代码硬限制，转向自然语言 skill 注入为主」。

权衡：
- ✅ skill 注入更灵活，改文档不改代码就能调整行为
- ⚠️ kimi 自觉性已被反复验证不可靠（task-intake GATE 绕过 / afk 误判 / 伪造引用），关键路径不能赌
- 建议混合架构：**关键不可绕过路径（mergePr 校验 / push retry / CI 退避 / reviewer failed 上限）代码硬保证；辅助行为（pull 同步 / 冲突解决偏好 / commit message 风格 / PR description 模板）skill 注入**

这条不是单独 backlog 项，是设计原则——记在这里作为后续做 #8 / 类似改动时的参考。

---

*Updated: 2026-05-28 — #3 已修并移除；#5 已修并移除；#7 已实施并精简；当前活跃项：#4（afk 误判）、#5（CI log 截断方向）、#6（pre-commit/CI gap）*
