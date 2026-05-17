# Directory Structure

> 完整目录结构参考。AGENTS.md 中的索引指向这里。

```
Kimi-Code-Swarm/
├── AGENTS.md              ← 🗺️ 地图索引（本文档的上级）
├── README.md              ← 人类友好的项目介绍
├── docs/                  ← 📚 知识库（Agent 按需加载）
│   ├── DESIGN.md            顶层设计 + Harness 五层架构
│   ├── ARCHITECTURE.md      系统架构、数据流、状态分层
│   ├── FRONTEND.md          前端编码规范 + 命令
│   ├── CLI_HARNESS.md       CLI 进程接入设计
│   ├── COMPONENT_PATTERNS.md Vue 组件规范
│   ├── PLANS.md             执行计划索引
│   ├── STATUS.md            功能实现状态单一事实源
│   ├── DIRECTORY.md         ← 📂 本文档
│   ├── design-docs/         设计决策记录
│   ├── exec-plans/          活跃/已完成计划 + 技术债务
│   ├── product-specs/       产品规格
├── ast/                   ← 🔧 AST 结构约束代码
│   ├── analyzer.ts          分析器入口
│   ├── rules/               规则定义
│   └── fixers/              自动修复器
├── ci/                    ← ✅ CI 约束配置
│   ├── hooks/               git hooks
│   ├── lint-rules/          自定义 ESLint 规则
│   └── scripts/             CI 辅助脚本
├── scripts/               ← 🤖 自动化脚本
│   └── cleanup.ts           熵管理清理脚本
├── skills/                ← 🎯 Agent 能力 Skill（可复用工作流规范）
│   ├── commit/SKILL.md      Commit 规范
│   ├── push/SKILL.md        PR 推送规范
│   └── debug/SKILL.md       Debug 规范
├── harness/               ← 📋 工作流模板
│   ├── new-instance.yaml
│   ├── bug-fix.yaml
│   ├── new-task.yaml
│   └── auto-test.yaml
└── kimi-code-swarm/       ← 💻 前端应用（Vue3 + Vite + Tailwind + Tauri v2）
    ├── src/                 前端源码
    ├── agent-engine/        Node.js Agent Engine
    ├── src-tauri/           Rust Tauri 桌面壳
    └── tests/               🧪 单元 / 集成 / E2E 测试
```

---

*Directory map version: 2026-05-16*
