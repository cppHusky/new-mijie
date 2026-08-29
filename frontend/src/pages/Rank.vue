<template>
  <div class="mb-20">
    <TitleCard title="排行榜">
      <template #subtitle>
        <div class="mt-10">
          <font-awesome-icon :icon="['fas', 'circle-info']" />
          按照题数降序、分数降序、上次有效提交时间升序排序，全部相同者排名相同。
        </div>
      </template>
      <div class="overflow-x-auto" v-if="!loading">
        <table class="table " v-if="rank.length">
          <thead>
            <tr class="text-white">
              <th>排名</th>
              <th>用户名</th>
              <th>题数</th>
              <th>分数</th>
              <th>
                <div class="tooltip tooltip-bottom" data-tip="有效提交指更新了题数或分数的提交">
                  上次有效提交
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rank" :key="row.username" :class="{ 'bg-base-200': row.username === user.username.value }">
              <th>{{ row.rank }}</th>
              <td>{{ row.username }}</td>
              <td>{{ row.passedCount }}</td>
              <td>{{ row.totalPoints }}</td>
              <td>{{ row.lastProgressAt ? new Date(row.lastProgressAt).toLocaleString() : '' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="mt-10">暂无数据</div>
      </div>
      <div v-else class="mt-10">Loading...</div>
    </TitleCard>
    <button
      :disabled="loading2"
      v-if="!loading"
      class="btn btn-circle btn-success text-white refresh shadow-lg fixed bottom-3 right-5"
      @click="refresh(false)"
      :class="{rotate: loading2}"
    >
      <font-awesome-icon :icon="['fas', 'arrows-rotate']" />
    </button>
  </div>
</template>

<script setup>
import TitleCard from '@/components/TitleCard.vue';
import { ref, onUnmounted } from 'vue'
import { api } from '@/tools/api'
import { rankEventListener, user } from '@/tools/bus'
import { useRouter } from 'vue-router';
import notificationManager from '@/tools/notification.js'
const router = useRouter()
const rank = ref([]);
const loading = ref(true)
const loading2 = ref(false)
async function refresh(noNotification) {
  loading2.value = true
  try {
    const res = await api("/api/rank")
    rank.value = res.rank
    if (!noNotification) {
      notificationManager.add({
        message: '刷新成功',
        type: 'success'
      })
    }
  } catch (err) {
    if (err.status == 401) {
      localStorage.setItem("afterLogin", "/rank")
      router.push("/login")
    }
    console.log(err)
  } finally {
    loading2.value = false
  }
}
function refreshWithNotification() {
  refresh(true)
}
rankEventListener.addEventListener('update', refreshWithNotification)
onUnmounted(() => {
  rankEventListener.removeEventListener('update', refreshWithNotification)
})
; (async function () {
  try {
    const res = await api("/api/rank")
    rank.value = res.rank
  } catch (err) {
    if (err.status == 401) {
      localStorage.setItem("afterLogin", "/rank")
      router.push("/login")
    }
    console.log(err)
  } finally {
    loading.value = false
  }
})();
</script>

<style scoped>
@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.rotate {
  animation: rotate 2s linear infinite;
}
</style>
