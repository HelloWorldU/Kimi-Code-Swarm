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

## ✅ #3 — Agent workspace pre-commit hook 根本没注册（**已修**）

**现象**（PR #18 / #23 两次复现）
agent 改源码忘改对应文档（按 doc-map 应触发 check-docs 拦截）→ 本地 commit 直接通过 → push 出去 → GitHub CI 上 check-docs 才报错。

**真根因**（2026-05-28 实测确认）
agent workspace 是 `git clone` 出来的，**没跑 `npm install`** → `scripts/setup-hooks.js`（postinstall 脚本）从未执行 → workspace 的 `core.hooksPath` 没设。git commit 时默认找 `.git/hooks/`（空目录），**没 hook 可跑** → commit 直接通过。`ci/hooks/pre-commit` 文件虽在 workspace 里存在但没注册到 git config，形同虚设。

之前我误诊为「Windows shell hook 找不到 sh.exe / silent skip」是因为当时用 kimi 在一个**碰巧跑过 `npm install`** 的旧 workspace 测试，hook 能拦。新建 workspace 没跑 npm install，hook 路径就没设。

**修复**（2026-05-28）
`git.ts.cloneRepo` 在 clone 完后追加一行 `git config core.hooksPath ci/hooks`——跟 `setup-hooks.js` 做的事一样，零开销。所有新 agent workspace 自动注册 pre-commit hook。

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

## #5 — 引擎自动注入的 fix prompt 应明确区分用户指令（已部分修，待观察）

**现象**
CI 自动修复 / pre-commit 失败修复 / 审阅拒绝修复 三处引擎自动调 `sendInstruction(fixPrompt)`，prompt 含大段 CI 日志或 git 输出。原实现里这些都被当成 `'input'` log 写入，结果：
- AgentDetail 「任务指令」区被引擎注入的 fixPrompt 覆盖（lastInput pick 到它）
- 聊天面板出现巨大的「用户消息气泡」装着 CI 日志，看起来像用户发的

**已修复（提交于 2026-05-27）**
- `sendInstruction` 加 `opts.displayAsUserInput`；fix path 三处传 `false` → log type 用 `'system'` 不污染 lastInput
- `isUserVisibleLog` patterns 加「自动修复 / 自动修改开始 / 正在根据执行日志自动修复」让用户能看到引擎触发提示
- kimi 的 think / tool_call / output 仍通过 agent-stream 实时显示

**仍待观察**
- 真机验证：fix path 触发时「任务指令」区保持用户原指令、聊天面板看不到巨大 fixPrompt 气泡、但能看到「CI 失败，第 X/Y 轮自动修复...」提示 + kimi 修复过程流式可见
- 如果有未覆盖的引擎注入路径（PR review reject prompt 等），同样要补 `displayAsUserInput: false`

**优先级**：低。已修主要场景，留作观察项。

---

## #6 — `getCheckRunLogs` 截断方向错，让 agent 看不到 CI 错误

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

## #7 — pre-commit hook 范围 vs CI 范围的 gap

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

*Updated: 2026-05-28 — #3 真根因确认（hookspath 没注册）+ 已修；新增 #6 CI log 截断方向 + #7 pre-commit/CI gap；Bug F 修复验证生效（PR #23 reviewer 失败 3 次正确标 failed，无需在 backlog 追踪）*
