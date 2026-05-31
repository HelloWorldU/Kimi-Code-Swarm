---
name: pull
description: 将 origin/main 的最新改动合并进当前分支，保持分支干净
---

# Pull Skill

## Goals

- 确认当前分支是否落后 origin/main
- 落后则执行 fetch + merge，将 main 的新 commit 纳入当前分支
- 遇到冲突时加载 resolve-conflict SKILL 解决

## Inputs

- 当前分支已 checkout（`git branch --show-current` 非空）
- 工作区干净或已 stash（有未提交改动先 commit 或 stash）

## Steps

### 1. 检查落后情况

```bash
git fetch origin main --quiet
git log --oneline HEAD..origin/main   # 有输出 = 落后，无输出 = 已是最新
```

无输出 → 分支已是最新，结束本 SKILL。

### 2. Merge

```bash
git merge origin/main
```

| 结果 | 行动 |
|------|------|
| 成功（fast-forward 或 auto-merge） | 进入步骤 3 验证 |
| 冲突 | 加载 `.kimi/skills/resolve-conflict/SKILL.md`，解决后回步骤 3 |

### 3. 验证

```bash
git log --oneline main..HEAD   # 确认分支包含原有 commit + main 新 commit
npm run typecheck               # 合并未引入类型错误
```

## Output

当前分支与 origin/main 对齐，工作区干净，可继续执行任务。

## Related Skills

- `.kimi/skills/resolve-conflict/SKILL.md` — merge 冲突解决
- `.kimi/skills/commit/SKILL.md` — 合并前先 commit 未提交改动
