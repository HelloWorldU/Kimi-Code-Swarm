---
name: resolve-conflict
description: 工作区处于 merge 冲突状态时，解决冲突标记并验证
---

# Resolve Conflict Skill

## Goals

- 消除工作区所有冲突标记（`<<<<<<<` / `=======` / `>>>>>>>`）
- 保留双方有效意图，不丢失功能
- 验证合并结果不破坏已有功能

## Inputs

工作区处于 merge 冲突状态。进入本 SKILL 前，调用方已执行 `git fetch` + `git merge`（或 `git rebase`），产生了冲突。

> **注意**：`git merge` / `git fetch` / `git rebase` 等分支操作由**调用方**在进入本 SKILL 前执行，不在本 SKILL 的职责范围内。

## Steps

### 1. 定位冲突

```bash
git status                        # 列出冲突文件
git diff --merge                  # 查看冲突片段
git diff :1:<path> :2:<path>      # 对比 base vs ours
git diff :1:<path> :3:<path>      # 对比 base vs theirs
```

使用 `zdiff3` 时，冲突标记含 `|||||||` base 区域，重点关注差异核心。

### 2. 逐文件解决

**硬约束**：
- 只修改 conflict marker 区域（`<<<<<<<` 到 `>>>>>>>` 之间的内容）
- 不在冲突文件里顺手写用户任务相关的新代码；新功能放到后续轮次

**解决原则**：
- 先理解双方意图：分别判断 ours / theirs 想修复什么 / 改变什么行为
- 先决定语义上正确的最终结果，再写代码
- 最小化改动，避免意外删除或静默行为变更
- 逐批解决逻辑相关文件，每批解决后运行测试验证
- 谨慎使用 ours/theirs 全覆盖，仅当确定整一方应完全胜出时才用
- 生成文件（如 `*.generated.ts`）优先解决其源文件，再重新运行生成工具
- import 冲突意图不明时，先保留双方所有 import，合并后通过 lint 清理

### 3. 清理验证

```bash
git diff --check          # 确认无冲突标记残留
npm run typecheck
npm run test
```

## Output

工作区无冲突标记，测试通过，可继续后续 commit / push 流程。

## 何时向用户确认

以下情况停止自主决策，向用户说明并等待确认：

- 冲突依赖无法从代码 / 测试 / 附近文档推断的产品意图
- 冲突涉及用户可见的 API 契约、迁移或外部消费者
- 需要在两个技术方案中选择，且本地无明确信号
- 合并可能引入数据丢失、schema 变更或不可逆副作用

## Related Skills

- `.kimi/skills/push/SKILL.md` — 冲突解决后继续 push 流程
- `.kimi/skills/commit/SKILL.md` — 解决后提交 merge commit
