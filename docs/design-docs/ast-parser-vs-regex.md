# AST Parser 迁移：正则 → TypeScript ESTree

> **状态**: 已识别，待迁移  
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

## 当前 Workaround

三层防御性修复已实施：
1. 正则补丁支持 `catch {`
2. 支持 `this.log('error')` / `log.error()` / `console.error()`
3. 预处理：移除字符串字面量、注释、正则字面量后再匹配

**问题**：每遇到新语法变体（模板字符串、多行注释等）都需继续打补丁。

## 迁移计划

| 阶段 | 内容 | 风险 | 时间 |
|------|------|------|------|
| 1 | 引入 `@typescript-eslint/typescript-estree` | 低 | 1-2h |
| 2 | 重写 `error-handling.ts` | 中 | 半天 |
| 3 | 迁移 `vue-structure` / `import-restrictions` / `style-constraints` | 低-中 | 1-2天 |
| 4 | 重写 `dead-code.ts`（跨模块引用分析） | 高 | 1-2天 |
| 5 | 移除正则 Workaround | 低 | — |

*Document created: 2026-05-13*
