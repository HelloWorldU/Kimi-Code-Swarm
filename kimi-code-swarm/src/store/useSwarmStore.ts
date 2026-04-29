import { reactive, computed } from 'vue'
import type { CliInstance, LogEntry } from '../types'

const generateId = () => Math.random().toString(36).substring(2, 10)

const mockLogs = (baseContent: string): LogEntry[] => [
  { id: generateId(), timestamp: new Date(Date.now() - 300000), type: 'system', content: 'Kimi Code CLI v2.0.0 已启动' },
  { id: generateId(), timestamp: new Date(Date.now() - 240000), type: 'input', content: '请帮我重构这个组件', tokens: 12 },
  { id: generateId(), timestamp: new Date(Date.now() - 180000), type: 'output', content: '好的，我将分析代码结构并开始重构...', tokens: 156 },
  { id: generateId(), timestamp: new Date(Date.now() - 120000), type: 'output', content: baseContent.slice(0, 200), tokens: 342 },
  { id: generateId(), timestamp: new Date(Date.now() - 60000), type: 'system', content: '文件已保存: src/components/Button.vue' },
]

const initialInstances: CliInstance[] = [
  {
    id: 'inst-001',
    name: 'Frontend Refactor #1',
    status: 'running',
    pid: 10234,
    workspace: 'E:/projects/web-app',
    model: 'kimi-k2',
    tokenUsed: 12400,
    tokenLimit: 200000,
    createdAt: new Date(Date.now() - 3600000),
    lastActivity: new Date(Date.now() - 30000),
    taskDescription: '重构 Button 和 Modal 组件',
    logs: mockLogs('已完成 Button 组件的 props 接口重构，添加了 defineExpose 支持...'),
  },
  {
    id: 'inst-002',
    name: 'API Integration #2',
    status: 'running',
    pid: 10256,
    workspace: 'E:/projects/backend',
    model: 'kimi-k2',
    tokenUsed: 8900,
    tokenLimit: 200000,
    createdAt: new Date(Date.now() - 2400000),
    lastActivity: new Date(Date.now() - 120000),
    taskDescription: '对接支付网关 API',
    logs: mockLogs('正在编写 Stripe webhook handler，需要验证签名...'),
  },
  {
    id: 'inst-003',
    name: 'Doc Generator #3',
    status: 'idle',
    workspace: 'E:/projects/docs',
    model: 'kimi-k2',
    tokenUsed: 3200,
    tokenLimit: 200000,
    createdAt: new Date(Date.now() - 7200000),
    lastActivity: new Date(Date.now() - 600000),
    taskDescription: '生成 API 文档',
    logs: mockLogs('文档生成完毕，等待下一次指令...'),
  },
  {
    id: 'inst-004',
    name: 'Bug Fix #4',
    status: 'error',
    pid: 10301,
    workspace: 'E:/projects/mobile',
    model: 'kimi-k2',
    tokenUsed: 5600,
    tokenLimit: 200000,
    createdAt: new Date(Date.now() - 1800000),
    lastActivity: new Date(Date.now() - 300000),
    taskDescription: '修复 iOS 崩溃问题',
    logs: [
      ...mockLogs('分析 crash log...'),
      { id: generateId(), timestamp: new Date(Date.now() - 300000), type: 'error', content: 'Error: Connection timeout after 30000ms' },
    ],
  },
]

// Global reactive state (singleton pattern)
const state = reactive({
  instances: initialInstances,
  selectedId: null as string | null,
  isCreateModalOpen: false,
})

// Simulate token consumption
setInterval(() => {
  state.instances.forEach((i) => {
    if (i.status === 'running') {
      const increment = Math.floor(Math.random() * 50) + 10
      i.tokenUsed = Math.min(i.tokenUsed + increment, i.tokenLimit)
      i.lastActivity = new Date()
    }
  })
}, 3000)

export function useSwarmStore() {
  const stats = computed(() => ({
    totalInstances: state.instances.length,
    activeInstances: state.instances.filter(i => i.status === 'running').length,
    totalTokensUsed: state.instances.reduce((sum, i) => sum + i.tokenUsed, 0),
    totalTokenLimit: state.instances.reduce((sum, i) => sum + i.tokenLimit, 0),
    queueLength: state.instances.filter(i => i.status === 'queued').length,
  }))

  const selectedInstance = computed(() =>
    state.instances.find(i => i.id === state.selectedId) || null
  )

  function createInstance(name: string, workspace: string, task: string) {
    const newInstance: CliInstance = {
      id: `inst-${generateId()}`,
      name,
      status: 'queued',
      workspace,
      model: 'kimi-k2',
      tokenUsed: 0,
      tokenLimit: 200000,
      createdAt: new Date(),
      lastActivity: new Date(),
      taskDescription: task,
      logs: [
        { id: generateId(), timestamp: new Date(), type: 'system', content: '实例已创建，等待启动...' },
      ],
    }
    state.instances.push(newInstance)
    setTimeout(() => {
      const inst = state.instances.find(i => i.id === newInstance.id)
      if (inst) {
        inst.status = 'running'
        inst.pid = Math.floor(Math.random() * 50000) + 10000
        inst.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: 'CLI 进程已启动' })
      }
    }, 1500)
  }

  function stopInstance(id: string) {
    const inst = state.instances.find(i => i.id === id)
    if (inst) {
      inst.status = 'stopped'
      inst.pid = undefined
      inst.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: '实例已停止' })
    }
  }

  function restartInstance(id: string) {
    const inst = state.instances.find(i => i.id === id)
    if (inst) {
      inst.status = 'running'
      inst.pid = Math.floor(Math.random() * 50000) + 10000
      inst.logs.push({ id: generateId(), timestamp: new Date(), type: 'system', content: '实例已重启' })
    }
  }

  function deleteInstance(id: string) {
    state.instances = state.instances.filter(i => i.id !== id)
    if (state.selectedId === id) state.selectedId = null
  }

  function sendCommand(id: string, command: string) {
    const inst = state.instances.find(i => i.id === id)
    if (!inst) return
    const newLog: LogEntry = { id: generateId(), timestamp: new Date(), type: 'input', content: command, tokens: Math.floor(command.length / 2) }
    inst.logs.push(newLog)
    inst.lastActivity = new Date()
    inst.tokenUsed += Math.floor(command.length / 2)

    setTimeout(() => {
      const current = state.instances.find(i => i.id === id)
      if (!current) return
      const responseLog: LogEntry = { id: generateId(), timestamp: new Date(), type: 'output', content: `收到指令: "${command}"，正在处理...`, tokens: 45 }
      current.logs.push(responseLog)
      current.lastActivity = new Date()
      current.tokenUsed += 45
    }, 800)
  }

  return {
    instances: computed(() => state.instances),
    stats,
    selectedId: computed(() => state.selectedId),
    selectedInstance,
    isCreateModalOpen: computed(() => state.isCreateModalOpen),
    setSelectedId: (id: string | null) => { state.selectedId = id },
    setIsCreateModalOpen: (v: boolean) => { state.isCreateModalOpen = v },
    createInstance,
    stopInstance,
    restartInstance,
    deleteInstance,
    sendCommand,
  }
}
