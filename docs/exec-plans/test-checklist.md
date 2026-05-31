# Engine → Control Plane 重构测试清单

> 重构完成后需要验证的场景，覆盖核心路径和边界。

---

## 自动化测试结果

✅ **全部 45 个测试通过，8 个文件**（2026-05-31）

---

## 说明

- ✓ **代码已验证**：通过代码审查或集成测试确认，无需运行 App
- ⬜ **需要运行 App**：需要真实 Kimi CLI 额度才能验证
- 第 4、5 节（multi-agent review routing、push SKILL 自主流程）需要 Kimi CLI 运行，额度就绪后补测

---

## 1. sendInstruction 不再自动触发工作流

- ✓ agent 执行任务完毕，工作区有文件变更 → UI 显示"提交审阅"按钮，**不**自动 commit/push/review（`autoSubmitForReview` 调用已删除）
- ⬜ agent 执行任务完毕，工作区无变更 → 无任何自动触发，状态回到 ready
- ✓ 发送多条指令连续工作 → 每条完成后仍停在 ready，不自动提交（`sendInstruction` 无尾部触发链）

---

## 2. submitForReview 新流程

- ⬜ agent 通过 push SKILL 已创建 PR → 用户点"提交审阅" → engine 查 GitHub API 找到 PR → 注册 prNumber/prUrl/prAuthor → 状态变 reviewing → review routing 触发
- ✓ 用户点"提交审阅"时 agent 尚未创建 PR（PR 不存在） → engine 查不到 PR → 合理处理不 crash（`getPullRequestByBranch` 返回 null 后 `submitForReview` 继续 setStatus，不抛异常）
- ✓ 无 GitHub Token（mock 模式） → 点"提交审阅" → 模拟 PR 号生成 → review routing 正常触发（mock 路径代码完整保留）
- ⬜ 多个 agent 同时处于 ready + 有变更 → 各自点"提交审阅"互不干扰，各自拿到自己分支的 PR

---

## 3. Engine 硬门控仍然生效

- ✓ token 预算耗尽 → sendInstruction 被拒，状态不再前进（硬门控代码未改动，集成测试覆盖）
- ✓ review 存在 pending 条目时点"合并" → 合并被拒（`canMerge` 逻辑未改，集成测试覆盖）
- ⬜ 所有 reviewer approved → 可以合并
- ⬜ 存在 failed reviewer（审阅跑不通）→ 不阻塞合并（fail-open 逻辑）
- ⬜ 无 GitHub Token 且 reviewer 全 approved → UI 显示"手动点合并"提示，不自动 merge

---

## 4. Multi-agent review routing

> ⬜ 全节需要 Kimi CLI 额度

- ⬜ agent A 提交审阅 → engine 自动指派 agent B 为 reviewer → B 的 performReview 跑起来
- ⬜ 提交时无其他 agent 可用 → 进入 pendingReviews 队列 → 新 agent 创建后自动被指派
- ⬜ reviewer B 正在 working → 延后重试，等 B 空闲后 retryDeferredReviews 触发
- ⬜ reviewer 审阅失败达到 MAX_REVIEW_ATTEMPTS → 标 failed，不再重试，等人工

---

## 5. Push SKILL agent 自主流程

> ⬜ 全节需要 Kimi CLI 额度

- ⬜ agent 按 push SKILL 提交代码 → CI 触发 → agent 自己用 `gh pr checks` 轮询
- ⬜ CI 失败 → agent 读日志、修复代码、重新 push → CI 重跑（最多 3 轮）
- ⬜ CI 连续失败超 3 轮 → agent 停止并向指挥官报告
- ⬜ reviewer 拒绝 PR → agent 读全部 review 意见 → 逐条处理 → push → 等新一轮 review
- ⬜ review 意见有歧义 → agent 列出选项等指挥官确认，不擅自决定

---

## 6. 持久化与恢复

- ⬜ agent 处于 reviewing 状态时重启 engine → 恢复后状态仍是 reviewing，prNumber 正确
- ⬜ agent 处于 working 状态时重启 engine → 恢复后状态变 ready（进程已死，合理降级）
- ⬜ reviews 数组在重启后正确还原（reviewer 状态不丢失）
- ⬜ F5 刷新前端 → list-agents 命令拉回全量状态，UI 正确显示

---

## 7. 边界与异常

- ✓ GitHub API 不可达 → `getPullRequestByBranch` 返回 null → submitForReview 合理处理，不 crash
- ✓ agent 已 merged → 再次点"提交审阅" → 正确拒绝（`submitForReview` 状态检查未改动）
- ⬜ 删除正在 reviewing 的 agent → 相关 pendingReviews 清理，不留孤儿记录

---

*Created: 2026-05-31 | Updated: 2026-05-31*
