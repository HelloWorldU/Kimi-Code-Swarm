# AST Parser 迁移：正则 → TypeScript ESTree

> **状态**: 阶段 1-2 已完成（`error-handling.ts` 已迁移至 ESTree）  
> **触发条件**: 新语法变体再次导致约束失效，或项目规模扩大需复杂结构分析  
> **影响范围**: `ast/rules/*.ts`

## 问题：正则做代码分析的系统性缺陷

`ast/rules/error-handling.ts` 已暴露 4 类缺陷：

1. **语法变体**：`catch {`（ES2019 可选 catch binding）不匹配 `/catch\s*\([^)]*\)\s*\{/`
2. **调用形式**：`this.log('error', ...)` 不匹配 `/\blog(?:ger)?\.(?:error|warn|debug|info)\b/`
3. **字符串误报**：正则字面量 `"catch(...)"` 被当成代码中的 catch
4. **注释误报**：注释里的 `catch (...)` 被当成空 catch

## 正则 vs AST Parser

| 维度 | 正则 | AST Parser |
|------|------|-----------|
| 语法变体覆盖 | ❌ 每个新语法需打补丁 | ✅ 自动覆盖 |
| 字符串/注释过滤 | ❌ 需层层预处理 | ✅ Parser 天然过滤 |
| 嵌套结构 | ❌ 大括号计数易出错 | ✅ 树形结构天然处理 |
| 语义理解 | ❌ 只能文本匹配 | ✅ 识别调用关系 |
| 实现复杂度 | ✅ 简单 | ⚡ 需学习 ESTree 节点类型 |
| TypeScript 语法 | ❌ 不支持泛型/类型断言 | ✅ 原生支持 |

## 当前状态

`error-handling.ts` 已于 2026-05-28 完成 ESTree 迁移：
- `findCatchBlocks` 使用 `@typescript-eslint/typescript-estree` 遍历 `CatchClause` 节点，自动处理 `.vue` SFC 的 script 提取与行号映射
- 字符串/注释误报、语法变体（`catch {`）、嵌套大括号计数问题已根治
- `fixers/error-handling.ts` 同步简化，直接复用 AST 提供的 `param`

其余规则保持正则实现，暂无迁移计划。

## 迁移计划

| 阶段 | 内容 | 状态 | 说明 |
|------|------|------|------|
| 1 | 引入 `@typescript-eslint/typescript-estree` | ✅ 完成 | `ast/package.json` 管理依赖 |
| 2 | 重写 `error-handling.ts` | ✅ 完成 | ESTree 解析 + Vue SFC script 提取 |
| 3 | 迁移 `import-restrictions` | ⏸️ 待评估 | 正则已稳定，收益有限 |
| 4 | 重写 `dead-code.ts`（跨模块引用分析） | ⏸️ 待排期 | 仅单文件 export 解析有收益 |
| 5 | 移除 `error-handling` 正则 Workaround | ✅ 完成 | 旧正则提取逻辑已删除 |

> **注**：`vue-structure` 与 `style-constraints` 检查 Vue/HTML/CSS 结构，不适用 TypeScript ESTree，已从迁移计划中移除。

*Document created: 2026-05-13*
