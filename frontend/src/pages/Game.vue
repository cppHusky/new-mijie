<template>
    <div>
        <TitleCard :title="title" :minHeight="100">
            <template #subtitle>
                <div class="flex title flex-row items-center justify-center"
                    v-if="myScore !== 0 || percent !== null && percent !== undefined || passed">
                    <div class="flex flex-col items-center justify-center">
                        <div class="text-2xl font-bold">
                            {{ myScore }} pts
                            <span v-if="percent !== null && percent !== undefined" class="tooltip"
                                data-tip="通过人数 / 提交人数">
                                , {{ percent }}% passed
                            </span>
                            <span v-if="passed">
                                , <router-link :to="'/record/' + $route.params.pid + '?passed=true'"
                                    class="link">已通过</router-link>
                            </span>
                        </div>
                    </div>
                </div>
            </template>
            <template v-if="gameState == 1 || !solved_description">
                <div class="min-h-[100px] items-center justify-center flex flex-col">
                    <Problem :description="problem" :key="problemKey"></Problem>
                </div>
                <FileList v-if="files.length" :files="files" @download="downloadFile" />
            </template>
            <div class="min-h-[100px] items-center justify-center flex flex-col" v-else>
                <Problem :description="solved_description"></Problem>
            </div>
        </TitleCard>
        <div v-if="user.admin && user.admin?.value >= 1" class="text-center w-full">
            <div class="mt-4 mx-auto max-w-[80%] w-[800px] border border-red-500 rounded-md p-4">
                <div class="flex justify-between text-red-500">
                    <span class="text-lg my-auto font-mono">Admin Area</span>
                    <button class="btn btn-ghost btn-sm" @click="pluginApi('__admin_bypass', undefined, true)">跳过此题</button>
                </div>
                <div class="mt-2">
                    <Suspense v-if="problem?.admin">
                        <Mdv :description="{ mdv: problem.admin, pid: problem.pid }" :admin="true" />
                        <template #fallback>
                            <Loading />
                        </template>
                    </Suspense>
                </div>
            </div>
        </div>
        <div v-if="scores.length" class="mx-auto text-center flex flex-col items-center justify-center card container">
            <h2 class="text-xl my-5 font-bold">得分表</h2>
            <ul class="menu bg-base-200 w-full rounded-box mb-5">
                <li v-for="s in scores" :key="s.id">
                    <a class="flex justify-between select-text" style="white-space: pre-wrap; word-break: break-all;">
                        <span>
                            <font-awesome-icon :icon="['fas', s.achieved ? 'circle-check' : 'circle-xmark']" class="mr-2"
                                :class="s.achieved ? 'text-success' : 'text-gray-500'" />{{ s.desc }}
                        </span>
                        <span class="font-mono ml-3 shrink-0" :class="s.points >= 0 ? 'text-success' : 'text-error'">
                            {{ s.points > 0 ? '+' : '' }}{{ s.points }} 分
                        </span>
                    </a>
                </li>
            </ul>
        </div>
        <div v-if="hints.length" class="mx-auto text-center flex flex-col items-center justify-center card container">
            <h2 class="text-xl my-5 font-bold">当前收集到的线索</h2>
            <ul class="menu bg-base-200 w-full rounded-box">
                <li><a class="select-text" :key="hint" v-for="hint in hints"
                        style="white-space: pre-wrap; word-break: break-all;">{{ hint }}</a></li>
            </ul>
        </div>
        <div class="mx-auto text-center flex flex-col items-center justify-center mb-20">
            <div class="card container">
                <template v-if="gameState == 1">
                    <template v-if="inputs !== false">
                        <textarea v-if="!inputs || !inputs.length" class="mt-5 textarea textarea-white"
                            style="border-color: hsl(var(--bc) / 0.2)" placeholder="输入答案" v-model="ans"
                            v-auto-expand ref="input_textareas"></textarea>
                        <template v-else>
                            <textarea v-for="(input, index) in inputs" :key="index"
                                class="mt-5 textarea textarea-white" style="border-color: hsl(var(--bc) / 0.2)"
                                :placeholder="input.placeholder || '输入答案'" v-model="answers[index]" v-auto-expand
                                ref="input_textareas"></textarea>
                        </template>
                    </template>
                    <div class="flex flex-col mx-auto" v-if="show_turnstile">
                        <div id="cfTurnstile" class="cf-turnstile mt-5" data-action="submit_problem"></div>
                    </div>
                    <div class="grid gap-4 mt-5"
                        :class="{ 'grid-cols-2': passed && inputs !== false, 'grid-cols-1': !passed || inputs === false }">
                        <button class="submit btn btn-outline group" v-if="inputs !== false" @click="submit"
                            :disabled="loading" style="border-color: hsl(var(--bc) / 0.2)">
                            <span class="loading loading-dots loading-xs" v-if="loading"></span>
                            提交
                            <Shortcut :disabled="loading" />
                        </button>
                        <button v-if="passed" class="submit btn btn-outline" @click="skip" :disabled="loading2"
                            style="border-color: hsl(var(--bc) / 0.2)">
                            <span class="loading loading-dots loading-xs" v-if="loading2"></span>
                            跳过
                        </button>
                    </div>
                </template>
            </div>
            <transition-group name="list">
                <template v-for="(record, index) in records" v-key="index">
                    <div class="container alert alert-error text-white mt-5 result rounded-lg" v-if="!record.passed">
                        <div>
                            <h2 class="font-bold">
                                <font-awesome-icon :icon="['fas', 'circle-xmark']" />
                                未通关
                            </h2>
                            <div class="mt-3" v-if="record.msg?.length">
                                <pre>{{ record.msg }}</pre>
                            </div>
                        </div>
                    </div>
                    <div class="container alert alert-success text-white mt-5 result rounded-lg" v-else>
                        <div>
                            <h2 class="font-bold">
                                <font-awesome-icon :icon="['fas', 'circle-check']" />
                                已通关
                            </h2>
                            <div class="mt-3" v-if="record.msg?.length">
                                <pre class="break-all">{{ record.msg }}</pre>
                            </div>
                        </div>
                    </div>
                </template>
            </transition-group>
            <Transition name="list">
                <div v-if="gameState == 2" class="card container">
                    <button class="btn btn-outline mb-5 mt-5" @click="$router.push('/problems')">
                        <font-awesome-icon :icon="['fas', 'puzzle-piece']" class="mr-1" />
                        返回题目列表
                    </button>
                    <button class="btn btn-outline mb-5"
                        @click="retry">
                        再试一次
                    </button>
                </div>
            </Transition>
            <Transition name="down">
                <button class="btn btn-circle down shadow-lg fixed bottom-3 right-5 text-white" @click="down"
                    :class="{ 'btn-success': state == 1, 'btn-error': state == 2 }" v-if="showDown">
                    <font-awesome-icon :icon="['fas', 'angles-down']" />
                </button>
            </Transition>
            <router-link tag="button" class="btn btn-link text-base-content"
                :to="`/record/${$route.params.pid}`">提交记录</router-link>
        </div>
    </div>
</template>

<script setup>
import TitleCard from '@/components/TitleCard.vue';
import Shortcut from '@/components/Shortcut.vue';
import Loading from '@/components/Loading.vue';
import { ref, computed, nextTick, provide, onMounted, onUnmounted, useTemplateRef, defineAsyncComponent } from 'vue'
import { api, downloadFile as download } from '@/tools/api'
import { useRouter } from 'vue-router'
import { user } from '@/tools/bus'
import notificationManager from '@/tools/notification.js'
import Problem from '@/components/Problem.vue'
import FileList from '@/components/FileList.vue'
import { getKeys } from '@/tools/keys'

const Mdv = defineAsyncComponent(() => import('@/components/Mdv.vue'))
const answers = ref([])
const router = useRouter()
const title = ref('')
const problem = ref(null)
const myScore = ref(0)
const passed = ref(false)
const scores = ref([])
const ans = ref('')
const loading = ref(false)
const records = ref([])
const showDown = ref(false)
const files = ref([])
const gameState = ref(1)
const percent = ref(null)
const inputs = ref(null)
const input_textareas = useTemplateRef("input_textareas")
const solved_description = ref(null)
let lastSubmit = null
const hintr = localStorage.getItem('hints')
const hints = ref([])
const show_turnstile = ref(false)
const loading2 = ref(false)
let initProblem = null
const problemKey = ref(0)
function retry() {
    problem.value = initProblem
    gameState.value = 1
    records.value = []
    problemKey.value++
    ans.value = ''
    if (inputs.value && inputs.value !== true) {
        answers.value = inputs.value.map(() => '')
    }
    cf_token = null
    nextTick(resize)
}
function resize() {
    function resizeTextarea(el) {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    }
    if (input_textareas.value.length) {
        input_textareas.value.forEach(el => {
            resizeTextarea(el)
        })
    } else {
        resizeTextarea(input_textareas.value)
    }
}
function onKeydown(e) {
    if (gameState.value != 1) return;
    if (e.key == 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        submit({})
    }
}
onMounted(() => {
    window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
})
if (hintr) {
    try {
        const hintk = JSON.parse(hintr)
        if (hintk[router.currentRoute.value.params.pid]?.length) {
            hints.value = hintk[router.currentRoute.value.params.pid]
        }
    } catch (err) {
        console.error(err)
    }
}
let cf_token = null

const state = computed(() => {
    if (!records.value.length) return 0;
    if (records.value[0].passed) return 1;
    return 2;
})

if (!user.login.value) {
    localStorage.setItem('afterLogin', router.currentRoute.value.fullPath)
    router.push('/login')
}

function toggle_turnstile(cb) {
    if (show_turnstile.value) return;
    show_turnstile.value = true;
    loading.value = true;
    nextTick(async () => {
        turnstile.render('#cfTurnstile', {
            sitekey: (await getKeys()).turnstile,
            callback: (token) => {
                cf_token = token;
                loading.value = false;
                setTimeout(() => {
                    turnstile.remove();
                    show_turnstile.value = false;
                }, 2000);
                cb({ token });
            }
        });
    })
}

function down() {
    const res = document.getElementsByClassName('result');
    if (!res.length) return;
    const rect = res[0].getBoundingClientRect();
    window.scrollTo({
        top: rect.top - 100,
        behavior: 'smooth'
    })
}

function downloadFile(file) {
    download(`/api/file/${router.currentRoute.value.params.pid}/${file}`, file)
}

function checkIfResultInViewport() {
    const res = document.getElementsByClassName('result');
    if (!res.length) return true
    const rect = res[0].getBoundingClientRect()
    return window.innerHeight > rect.bottom || rect.top < 100
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function notifyAwarded(awarded) {
    for (const a of awarded || []) {
        notificationManager.add({
            message: `达成【${a.desc}】${a.points > 0 ? '+' : ''}${a.points} 分`,
            type: a.points >= 0 ? 'success' : 'error',
            time: 4000,
        })
        const s = scores.value.find(x => x.id === a.id)
        if (s) s.achieved = true
    }
    if (awarded?.length) user.update()
}

async function setResult(res) {
    if (res.turnstile) {
        toggle_turnstile(submit)
        return false;
    }
    records.value = []
    if (lastSubmit) await sleep(500 - new Date().getTime() + lastSubmit.getTime())
    else await sleep(100)
    records.value.unshift(res)
    notifyAwarded(res.awarded)
    if (res.passed) {
        gameState.value = 2
        passed.value = true
    }
    if (res.percent != undefined && res.percent != null) percent.value = res.percent
    if (res.content) problem.value = {
        pid: router.currentRoute.value.params.pid,
        content: res.content
    }
    if (res.after_solve) solved_description.value = {
        pid: router.currentRoute.value.params.pid,
        ...res.after_solve
    }
    nextTick(() => {
        if (!checkIfResultInViewport()) showDown.value = true
    })
    return true;
}

async function submit({ token }) {
    if (loading.value) return;
    loading.value = true
    records.value = []
    lastSubmit = new Date()
    showDown.value = false
    try {
        const res = await api('/api/problem/' + router.currentRoute.value.params.pid, {
            ans: inputs.value
                ? (
                    inputs.value === true ?
                        ans.value :
                        Object.fromEntries(inputs.value.map((input, index) => [input.name, answers.value[index]]))
                ) : ans.value,
            token: token || cf_token
        })
        if (!await setResult(res)) {
            return;
        }
        loading.value = false
    } catch (err) {
        if (err.status == 401) {
            localStorage.setItem('afterLogin', router.currentRoute.value.fullPath)
            router.push('/login')
        }
        loading.value = false
        console.error(err)
    }
}

async function skip() {
    records.value = []
    loading2.value = true
    showDown.value = false
    lastSubmit = new Date()
    try {
        const res = await api('/api/skipProblem/' + router.currentRoute.value.params.pid)
        await sleep(500 - new Date().getTime() + lastSubmit.getTime())
        records.value.unshift(res)
        if (res.passed) gameState.value = 2
        if (res.percent != undefined && res.percent != null) percent.value = res.percent
        if (res.after_solve) solved_description.value = {
            pid: router.currentRoute.value.params.pid,
            ...res.after_solve
        }
        nextTick(() => {
            if (!checkIfResultInViewport()) showDown.value = true
        })
        loading2.value = false
    } catch (err) {
        console.log(err)
        if (err.status == 401) {
            localStorage.setItem('afterLogin', router.currentRoute.value.fullPath)
            router.push('/login')
        }
        loading2.value = false
    }
}

async function pluginApi(event, data, admin) {
    const result = await api('/api/problem/' + router.currentRoute.value.params.pid + '/server?' +
        new URLSearchParams({ admin }), {
        event,
        data
    })
    if (result.passed !== undefined) {
        await setResult({
            passed: result.passed,
            msg: result.msg || '',
            awarded: result.awarded,
            after_solve: result.after_solve
        })
    } else {
        notifyAwarded(result.awarded)
    }
    if (result.percent != undefined && result.percent != null) percent.value = result.percent
    return result.res
}
provide("api", (event, data) => pluginApi(event, data, false))
provide('admin_api', (event, data) => pluginApi(event, data, true))
provide("reset", () => {
    records.value = []
})

document.addEventListener('scroll', () => {
    if (checkIfResultInViewport()) showDown.value = false
    else if (records.value.length) showDown.value = true
})
; (async function () {
    try {
        const res = await api('/api/problem/' + router.currentRoute.value.params.pid)
        title.value = res.name
        problem.value = initProblem = {
            pid: router.currentRoute.value.params.pid,
            admin: res.admin,
            ...res.description,
        }
        myScore.value = res.myScore
        passed.value = res.passed
        scores.value = res.scores || []
        inputs.value = res.inputs
        if (res.inputs && res.inputs !== true) answers.value = res.inputs?.map(() => '')
        percent.value = res.percent
        if (res.files && res.files.length) files.value = res.files
        document.title = res.name + ' | ' + document.title.split(' | ')[1]
    } catch (err) {
        if (err.status == 401) {
            localStorage.setItem('afterLogin', router.currentRoute.value.fullPath)
            router.push('/login')
        } else if (err.status == 404) {
            router.replace('/404')
        }
        console.log("Error:", err)
    }
})()

</script>

<style scoped>
@keyframes fadeIn {
    from {
        opacity: 0;
    }

    to {
        opacity: 1;
    }
}

.textarea {
    font-family: monospace;
}

.btn.submit,
.textarea {
    animation: fadeIn var(--animation-duration, 0.5s) ease;
}

.textarea:focus {
    outline-color: hsl(var(--bc) / 0.2);
}

.container {
    width: 800px;
    max-width: 80%;
}

.list-enter-active,
.list-leave-active {
    transition: all 0.5s ease;
}

.list-enter-from,
.list-leave-to {
    opacity: 0;
    transform: none
}

pre {
    word-wrap: break-word;
    white-space: pre-wrap;
}

.down-enter-active,
.down-leave-active {
    transition: transform 0.5s ease;
}

.down-enter-from {
    transform: translateY(calc(0.75rem + 100%));
}

.down-enter-to {
    transform: translateY(0);
}

.down-leave-from {
    transform: translateY(0);
}

.down-leave-to {
    transform: translateY(calc(0.75rem + 100%));
}

.btn.down {
    animation: none;
}

.title {
    font-family: "Neutraface Text", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
    ;
}
</style>
