# PR Workflow Architecture Issues

> 记录时间：2026-05-27
> 范围：PR 创建、CI 监控、审阅、修复、合并的核心工作流
> 目标：记录当前设计问题，作为后续重构 PR Workflow 模块的依据

## 背景

PR 是 Kimi-Code-Swarm 的核心闭环：Agent 完成任务后自动提交代码、创建 PR、等待 CI、触发其他 Agent 审阅、根据结果修复或合并。

当前实现已经具备完整功能，但 bug 频繁集中在 PR 链路上。问题不只是单个函数缺少判断，而是 PR 业务规则分散在多个模块中，导致状态、事实源、自动路径和手动路径互相穿插。

## 当前症状

- 自动提交和手动提交的行为曾经不一致：手动路径能指派 reviewer，自动路径可能只创建 PR 后停在 `reviewing`。
- 真实 PR 可能因为漏传 `githubToken` 走到 mock merge。
- CI 失败后的自动修复曾经在 UI 中不可见，用户无法判断 Agent 是否真的在工作。
- reviewer 不可用时，review entry 可能长期停在 `pending`。
- PR 被打回后，UI 文案暗示 Agent 会继续修改，但实际只是状态切换，仍需要用户发送新指令。
- 合并判断在内部 reviews、GitHub reviews、自审 fallback、mock 模式之间切换，边界复杂。

这些症状共同指向一个问题：PR 工作流缺少单独的一等模块和明确状态机。

## 结构性问题

### 1. Agent 承担了过多职责

`kimi-code-swarm/agent-engine/src/agent.ts` 同时负责：

- Kimi CLI 执行与流式输出
- git add / commit / push
- PR 创建与 mock PR 降级
- CI 轮询与失败修复
- reviewer 指派
- 自动审阅执行
- review 结果同步 GitHub
- merge 判断与合并
- PR 打回后的状态切换

这让 `Agent` 既是执行者，又是 PR 编排器、GitHub 策略层、CI 控制器和状态机。一个类承担太多业务角色后，局部修 bug 很容易影响其他路径。

### 2. Agent 状态和 PR 状态混用

当前 `AgentState.status` 包含：

```ts
pending | cloning | ready | working | reviewing | completed | stopped
```

这些状态同时表达两件事：

- Agent 自身是否可执行任务
- 当前 PR 是否处于审阅或完成阶段

例如：

- `working` 表示 Agent 正在执行指令，但也被用作 PR 被打回后的状态。
- `reviewing` 表示目标 Agent 的 PR 在审阅中，但 reviewer 自己处于 `reviewing` 时又被允许执行审阅。
- `completed` 既可能表示任务完成，又会影响是否还能作为 reviewer。

结果是 review 能否执行、PR 能否合并、Agent 能否继续接收指令，都依赖同一个状态字段的局部解释。

### 3. 自动路径和手动路径不是单一入口

手动提交路径大致是：

```text
engine submit-for-review
  -> agent.submitForReview()
  -> engine.triggerReviews()
```

自动路径大致是：

```text
agent.sendInstruction()
  -> agent.autoSubmitForReview()
  -> agent.submitForReview()
  -> notifyPrCreated callback
  -> engine.triggerReviews()
```

两条路径最后都想表达“创建 PR 后进入审阅”，但入口、时序、错误处理不同。只要其中一条漏掉 reviewer 指派、CI 触发或 token 传递，就会产生行为分叉。

PR 工作流应当有一个统一编排入口，例如：

```text
workflow.submit(agentId, mode)
```

手动和自动只应该是触发来源不同，不应该复制或绕过编排步骤。

### 4. 事实源不稳定

文档中已经倾向以 GitHub 分支保护规则和 GitHub PR review 为事实源，但实现中存在多个事实源：

- GitHub API 的 PR / review / check runs
- Agent 内部的 `reviews`
- 前端 Store 中的 mock reviews
- `pendingReviews` 队列
- 自审场景下的内部 reviews fallback
- 无 token 场景下的 mock PR

这些事实源在不同路径中有不同优先级。比如：

- 多人协作时 `canMerge()` 查 GitHub reviews。
- 自审时 `canMerge()` 回退内部 reviews。
- 身份获取失败时 fail-open，继续回退内部 reviews。
- 前端按钮是否可点又可能基于 `reviews.every(...)`。

这会导致 UI、Engine、GitHub 三者对“是否可合并”的答案不完全一致。

### 5. Real / Mock 模式是隐式分支

当前很多逻辑通过 `githubToken` 是否存在决定真实 GitHub 模式还是 mock 模式。

这种设计的风险是：漏传 token 不会立刻失败，而是悄悄切到 mock 行为。已有问题中“真实 PR 最后走 mock merge”就是这个风险的直接表现。

更稳妥的方式是把模式显式建模：

```ts
type PrRuntimeMode = 'github' | 'mock'
```

工作流入口需要明确模式。真实 PR 模式下缺 token 应该报错，而不是自动降级。

### 6. 前端 Store 也维护了一套 PR 业务逻辑

`kimi-code-swarm/src/store/useSwarmStore.ts` 在非 Tauri 模式下会自己模拟：

- 创建 reviewers
- 创建 mock PR
- 判断 merge
- submit review
- reject PR

这对浏览器 demo 有价值，但长期看会让前端逻辑和 Engine 逻辑分叉。测试如果覆盖的是前端 mock 行为，不一定能保护真实 Engine 工作流。

建议将浏览器模式也尽量复用同一套纯状态机或 workflow reducer，只替换 GitHub/Git/Kimi 等外部端口。

### 7. 缺少中心 PR 状态机

当前 PR 阶段散落在多个字段和计数器中：

- `status`
- `prStatus`
- `ciStatus`
- `reviews`
- `pendingReviews`
- `reviewRound`
- `ciRetryCount`

但没有一个中心模型表达 PR 生命周期：

```text
idle
  -> submitting
  -> pr_open
  -> ci_pending
  -> ci_failed
  -> fixing_ci
  -> review_pending
  -> fixing_review
  -> merge_ready
  -> merging
  -> merged
  -> failed
```

缺少状态机后，每个函数都在局部判断“现在该做什么”。随着分支增加，bug 会持续产生。

### 8. 测试没有完全锁住 PR 场景

当前集成测试覆盖了 Engine 生命周期，但 PR 工作流里的复杂场景还不够系统化：

- 自动提交路径和手动提交路径一致性
- 单 Agent 无 reviewer 时进入 pending 队列
- 新 Agent 加入后补审
- reviewer busy 后延迟重试
- CI fail 后自动修复并重新提交
- GitHub review 同步成功 / 失败
- 自审场景下 COMMENT 降级
- mock 模式下禁止自动 merge
- 漏传 token 时真实模式必须失败

这些应当从 `docs/PR_WORKFLOW.md` 转成可执行测试。

## 典型 Bug 与设计根因

| 现象 | 直接原因 | 设计根因 |
|------|----------|----------|
| 自动 PR 创建后没有 reviewer 介入 | 自动路径未完整复用手动路径的 reviewer 编排 | 自动/手动路径不是单一工作流入口 |
| 真实 PR 走 mock merge | `submit-review` 漏传 `githubToken` | real/mock 由 token 隐式决定 |
| reviewer pending 卡住 | reviewer 当前状态不可审，后续补审机制不完整或不明显 | Agent 状态和 PR 状态混用 |
| CI 修复黑盒运行 | 使用 silent runner | CI 修复属于 workflow 阶段，但没有统一事件模型 |
| PR 打回后文案误导 | `rejectPr()` 只切状态，不触发修复 | PR 状态转移和用户动作语义未明确区分 |

## 建议的重构边界

不建议重构整个项目。建议只把 PR 工作流从 `Agent` / `AgentEngine` / Store 中抽出来，形成独立模块。

建议目录：

```text
kimi-code-swarm/agent-engine/src/pr-workflow/
  state.ts
  policy.ts
  orchestrator.ts
  ports.ts
  events.ts
```

### state.ts

定义 PR workflow 的状态、事件和阶段。

重点是把 Agent 执行状态和 PR 状态拆开：

```ts
type AgentRuntimeStatus = 'pending' | 'cloning' | 'ready' | 'working' | 'stopped'
type PrWorkflowStatus =
  | 'none'
  | 'submitting'
  | 'open'
  | 'ci_pending'
  | 'review_pending'
  | 'fixing'
  | 'merge_ready'
  | 'merging'
  | 'merged'
  | 'failed'
```

### policy.ts

集中处理策略判断：

- 是否可以 merge
- real/mock 模式行为差异
- 自审场景如何处理
- GitHub review 状态如何折算
- CI timeout 后是否继续审阅
- reviewer 不可用时是否等待或跳过

### orchestrator.ts

唯一负责编排：

```text
submit -> push -> create PR -> wait CI -> trigger reviews -> handle verdict -> fix or merge
```

`AgentEngine` 调用 orchestrator，不再自己拼流程。`Agent` 提供执行能力，不再决定 PR 策略。

### ports.ts

把外部依赖作为端口注入：

- Git port
- GitHub port
- Kimi runner port
- Timer port
- Logger/event port

这样 workflow 可以做纯逻辑测试，不需要真实 GitHub、真实 git 或真实 Kimi CLI。

## 不建议做的事

- 不建议继续在 `agent.ts` 中追加 PR 分支判断。
- 不建议让前端 Store 继续复制 Engine 的 PR 业务规则。
- 不建议让 `githubToken?: string` 继续隐式决定 real/mock。
- 不建议一次性重写 Agent Engine、前端和 Tauri IPC。
- 不建议在没有状态机测试前大规模移动代码。

## 后续行动清单

1. 先修当前已知 PR 体验 bug，避免在重构前继续积累干扰项。
2. 将 `docs/PR_WORKFLOW.md` 的验收清单转成测试用例。
3. 新建 `pr-workflow` 模块，先实现纯状态机和 policy 测试。
4. 让手动提交和自动提交都走同一个 orchestrator 入口。
5. 显式引入 `PrRuntimeMode`，真实模式下缺 token 直接失败。
6. 将 `Agent` 中的 CI、review、merge 编排逐步迁移到 workflow。
7. 前端 Store 只消费 Engine 事件，browser mock 模式复用 workflow reducer。
8. 更新 `docs/ARCHITECTURE.md` 和 `docs/STATUS.md`，声明 PR Workflow 成为独立模块。

## 核心结论

当前 PR 工作流 bug 多的根因不是“实现不够细”，而是边界不清：

- PR 业务规则没有独立模块。
- Agent 执行状态和 PR 生命周期混在一起。
- 自动/手动路径没有统一入口。
- GitHub、内部 reviews、mock 状态多事实源并存。
- real/mock 模式由 token 隐式触发。

后续重构应聚焦一个目标：**把 PR Workflow 抽成独立、可测试、单入口的状态机和编排层**。Agent 负责执行，Engine 负责命令和事件，Store 负责展示，GitHub 作为明确外部事实源。
