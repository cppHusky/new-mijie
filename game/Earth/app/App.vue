<template>
    <hr />
    <div class="earth">
        <p class="hint" v-if="phase === 'deploy'">
            布署监测站（{{ stations.length }}/3）：点击地图放置，点击已有站点移除
        </p>
        <p class="hint" v-else>
            监测中
            <span v-if="wind"> · 风之加持</span>
        </p>

        <div class="map-wrap">
            <svg :viewBox="`0 0 ${SIZE} ${SIZE}`" class="map" ref="svgEl" @click="onMapClick">
                <g class="grid">
                    <line v-for="k in gridLines" :key="'v' + k" :class="{ axis: k === 0 }"
                        :x1="C + k * SCALE" :y1="C - 200" :x2="C + k * SCALE" :y2="C + 200" />
                    <line v-for="k in gridLines" :key="'h' + k" :class="{ axis: k === 0 }"
                        :x1="C - 200" :y1="C - k * SCALE" :x2="C + 200" :y2="C - k * SCALE" />
                    <text v-for="k in gridLabels" :key="'gx' + k" class="tick"
                        :x="C + k * SCALE" :y="C + 200 + 14" text-anchor="middle">{{ k }}</text>
                    <text v-for="k in gridLabels" :key="'gy' + k" class="tick"
                        :x="C - 200 - 5" :y="C - k * SCALE + 3" text-anchor="end">{{ k }}</text>
                </g>
                <circle class="border" :cx="C" :cy="C" :r="200" />
                <g class="cross">
                    <line :x1="C - 6" :y1="C" :x2="C + 6" :y2="C" />
                    <line :x1="C" :y1="C - 6" :x2="C" :y2="C + 6" />
                </g>
                <g v-for="(s, i) in stations" :key="'s' + i">
                    <circle class="station" :class="lightClass(i)"
                        :cx="C + s.x * SCALE" :cy="C - s.y * SCALE" :r="9" />
                    <text class="stnum" :x="C + s.x * SCALE" :y="C - s.y * SCALE + 3.5"
                        text-anchor="middle">{{ i + 1 }}</text>
                </g>
                <g v-if="guess.valid">
                    <circle class="guess" :cx="C + guess.x * SCALE" :cy="C - guess.y * SCALE" :r="5" />
                    <line class="guess" :x1="C + guess.x * SCALE - 9" :y1="C - guess.y * SCALE"
                        :x2="C + guess.x * SCALE + 9" :y2="C - guess.y * SCALE" />
                    <line class="guess" :x1="C + guess.x * SCALE" :y1="C - guess.y * SCALE - 9"
                        :x2="C + guess.x * SCALE" :y2="C - guess.y * SCALE + 9" />
                </g>
            </svg>
        </div>

        <div class="btnrow">
            <button v-if="phase === 'deploy'" class="btn btn-outline btn-sm"
                :disabled="busy || !stations.length" @click="start">
                开始监测
            </button>
            <button v-else class="btn btn-ghost btn-sm" :disabled="busy" @click="toDeploy">
                重新布署
            </button>
        </div>

        <table class="sttable" v-if="stations.length">
            <thead>
                <tr>
                    <th>站</th>
                    <th>位置 (km)</th>
                    <th>状态</th>
                    <th v-if="phase === 'monitor' && wind">到时（监测开始后 / 秒）</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(s, i) in stations" :key="i">
                    <td>{{ i + 1 }}</td>
                    <td class="mono">({{ s.x.toFixed(1) }}, {{ s.y.toFixed(1) }})</td>
                    <td>
                        <span class="dot" :class="lightClass(i)"></span>
                        <span class="lightlabel">{{ lightLabel(i) }}</span>
                    </td>
                    <td v-if="phase === 'monitor' && wind" class="mono">
                        <template v-if="lightState(i) >= 1">{{ timeOf(i, 'tP') }}</template>
                        <template v-else>—</template>
                        ·
                        <template v-if="lightState(i) >= 2">{{ timeOf(i, 'tS') }}</template>
                        <template v-else>—</template>
                    </td>
                </tr>
            </tbody>
        </table>

        <div class="answer" v-if="phase === 'monitor'">
            <p class="hint">提交震中位置（你只有一次机会）</p>
            <div class="answerrow">
                <label class="mono">x = <input class="num" type="text" inputmode="decimal"
                        v-model="guessX" placeholder="0" /></label>
                <label class="mono">y = <input class="num" type="text" inputmode="decimal"
                        v-model="guessY" placeholder="0" /></label>
                <button class="btn btn-outline btn-sm" :disabled="busy || !guess.valid" @click="submitAnswer">
                    提交
                </button>
            </div>
        </div>

        <p class="msg" v-if="message">{{ message }}</p>
    </div>
</template>

<script setup>
import { inject, ref, computed, onUnmounted } from 'vue';

const api = inject("api");

const SIZE = 460, C = 230, SCALE = 2, R = 100;
const gridLines = Array.from({ length: 21 }, (_, i) => i * 10 - 100);
const gridLabels = [-100, -80, -60, -40, -20, 20, 40, 60, 80, 100];

const svgEl = ref(null);
const phase = ref('deploy');
const stations = ref([]);
const wind = ref(false);
const lights = ref([]);
const schedule = ref([]);
const startedAt = ref(0);
const guessX = ref('');
const guessY = ref('');
const message = ref('');
const busy = ref(false);
let clientNow = 0, serverNow = 0;
let timers = [];

const counts = computed(() => ({
    p: lights.value.filter(l => l >= 1).length,
    s: lights.value.filter(l => l >= 2).length,
}));

const guess = computed(() => {
    const x = guessX.value.trim(), y = guessY.value.trim();
    if (!x || !y) return { x: 0, y: 0, valid: false };
    const nx = Number(x), ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return { x: 0, y: 0, valid: false };
    return { x: nx, y: ny, valid: true };
});

function lightState(i) { return lights.value[i] ?? 0; }
function lightClass(i) {
    const st = lightState(i);
    return st >= 2 ? 'st-red' : st >= 1 ? 'st-yellow' : 'st-idle';
}
function lightLabel(i) {
    const st = lightState(i);
    return st >= 2 ? '到达（S 波）' : st >= 1 ? '预警（P 波）' : '待命中';
}
function timeOf(i, key) {
    return ((schedule.value[i][key] - startedAt.value) / 1000).toFixed(3);
}

function onMapClick(evt) {
    if (phase.value !== 'deploy') return;
    const rect = svgEl.value.getBoundingClientRect();
    const svgX = (evt.clientX - rect.left) / rect.width * SIZE;
    const svgY = (evt.clientY - rect.top) / rect.height * SIZE;
    const p = { x: (svgX - C) / SCALE, y: (C - svgY) / SCALE };
    if (p.x * p.x + p.y * p.y > R * R) return;
    const snap = (v) => Math.round(v * 10) / 10;
    const q = { x: snap(p.x), y: snap(p.y) };
    const idx = stations.value.findIndex(s => Math.hypot(s.x - q.x, s.y - q.y) < 5);
    if (idx >= 0) {
        stations.value.splice(idx, 1);
        return;
    }
    if (stations.value.length >= 3) return;
    stations.value.push(q);
}

async function start() {
    if (busy.value) return;
    busy.value = true;
    message.value = '';
    clientNow = Date.now();
    try {
        const res = await api('start', { stations: stations.value, clientNow });
        if (!res || res.ok === false) {
            message.value = res?.reason || '开始监测失败，请重试';
            return;
        }
        wind.value = !!res.wind;
        schedule.value = res.schedule;
        startedAt.value = res.startedAt;
        serverNow = res.serverNow;
        lights.value = stations.value.map(() => 0);
        phase.value = 'monitor';
        scheduleTimers();
    } catch (e) {
        message.value = '开始监测失败，请重试';
        console.error(e);
    } finally {
        busy.value = false;
    }
}

function scheduleTimers() {
    clearTimers();
    const latency = Date.now() - clientNow;
    schedule.value.forEach((ev, i) => {
        const dP = ev.tP - serverNow - latency;
        if (dP > 0) timers.push(setTimeout(() => fire(i, 1), dP));
        else fire(i, 1);
        const dS = ev.tS - serverNow - latency;
        if (dS > 0) timers.push(setTimeout(() => fire(i, 2), dS));
        else fire(i, 2);
    });
}

function fire(i, st) {
    if (lightState(i) < st) lights.value[i] = st;
}

function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers = [];
}

function toDeploy() {
    clearTimers();
    phase.value = 'deploy';
    lights.value = [];
    schedule.value = [];
    wind.value = false;
    message.value = '';
}

async function submitAnswer() {
    if (busy.value || phase.value !== 'monitor' || !guess.value.valid) return;
    busy.value = true;
    try {
        const res = await api('answer', { x: guess.value.x, y: guess.value.y });
        if (res && res.ok) {
            message.value = `已通过！误差 ${res.error.toFixed(3)} km`;
        } else if (res && res.reset) {
            toDeploy();
            guessX.value = '';
            guessY.value = '';
            message.value = res.error != null
                ? `误差 ${res.error.toFixed(3)} km。关卡已重置，请调整布署后重新开始监测。`
                : '提交无效。关卡已重置，请调整布署后重新开始监测。';
        } else if (res && res.invalid) {
            message.value = res.reason || '请输入有效的 x、y 坐标';
        } else if (res && res.reason === 'no-session') {
            toDeploy();
            message.value = '尚无监测数据，请先开始监测。';
        } else {
            message.value = '提交失败，请重试';
        }
    } catch (e) {
        message.value = '提交失败，请重试';
        console.error(e);
    } finally {
        busy.value = false;
    }
}

api('init').then((res) => {
    if (Array.isArray(res?.stations)) stations.value = res.stations;
}).catch(() => {});

onUnmounted(clearTimers);
</script>

<style scoped>
.earth {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
}
.hint {
    text-align: center;
    font-size: 13px;
    opacity: 0.8;
}
.map-wrap {
    display: flex;
    justify-content: center;
    width: 100%;
}
.map {
    width: 100%;
    max-width: 480px;
    height: auto;
    cursor: crosshair;
    touch-action: manipulation;
}
.grid line {
    stroke: rgba(148, 163, 184, 0.25);
    stroke-width: 0.6;
}
.grid line.axis {
    stroke: rgba(148, 163, 184, 0.5);
}
.grid .tick {
    font-size: 9px;
    fill: currentColor;
    opacity: 0.55;
}
.border {
    fill: rgba(148, 163, 184, 0.06);
    stroke: rgba(148, 163, 184, 0.55);
    stroke-width: 1.5;
}
.cross line {
    stroke: rgba(148, 163, 184, 0.6);
    stroke-width: 1;
}
.station {
    stroke: #94a3b8;
    stroke-width: 2;
    cursor: pointer;
    transition: fill 0.15s ease;
}
.st-idle {
    fill: #475569;
    background-color: #475569;
}
.st-yellow {
    fill: #facc15;
    background-color: #facc15;
    animation: flashy 1s ease-out;
}
.st-red {
    fill: #ef4444;
    background-color: #ef4444;
    animation: flashy 1s ease-out;
}
.stnum {
    font-size: 10px;
    fill: #fff;
    stroke: rgba(15, 23, 42, 0.45);
    stroke-width: 1.5;
    paint-order: stroke;
    pointer-events: none;
}
.guess {
    fill: none;
    stroke: #f43f5e;
    stroke-width: 1.5;
}
@keyframes flashy {
    0% { opacity: 0.35; }
    40% { opacity: 1; }
    70% { opacity: 0.6; }
    100% { opacity: 1; }
}
.btnrow {
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
}
.sttable {
    border-collapse: collapse;
    font-size: 13px;
    margin: 4px auto;
}
.sttable th,
.sttable td {
    padding: 4px 12px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    text-align: center;
}
.mono {
    font-family: monospace;
}
.dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: -1px;
}
.lightlabel {
    font-size: 12px;
    opacity: 0.85;
}
.answerrow {
    display: flex;
    gap: 10px;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
}
.num {
    width: 90px;
    border: 1px solid rgba(148, 163, 184, 0.4);
    border-radius: 4px;
    padding: 3px 8px;
    margin: 0 2px;
    font-family: monospace;
    background: transparent;
    color: inherit;
}
.msg {
    text-align: center;
    font-size: 13px;
}
</style>
