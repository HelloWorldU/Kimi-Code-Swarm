<script setup lang="ts">
import { ref } from 'vue'
import { Plus, Activity, ClipboardList, Coins, CheckCircle, Github } from 'lucide-vue-next'
import Sidebar from './components/Sidebar.vue'
import TaskCard from './components/TaskCard.vue'
import CreateTaskModal from './components/CreateTaskModal.vue'
import TaskDetail from './components/TaskDetail.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import AnalyticsPanel from './components/AnalyticsPanel.vue'
import { useSwarmStore } from './store/useSwarmStore'

const store = useSwarmStore()
const activeTab = ref('dashboard')

function handleTabChange(tab: string) {
  activeTab.value = tab
  store.setSelectedTaskId(null)
}

async function handleShowFileDiff(taskId: string, filePath: string) {
  const diff = await store.getFileDiff(taskId, filePath)
  const task = store.tasks.value.find(t => t.id === taskId)
  if (!task) return
  task.logs.push({
    id: Math.random().toString(36).substring(2, 10),
    timestamp: new Date(),
    type: 'system',
    content: `=== ${filePath} ===\n${diff || '无变更内容'}`,
  })
}

const statCards = [
  { label: '活跃任务', value: () => store.stats.value.activeTasks.toString(), sub: () => `共 ${store.stats.value.totalTasks} 个任务`, icon: ClipboardList, color: 'bg-amber-600' },
  { label: '已完成', value: () => store.stats.value.completedTasks.toString(), sub: () => '累计交付', icon: CheckCircle, color: 'bg-emerald-600' },
  { label: 'Token 消耗', value: () => `${(store.stats.value.totalTokensUsed / 1000).toFixed(1)}K`, sub: () => `预算 ${(store.stats.value.totalTokenBudget / 1000).toFixed(0)}K`, icon: Coins, color: 'bg-blue-600' },
  { label: '系统状态', value: () => '正常', sub: () => '所有节点在线', icon: Activity, color: 'bg-swarm-600' },
]
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden bg-gray-950">
    <Sidebar :active-tab="activeTab" @change="handleTabChange" />

    <main class="flex-1 flex flex-col min-w-0">
      <!-- Top Bar -->
      <header class="h-16 border-b border-gray-800 flex items-center justify-between px-6 bg-gray-900/50 backdrop-blur">
        <div>
          <h2 class="text-lg font-semibold text-white">
            <span v-if="activeTab === 'dashboard'">任务总览</span>
            <span v-else-if="activeTab === 'tasks'">任务管理</span>
            <span v-else-if="activeTab === 'analytics'">监控分析</span>
            <span v-else>系统设置</span>
          </h2>
        </div>
        <button
          class="px-4 py-2 bg-swarm-600 hover:bg-swarm-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          @click="store.setIsCreateModalOpen(true)"
        >
          <Plus class="w-4 h-4" /> 新建任务
        </button>
      </header>

      <!-- Content -->
      <div class="flex-1 overflow-hidden p-6">
        <!-- Task Detail -->
        <TaskDetail
          v-if="store.selectedTaskId.value && store.selectedTask.value"
          :task="store.selectedTask.value"
          @back="store.setSelectedTaskId(null)"
          @start="store.startTask"
          @stop="store.stopTask"
          @send-instruction="store.sendInstruction"
          @submit-for-review="store.submitForReview"
          @merge-pr="store.mergePr"
          @reject-pr="store.rejectPr"
          @submit-review="store.submitReview"
          @show-file-diff="handleShowFileDiff"
        />

        <!-- Dashboard / Tasks -->
        <div v-else-if="activeTab === 'dashboard' || activeTab === 'tasks'" class="h-full flex flex-col">
          <!-- Stats Grid -->
          <div class="grid grid-cols-4 gap-4 mb-6">
            <div
              v-for="stat in statCards"
              :key="stat.label"
              class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4 flex items-center gap-4"
            >
              <div :class="['w-12 h-12 rounded-xl flex items-center justify-center', stat.color]">
                <component :is="stat.icon" class="w-6 h-6 text-white" />
              </div>
              <div>
                <p class="text-xs text-gray-500 font-medium">{{ stat.label }}</p>
                <p class="text-2xl font-bold text-white">{{ stat.value() }}</p>
                <p class="text-xs text-gray-500">{{ stat.sub() }}</p>
              </div>
            </div>
          </div>

          <!-- Tasks Grid -->
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">任务列表</h3>
            <div class="flex items-center gap-2 text-xs text-gray-500">
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400" /> 工作中</span>
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-purple-400" /> 待审阅</span>
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-400" /> 已完成</span>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto scrollbar-thin">
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 pb-4">
              <TaskCard
                v-for="task in store.tasks.value"
                :key="task.id"
                :task="task"
                :is-selected="store.selectedTaskId.value === task.id"
                @select="store.setSelectedTaskId"
                @start="store.startTask"
                @stop="store.stopTask"
                @delete="store.deleteTask"
              />
            </div>
          </div>
        </div>

        <!-- Placeholder Tabs -->
        <div v-else-if="activeTab === 'analytics'" class="h-full">
          <AnalyticsPanel :tasks="store.tasks.value" />
        </div>
        <div v-else class="h-full max-w-2xl mx-auto">
          <h3 class="text-lg font-semibold text-white mb-6">系统设置</h3>
          <div class="space-y-6">
            <div class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-6">
              <h4 class="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Github class="w-4 h-4" /> GitHub 配置
              </h4>
              <SettingsPanel />
            </div>
          </div>
        </div>
      </div>
    </main>

    <CreateTaskModal
      :is-open="store.isCreateModalOpen.value"
      @close="store.setIsCreateModalOpen(false)"
      @create="store.createTask"
    />
  </div>
</template>
