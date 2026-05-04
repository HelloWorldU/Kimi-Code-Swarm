# ARCHITECTURE

## 数据流

```
UI (Vue) ←→ useSwarmStore (AgentTask[])
  ←→ Tauri IPC ←→ Rust Main Process ←→ git / spawn CLI
  ←→ GitHub API (PR create/merge)
```

## 状态分层

| 层级 | 存储 | 生命周期 |
|------|------|---------|
| UI State | reactive | 页面刷新丢失 |
| Runtime | Main Process | 应用关闭丢失 |
| Persistent | localStorage | 跨会话保留 |

## 模块边界

- `kimi-code-swarm/src/` —— 纯前端，禁止直接操作进程
- 桌面壳层（未来）—— 唯一有权 spawn 进程
