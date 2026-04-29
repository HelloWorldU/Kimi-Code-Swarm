# ci/

> 约束验证流水线。

```bash
npm run lint       # ESLint
npm run typecheck  # vue-tsc
npx tsx ast/analyzer.ts src  # AST
npm run build      # Vite
```

可观测性设计见 `docs/OBSERVABILITY.md`。
