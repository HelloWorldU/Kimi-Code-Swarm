# Token Monitoring

## 维度

| 维度 | 来源 |
|------|------|
| 单实例实时 | 解析 CLI stdout `[TOKEN]` |
| 全局总量 | useSwarmStore 聚合 |
| Plan 限额 | 用户配置（小快板 200K/日） |

## 预警阈值

```ts
INFO:  50%  // 绿色→黄色
WARN:  80%  // 黄色→红色
CRIT:  95%  // 红色 + 禁止新建
```
