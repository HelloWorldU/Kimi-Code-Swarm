# Tech Debt Tracker

| 债务 | 优先级 | 影响 | 计划解决 |
|------|--------|------|---------|
| ~~AST 规则未实现~~ | ~~P1~~ | ~~Agent 代码结构无法自动验证~~ | ✅ 已完成：5 套规则（error-handling/vue-structure/import-restrictions/style-constraints/dead-code） |
| AST Parser 迁移（正则 → TypeScript ESTree） | P2 | 正则做代码分析有系统性缺陷：无法区分代码/字符串/注释、语法变体需持续打补丁 | 见 `docs/design-docs/ast-parser-vs-regex.md`，触发条件：新语法变体再次导致约束失效 |
| ~~真实 CLI 接入~~ | ~~P0~~ | ~~目前全是 Mock~~ | ✅ 已完成：tsx + Node.js Agent Engine |
| Token 趋势图 | P1 | 监控不完整 | 接入图表库后 |
| Windows 路径兼容性测试 | P2 | 目前只在单台 Windows 机器验证 | 增加 CI 矩阵或多机测试 |
