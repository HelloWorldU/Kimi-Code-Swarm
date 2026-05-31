# Engine → Control Plane 重构工作日志

> 记录重构过程中每轮的发现、决策和改动，方便随时回溯。

---

## 背景

Engine 当前把 PR 工作流（commit → push → CI 监控 → 自动 fix → review → merge）写死成代码。每增加一个边界场景就打一个 patch，bug 没有终点。

正确的职责：engine 只管 agent lifecycle / inter-agent routing / 硬门控；工作流全程由 agent 自主执行，SKILL 提供指引。

---

## 第一轮

### 发现的问题（读 agent.ts / engine.ts）

**问题 1：`sendInstruction` 尾部自动触发完整工作流链**（agent.ts:525-548）

kimi 跑完后，sendInstruction 内部检测到文件变更就自动调 `autoSubmitForReview`，从而引爆 `commit → push → CI 监控 → fix loop → review` 整条链。调用方无法控制是否触发，也无法在中间暂停。

**问题 2：`FIX_PROMPT_GIT_GUARD` 是架构破窗的证据**（agent.ts:42-43）

```ts
const FIX_PROMPT_GIT_GUARD = '\n\n**重要约束：只修改文件，不要运行 git...**'
```

三处 fix prompt 都注入这个约束，目的是阻止 agent 自己跑 git——因为 engine 要代劳。系统需要用 prompt 来限制 LLM 维持自身控制权，说明控制权分配本身就错了。正确架构里不需要这个常量。

**问题 3：engine 维护了三套工作流执行状态**（agent.ts:50-57）

```ts
private reviewRound = 0        // review fix 轮次（上限 3）
private autoSubmitting = false // 防 autoSubmit 重入
private ciRetryCount = 0       // CI retry 计数
```

这三个是工作流执行状态，混入了 agent lifecycle 状态（`pending/ready/working/reviewing`）。engine 不应该知道"现在是第几轮 CI 修复"。

**问题 4：`startCiMonitor` — engine 在跑外部 polling loop 并直接决策**（agent.ts:687-737）

engine 用 `setInterval` 轮询 GitHub CI，CI 失败时自己构造 fix prompt 注入 LLM。"观察外部事实"和"做决策"都在 engine 里，agent 是被动执行者，不是主动决策者。

**问题 5：`syncBranchWithMain` 在 `sendInstruction` 入口隐式运行**（agent.ts:320-323）

每次用户发指令前，engine 自动 fetch + merge + 解冲突，注释里称"对 UI 透明"。隐藏的前置工作流让调试极难，调用方不知道自己的指令触发了什么。

**问题 6：`onPrCreated` 回调形成 Agent → Engine 的反向耦合**（agent.ts:75, engine.ts:50）

Agent 创建 PR 后需要"叫回" Engine 触发 review 调度，形成循环依赖。说明工作流边界本身就不清晰。

**补充发现（读 IPC 层后）**：`submit-for-review` IPC 命令和 UI 按钮一直存在（store.ts:593, AgentDetail.vue:604），用户点"提交审阅"就会触发 `triggerReviews`。`onPrCreated` 只是 `autoSubmitForReview` 绕过按钮的自动路径。只要删掉 `notifyPrCreated()` 的调用，`onPrCreated` 自然成为死代码，问题 6 随问题 1 一并消失，不需要单独处理。

---

### P — 改动方向

#### 核心判断

6 个问题都指向同一件事：**`sendInstruction` 完成后会自动引爆整条工作流链**。
只要这条链在，其他所有问题（重试状态、CI polling、FIX_PROMPT_GIT_GUARD）都是维持它运转的补丁。

所以方向是：**切断这条链，把工作流决策权还给 agent。**

---

#### 什么保留，什么移出

**保留**（engine 的合法职责）：

| 代码 | 原因 |
|------|------|
| `performReview` + `runReview` | inter-agent routing，这正是 control plane 应做的 |
| `triggerReviews` / `retryDeferredReviews` | 多 agent 调度，同上 |
| `handleReviewVerdict` 的 merge 门控部分 | 硬门控，不可 LLM 绕过 |
| `canMerge` | 合并资格校验，硬门控 |
| token 预算检查 | 硬门控 |
| `submitForReview` 中的 setStatus + notifyPrCreated | 状态流转是 engine 职责 |

**移出**（不该在 engine 里的）：

| 代码 | 移出理由 |
|------|---------|
| `sendInstruction` 尾部的 `autoSubmitForReview()` 调用 | 工作流不该被指令完成自动触发 |
| `autoSubmitForReview` 整个方法 | 由 agent 按 SKILL 自主决定何时提交 |
| `syncBranchWithMain` 从 `sendInstruction` 入口移出 | agent 自己决定何时 sync，不应是隐式前置步骤 |
| `startCiMonitor` / `fixBasedOnCiFailure` | agent 自己轮询 CI、决定是否修复 |
| `fixBasedOnReviews` + `handleReviewVerdict` 里的调用 | agent 自己读 review comment、决定怎么改 |
| `FIX_PROMPT_GIT_GUARD` 常量及三处注入 | 约束存在的前提（engine 管 git）消失后自然消亡 |
| `reviewRound` / `autoSubmitting` / `ciRetryCount` 字段 | 工作流执行状态，不属于 lifecycle |
| `submitForReview` 里的 git add/commit/push/createPR 逻辑 | git 操作由 agent 通过 kimi CLI 自己执行 |

---

#### 关键依赖：更新现有 SKILL，不需要新建

已有 commit / push / resolve-conflict SKILL，agent 在任务中自然参考。
不需要新建 pr-workflow SKILL，只需修正现有 SKILL 里指向 engine 行为的描述：

- **push SKILL 第 48-52 行**"与 CI 的协作"描述的是 engine 的 `startCiMonitor`，engine 删了之后这段失效 → 改成 agent 自己用 `gh pr checks` 轮询
- review 拒绝处理当前无任何 SKILL 覆盖，全在 engine 的 `fixBasedOnReviews` → 需在 push SKILL 或单独补充一段

**✅ R 补充已解决**：review routing 信号不会断。`submit-for-review` IPC 命令 + UI 按钮本来就存在，用户点"提交审阅"直接触发 `triggerReviews`。`onPrCreated` 只是 `autoSubmitForReview` 的自动绕路，删掉 `notifyPrCreated()` 调用后它自动成为死代码。

---

#### 分阶段顺序

**阶段 A — ✅ 完成**：更新所有 PR 工作流相关 SKILL

按 OpenAI skill 结构重写三个 SKILL：
- push SKILL：CI + review 改为 agent 自主处理，merge 保留 engine 门控
- commit SKILL：结构对齐，内容不变
- resolve-conflict SKILL：澄清"不执行 git 命令"仅限冲突标记解决阶段，结构对齐

---

**阶段 B — ✅ 完成**：切断 `sendInstruction` 自动链

改动点（agent.ts）：
- 删 321 行 `syncBranchWithMain()` 调用及其 return 分支
- 删 541-543 行 `autoSubmitForReview()` 调用及其 log
- 新增 log：`'检测到代码变更，可点击提交审阅'`
- 删 `autoSubmitForReview` 整个方法（780-821 行）
- 删 `syncBranchWithMain` 整个方法（910 行起）
- 清理注释：328 / 669 / 767 / 777 行
- 删 `autoSubmitting` / `lastSyncCheckAt` / `SYNC_THROTTLE_MS` 字段

改动范围仅限 agent.ts，不波及 engine.ts、前端、IPC 层。

---

**阶段 C — ✅ 完成**：删 CI 自动修复 + Stage B 遗留死代码

agent.ts：
- 删 9 个字段（50/53/56/57/58/59/60/67/68）：`reviewRound`、`autoSubmitting`、`ciMonitorTimer`、`ciRetryCount`、`CI_MAX_RETRIES`、`CI_POLL_INTERVAL_MS`、`CI_TIMEOUT_MS`、`lastSyncCheckAt`、`SYNC_THROTTLE_MS`
- 删 `stop()` 里的 `this.stopCiMonitor()` 调用（540 行）
- 删 `submitForReview` 里两处 `this.startCiMonitor(githubToken)` 调用（630、649 行）
- 删 `startCiMonitor` 整个方法（674-723）
- 删 `stopCiMonitor` 整个方法（729-733）
- 删 `fixBasedOnCiFailure` 整个方法（739-770）
- 删 `autoSubmitForReview` 整个方法（757-796，Stage B 遗留死代码）
- 删 `syncBranchWithMain` 整个方法（887+，Stage B 遗留死代码）
- 删 `fixBasedOnReviews` 整个方法（1436-1475）

engine.ts：
- 删 `delete-agent` 里的 `agent.stopCiMonitor()` 调用（113 行）
- 删 `handleReviewVerdict` 里的条件块（286-292）：`hasPending`/`hasFailed` + `fixBasedOnReviews`，`!canMerge` 时直接 return

注：`ciStatus` 状态字段在前端无消费，删方法后变死状态，留阶段 D 清理。

---

**阶段 D — ✅ 完成**：submitForReview 瘦身 + 清理死代码

R 确认：

**设计决策**：`submitForReview` 不再做 git 操作，改为"找到 agent 已创建的 PR 并注册状态"。需在 `github-api.ts` 新增 `getPullRequestByBranch(token, repoUrl, branch)` — 调 `GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open`，取第一条。mock 模式（无 token）照旧模拟。

**`notifyPrCreated` 已是重复调用**：engine.ts:179 在 `submit-for-review` handler 里已直接调 `triggerReviews`，`notifyPrCreated` 形成双重调用，可直接删。

**`syncBranchWithMain` Stage C 未删**：仍在代码里（含 `FIX_PROMPT_GIT_GUARD` at 812、`gitCommit` at 884），Stage D 一并清理。

agent.ts：
- 删 `syncBranchWithMain` + `finalizeMergeCommit` 整个方法（若仅被其调用）
- 删 `FIX_PROMPT_GIT_GUARD` 常量定义
- `submitForReview` 改造：删 git add/commit/push/createPR 逻辑（563-603），调 `getPullRequestByBranch` 注册已有 PR；返回类型从 `{ ok: boolean; steps: SubmitStep[] }` 改为 `{ ok: boolean }`
- 删 `SubmitStep` interface（9-14 行）
- 删 `generateCommitAndPrBody` 方法（1070+）
- 删 `notifyPrCreated` 方法（890）及 `onPrCreated` 字段（65）
- 清理 imports：`gitAdd`、`getStagedFiles`、`gitCommit`、`gitPush`、`createPullRequest`（确认无其他用处后）
- 清理 `ciStatus` 相关字段及持久化（state 定义、businessFingerprint、fromPersisted）

engine.ts：
- 删 `create-agent` 和 `restoreAgent` 里的 `onPrCreated` 参数（50、390 行）

github-api.ts：
- 新增 `getPullRequestByBranch(token, repoUrl, branch)` 函数
  - 调 `GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open`，取第一条
  - 每个 agent 有唯一分支名（`agent/${slug}-${id}`），多 agent 并发不冲突，每条分支只会有一条 open PR

**阶段 D 遗留清理项 — ✅ 完成**

---

*Started: 2026-05-31*
