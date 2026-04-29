# ast/

> AST 结构约束。代码必须过 AST 检查才能进仓库。

```bash
npx tsx ast/analyzer.ts <file|dir> [--fix]
```

规则见 `docs/DESIGN.md` → Constraints 层。分析器实现见 `ast/analyzer.ts`。
