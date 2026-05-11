<script setup lang="ts">
import { ref, watch } from 'vue'
import { createLogger } from './utils/logger'

const log = createLogger('App')
import { Plus, LogOut, Settings } from 'lucide-vue-next'
import LoginView from './components/LoginView.vue'
import AgentDashboard from './components/AgentDashboard.vue'
import AgentDetail from './components/AgentDetail.vue'
import CreateTaskModal from './components/CreateTaskModal.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import AnalyticsPanel from './components/AnalyticsPanel.vue'
import { useSwarmStore } from './store/useSwarmStore'

const store = useSwarmStore()

type View = 'dashboard' | 'agent-detail' | 'settings' | 'analytics'
const view = ref<View>('dashboard')

watch(() => store.isLoggedIn.value, (loggedIn) => {
  if (!loggedIn) view.value = 'dashboard'
})

watch(() => store.isCreateModalOpen.value, (isOpen) => {
  log.debug('isCreateModalOpen changed:', isOpen)
})

function handleLogin(key: string) {
  store.login(key)
}

function handleSelectAgent(id: string) {
  store.setSelectedAgentId(id)
  view.value = 'agent-detail'
}

function handleBackToDashboard() {
  store.setSelectedAgentId(null)
  view.value = 'dashboard'
}

async function handleShowFileDiff(agentId: string, filePath: string) {
  const diff = await store.getFileDiff(agentId, filePath)
  const agent = store.agents.value.find((a) => a.id === agentId)
  if (!agent) return
  agent.logs.push({
    id: Math.random().toString(36).substring(2, 10),
    timestamp: new Date().toISOString(),
    type: 'system',
    content: `=== ${filePath} ===\n${diff || '无变更内容'}`,
  })
}

function handleLogout() {
  store.logout()
}
</script>

<template>
  <!-- Login View -->
  <LoginView
    v-if="!store.isLoggedIn.value"
    :is-loading="store.isAuthLoading.value"
    :error="store.authError.value"
    @login="handleLogin"
  />

  <!-- Main App -->
  <div v-else class="flex h-screen w-screen overflow-hidden bg-gray-50">
    <!-- Sidebar -->
    <aside class="w-16 flex flex-col items-center py-4 border-r border-gray-200 bg-white shrink-0">
      <div class="mb-6">
        <div class="w-9 h-9 rounded-xl bg-swarm-600 flex items-center justify-center">
          <span class="text-white font-bold text-sm">K</span>
        </div>
      </div>

      <nav class="flex-1 flex flex-col items-center gap-2">
        <button
          :class="[
            'w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
            view === 'dashboard' ? 'bg-swarm-50 text-swarm-600' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
          ]"
          title="Agent 管理"
          @click="view = 'dashboard'"
        >
          <Plus class="w-5 h-5" />
        </button>
        <button
          :class="[
            'w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
            view === 'analytics' ? 'bg-swarm-50 text-swarm-600' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
          ]"
          title="监控分析"
          @click="view = 'analytics'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
        </button>
        <button
          :class="[
            'w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
            view === 'settings' ? 'bg-swarm-50 text-swarm-600' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
          ]"
          title="设置"
          @click="view = 'settings'"
        >
          <Settings class="w-5 h-5" />
        </button>
      </nav>

      <div class="mt-auto flex flex-col items-center gap-2">
        <button
          class="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          title="退出登录"
          @click="handleLogout"
        >
          <LogOut class="w-5 h-5" />
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col min-w-0">
      <!-- Top Bar -->
      <header class="h-14 border-b border-gray-200 flex items-center justify-between px-6 bg-white shrink-0">
        <div class="flex items-center gap-3">
          <h2 class="text-base font-semibold text-gray-900">
            <span v-if="view === 'dashboard'">Agent 管理</span>
            <span v-else-if="view === 'agent-detail'">Agent 详情</span>
            <span v-else-if="view === 'analytics'">监控分析</span>
            <span v-else>系统设置</span>
          </h2>
          <span v-if="view === 'dashboard'" class="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {{ store.agents.value.length }} / {{ store.maxAgents }}
          </span>
        </div>
        <button
          v-if="view === 'dashboard'"
          :disabled="!store.canCreateAgent.value"
          class="px-3 py-1.5 bg-swarm-600 hover:bg-swarm-700 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
          @click="() => { log.debug('新建 Agent button clicked'); store.setIsCreateModalOpen(true) }"
        >
          <Plus class="w-3.5 h-3.5" /> 新建 Agent
        </button>
      </header>

      <!-- Content Area -->
      <div class="flex-1 overflow-hidden p-6">
        <!-- Agent Detail -->
        <AgentDetail
          v-if="view === 'agent-detail' && store.selectedAgent.value"
          :agent="store.selectedAgent.value"
          @back="handleBackToDashboard"
          @start="store.startAgent"
          @stop="store.stopAgent"
          @send-instruction="store.sendInstruction"
          @submit-for-review="store.submitForReview"
          @merge-pr="store.mergePr"
          @reject-pr="store.rejectPr"
          @submit-review="store.submitReview"
          @show-file-diff="handleShowFileDiff"
        />

        <!-- Dashboard -->
        <AgentDashboard
          v-else-if="view === 'dashboard'"
          :agents="store.agents.value"
          :can-create="store.canCreateAgent.value"
          :max-agents="store.maxAgents"
          @select="handleSelectAgent"
          @create="store.setIsCreateModalOpen(true)"
          @start="store.startAgent"
          @stop="store.stopAgent"
          @delete="store.deleteAgent"
        />

        <!-- Analytics -->
        <div v-else-if="view === 'analytics'" class="h-full">
          <AnalyticsPanel :tasks="store.agents.value" />
        </div>

        <!-- Settings -->
        <div v-else class="h-full max-w-2xl mx-auto">
          <h3 class="text-lg font-semibold text-gray-900 mb-6">系统设置</h3>
          <div class="space-y-6">
            <div class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h4 class="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
                GitHub 配置
              </h4>
              <SettingsPanel />
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Create Modal -->
    <CreateTaskModal
      :is-open="store.isCreateModalOpen.value"
      @close="store.setIsCreateModalOpen(false)"
      @create="store.createAgent"
    />
  </div>
</template>
