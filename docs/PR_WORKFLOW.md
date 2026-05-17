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

## 6. 验收清单（修复后验证用）

### 审阅触发
- [ ] Agent A 自动执行完指令 → PR 创建 → 其他 ready Agent 自动审阅
- [ ] 手动点击"提交审阅"和自动流程行为一致
- [ ] 单 Agent 创建 PR → 进入 pending 队列 → 创建新 Agent B → B 自动审阅
- [ ] Agent B 在 working 时被指派为 reviewer → B 完成自身任务恢复 ready → B 自动补审阅

### 审阅结果处理（以 GitHub 为准）
- [ ] GitHub API 返回满足 required approvals → 自动合并 → 状态变为 completed
- [ ] GitHub API 返回 changes requested / review 不足 → 自动修改 → 重新提交 → 重新审阅（最多 3 轮）

### GitHub 真实同步
- [ ] reviewer 审阅通过后，GitHub PR 页面上显示 "Approved" review
- [ ] reviewer 审阅拒绝后，GitHub PR 页面上显示 "Requested changes" review
- [ ] GitHub review body 包含 kimi 的审阅意见（comment）
- [ ] 打开 PR 链接能看到所有 reviewer 的审阅记录
- [ ] `canMerge()` 改为查询 GitHub API（`GET /pulls/{prNumber}` 或列出 reviews），以 GitHub 返回的真实 review 状态为合并依据
- [ ] App 内 reviews 状态与 GitHub PR 的 review 状态一致（或允许 GitHub 领先）

---

*Document created: 2026-05-17*
