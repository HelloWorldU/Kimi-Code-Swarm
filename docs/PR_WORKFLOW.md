# PR 工作流场景文档

> PR 审阅门控的完整场景、当前行为与期望行为对照。以 **GitHub 分支保护规则** 为唯一事实源，App 内部状态跟随 GitHub。用于功能对齐和测试验证。

---

## 1. 正常流程（多 Agent 已创建，全部 ready）

### 触发条件
Agent A 执行指令完成，检测到文件变更。

### 当前行为（手动提交审阅路径 ✅）
```
前端点击"提交审阅"
  → sendToEngine({type: 'submit-for-review'})
  → engine.assignReviewers(allAgents)  // 排除自己
  → agent.submitForReview()            // git + PR 创建
  → 遍历 reviews，每个 reviewer.performReview()
  → 各 reviewer 运行 kimi CLI 审阅 diff
  → reviewer 回调 submitReview(approved/rejected)
  → 全部 approved → mergePr() → completed
  → 有 rejected → fixBasedOnReviews() → 重新提交（最多 3 轮）
```

### 当前行为（自动流程路径 ❌）
```
sendInstruction 完成
  → autoSubmitForReview()
  → agent.submitForReview()     // 只做了 git + PR 创建
  → ❌ 没有 assignReviewers
  → ❌ 没有触发 performReview
  → PR 创建后无 reviewer 介入，永远停在 reviewing
```

### 期望行为
自动路径和手动路径行为完全一致：PR 创建后自动指派 reviewer、触发审阅、处理结果。合并决策以 GitHub API 返回的真实 review 状态为准，不强制要求 App 内全员通过。

---

## 2. 单 Agent 场景

### 触发条件
只有一个 Agent A，执行指令完成并创建 PR。

### 当前行为
```
assignReviewers([A]) → 排除自己后为空数组
→ PR 进入 pendingReviews 队列
→ 日志："当前无可用审阅者，进入待审队列等待新 Agent 加入"
```

### 后续行为
创建新 Agent B 时：
```
create-agent B
→ 检查 pendingReviews
→ A 的 reviews 列表追加 B（pending）
→ B.performReview(A.branch, A.id, ...)
→ B 审阅完成后 submitReview
```

### 期望行为
单 Agent → PR 创建 → `assignReviewers` 返回空数组 → 进入 `pendingReviews` 队列 → **必须等待创建新 Agent B** → B 审阅 approve → GitHub 满足 required approvals → 才能合并。

**不存在"单 Agent 直接合并"的场景**（除非仓库未开 "Require approvals"，但那样审阅门控无意义）。

---

## 3. 非 ready Agent 场景

### 触发条件
Agent A 创建 PR 时，Agent B 处于 `working` / `stopped` / `completed` 等非 ready 状态。

### 当前行为
```
assignReviewers(allAgents)
→ B 被加入 reviews 列表（status: 'pending'）
→ B.performReview() 被调用
→ B 检查 this.state.status !== 'ready' → 跳过
→ 日志："当前状态 working，跳过自动审阅"
→ B 的 review entry 永远停留在 'pending'
```

### 设计缺口
B 后续恢复 `ready` 后，**不会自动补审阅**。A 的 PR 永远等不到 B 的结果，卡在 `reviewing` 状态。

### 期望行为
**取消"全员通过"强制要求。** 合并决策以 GitHub 分支保护规则为准：
- 如果 GitHub 已满足 required approvals（如仓库设置只需 1 个），即使 B 未审阅也可合并
- B 恢复 `ready` 后是否补审阅，不影响合并决策，仅作为补充审阅
- 如果仓库设置了 "dismiss stale reviews"，重新 push 后会重置 review 状态，此时需要重新审阅

---

## 4. 状态机对照

| 状态 | 可执行操作 | 限制 |
|------|-----------|------|
| ready | 接收指令、被指派为 reviewer | — |
| working | 执行指令中 | **不能**审阅他人 PR |
| reviewing | 等待审阅结果 | 合并按钮受 reviews 状态控制 |
| stopped | 可恢复对话 | **不能**审阅他人 PR（performReview 跳过） |
| completed | 任务结束 | **不能**审阅他人 PR |

### 关键缺口
`stopped` / `completed` 状态的 Agent 被加入 reviews 列表后，performReview 直接跳过。**不再强制要求全员通过，以 GitHub API 查询的 review 状态为合并依据。**

---

## 5. GitHub PR Review 真实同步

### 触发条件
Reviewer Agent 完成 `performReview`，回调 `submitReview(approved, comment)`。

### 当前行为 ❌
```
performReview 返回 {approved, comment}
→ 回调只传递 approved（布尔值），comment 被丢弃
→ submitReview() 只更新内存状态：review.status = 'approved'
→ 日志输出："Agent「xxx」审阅通过了此 PR"
→ ❌ 没有调用 GitHub API
→ ❌ GitHub PR 页面上没有任何 review 记录
→ ❌ 打开 PR 链接看不到任何评论或 approve 标记
```

### 期望行为 ✅
```
performReview 返回 {approved, comment}
→ 回调传递 approved + comment
→ submitReview() 更新内存状态
→ 调用 GitHub API: POST /repos/.../pulls/{prNumber}/reviews
   {
     "event": "APPROVE" | "REQUEST_CHANGES",
     "body": comment  // kimi 的审阅意见（如 "LGTM" 或具体问题描述）
   }
→ GitHub PR 页面上显示真实的 review 记录
→ 内部状态与 GitHub 状态保持一致
```

### 链路缺口明细

| 环节 | 当前 | 期望 |
|------|------|------|
| `github-api.ts` | 无 `submitPullRequestReview` | 新增 API 封装 |
| `performReview` 回调 | `(reviewerId, targetId, approved)` | `(reviewerId, targetId, approved, comment)` |
| `submitReview` 签名 | `(reviewerAgentId, approved)` | `(reviewerAgentId, approved, comment?)` |
| `submitReview` 实现 | 只改内存 | 先调 GitHub API，再改内存 |

---

## 6. 自审场景（单账号多工作区）

### 场景描述
用户只有一个 GitHub 账号（如 `HelloWorldU`），通过多个本地工作区并行开发。每个 Agent 使用同一个 GitHub Token：
- Agent A 完成代码变更 → 创建 PR（作者为 `HelloWorldU`）
- Agent B 被指派审阅 → 调用 GitHub API 提交 APPROVE review

### 问题
GitHub REST API 返回 **422 Unprocessable Entity**：
```
"Review Can not approve your own pull request"
```
因为 reviewer 和 PR 作者使用的是同一个 GitHub 账号，GitHub 不允许自审。

### 解决
#### 身份缓存
创建/复用 PR 时通过 `GET /user` 获取当前 Token 对应的 GitHub 用户名，**在 Agent 实例上缓存一次**（`githubUser`）。一个会话内 token 不变，避免每次 `canMerge` / `submitReview` 重复调用 `/user`。

#### 合并决策
`canMerge()` 中识别自审场景：
1. 若 `githubUser` 已缓存且 `prAuthor` 存在：
   - `githubUser === prAuthor` → 自审，以 **内部 reviews 状态** 为合并依据
   - `githubUser !== prAuthor` → 多人协作，查询 GitHub API reviews
2. 若 `githubUser` 未获取到（网络抖动/限流）→ **fail-open**，回退到内部 reviews 状态，避免合并被静默卡死
3. 调用 `mergePullRequest` 时，GitHub 会因为用户是仓库管理员而自动 **bypass 分支保护规则**

#### 审阅意见同步（proactive COMMENT）
`submitReview` 调用 GitHub API **之前**先用缓存的 `githubUser` 与 `prAuthor` 做 proactive 判断：

```
githubUser === prAuthor
  → 自审场景：直接发送 COMMENT review（不先发 APPROVE 猜 422）
     {
       "event": "COMMENT",
       "body": "[自审] 自动审阅通过\n\n> 注：GitHub 不允许 PR 作者 approve 自己的 PR，此评论仅作为审阅记录。"
     }
  → PR 页面上显示 review comment（非 approved 标记）

githubUser !== prAuthor
  → 多人协作：正常发送 APPROVE / REQUEST_CHANGES
```

优势：不猜 GitHub 错误字符串（避免文案变更导致失效），通过/不通过行为一致（都发 COMMENT），且省掉一次注定失败的 APPROVE 请求。

### 行为对照

| 场景 | `submitReview` GitHub 行为 | `canMerge` 判断逻辑 | 合并方式 |
|------|---------------------------|---------------------|----------|
| 多人协作（prAuthor ≠ 当前用户）| 正常发送 APPROVE / REQUEST_CHANGES | 查询 GitHub API reviews，需满足 required approvals | 正常合并 |
| 自审（prAuthor = 当前用户）| **proactive 直接发送 COMMENT** | 内部 reviews 全部 approved 即可 | 管理员权限 bypass 合并 |
| 身份获取失败（githubUser 为 null）| 正常发送 APPROVE / REQUEST_CHANGES | **fail-open：回退到内部 reviews** | 内部审阅通过即可合并 |

### 关键日志
```
[Agent] 自审场景：内部 review 全部通过，准备通过管理员权限合并
[GitHub] 自审场景：审阅意见已作为 comment 发布到 GitHub PR
[GitHub] PR #x 已合并到 main（GitHub）
```

---

## 7. 验收清单（修复后验证用）

### 审阅触发
- [x] Agent A 自动执行完指令 → PR 创建 → 其他 ready Agent 自动审阅（review-flow-fixes A 已修）
- [x] 手动点击"提交审阅"和自动流程行为一致（review-flow-fixes A 已修）
- [ ] 单 Agent 创建 PR → 进入 pending 队列 → 创建新 Agent B → B 自动审阅
- [ ] Agent B 在 working 时被指派为 reviewer → B 完成自身任务恢复 ready → B 自动补审阅（设计缺口：非 ready Agent 恢复后不会自动补审阅）

### 审阅结果处理（以 GitHub 为准）
- [x] GitHub API 返回满足 required approvals → 自动合并 → 状态变为 completed（review-flow-fixes C-2 已修：mock 不自动合，真实自动合）
- [ ] GitHub API 返回 changes requested / review 不足 → 自动修改 → 重新提交 → 重新审阅（最多 3 轮）

### GitHub 真实同步
- [ ] reviewer 审阅通过后，GitHub PR 页面上显示 "Approved" review（`submitReview` 未调用 GitHub API POST reviews，仅更新内存状态）
- [ ] reviewer 审阅拒绝后，GitHub PR 页面上显示 "Requested changes" review（同上，未同步到 GitHub）
- [ ] GitHub review body 包含 kimi 的审阅意见（comment）
- [ ] 打开 PR 链接能看到所有 reviewer 的审阅记录
- [ ] `canMerge()` 改为查询 GitHub API（`GET /pulls/{prNumber}` 或列出 reviews），以 GitHub 返回的真实 review 状态为合并依据
- [ ] App 内 reviews 状态与 GitHub PR 的 review 状态一致（或允许 GitHub 领先）

### 自审场景（单账号多工作区）
- [ ] Agent A 创建 PR → Agent B（同一 GitHub 账号）审阅 → `submitReview` 发送 APPROVE 被 422 拒绝
- [ ] 422 拒绝后自动降级为发送 `COMMENT` review，PR 页面可见审阅记录
- [x] `canMerge` 识别 `prAuthor === 当前用户`，以内部 reviews 状态为合并依据（review-flow-fixes 附带修复已过滤 `failed` reviewer）
- [ ] 内部审阅全部通过后自动调用 `mergePullRequest`，GitHub 管理员权限 bypass 分支保护
- [ ] PR 成功合并，状态变为 `completed`，远程分支自动清理

---

## 7. 已知设计缺口：硬编码路径

### 当前问题
以下路径在核心代码中硬编码，换机器/盘符/安装位置后功能失效：

| 位置 | 硬编码值 | 用途 | 影响 |
|------|---------|------|------|
| `agent.ts:147` | `E:/workspace` | Agent 工作目录根 | 换盘符后无法创建工作空间 |
| `engine.ts:112` | `E:/workspace/${id}` | delete-agent 时清理目录的 fallback | 清理到错误位置或失败 |
| `kimi.ts:8` | `C:\Python312\Scripts\kimi.exe` | Kimi CLI 探测路径 | Python 装在其他位置时找不到 CLI |
| `lib.rs` | `C:\nvm4w\nodejs\node.exe` | Node.js 探测路径 | 非 nvm-windows 用户找不到 node |

### 期望行为
- 工作目录根路径：从配置读取（如 `~/.config/kcs/workspace` 或用户自定义）
- 外部工具路径：环境变量 > 配置 > 自动探测 > 友好报错，禁止硬编码绝对路径
- 只有 `tests/` 中允许硬编码路径（测试用例隔离、可预期）

### 原则（vllm 经验）
> **非 `tests/` 代码禁止包含硬编码绝对路径**。路径应通过配置、环境变量或运行时探测获取。这是可移植性的底线。

---

*Document updated: 2026-05-28 — 同步 review-flow-fixes 实施状态，验收清单标注已修复项，补充 GitHub 真实同步缺口说明*
