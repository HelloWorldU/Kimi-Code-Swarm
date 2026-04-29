# Kimi-Code-Swarm

> 桌面端 CLI 集群管理控制台。通过 UI 同时控制 N 个 Kimi Code CLI 实例，实时监控 Token 与日志。

## 核心功能

- 🖥️ 桌面端 UI 管理多个 CLI 实例
- 📊 实时 Token 消耗监控
- 📝 染色日志流（system/input/output/error）
- 🚀 实例状态控制（启动/停止/重启/删除）
- 📋 任务队列与并发调度

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Tailwind CSS |
| 构建 | Vite |
| 图标 | lucide-vue-next |
| 桌面壳 | Tauri v2 / Electron（未来） |

## 快速启动

```bash
cd kimi-code-swarm
npm install
npm run dev    # localhost:5173
```

## 文档结构

```
AGENTS.md        ← 地图（Agent 启动先读）
docs/            ← 知识库（架构/设计/规范）
ast/             ← AST 结构约束
kimi-code-swarm/ ← 前端应用
```

## 许可证

MIT
