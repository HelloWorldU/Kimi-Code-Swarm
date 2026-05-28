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

**风险**：kimi 自觉性已被反复验证不可靠（task-intake GATE 绕过 / afk 误判）。**只下放辅助行为**，硬门控（不可绕过的 merge 资格检查、reviewer failed 上限）仍由 engine 兜底。

**下一步**：先写一份 exec-plan 列出当前 engine 里所有 git 触点 + 拟下放路径 + 保留的兜底集合，对齐后再动代码。

---

## 🐛 活跃 Bug

### #1 — `submitReview` 丢失 reviewer 的具体评论

**现象**
PR #25 流程里 reviewer agent 给出了详细修改建议（如「按钮会随聊天内容滚走，建议放到 wrapper 外」），但 engine-state.json 里 `reviews[].comment` 字段全部缺失，前端 agent 收到的 fix 指令只剩 fallback「审阅未通过」空字符串，kimi 无据可改。

**根因（源码确认）**
- [agent.ts:1074-1117 submitReview](kimi-code-swarm/agent-engine/src/agent.ts#L1074-L1117)：收到 `comment` 参数后**只用来拼 GitHub API 的 reviewBody**（1081 / 1091 / 1105 行），写入 review 记录时（1113-1114）只 set `status` 和 `reviewedAt`，**遗漏 `review.comment = comment`**。
- [agent.ts:1473 fixBasedOnReviews](kimi-code-swarm/agent-engine/src/agent.ts#L1473)：读 `r.comment || '审阅未通过'` → 永远 `undefined` → fallback「审阅未通过」→ kimi 拿到 0 信息无据可改。

**修复方向**
1114 行后追加一行：`review.comment = comment`。

**优先级**：高。直接让 review→fix 闭环失效。

---

### #2 — `stop()` 不级联取消 async 链

**现象**
fixBasedOnReviews 进入循环后按「停止」按钮无反应；点多次也停不下，kimi 进程被 kill 但下一轮 `sendInstruction → autoSubmitForReview` 仍按计划起来。

**根因**
`stop()` 只 kill 当前 kimi 子进程，不取消 engine 里的异步链（fixBasedOnReviews → 等 reviewer → 再 sendInstruction → autoSubmitForReview）。没有 cancellation token / AbortSignal 贯穿。

**修复方向**
agent 上挂 `AbortController`，stop 时 abort；所有 await 链入口检查 `signal.aborted` 直接 throw / return。或更彻底——下放到 agent skill 后，停止只需 kill 进程即可，不再有 engine 编排的异步链。

**优先级**：高。用户能感知到「按钮坏了」。

---

### #3 — `syncBranchWithMain` 同步成功却报「同步提交失败」

**现象**
PR squash merge 后下一次 sendInstruction 触发 sync，UI 红字「同步提交失败」+ pre-commit 输出，但 pre-commit 自己写「✅ pre-commit 检查通过」，互相打架。

**根因**
[agent.ts:936-946](kimi-code-swarm/agent-engine/src/agent.ts#L936-L946)：`gitMerge` 在 git 默认行为下成功时已自动建 merge commit，紧接着代码又调 `gitCommit('sync: merge origin/main')` —— 此时无暂存内容 → `nothing to commit` → exit 1 → 误报。squash merge 场景必触发（agent 分支 A+B+C ≡ main 的 squash commit S，merge 必为 clean）。

**修复方向**
删掉 merge 成功后的 `gitCommit` 调用，直接 `this.log('system', '已同步 ...') + return true`。

**优先级**：中。同步实际成功，纯 UI 噪音，但加重 "engine 修不完" 感受。归并到 [架构决策项] 整体下放更彻底。

---

### #4 — F5 刷新 dashboard 后 agents 不可见

**现象**
登录后按 F5，所有 agent 卡片消失。需「退出 → 重登」或杀 engine 重启 App 才能恢复。

**根因**
F5 走 `bootstrap()`，`isEngineRunning()=true` → `startAgentEngine` 跳过 spawn → engine 不会重发 `agent-created` 序列 → `state.agents` 空。前端没有「engine 已活着，把 agents 拉回来」的命令。

**修复方向**
engine 新增 `list-agents` 命令：收到后全量 emit `agent-created` + `engine-restored`，复用现有事件链；前端在 `running=true` 分支里发这条命令。

**优先级**：中。开发体验 + 生产用户都会踩。

---

### #5 — `getCheckRunLogs` 截断方向错（PR #28 重现）

**现象**
CI fix 轮里 agent 思维链都说「日志被截断了，找不到完整错误」，反翻 `.github/workflows/` 反推 CI 在跑什么。PR #28 那次：fix prompt 里 8KB 窗口前面全是 git config / fetch refs / setup auth 噪音，真错误 `ERR_MODULE_NOT_FOUND: @typescript-eslint/typescript-estree` 完全被截走，kimi 是靠自己另起 tool call 去 GitHub 拉完整 log 才查出根因。

**根因**
[github-api.ts:244 / :265](kimi-code-swarm/agent-engine/src/github-api.ts#L244)：`text.slice(0, 8000)` 取前 8k 字符 —— 但 GitHub Actions log 开头全是 setup 噪音（runner 启动 / checkout / `npm install` deprecation warnings），**真正错误在末尾**。引入新依赖后 setup+install 轻松 8k+，错误被全截走。

**修复方向**
- 简版：`text.slice(-8000)` —— 错误几乎永远在末尾
- 稳版：首部 500（job 元信息）+ 末尾 7500 + 中间 `[middle truncated]` 标记

**优先级**：高。今晚 PR #28 再次证明不是偶发，会随依赖/复杂度增加越来越频繁。

---

*Updated: 2026-05-28 — 新增架构决策项 + 4 个活跃 bug（review.comment 丢失 / stop 不级联 / sync 误报 / F5 失踪）+ 重新收回 #5（CI log 截断方向，PR #28 重现）。*
