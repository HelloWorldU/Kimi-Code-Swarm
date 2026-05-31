---
name: debug
description: 同一问题反复未解时停止猜测，通过加日志 + 与用户协作收集运行时数据来定位根因
---

# Debug Skill

## Goals

- 停止猜测式修改，转为数据驱动的调试
- 通过加日志 + 让用户采集运行时数据，定位真实根因
- 修复并验证通过后退出

## Inputs

满足任一即进本 SKILL：

- 同一症状用户反馈 ≥ 2 次仍未消失
- 提出的修复假设 ≥ 2 个不同方向都被验证失败
- 无法用现有代码 / 文档证据解释为什么旧行为会发生

## Constraints

- **反复未解 = 信息不够，不是创意不够。** 停止「换个写法再试」「换个 API 试试」「再加一层 try/catch」之类的猜测式修改。
- **无法直接读 Tauri 控制台 / engine-state.json / OS 进程状态 / Kimi 内置日志** —— 需要这些数据时必须显式让用户帮采，不要假装看到了，不要基于猜测继续推进。
- **未拿到用户反馈前不允许再改代码** —— 违反 = 退回猜测式修改。

## Steps

### 1. 加日志

在可疑路径加调试信息：
- 前端：用 `src/utils/logger.ts` 的 `log.info` / `log.error`，stdout JSON 进 UI
- agent-engine：用 `console.error`，输出到 stderr / Debug Console

按 `docs/ARCHITECTURE.md` 的「日志分流」约定。

### 2. 明确告诉用户要看什么 + 怎么采

- 哪个文件改了，要不要重新打包
- 在哪里复现，步骤是什么
- 要在 Debug Console 找什么前缀（如 `[Kimi]` `[Agent]` `[Git]`）
- 要看 JSON 的哪个字段
- 输出粘回哪

**让用户拷贝粘贴即可，不要让他读懂代码再翻译。**

日志要带 `agent.id` / `kimiSessionId` / PR `#N` 之一，用户在并发输出里才筛得出相关行。

### 3. 基于数据做下一步

拿到用户反馈的日志后，**基于数据**做下一步假设并修复。未拿到反馈前停下等待。

## Output

根因定位 → 修复落地 → 验证通过 → 回 task-intake 阶段 4 的不变量收尾。

多次协作仍无法定位 → 明确告知用户「我已尽力，需要你手动介入调试」，停下。

## Constraints（收尾）

- **加完调试要交代怎么清**：修复落地后告知哪些 log 是临时的应删、哪些有长期价值应保留（标 `// debug-keep:` 注释说明原因）。不留 `console.log` 残余。
- **commit message 要留根因**：写「为什么旧代码会错」+「怎么修对了」，不许「fix bug」「update files」之类敷衍。

## Related Skills

- `.kimi/skills/task-intake/SKILL.md` — 修复验证通过后回此收尾
