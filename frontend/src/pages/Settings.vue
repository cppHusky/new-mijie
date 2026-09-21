<template>
    <TitleCard title="账户设置" class="mb-20">
        <template #subtitle><div class="mt-10"></div></template>
        <div class="form-control w-full max-w-xs flex flex-col m-auto">
            <label class="label">
                <span class="label-text">QQ 号</span>
            </label>
            <input type="text" class="input input-bordered w-full max-w-xs mb-1" v-model="qq" autocomplete="off"
                placeholder="用于领奖核验"/>
            <label class="label -mt-2">
                <span class="label-text-alt"></span>
                <span class="label-text-alt text-red-400 transition-opacity" :class="{
                    'opacity-0': !qq.length || qqValid,
                    'opacity-100': qq.length && !qqValid
                }">QQ 号格式不正确</span>
            </label>
            <button class="btn btn-accent mb-5" @click="changeQQ" :disabled="qq.length > 0 && !qqValid">修改 QQ 号</button>
            <hr class="my-5">
            <label class="label">
                <span class="label-text">旧密码</span>
            </label>
            <input type="password" class="input input-bordered w-full max-w-xs" autocomplete="current-password" v-model="oldPassword"/>
            <label class="label">
                <span class="label-text">新密码</span>
            </label>
            <input type="password" class="input input-bordered w-full max-w-xs" autocomplete="new-password" v-model="password"/>
            <label class="label">
                <span class="label-text-alt"></span>
                <span class="label-text-alt text-red-400 transition-opacity" :class="{ 
                    'opacity-0': !error.length,
                    'opacity-100': error.length
                }">{{ error }}</span>
            </label>
            <label class="label -mt-3 block text-left">
                <span class="label-text">重复密码</span>
            </label>
            <input type="password" class="input input-bordered w-full max-w-xs" autocomplete="new-password" v-model="password2"/>
            <label class="label">
                <span class="label-text-alt"></span>
                <span class="label-text-alt text-red-400 transition-opacity" :class="{ 
                    'opacity-0': !password2.length || password2 == password,
                    'opacity-100': password2.length && password2 != password
                }">密码不匹配</span>
            </label>
            <button class="btn btn-accent" @click="changePassword" :disabled="error.length || !password.length || !password2.length || password != password2">更改密码</button>
        </div>
        <div v-if="reviewMode"
            class="form-control w-full max-w-xs flex flex-col m-auto mt-10 border border-error/60 rounded-box p-4">
            <h2 class="text-lg font-bold text-error mb-2">重置进度</h2>
            <p class="label-text">
                重置进度会清空你的全部游戏数据（解锁、通关、得分、提交记录等），账号将会保留，且不可恢复。
            </p>
            <button class="btn btn-error mt-3" :disabled="resetting" @click="resetProgress">
                <span class="loading loading-dots loading-xs" v-if="resetting"></span>
                重置进度
            </button>
        </div>
    </TitleCard>
</template>

<script setup>
import TitleCard from '@/components/TitleCard.vue';
import { ref, watch, computed } from 'vue'
import { api } from '@/tools/api'
import { useRouter } from 'vue-router'
import { user } from '@/tools/bus'
import { reviewMode, loadMode } from '@/tools/mode'
import notificationManager from '@/tools/notification.js'
const router = useRouter()
const qq = ref(user.qq?.value || '')
const oldPassword = ref('')
const password = ref('')
const password2 = ref('')
const error = ref('')
const resetting = ref(false)
const qqValid = computed(() => /^[1-9]\d{4,10}$/.test(qq.value))
loadMode()
if (!user.login.value) {
    localStorage.setItem('afterLogin', router.currentRoute.value.fullPath)
    router.replace('/login')
}
async function changeQQ() {
    try {
        await api('/api/change-qq', { qq: qq.value })
        user.update()
    } catch (err) {
        console.log(err)
    }
}
watch(password, () => {
    if (!password.value.length) {
        error.value = ''
        return
    }
    if (password.value.length < 16) {
        error.value = '密码长度不足 16 位'
    } else if (password.value.length > 128) {
        error.value = '密码长度超过 128 位'
    } else if (!password.value.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[~!@#$%^&*()_+`\-={}:";'<>?,.\/]).{16,128}$/)) {
        error.value = '密码必须包含大小写字母、数字和特殊符号'
    } else {
        error.value = ''
    }
})
async function changePassword() {
    try {
        await api('/api/change-password', {
            password: oldPassword.value,
            newPassword: password.value
        })
    } catch (err) {
        console.log(err)
    }
}
async function resetProgress() {
    if (!window.confirm('重置后将清空你的全部游戏数据，账号保留，且不可恢复，确定继续吗？')) return
    resetting.value = true
    try {
        await api('/api/reset-progress', {})
        user.update()
        notificationManager.add({ message: '进度已重置', type: 'success' })
        router.push('/problems')
    } catch (err) {
        console.log(err)
    } finally {
        resetting.value = false
    }
}
</script>
