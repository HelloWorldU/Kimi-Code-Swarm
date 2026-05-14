# Push Skill

> 将当前分支推送到 origin，并确保存在格式规范的 Pull Request。

## 职责范围

- `git push` 到远程分支
- PR 生命周期管理：创建 / 追加 commit / 状态检查
- PR title 和 body 格式化

## 推送前强制验证

在 `git push` 之前，必须确认以下检查已通过：

- [ ] `npm run typecheck` — TypeScript 类型检查
- [ ] `npm run lint` — ESLint 代码检查
- [ ] `npm run analyze` — AST 结构分析
- [ ] `npm run test` — 测试套件（如有新增代码）
- [ ] `npm run build` — 生产构建

> **注意**：如果上述检查失败，先修复问题再推送。参考 `skills/commit/SKILL.md` 的修复流程。

## PR Title 规范

与 commit message 的首行保持一致：

```
<type>(<scope>): <summary>
```

## PR Body 规范

基于 `.github/pull_request_template.md` 模板填写，必须包含：

1. **变更内容** — 列出每个新增/修改文件及一句话作用说明
2. **类型勾选** — 对应 Conventional Commits 的 type
3. **检查项** — 确认本地验证已通过

## PR 生命周期

| 场景 | 行为 |
|------|------|
| 无 open PR | 创建新 PR，title/body 按规范填写 |
| 有 open PR | 新 commit 自动追加到现有 PR，不修改 title/body |
| 已关闭 PR | 报错，提示用户检查分支状态 |

## 与 CI 的协作

PR 创建后：
1. 自动启动 CI 监控（轮询 GitHub Checks API）
2. CI 失败 → 获取日志 → 自动修复 → 重新提交（最多 3 轮）
3. CI 通过 → 停止监控，等待审阅或合并

## 相关 Skill

- `skills/commit/SKILL.md` — commit message 规范
- `.github/pull_request_template.md` — PR 描述模板
