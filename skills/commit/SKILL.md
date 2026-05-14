# Commit Skill

> 将当前工作区的改动转化为格式良好的 git commit。

## 职责范围

- 读取 staged 文件列表
- 生成符合 Conventional Commits 规范的 commit message
- 提交前 sanity-check（避免垃圾文件入库）

## Commit Message 格式

```
<type>(<scope>): <summary>

<rationale>

<tests>
```

### Type（必须）

| 类型 | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 代码重构（不改变行为） |
| `docs` | 文档更新 |
| `test` | 测试补充/修改 |
| `chore` | 构建、工具链、依赖升级 |

### Scope（根据文件路径推断）

| 路径前缀 | Scope |
|---------|-------|
| `kimi-code-swarm/src/` | `frontend` |
| `agent-engine/src/` | `agent-engine` |
| `docs/` | `docs` |
| `tests/` / `*.spec.ts` | `test` |
| `ci/` | `ci` |
| `ast/` | `ast` |
| `src-tauri/` | `tauri` |

### Summary（必须）

- 英文，首字母**不大写**，末尾**不加句号**
- 不超过 50 个字符
- 用动词原形开头：`add` / `fix` / `update` / `refactor` / `remove`
- 说明"做了什么"，而非"怎么做"

### Rationale（可选但推荐）

- 1-2 句话说明"为什么做这次变更"
- 行宽不超过 72 字符

### Tests（可选但推荐）

- 说明测试情况：`新增 XX 测试，全部通过` / `无需补充测试（纯重构）` / `已有测试覆盖`

## 提交前 Checklist

- [ ] 确认没有垃圾文件（`.log`、`.tmp`、编辑器临时文件）被 stage
- [ ] 确认变更文件与本次意图一致
- [ ] 如果涉及多个 scope，优先选主要变更的 scope，或用 `multi`

## 示例

```
feat(frontend): add SwarmConfirmModal and SwarmToast components

Add global confirm modal and toast notification components
with type-safe icons and auto-dismiss functionality.

新增组件单元测试，全部通过。
```

## 反例

```
feat: 前端专家                    ← 缺少 scope 和具体描述
feat(frontend): Add Component.    ← 首字母大写、末尾句号
feat: add something               ← 过于模糊
```
