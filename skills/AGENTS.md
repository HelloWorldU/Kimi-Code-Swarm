# skills/ — Agent 能力地图

> 本目录存放**可复用的 Agent 能力规范**（Skill）。每个 Skill 是一个独立目录，内含 `SKILL.md` 定义该能力的规范、步骤和检查项。

---

## Skill 清单

| Skill | 作用 | 代码接入状态 | 关键文件 |
|-------|------|-------------|---------|
| `commit/` | Commit message 规范（Conventional Commits）和提交前检查清单 | ✅ **动态读取** — `agent.ts` 的 `generateCommitAndPrBody()` 运行时读取本 skill 作为 prompt 事实源 | `SKILL.md` |
| `push/` | PR 推送规范（推送前验证、PR title/body 格式、生命周期管理） | ⚡ **静态规范** — 工程师参考文档；PR title/body/生命周期已由 `agent.ts` 其他逻辑覆盖，推送前验证尚未接入 | `SKILL.md` |

---

## 使用指引

- **改 commit 行为** → 直接修改 `skills/commit/SKILL.md`，无需改代码（已被 `agent.ts` 动态读取）
- **改 PR 模板** → 修改 `.github/pull_request_template.md`，已被 `agent.ts` 动态读取
- **新增 Skill** → 新建目录 + `SKILL.md`，然后在 Engine 代码中通过 `loadSkill()` 接入，或先作为静态规范沉淀

---

## 规则

- Skill 文件本身只写**规范**（What / How），不写**状态**（状态统一写在本 AGENTS.md）
- 保持 SKILL.md 精简，工程师能快速读完并执行
- 如果一个 Skill 长期保持静态规范未接入代码，需在 STATUS.md 中标记为技术债务
