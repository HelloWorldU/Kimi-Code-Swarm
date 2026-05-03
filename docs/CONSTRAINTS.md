# CONSTRAINTS

> 约束体系全景：强制规则与软性约定。
> Agent 修改代码前必读，确保变更不破坏现有约束。

---

## 🔒 强制约束（自动化，不可绕过）

### 1. 编译与类型层

| 约束 | 工具 | 触发方式 | 失败后果 |
|------|------|---------|---------|
| TypeScript 类型检查 | `vue-tsc --noEmit` | `npm run typecheck` / CI | 编译失败 |
| 代码质量检查 | ESLint (`eslint.config.mjs`) | `npm run lint` / CI | 阻断流水线 |
| ESLint 关键规则 | `no-var`, `prefer-const`, `@typescript-eslint/no-unused-vars` | 实时 / CI | 阻断提交 |

### 2. AST 结构约束 (`ast/rules/`)

AST 负责**骨架合规**——Vue 结构、导入限制、样式约束。不替代 ESLint/TS。

| 规则文件 | 规则 ID | 约束内容 | 可修复 |
|----------|---------|---------|--------|
| `vue-structure.ts` | `vue/no-script-setup` | 必须用 `<script setup lang="ts">` | ✅ |
| | `vue/no-scoped-style` | 禁止 `<style scoped>`（只用 Tailwind） | ✅ |
| | `vue/no-options-api` | `<script setup>` 内禁止 Options API | ✅ |
| `import-restrictions.ts` | `import/forbidden` | 黑名单库禁止导入 | ✅ |
| | `import/wrong-icon-lib` | 图标库必须用 `lucide-vue-next` | ✅ |
| | `import/deep-relative` | 相对路径禁止超过 2 层 | ✅ |
| `style-constraints.ts` | `style/raw-css-detected` | `<style>` 块禁止原始 CSS | ✅ |
| | `style/inline-style-attr` | 模板禁止内联 `style` 属性 | ✅ |

### 3. CI 流水线 (`npm run ci`)

```
typecheck → lint → analyze → check-docs → build
```

任一阶段失败即 exit 1。

### 4. 文档同步检测 (`ci/scripts/check-docs-sync.ts`)

- 数据源：`docs/doc-map.json`
- 触发：pre-commit hook + CI
- 规则：代码路径变更 → 关联文档必须同步变更
- 边界处理：**已删除的文件不触发文档同步要求**（`--diff-filter=d`）
- 失败：报错阻断提交/合入

### 5. GitHub Actions

- 触发：Push / Pull Request
- 执行：`npm run ci`
- 效果：未过 CI 无法合入 main

---

## 📖 软性约束（文档、约定）

依赖 Agent 阅读理解并自觉遵守，无自动化拦截。

### 1. 黄金原则 (`AGENTS.md`)

1. **地图即边界** — Agent 只读 AGENTS.md，细节去 docs/ 按需加载
2. **机械化约束优先** — 代码必须过 CI
3. **仓库是唯一事实源** — Slack/口头约定对 Agent 等于不存在
4. **执行即更新文档** — 每次代码变更同步更新相关文档
5. **约束即代码** — 不能自动检查的约定等于不存在

### 2. 知识库文档

| 文档 | 内容 |
|------|------|
| `DESIGN.md` | Harness 五层架构、系统边界 |
| `ARCHITECTURE.md` | 数据流、状态分层、模块边界 |
| `FRONTEND.md` | 技术栈、编码规范、命令 |
| `COMPONENT_PATTERNS.md` | 组件模板、命名规范 |
| `CLI_HARNESS.md` | CLI 进程接入规范 |
| `OBSERVABILITY.md` | 可观测性设计 |
| `TOKEN_MONITORING.md` | Token 预算与监控 |
| `PLANS.md` | 执行计划索引 |

### 3. Skill 工作流模板 (`harness/*.yaml`)

| 模板 | 内容 |
|------|------|
| `new-instance.yaml` | 前置条件、标准步骤、回滚策略 |
| `bug-fix.yaml` | 前置条件、标准步骤、回滚策略 |

**本质**：偏离模板需自担风险。

### 4. 工程约定

| 约定 | 说明 |
|------|------|
| 知识 vs 代码分离 | 功能目录无 README，知识统一归 `docs/` |
| 模块边界 | `kimi-code-swarm/src/` 纯前端，禁止直接操作进程 |
| 状态色语义 | running=emerald, idle=blue, error=red, queued=amber, stopped=gray |
| Store 修改规范 | 状态必须通过 `useSwarmStore` 方法修改 |

---

## 🔮 硬化路线图

| 软性约束 | 硬化方式 | 优先级 |
|----------|---------|--------|
| `harness/*.yaml` 偏离 | `evals/` 回归测试 | P1 |
| 模块边界（前端禁 spawn） | ESLint 自定义规则 | P1 |
| Store 直接赋值 | ESLint 规则或 TS 类型设计 | P2 |
| 状态色语义 | AST 规则扫描非法颜色类名 | P2 |
| 工程约定 | check-docs-sync.ts 扩展禁止模式检测 | P2 |
| 运行时边界验证 | 引入 zod / io-ts | P1 |
| 循环清理 | `scripts/cleanup.ts` 实现 | P1 |

---

## 相关文档

- [`AGENTS.md`](../AGENTS.md)
- [`DESIGN.md`](DESIGN.md)
- [`COMPONENT_PATTERNS.md`](COMPONENT_PATTERNS.md)
- [`PLANS.md`](PLANS.md)
