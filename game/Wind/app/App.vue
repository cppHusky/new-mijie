<template>
    <hr />
    <p class="status">
        回合 {{ turn }}<template v-if="canIgnite"> · 点火剩余 {{ 3 - igniteUsed }}</template>
        <span v-if="igniteMode"> · 点火中：点击一棵树干将其烧毁</span>
    </p>
    <div class="grid-wrap" :class="{ igniting: igniteMode }">
        <div class="grid">
            <div v-for="i in 81" :key="i" class="cell" :class="cellClass(i - 1)" @click="onCellClick(i - 1)">
                <svg v-if="cellMap[i - 1] === 'box red'" viewBox="0 0 24 24" class="arrow">
                    <path d="M19.5 12H6.5M12 6.5l-5.5 5.5L12 17.5" stroke="rgba(0,0,0,0.4)" stroke-width="4"
                        fill="none" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M19.5 12H6.5M12 6.5l-5.5 5.5L12 17.5" stroke="#fff" stroke-width="2.2"
                        fill="none" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <svg v-if="cellMap[i - 1] === 'box green'" viewBox="0 0 24 24" class="arrow">
                    <path d="M4.5 12h13M12 6.5l5.5 5.5-5.5 5.5" stroke="rgba(0,0,0,0.4)" stroke-width="4"
                        fill="none" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M4.5 12h13M12 6.5l5.5 5.5-5.5 5.5" stroke="#fff" stroke-width="2.2"
                        fill="none" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
            </div>
        </div>
    </div>
    <p class="legend">
        <span><i class="sw yellow"></i>普通箱</span>
        <span><i class="sw red"></i>红箱</span>
        <span><i class="sw green"></i>绿箱</span>
        <span><i class="sw trunk"></i>树干</span>
    </p>
    <div class="ctrl">
        <div class="dpad">
            <button class="btn btn-outline btn-sm" @click="blow('up')" :disabled="busy || won">↑ 上</button>
            <div class="drow">
                <button class="btn btn-outline btn-sm" @click="blow('left')" :disabled="busy || won">← 左</button>
                <button class="btn btn-outline btn-sm" @click="blow('down')" :disabled="busy || won">↓ 下</button>
                <button class="btn btn-outline btn-sm" @click="blow('right')" :disabled="busy || won">→ 右</button>
            </div>
        </div>
        <button v-if="canIgnite" class="btn btn-outline btn-sm" :class="{ 'btn-active': igniteMode }"
            :disabled="busy || won || igniteUsed >= 3" @click="toggleIgnite">
            点火（剩余 {{ 3 - igniteUsed }}）
        </button>
    </div>
    <p class="msg" v-if="message">{{ message }}</p>
</template>

<script setup>
import { inject, ref, computed } from 'vue';

const api = inject("api");
const N = 9;

const DIR_DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const STEP_MS = 150;

const boxes = ref([]);
const trunks = ref([]);
const turn = ref(0);
const igniteUsed = ref(0);
const canIgnite = ref(false);
const igniteMode = ref(false);
const busy = ref(false);
const won = ref(false);
const message = ref('');

const cellMap = computed(() => {
    const m = {};
    for (const b of boxes.value) m[b.y * N + b.x] = "box " + b.kind;
    for (const t of trunks.value) m[t.y * N + t.x] = "trunk";
    return m;
});

function cellClass(i) { return cellMap.value[i] || ""; }

function apply(s) {
    boxes.value = s.boxes;
    trunks.value = s.trunks;
    turn.value = s.turn;
    igniteUsed.value = s.igniteUsed;
    canIgnite.value = !!s.canIgnite;
    if (s.won) won.value = true;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 把一次鼓风拆成逐格中间状态：同一行（左右吹）/同一列（上下吹）内顺序对应，
 * 每帧所有箱子只前进一格（被挡住的停下），返回每帧的 boxes 数组。
 */
function blowFrames(dir, oldBoxes, newBoxes) {
    const [dx, dy] = DIR_DELTA[dir];
    const movers = [];
    for (const kind of ["red", "green", "yellow"]) {
        const olds = oldBoxes.filter((b) => b.kind === kind);
        const news = newBoxes.filter((b) => b.kind === kind);
        const lines = {};
        for (const b of olds) {
            const k = dx ? b.y : b.x;
            (lines[k] = lines[k] || { olds: [], news: [] }).olds.push(b);
        }
        for (const b of news) {
            const k = dx ? b.y : b.x;
            if (lines[k]) lines[k].news.push(b);
        }
        for (const line of Object.values(lines)) {
            const ol = line.olds.sort((a, b) => (dx ? a.x - b.x : a.y - b.y));
            const nl = line.news.sort((a, b) => (dx ? a.x - b.x : a.y - b.y));
            for (let i = 0; i < ol.length; i++) {
                const o = ol[i], n = nl[i];
                movers.push({
                    kind,
                    x: o.x,
                    y: o.y,
                    steps: n && !(o.x === n.x && o.y === n.y)
                        ? (dx ? Math.abs(n.x - o.x) : Math.abs(n.y - o.y))
                        : 0,
                });
            }
        }
    }
    const maxSteps = movers.reduce((m, x) => Math.max(m, x.steps), 0);
    const frames = [];
    for (let t = 1; t <= maxSteps; t++) {
        frames.push(
            movers.map((m) => ({
                kind: m.kind,
                x: m.x + dx * Math.min(t, m.steps),
                y: m.y + dy * Math.min(t, m.steps),
            }))
        );
    }
    return frames;
}

async function blow(dir) {
    if (busy.value || won.value) return;
    busy.value = true;
    message.value = '';
    try {
        const res = await api('blow', { dir });
        if (res && res.ok === false) {
            message.value = res.reason;
            return;
        }
        // 逐格变色：每帧更新一次箱子状态，只改变格子颜色
        const frames = blowFrames(dir, boxes.value, res.boxes);
        for (const f of frames) {
            boxes.value = f;
            await sleep(STEP_MS);
        }
        apply(res);
        if (res.won) message.value = `已通过！用时 ${res.turn} 回合`;
    } catch (e) {
        message.value = '操作失败，请重试';
        console.error(e);
    } finally {
        busy.value = false;
    }
}

function toggleIgnite() {
    if (igniteMode.value) {
        igniteMode.value = false;
        return;
    }
    if (igniteUsed.value < 3) igniteMode.value = true;
}

async function onCellClick(i) {
    if (!igniteMode.value || busy.value || won.value) return;
    const x = i % N, y = (i / N) | 0;
    if (!trunks.value.some(t => t.x === x && t.y === y)) return;
    busy.value = true;
    message.value = '';
    try {
        const res = await api('ignite', { x, y });
        if (res && res.ok === false) {
            message.value = res.reason;
            return;
        }
        apply(res);
        if (res.igniteUsed >= 3) igniteMode.value = false;
    } catch (e) {
        message.value = '操作失败，请重试';
        console.error(e);
    } finally {
        busy.value = false;
    }
}

api('init').then(apply).catch(() => { message.value = '加载失败，请刷新页面重试'; });
</script>

<style scoped>
.hint {
    text-align: center;
    font-size: 13px;
    opacity: 0.8;
}
.status {
    text-align: center;
    font-size: 13px;
    margin-top: 4px;
}
.grid-wrap {
    display: flex;
    justify-content: center;
    width: 100%;
}
.grid {
    display: grid;
    grid-template-columns: repeat(9, 1fr);
    gap: 2px;
    max-width: 500px;
    min-width: 300px;
    width: 100%;
}
.cell {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    background-color: #666;
    aspect-ratio: 1 / 1;
    position: relative;
}
.cell.box {
    border-color: rgba(0, 0, 0, 0.3);
}
.cell.box.yellow {
    background-color: #eab308;
}
.cell.box.red {
    background-color: #ef4444;
}
.cell.box.green {
    background-color: #22c55e;
}
.arrow {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 62%;
    height: 62%;
    pointer-events: none;
}
.cell.trunk {
    background-color: #57534e;
}
.cell.trunk::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 42%;
    height: 72%;
    background-color: #92400e;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
}
.igniting .cell.trunk {
    cursor: pointer;
}
.igniting .cell.trunk:hover {
    filter: brightness(1.3);
}
.legend {
    display: flex;
    gap: 12px;
    justify-content: center;
    font-size: 12px;
    flex-wrap: wrap;
    margin-top: 4px;
}
.sw {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    margin-right: 4px;
    vertical-align: -1px;
}
.sw.yellow { background-color: #eab308; }
.sw.red { background-color: #ef4444; }
.sw.green { background-color: #22c55e; }
.sw.trunk { background-color: #92400e; }
.ctrl {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
}
.dpad {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
}
.drow {
    display: flex;
    gap: 4px;
}
.msg {
    text-align: center;
    font-size: 13px;
    margin-top: 4px;
}
</style>
