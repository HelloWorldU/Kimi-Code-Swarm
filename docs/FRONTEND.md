# FRONTEND

> 前端应用的 Agent 指南。

## 技术栈

Vue 3 + TypeScript + Vite + Tailwind CSS + lucide-vue-next

## 编码规范

1. `<script setup lang="ts">`，禁止 Options API
2. Tailwind 原子类，禁止 `<style scoped>`
3. 图标从 `lucide-vue-next` 导入
4. 状态色：running=emerald, idle=blue, error=red, queued=amber, stopped=gray
5. 新增组件必须在 App.vue 注册

## 关键文件

- `store/useSwarmStore.ts` — 状态必须通过方法修改
- `types/index.ts` — 修改前检查上下游依赖

## 命令

```bash
cd kimi-code-swarm
npm run dev         # 开发服务器
npm run typecheck   # TypeScript 类型检查
npm run lint        # ESLint 代码检查
npm run lint:fix    # ESLint 自动修复
npm run analyze     # AST 结构分析
npm run ci          # 完整流水线：typecheck → lint → analyze → build
npm run build       # 生产构建
```
