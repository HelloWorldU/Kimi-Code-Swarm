---
name: commit
description: 将工作区改动转化为格式良好的 git commit
---

# Commit Skill

## Goals

- 只 stage 本次任务相关文件
- 生成符合 Conventional Commits 规范的 commit message
- 提交前排除垃圾文件

## Inputs

- 工作区改动（`git diff` / `git status`）
- 本次任务意图（决定 type / scope / summary）

## Steps

1. `git status` 确认改动范围，排除 `.log` / `.tmp` / 编辑器临时文件
2. `git add <file1> <file2> ...`（只 stage 本次相关文件，不用 `git add .`）
3. 按格式写 commit message，`git commit -m "..."`

### Commit Message 格式

```
<type>(<scope>): <summary>

<rationale>

<tests>
```

**Type**

| 类型 | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 代码重构（不改变行为） |
| `docs` | 文档更新 |
| `test` | 测试补充/修改 |
| `chore` | 构建、工具链、依赖升级 |

**Scope**（根据文件路径推断）

| 路径前缀 | Scope |
|---------|-------|
| `kimi-code-swarm/src/` | `frontend` |
| `agent-engine/src/` | `agent-engine` |
| `docs/` | `docs` |
| `tests/` / `*.spec.ts` | `test` |
| `ci/` | `ci` |
| `ast/` | `ast` |
| `src-tauri/` | `tauri` |

**Summary 规则**
- 英文，首字母不大写，末尾不加句号，不超过 50 字符
- 动词原形开头：`add` / `fix` / `update` / `refactor` / `remove`

**Rationale**（可选）：1-2 句说明为什么，行宽 ≤ 72 字符

**Tests**（可选）：`新增 XX 测试，全部通过` / `无需补充测试（纯重构）`

## Output

一个格式合规的 git commit，只包含本次任务相关文件。

## 示例 / 反例

```
# ✅
feat(frontend): add SwarmConfirmModal and SwarmToast components

# ❌
feat: 前端专家                    ← 缺 scope 和具体描述
feat(frontend): Add Component.    ← 首字母大写、末尾句号
```

## Related Skills

- `.kimi/skills/push/SKILL.md` — push 前本地验证 + PR 创建
