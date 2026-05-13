# AST Parser vs 正则：代码分析工具的技术债务

> **状态**: 已识别，待迁移  
> **当前实现**: 基于正则的文本扫描 (`ast/rules/*.ts`)  
> **目标实现**: TypeScript ESTree AST Parser (`@typescript-eslint/typescript-estree`)  
> **影响范围**: `ast/rules/error-handling.ts`, `ast/rules/vue-structure.ts`, `ast/rules/import-restrictions.ts`, `ast/rules/style-constraints.ts`, `ast/rules/dead-code.ts`

---

## 背景

项目的 AST 结构约束层（`ast/`）目前使用**正则表达式**扫描源代码文本，检测代码结构问题：
- 空 catch 块
- 未记录错误的 catch 块
- Vue 组件结构合规性
- 导入限制
- 死代码检测

这套工具在 CI (`npm run analyze`) 和 pre-commit hook 中强制运行，是 Harness Engineering 约束体系的核心组成部分。

---

## 问题：正则做代码分析的系统性缺陷

2026-05-13 的修复过程中，`ast/rules/error-handling.ts` 连续暴露 4 个正则缺陷，每一个都导致约束失效或误报：

### 缺陷 1：无法识别 ES2019 可选 catch binding

```ts
// 代码中实际存在的空 catch（agent.ts 第 151 行）
} catch {
  // ignore
}

// 正则只匹配带参数的 catch
/catch\s*\([^)]*\)\s*\{/   // ❌ 不匹配 `catch {`
```

**后果**: 3 个空 catch 块逃过检测，错误被静默吞没，后端日志完全缺失。

### 缺陷 2：无法识别 `this.log('error', ...)` 调用

```ts
// agent.ts 中实际的日志调用
} catch (err) {
  this.log('error', `启动失败: ${String(err)}`)
}

// 正则只匹配 log.error(...) 形式
/\blog(?:ger)?\.(?:error|warn|debug|info)\b/   // ❌ 不匹配 this.log('error', ...)
```

**后果**: 大量已正确记录错误的 catch 块被误报为 `missing-logger`。

### 缺陷 3：无法区分代码和字符串字面量

```ts
// ast/rules/error-handling.ts 自身的第 29 行
const catchMatch = line.match(/catch(?:\s*\([^)]*\))?\s*\{/)
//                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// 正则匹配到了正则表达式字面量中的 "catch"！
```

**后果**: AST 分析器分析自身时，把字符串中的 `catch` 当成了代码中的 catch 块，产生空 catch 误报。

### 缺陷 4：无法区分代码和注释

```ts
// ast/rules/error-handling.ts 第 32 行
// 匹配 catch (...) { 或 catch { （支持可选 catch binding）
//      ^^^^^^^^^^^^^^
// 正则匹配到了注释中的 "catch (...) {"
```

**后果**: 注释中的 `catch` 被当成空 catch 块误报。

---

## 什么是 AST Parser

AST（Abstract Syntax Tree，抽象语法树）是把源代码解析成树形结构的过程。TypeScript 编译器（或 `@typescript-eslint/typescript-estree`）会把代码转换成标准化的节点对象，每个节点有明确的类型和属性。

### 例子：同一行代码的正则 vs AST 分析

源代码：
```ts
const msg = "catch error"; // 注释里的 catch
function foo() {
  try { bar() } catch (err) { log.error('fail', err) }
}
```

**正则分析**：
```ts
const matches = source.match(/catch(?:\s*\([^)]*\))?\s*\{/g)
// matches = ['catch (err) {', 'catch error"] ...']  // ❌ 字符串和代码混在一起
```

**AST 分析**：
```ts
import { parse } from '@typescript-eslint/typescript-estree'

const ast = parse(source, { ecmaVersion: 2022 })
// 遍历 AST，只找 CatchClause 节点
// 找到 1 个 CatchClause：第 3 行的 catch (err) { ... }
// 字符串 "catch error" 是 StringLiteral 节点，不会误匹配
// 注释被 parser 直接丢弃
```

AST 节点示例：
```ts
{
  type: 'CatchClause',
  param: {
    type: 'Identifier',
    name: 'err'
  },
  body: {
    type: 'BlockStatement',
    body: [
      {
        type: 'ExpressionStatement',
        expression: {
          type: 'CallExpression',
          callee: {
            type: 'MemberExpression',
            object: { type: 'Identifier', name: 'log' },
            property: { type: 'Identifier', name: 'error' }
          }
        }
      }
    ]
  }
}
```

---

## 正则 vs AST Parser：优劣对比

| 维度 | 正则 | AST Parser |
|------|------|-----------|
| **语法变体覆盖** | ❌ 每个新语法需要打补丁（`catch {`、`catch (err: unknown)`） | ✅ 自动覆盖所有语法变体 |
| **字符串/注释过滤** | ❌ 无法区分，需要层层预处理 | ✅ Parser 天然丢弃注释，字符串是独立节点 |
| **嵌套结构匹配** | ❌ 大括号嵌套计数容易出错 | ✅ 树形结构天然处理嵌套 |
| **代码语义理解** | ❌ 只能文本匹配，不理解调用关系 | ✅ 能识别 `this.log('error', ...)` 和 `log.error(...)` 都是日志调用 |
| **实现复杂度** | ✅ 简单，几十行代码 | ⚡ 需要引入 parser 依赖，学习 AST 节点类型 |
| **性能** | ✅ 快，逐行扫描 | ⚡ 稍慢，需要完整解析文件，但对项目规模可忽略 |
| **TypeScript 专用语法** | ❌ 不支持泛型、类型断言、`satisfies` 等 | ✅ 原生支持 TypeScript 全部语法 |
| **可扩展性** | ❌ 新增规则需要写新的正则 | ✅ 复用遍历器框架，新增规则只需匹配节点类型 |

---

## 当前 Workaround（已实施）

在迁移到 AST Parser 之前，对 `ast/rules/error-handling.ts` 进行了三层防御性修复：

1. **正则补丁**：支持可选 catch binding `catch {`
2. **日志调用识别**：支持 `this.log('error', ...)`、`log.error(...)`、`console.error(...)`
3. **预处理流水线**：匹配前先移除字符串字面量、注释、正则表达式字面量

```ts
const codeOnly = line
  .replace(/(['"`])[^'"`]*\1/g, (m) => ' '.repeat(m.length))  // 字符串
  .replace(/\/\/.*$/g, '')                                    // 注释
  .replace(/\/[^/]+\//g, (m) => ' '.repeat(m.length))        // 正则字面量
```

**这些 workaround 的问题是**：每遇到一种新的语法变体（如模板字符串中的 catch、正则中的转义斜杠、多行注释），都需要继续打补丁。打地鼠游戏没有尽头。

---

## 迁移计划

### 阶段 1：引入依赖（低风险，1-2 小时）

```bash
cd kimi-code-swarm
npm install -D @typescript-eslint/typescript-estree
```

### 阶段 2：重写 `error-handling.ts`（中等风险，半天）

用 AST 遍历器替换正则：

```ts
import { parse } from '@typescript-eslint/typescript-estree'
import { simpleTraverse } from '@typescript-eslint/typescript-estree/dist/traverse'

export function checkErrorHandling(content: string, filePath: string): AstIssue[] {
  const issues: AstIssue[] = []
  const ast = parse(content, { ecmaVersion: 2022, range: true })

  simpleTraverse(ast, {
    enter(node) {
      if (node.type === 'CatchClause') {
        const body = node.body.body
        if (body.length === 0) {
          issues.push({
            file: filePath,
            rule: 'error-handling/empty-catch',
            line: node.loc?.start.line,
            // ...
          })
          return
        }
        if (!hasLoggerCall(node.body)) {
          issues.push({
            file: filePath,
            rule: 'error-handling/missing-logger',
            line: node.loc?.start.line,
            // ...
          })
        }
      }
    }
  })

  return issues
}

function hasLoggerCall(body: BlockStatement): boolean {
  let found = false
  simpleTraverse(body, {
    enter(node) {
      if (node.type === 'CallExpression') {
        // 检测 log.error(...)、this.log('error', ...)、console.error(...)
        if (isLoggerCall(node.callee)) {
          found = true
        }
      }
    }
  })
  return found
}
```

### 阶段 3：逐步迁移其他规则（低-中等风险）

| 规则文件 | 复杂度 | 估计时间 |
|----------|--------|---------|
| `vue-structure.ts` | 中 | 半天 |
| `import-restrictions.ts` | 低 | 2 小时 |
| `style-constraints.ts` | 低 | 2 小时 |
| `dead-code.ts` | 高 | 1-2 天 |

### 阶段 4：移除正则 Workaround（低风险）

删除 `ast/rules/error-handling.ts` 中的字符串/注释/正则预处理代码。

---

## 为什么现在不立即迁移

1. **当前 workaround 已覆盖主要场景**：经过 4 轮补丁，正则已能处理项目现有代码中的全部 catch 变体
2. **迁移成本**：AST Parser 需要学习成本（ESTree 节点类型体系），且 `dead-code.ts` 的跨模块引用分析用 AST 重写工作量较大
3. **收益递减**：当前项目规模下（~5000 行 TypeScript），正则的误报率已降至可接受范围

**触发迁移的条件**：
- 正则再次因新语法变体导致约束失效（如遇到 `catch (err: unknown) {`）
- 项目规模扩大到需要更复杂的结构分析（如控制流分析、数据流分析）
- 需要支持 Vue SFC 的 `<script setup>` 专用语法分析

---

## 根因记录

本次暴露的问题遵循 Harness Engineering 的 **"反复 bug → 日志 → 留痕"** 原则：

> 同一个代码层面的 bug（正则无法检测 `catch {`）在多个文件中反复出现时，说明约束工具有缺陷，而非代码有问题。修复约束工具本身，比逐个修复代码中的 catch 块更有价值。

---

*Document created: 2026-05-13*  
*Related commits: AST 正则补丁修复（catch { 检测、this.log 识别、字符串/注释过滤）*
