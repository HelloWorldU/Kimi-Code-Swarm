# Evals — Harness 流程回归测试

> 评估 Agent 行为是否符合 `harness/*.yaml` 工作流模板。
> 输入：Git 历史 + 文件系统状态。输出：合规评分 + 偏离报告。

## 评估维度

| 维度 | 说明 |
|------|------|
| **分支规范** | bug-fix 必须从 `fix/*` 或 `bugfix/*` 分支发起 |
| **测试覆盖** | 代码变更必须伴随 `tests/` 新增或修改 |
| **文档同步** | src/ 变更必须伴随 `docs/` 或 `exec-plans/` 变更 |
| **commit 规范** | message 必须包含根因说明 |
| **验证闭环** | PR 必须通过 `npm run ci` |
| **STATUS 更新** | 功能状态变更后必须更新 STATUS.md |

## 运行

```bash
# 评估最近一次提交（本地开发）
npx tsx evals/bug-fix.eval.ts --commit HEAD
npx tsx evals/new-task.eval.ts --commit HEAD

# 评估指定 PR（CI 中使用）
npx tsx evals/bug-fix.eval.ts --pr 42
```

## 规则

- 硬性偏离（Hard Fail）：Agent 必须修复才能合入
- 软性偏离（Soft Warn）：建议修复，但不阻断
