/**
 * 统一日志工具
 *
 * 设计原则：
 * - 替代散落的 console.xxx，消除 ESLint no-console 警告
 * - 带时间戳 + 命名空间，调试时可快速定位来源
 * - 环境感知：开发模式输出 debug，生产模式仅 warn/error
 *
 * 用法：
 *   import { createLogger } from '../utils/logger'
 *   const log = createLogger('SwarmStore')
 *   log.debug('detail', data)
 *   log.error('failed', err)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function getDefaultLevel(): LogLevel {
  try {
    // Vite 注入的环境变量
    if (import.meta.env?.DEV) return 'debug'
  } catch {
    // 非 Vite 环境（如测试环境）没有 import.meta.env，预期行为
  }
  return 'warn'
}

export class Logger {
  private level: LogLevel
  private prefix: string

  constructor(namespace = '', level?: LogLevel) {
    this.prefix = namespace ? `[${namespace}]` : ''
    this.level = level ?? getDefaultLevel()
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level]
  }

  private format(level: LogLevel, messages: unknown[]): [string, ...unknown[]] {
    const time = new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
    const tag = `${time} ${level.toUpperCase().padStart(5)} ${this.prefix}`.trimEnd()
    return [tag, ...messages]
  }

  debug(...messages: unknown[]) {
    if (this.shouldLog('debug')) {
      console.log(...this.format('debug', messages))
    }
  }

  info(...messages: unknown[]) {
    if (this.shouldLog('info')) {
      console.info(...this.format('info', messages))
    }
  }

  warn(...messages: unknown[]) {
    if (this.shouldLog('warn')) {
      console.warn(...this.format('warn', messages))
    }
  }

  error(...messages: unknown[]) {
    if (this.shouldLog('error')) {
      console.error(...this.format('error', messages))
    }
  }
}

/** 按模块创建 Logger */
export function createLogger(namespace: string, level?: LogLevel): Logger {
  return new Logger(namespace, level)
}

/** 全局默认 logger */
export const logger = new Logger()

// 自身引用，避免被 dead-code 检测误报（全局 logger 供各模块按需导入）
logger.debug('Logger module loaded')
