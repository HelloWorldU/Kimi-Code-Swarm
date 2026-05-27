import type { LogEntry } from '../types'

/**
 * 从日志列表中找出最后一条用户输入（type === 'input'）的内容。
 * 无 input 时返回空串，供 UI 各处统一展示「当前/最后指令」。
 */
export function getLastInput(logs: LogEntry[]): string {
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].type === 'input') return logs[i].content
  }
  return ''
}
