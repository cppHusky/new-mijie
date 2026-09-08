<template>
  <div class="mb-20">
    <TitleCard title="题目列表">
      <template #subtitle>
        <div class="mt-10">
          <font-awesome-icon :icon="['fas', 'circle-info']" />
          未解锁的题目会展示解锁条件；满足全部条件后，点击「解锁」即可进入。
        </div>
      </template>
      <div v-if="loading" class="mt-10">Loading...</div>
      <div v-else class="flex flex-col items-center w-full pb-5">
        <div v-if="!problems.length" class="mt-10">暂时没有可见的题目</div>
        <div v-for="p in problems" :key="p.pid"
          class="card bg-base-200 w-full max-w-[800px] mt-5 p-5 text-left shadow-md">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center min-w-0">
              <span class="badge badge-outline mr-3 font-mono shrink-0">{{ p.label ?? '???' }}</span>
              <span class="text-xl font-bold truncate">{{ p.state === 'visible' ? p.name : '???' }}</span>
              <button v-if="p.unlocked && p.conditions?.length" class="btn btn-ghost btn-circle btn-xs tooltip ml-1"
                :data-tip="condOpen[p.pid] ? '收起解锁条件' : '查看解锁条件'"
                :class="condOpen[p.pid] ? 'btn-active' : ''" @click="toggleCond(p.pid)">
                <font-awesome-icon :icon="['fas', 'angles-down']" class="transition-transform duration-200"
                  :class="condOpen[p.pid] ? 'rotate-180' : ''" />
              </button>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span v-if="p.passed" class="text-success">
                <font-awesome-icon :icon="['fas', 'circle-check']" class="mr-1" />已通过
              </span>
              <span v-if="p.myScore" class="font-mono" :class="p.myScore > 0 ? 'text-success' : 'text-error'">
                {{ p.myScore > 0 ? '+' : '' }}{{ p.myScore }} pts
              </span>
            </div>
          </div>
          <div v-if="!p.unlocked" class="mt-3">
            <ul>
              <li v-for="(cond, i) in p.conditions" :key="i" class="flex items-center mt-1">
                <font-awesome-icon :icon="['fas', cond.met ? 'circle-check' : 'circle-xmark']"
                  :class="cond.met ? 'text-success' : 'text-error'" class="mr-2 shrink-0" />
                <span :class="{ 'opacity-60': cond.met }">{{ cond.desc }}</span>
              </li>
            </ul>
            <button class="btn btn-outline btn-sm mt-3" :disabled="!p.canUnlock || unlocking !== ''" @click="unlock(p)">
              <span class="loading loading-dots loading-xs" v-if="unlocking === p.pid"></span>
              解锁
            </button>
          </div>
          <div v-else class="mt-3">
            <ul v-if="condOpen[p.pid]" class="mb-3">
              <li v-for="(cond, i) in p.conditions" :key="i" class="flex items-center mt-1">
                <font-awesome-icon :icon="['fas', cond.met ? 'circle-check' : 'circle-xmark']"
                  :class="cond.met ? 'text-success' : 'text-error'" class="mr-2 shrink-0" />
                <span :class="{ 'opacity-60': cond.met }">{{ cond.desc }}</span>
              </li>
            </ul>
            <router-link :to="'/game/' + p.pid" class="btn btn-outline btn-sm">进入题目</router-link>
          </div>
        </div>
      </div>
    </TitleCard>
    <button :disabled="loading" class="btn btn-circle btn-success text-white shadow-lg fixed bottom-3 right-5"
      @click="load" :class="{ rotate: loading }">
      <font-awesome-icon :icon="['fas', 'arrows-rotate']" />
    </button>
  </div>
</template>

<script setup>
import TitleCard from '@/components/TitleCard.vue';
import { ref, reactive } from 'vue'
import { api } from '@/tools/api'
import { useRouter } from 'vue-router'
import { user } from '@/tools/bus'
import notificationManager from '@/tools/notification.js'

const router = useRouter()
const problems = ref([])
const loading = ref(true)
const unlocking = ref('')
const condOpen = reactive({})

function toggleCond(pid) {
  condOpen[pid] = !condOpen[pid]
}

if (!user.login.value) {
  localStorage.setItem('afterLogin', router.currentRoute.value.fullPath)
  router.push('/login')
}

async function load() {
  loading.value = true
  try {
    const res = await api('/api/problems')
    problems.value = res.problems
  } catch (err) {
    if (err.status == 401) {
      localStorage.setItem('afterLogin', router.currentRoute.value.fullPath)
      router.push('/login')
    }
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function unlock(p) {
  unlocking.value = p.pid
  try {
    const res = await api('/api/problems/' + p.pid + '/unlock', {})
    if (res.unlocked) {
      notificationManager.add({ message: '解锁成功', type: 'success' })
      await load()
    } else {
      notificationManager.add({ message: '解锁条件未满足', type: 'error' })
      p.conditions = res.conditions
    }
  } catch (err) {
    if (err.status == 401) {
      localStorage.setItem('afterLogin', router.currentRoute.value.fullPath)
      router.push('/login')
    }
    console.error(err)
  } finally {
    unlocking.value = ''
  }
}

load()
</script>

<style scoped>
.rotate {
  animation: rotate 2s linear infinite;
}
@keyframes rotate {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
