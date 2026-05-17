# PR 工作流问题记录

> PR #1 ~ #3 时期的历史问题。**已全部解决**，新 Agent 无需操作。

## 问题 1：check-docs-sync 频繁阻断 `git commit`

- **根因**：`autoSubmitForReview` 最初只传 `err.message`（单行摘要）给 Kimi CLI，Agent 看不到 pre-commit 完整输出，导致盲猜修复
- **修复**（2026-05-14）：`git.ts` 返回完整 `GitResult`，`autoSubmitForReview` 将 stdout + stderr + exit code 全量回传

## 问题 2：check-test-sync 阻断 PR CI

- **根因**：新增 4 个代码文件（2 组件 + 2 composables）未补充测试
- **修复**（PR #3，2026-05-14）：补充 `useConfirm.spec.ts` 和 `useToast.spec.ts`

## 当前系统行为

1. `autoSubmitForReview` 自动处理 pre-commit 失败（全量日志回传，最多 3 轮）
2. PR 创建后自动启动 CI 监控，失败时自动修复重试（最多 3 轮）
3. `runInstructionSilent` 设 120s 超时保护

## 避坑

- 修改 Vue 组件时同步检查 `doc-map.json` 映射
- 新增 `src/` 代码文件时必须同步在 `tests/` 添加测试
