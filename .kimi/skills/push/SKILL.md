---
name: push
description: 推送分支、创建/更新 PR，并自主处理 CI 失败和 review 拒绝，直到 PR 可 merge
---

# Push Skill

## Goals

- `git push` 到 origin
- 确保存在格式规范的 PR
- 轮询 CI，自主处理失败（最多 3 轮）
- 读取 reviewer 意见，自主处理拒绝
- 状态收敛后向 engine 发 `submit-for-review` 或 `merge-pr` 信号

## Inputs

- 当前分支已有 commit（`git log --oneline main..HEAD` 非空）
- 本地验证已通过（见下方 Checklist）

## Steps

### 1. 推送前本地验证（必须全部通过）

```bash
npm run typecheck
npm run lint
npm run analyze
npm run test      # 如有新增代码
npm run build
```

验证失败先修复，再回到 commit SKILL 提交修复后重新跑验证。

### 2. Push + PR

```bash
git push -u origin HEAD   # 首次建立 upstream
# 后续推送
git push
```

**PR 创建**（无 open PR 时）：

```bash
gh pr create --title "<type>(<scope>): <summary>" \
             --body "$(cat .github/pull_request_template.md)"
```

- title 与 commit message 首行一致
- body 按模板填写：变更内容 / 类型勾选 / 检查项
- 有 open PR：新 commit 自动追加，不修改 title/body
- 已关闭 PR：停止，向用户报告分支状态

### 3. CI 轮询（push 后自主执行）

```bash
gh pr checks              # 查看所有 check 状态
```

| 状态 | 行动 |
|------|------|
| 全部 pass | 进入步骤 4 |
| pending | 等待后重新轮询 |
| 有 fail | 获取日志，进入 CI 修复流程 |

**CI 修复流程**（最多自主执行 3 轮，第 4 轮失败停止并向用户报告）：

```bash
gh run list --branch $(git branch --show-current) --limit 3
gh run view <run-id> --log-failed   # 获取失败 job 日志
```

根据日志定位根因 → 修改代码 → 重跑本地验证 → commit → push → 重新轮询 CI。

### 4. Review 处理

CI 全绿后，向 engine 发送 `submit-for-review` 信号，engine 调度 reviewer agent。

收到 review 结果后：

```bash
gh pr view --json reviews,comments
gh api repos/{owner}/{repo}/pulls/{pr-number}/comments
```

| review 决定 | 行动 |
|-------------|------|
| approved | 进入步骤 5 |
| changes_requested | 读全部意见 → 逐条处理 → commit → push → 重新进入 CI 轮询 |

**处理 review 意见原则**：
- 读全部 reviewer 意见后再动手，不逐条处理
- 有歧义或不确定该不该改的条目，向用户确认后再处理
- 不擅自决定"这条不用改"

### 5. 请求 Merge

所有 reviewer approved 且 CI 全绿后，向 engine 发送 `merge-pr` 信号。

**不直接调用 `gh pr merge`**，merge 资格校验由 engine 硬门控执行。

## Output

PR 处于 merged 状态，或因超出自主修复上限 / 遇到歧义而停止并向用户报告。

## Related Skills

- `.kimi/skills/commit/SKILL.md` — commit message 规范
- `.kimi/skills/resolve-conflict/SKILL.md` — 分支同步时遇 merge conflict
- `.github/pull_request_template.md` — PR body 模板
