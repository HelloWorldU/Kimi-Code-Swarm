# CLI Harness

## 目标

后台 spawn N 个 `kimi` 进程，每个有独立 PTY，stdout/stderr 实时解析。

## 技术选型

| 方案 | 工具 | 阶段 |
|------|------|------|
| node-pty | `node-pty` | Electron 方案 |
| Tauri Command | `tauri::api::process` | Tauri 方案 |

当前 Web 原型期用 Mock 数据。

## 输出解析

```
[TOKEN] usage: 12400 / 200000
[FILE] saved: src/components/Button.vue
[ERROR] Connection timeout...
```

## 状态机

```
queued ──spawn──→ running ──stop──→ stopped
   ↑                  │
   └──restart────────┘
   │                  │
   └──crash/error────→ error
```
