<script setup lang="ts">
import { ref } from 'vue'
import { Plus, Activity, Server, Coins, Layers } from 'lucide-vue-next'
import Sidebar from './components/Sidebar.vue'
import InstanceCard from './components/InstanceCard.vue'
import CreateInstanceModal from './components/CreateInstanceModal.vue'
import InstanceDetail from './components/InstanceDetail.vue'
import { useSwarmStore } from './store/useSwarmStore'

const store = useSwarmStore()
const activeTab = ref('dashboard')

function handleTabChange(tab: string) {
  activeTab.value = tab
  store.setSelectedId(null)
}

const statCards = [
  { label: '活跃实例', value: () => store.stats.value.activeInstances.toString(), sub: () => `共 ${store.stats.value.totalInstances} 个实例`, icon: Server, color: 'bg-emerald-600' },
  { label: 'Token 消耗', value: () => `${(store.stats.value.totalTokensUsed / 1000).toFixed(1)}K`, sub: () => `限额 ${(store.stats.value.totalTokenLimit / 1000).toFixed(0)}K`, icon: Coins, color: 'bg-amber-600' },
  { label: '排队任务', value: () => store.stats.value.queueLength.toString(), sub: () => '等待启动', icon: Layers, color: 'bg-blue-600' },
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
            <span v-if="activeTab === 'dashboard'">控制台总览</span>
            <span v-else-if="activeTab === 'instances'">实例管理</span>
            <span v-else-if="activeTab === 'analytics'">监控分析</span>
            <span v-else>系统设置</span>
          </h2>
        </div>
        <button
          class="px-4 py-2 bg-swarm-600 hover:bg-swarm-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          @click="store.setIsCreateModalOpen(true)"
        >
          <Plus class="w-4 h-4" /> 新建实例
        </button>
      </header>

      <!-- Content -->
      <div class="flex-1 overflow-hidden p-6">
        <!-- Instance Detail -->
        <InstanceDetail
          v-if="store.selectedId.value && store.selectedInstance.value"
          :instance="store.selectedInstance.value"
          @back="store.setSelectedId(null)"
          @send-command="store.sendCommand"
        />

        <!-- Dashboard / Instances -->
        <div v-else-if="activeTab === 'dashboard' || activeTab === 'instances'" class="h-full flex flex-col">
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

          <!-- Instances Grid -->
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">CLI 实例列表</h3>
            <div class="flex items-center gap-2 text-xs text-gray-500">
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-400" /> 运行中</span>
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-blue-400" /> 空闲</span>
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-400" /> 错误</span>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto scrollbar-thin">
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 pb-4">
              <InstanceCard
                v-for="instance in store.instances.value"
                :key="instance.id"
                :instance="instance"
                :is-selected="store.selectedId.value === instance.id"
                @select="store.setSelectedId"
                @stop="store.stopInstance"
                @restart="store.restartInstance"
                @delete="store.deleteInstance"
              />
            </div>
          </div>
        </div>

        <!-- Placeholder Tabs -->
        <div v-else-if="activeTab === 'analytics'" class="flex items-center justify-center h-full text-gray-500">
          <div class="text-center">
            <Activity class="w-16 h-16 mx-auto mb-4 text-gray-700" />
            <p class="text-lg font-medium">监控分析面板</p>
            <p class="text-sm mt-2">Token 使用趋势、实例负载图表等功能即将上线</p>
          </div>
        </div>
        <div v-else class="flex items-center justify-center h-full text-gray-500">
          <div class="text-center">
            <Layers class="w-16 h-16 mx-auto mb-4 text-gray-700" />
            <p class="text-lg font-medium">系统设置</p>
            <p class="text-sm mt-2">CLI 路径配置、Token 限额、通知设置等功能即将上线</p>
          </div>
        </div>
      </div>
    </main>

    <CreateInstanceModal
      :is-open="store.isCreateModalOpen.value"
      @close="store.setIsCreateModalOpen(false)"
      @create="store.createInstance"
    />
  </div>
</template>
