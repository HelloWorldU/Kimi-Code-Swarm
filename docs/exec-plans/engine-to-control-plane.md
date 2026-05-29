# Exec-Plan: Engine → Control Plane 迁移

> 状态：**草稿，待对齐后执行**
> 目标：把 engine 从"隐式 PR 状态机"还原为"多 Agent 协作 control plane"

---

## 一、问题根因（一句话）

当前 `agent.ts` / `engine.ts` 把 PR 工作流的编排逻辑写死成代码：检测文件变更就自动 commit/push、CI 失败就自动 fix、review 拒绝就自动改、merge 后自动 sync main。每增加一种边界场景就打一个 patch，bug 没有终点。

根本原因：**engine 在做 agent 该做的判断**。

---

## 二、目标架构

```
┌─────────────────────────────────────────────────────┐
│  UI（展示状态 + 人工介入入口）                        │
└──────────────────────┬──────────────────────────────┘
                       │ IPC
┌──────────────────────▼──────────────────────────────┐
│  Engine（Control Plane）                             │
│  ✅ 保留：agent lifecycle / inter-agent routing      │
│  ✅ 保留：token 计量 / 持久化 / UI 事件流             │
│  ✅ 保留：硬门控（reviewer failed 上限 / merge 资格） │
│  ❌ 移出：所有 workflow 自动触发逻辑                  │
└──────────────────────┬──────────────────────────────┘
                       │ spawn + stdio
┌──────────────────────▼──────────────────────────────┐
│  Kimi CLI（Agent 执行层）                            │
│  通过自身 tool/shell/MCP 能力执行：                   │
│  git status / add / commit / push                    │
│  gh pr create / gh pr checks / gh api               │
│  读 CI 日志 / 处理 review comment / 解 conflict      │
│  由 SKILL 指导何时做、怎么做                          │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  GitHub / Git（外部事实源）                           │
│  PR 状态 / CI 结果 / review comment 都在这里          │
└─────────────────────────────────────────────────────┘
```

**关键原则**：
- PR 状态在 GitHub，agent 去读，engine 不维护镜像状态机
- git 操作由 agent 发起（通过 Kimi CLI 的工具能力），engine 不包 git wrapper
- engine 只观察宏观结果（"这个 agent 的 PR 当前是 reviewing / blocked / merged"），不追踪细节
- LLM 在关键决策点介入（RPI 框架：Research→Plan→Implement），工具执行是确定性代码

---

## 三、当前 engine 的 workflow 触点（全量清单）

### agent.ts — 待迁移

| 方法 | 当前行为 | 迁移方向 |
|------|---------|---------|
| `autoSubmitForReview()` | 检测文件变更 → 自动 git add/commit/push + 创建 PR | 移出。由 agent 在 SKILL 指引下主动调用 commit/push 工具 |
| `syncBranchWithMain()` | sendInstruction 入口检测 main 落后 → 自动 fetch/merge/commit | 移出。agent 自己决定何时 sync，SKILL 指引处理冲突 |
| `fixBasedOnCi()` | CI 失败 → 自动拉日志 → 发 fix prompt → 重新提交（最多 3 轮） | 移出。agent 自己轮询 CI、读日志、决定是否修复 |
| `fixBasedOnReviews()` | review 拒绝 → 自动构造 fix prompt → 重提 PR（最多 3 轮） | 移出。agent 读 review comment 后自己决定改法 |
| `performReview()` | reviewer agent 跑 kimi CLI 审阅 diff → 回传 approve/reject | **保留**。这是 inter-agent routing，是 engine 的核心职责 |

### engine.ts — 待迁移

| 方法/逻辑 | 当前行为 | 迁移方向 |
|----------|---------|---------|
| `triggerReviews()` | submit-for-review 命令 → 自动指派所有空闲 agent 去审阅 | **保留**（多 Agent 调度）。但触发时机改为由 agent 主动 submit-for-review |
| `handleReviewVerdict()` | reviewer 回传后自动判断 merge 或启动 fixBasedOnReviews | **部分保留**：merge 资格校验（硬门控）保留；自动启动 fixBasedOnReviews 移出 |
| `retryDeferredReviews()` | 每 60s 轮询，找 pending reviewer 重试 | **保留**（routing 可靠性）|
| `reviewRetryTimer` | 上面的定时器 | **保留** |

---

## 四、保留的硬门控（不可由 LLM 绕过）

| 门控 | 位置 | 说明 |
|------|------|------|
| reviewer failed 上限（MAX_REVIEW_ATTEMPTS=3） | engine.ts handleReviewVerdict | 审阅多次跑不通标 failed，不再重试，等人工 |
| merge 资格校验（canMerge） | agent.ts mergePr | 所有 active reviewer 必须 approved 才能 merge |
| token 预算耗尽强制停止 | agent.ts sendInstruction | 不允许超预算继续跑 |
| 前端 engineReady 门控 | useSwarmStore.ts | engine restore 完成前禁用所有操作按钮 |

---

## 五、需要新增/重写的 SKILL

### 5.1 PR Workflow SKILL（新建）

`.kimi/skills/pr-workflow/SKILL.md`

指导 agent 自主完成完整 PR 生命周期，采用 **RPI 框架**：

```
R（Research）— 只读，不操作
  - git status / git log，了解当前工作区状态
  - gh pr view，了解当前 PR 状态
  - gh pr checks，查 CI 结果
  - gh pr comments / gh api reviews，读 reviewer 意见

P（Plan）— 写出下一步，等确认
  - 判断：该 commit 什么？CI 失败要改什么？reviewer 说的要不要改？
  - 明确写出拟执行动作，遇重大判断等指挥官确认

I（Implement）— 执行工具调用
  - git add / git commit / git push
  - gh pr create / 更新 PR body
  - 修改代码应对 CI 失败或 review 拒绝
```

硬约束（必须写进 SKILL）：
- Research 阶段禁止任何写操作（git add / commit / write file）
- 每轮 Implement 完成后回到 Research 重新评估，不假设"一次成功"
- 遇到 merge conflict → 加载 resolve-conflict SKILL
- 不确定要不要改某条 review → 先 Research 读全部 reviewer 意见，Plan 里列出理由，再 Implement

### 5.2 resolve-conflict SKILL（已有，确认够用）

当前 `.kimi/skills/resolve-conflict/SKILL.md` 覆盖了冲突解决的基本流程，在 PR Workflow SKILL 中引用即可。

### 5.3 commit SKILL（已有，确认够用）

当前 `.kimi/skills/commit/SKILL.md` 覆盖 git add/commit 流程。

---

## 六、迁移步骤（渐进，不一刀切）

### 阶段 0（已完成）
- [x] 修复 review.comment 丢失（PR #29）
- [x] syncBranchWithMain 删多余 gitCommit（PR #29）
- [x] Bug #4 F5 刷新修复（list-agents 命令）

### 阶段 1：写 PR Workflow SKILL（低风险，纯新增）
- 写 `.kimi/skills/pr-workflow/SKILL.md`，覆盖 RPI 框架下的完整 PR 流程
- 不动 engine 代码，先让 agent 可以按 SKILL 走流程
- **验证**：派一个 agent 手动走一遍全流程，确认 SKILL 够用

### 阶段 2：移出 autoSubmitForReview（engine 减法，单点）
- 删 `agent.ts` 里的 `autoSubmitForReview` 自动触发调用
- sendInstruction 完成后不再自动检测变更并提交，改为 agent 自主决定
- 对应：engine 只保留 `submit-for-review` IPC 命令作为人工/agent 主动触发入口
- **验证**：确认 agent 按 SKILL 能完成 commit → push → submit-for-review 全链路

### 阶段 3：移出 fixBasedOnCi / fixBasedOnReviews（engine 减法）
- 删自动 CI fix loop 和 review fix loop
- agent 通过 SKILL 自己轮询 CI 状态、读 review comment、决定是否修改
- **验证**：CI 失败场景 + review 拒绝场景各跑一遍

### 阶段 4：移出 syncBranchWithMain（engine 减法）
- 删 sendInstruction 入口的自动 sync 调用
- 由 PR Workflow SKILL 的 Research 阶段指导 agent 自己检查并 sync
- **验证**：PR merge 后再接新任务，确认 agent 能自己处理 sync

### 阶段 5：engine 清理
- 确认 `agent.ts` 里 git 相关导入（gitAdd / gitCommit / gitPush 等）是否还有 engine 主动调用的路径，有则移出
- 保留 `cloneRepo` / `createBranch`（agent 启动时 engine 帮 clone，这是 lifecycle 职责，不是 workflow）

---

## 七、迁移后 engine IPC 命令集（预期）

**保留**：
- `create-agent` / `start-agent` / `stop-agent` / `delete-agent` — lifecycle
- `send-instruction` — agent 执行入口
- `submit-for-review` — agent 主动触发 review（不再自动触发）
- `submit-review` — reviewer agent 回传结果（routing）
- `merge-pr` / `reject-pr` — 人工介入 / agent 请求 merge（硬门控在这里）
- `get-file-diff` — UI 展示用
- `list-agents` / `ping` / `shutdown` — 运维命令

**可能移出**（待阶段 2-4 验证后决定）：
- git 相关的内部调用路径（但 IPC 命令本身可能不需要变，只是 engine 不再主动调用）

---

*Created: 2026-05-29*
*Next action: 写 `.kimi/skills/pr-workflow/SKILL.md`（阶段 1），验证 agent 能按 SKILL 自主走完 PR 流程后，再做阶段 2。*
