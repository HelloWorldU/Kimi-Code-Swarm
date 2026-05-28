# Pull Skill

> 将当前本地分支与 `origin/main` 同步，执行基于 merge 的分支更新（非 rebase），并在出现冲突时引导解决。

## 职责范围

- 拉取 `origin/main` 最新变更并合并到当前分支
- 处理 merge 冲突，保留分支意图
- 合并后执行项目验证，确保不破坏构建

## 合并前检查

1. **确认工作区干净**：
   - `git status` 查看未提交变更
   - 如有未提交变更，先执行 `.kimi/skills/commit/SKILL.md` 提交或 stash

2. **启用 rerere**（如未启用）：
   - `git config rerere.enabled true`
   - `git config rerere.autoupdate true`

3. **确认远程与分支**：
   - `origin` 远程存在
   - 当前分支是要接收合并的目标分支

## 合并流程

| 步骤 | 命令 | 说明 |
|------|------|------|
| 1 | `git fetch origin` | 获取最新远程引用 |
| 2 | `git pull --ff-only origin $(git branch --show-current)` | 先 fast-forward 同步远程分支自身的更新 |
| 3 | `git -c merge.conflictstyle=zdiff3 merge origin/main` | 合并 `origin/main`，使用 zdiff3 冲突样式 |
| 4 | 如有冲突 → 解决冲突 | 见下方「冲突解决指南」 |
| 5 | `git add <files>` | 标记冲突已解决 |
| 6 | `git merge --continue` / `git commit` | 完成合并 |
| 7 | 执行项目验证 | 见下方「合并后验证」 |

## 冲突解决指南

### 分析冲突

- `git status` 列出冲突文件
- `git diff --merge` 查看冲突片段
- `git diff :1:path :2:path` 对比 base vs ours
- `git diff :1:path :3:path` 对比 base vs theirs
- 使用 `zdiff3` 时，冲突标记包含 `|||||||` base 区域，关注差异核心

### 解决原则

- **先理解双方意图**：分别判断 ours/theirs 想修复什么 / 重构什么 / 改变什么行为
- **确定最终行为**：先决定语义上正确的结果，再写代码
- **最小化改动**：保留分支原有意图，避免意外删除或静默行为变更
- **逐个文件解决**：每解决一批逻辑相关的文件后，运行测试验证
- **谨慎使用 ours/theirs**：仅当确定整一方应完全胜出时才使用
- **生成文件优先解决源文件**：先解决手写逻辑，再重新运行生成工具
- **import 冲突**：如意图不明，先保留双方所有 import，合并后再通过 lint 清理

### 清理检查

- [ ] `git diff --check` —— 确认无冲突标记残留
- [ ] 运行测试 —— 确保合并未破坏功能

## 合并后验证

执行项目 pre-commit 检查：

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run analyze`
- [ ] `npm run test`（如有新增代码）
- [ ] `npm run check-docs`（如变更涉及文档）
- [ ] `npm run build`

> **注意**：验证失败时，先修复问题再继续。参考 `.kimi/skills/debug/SKILL.md` 的调试流程。

## 合并总结

完成合并后，向用户汇报：

1. 是否出现冲突
2. 最棘手的冲突文件及解决方式
3. 任何假设或后续跟进事项

## 何时询问用户

以下情况才询问用户，其余情况自主决策并记录理由：

- 冲突依赖无法从代码 / 测试 / 附近文档推断的产品意图
- 冲突涉及用户可见的 API 契约、迁移或外部消费者
- 冲突需要在两个技术方案中选择，且本地无明确信号
- 合并可能引入数据丢失、schema 变更或不可逆副作用
- 当前分支或远程分支名称不符合预期

