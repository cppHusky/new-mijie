<template>
    <hr />
    <div class="water">
        <p class="status">
            第 <strong>{{ turn }}</strong> 回合
            <span class="sep">·</span>体力
            <strong :class="{ low: stamina <= 25, mid: stamina > 25 && stamina <= 50 }">{{ stamina }}</strong>/100
            <span class="sep">·</span>视野 <strong>{{ vision }}</strong>
            <span class="sep">·</span>洋流
            <svg class="flow-mini" :style="{ transform: 'rotate(' + (-current * 60) + 'deg)' }" viewBox="0 0 24 24">
                <path d="M4 12h13M13 7l5 5-5 5" stroke="currentColor" stroke-width="3.4" fill="none"
                    stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span v-if="buffs.storm" class="buff">⛈️{{ buffs.storm }}</span>
            <span v-if="buffs.fog" class="buff">🌫️{{ buffs.fog }}</span>
            <span v-if="buffs.dolphin" class="buff">🐬{{ buffs.dolphin }}</span>
            <span v-if="buffs.vision" class="buff">🔭{{ buffs.vision }}</span>
            <span v-if="paralyze" class="buff">🪼麻痹</span>
            <span v-if="islands" class="buff">🛕土之加持</span>
        </p>
        <div class="layout">
            <div class="map-side">
                <div class="map">
                    <div v-for="t in tileList" :key="t.q + ',' + t.r" class="hex"
                        :class="['k-' + t.kind, { dim: t.dim, done: t.done, clickable: t.clickable, player: isPlayer(t) }]"
                        :style="hexStyle(t)" @click="onTileClick(t)">
                        <span v-if="isPlayer(t)" class="kind-emoji">🏊</span>
                        <span v-else class="kind-emoji">{{ KIND_ICON[t.kind] || '' }}</span>
                    </div>
                    <div v-if="won" class="overlay won">🏖️ 你抵达了大陆！<br />恭喜通关</div>
                    <div v-else-if="dead" class="overlay dead">☠️ {{ deadCause }}<br />刷新页面可以重新开始</div>
                    <div v-else-if="wash" class="overlay wash">🌊 你被冲到了远处……</div>
                </div>
            </div>
            <div class="side">
                <div class="panel-title" v-if="itemList.length">背包</div>
                <div class="pack" v-if="itemList.length">
                    <div v-for="it in itemList" :key="it.id" class="item" :title="it.desc">
                        <span class="item-name">{{ it.icon }} {{ it.name }}<template v-if="it.count > 1">
                                ×{{ it.count }}</template></span>
                        <button v-if="it.usable" class="btn btn-outline btn-xs" @click="useItem(it.id)"
                            :disabled="busy || won || dead">使用</button>
                        <span v-else class="passive">被动</span>
                    </div>
                </div>
                <div class="panel-title" v-if="log.length">航海日志</div>
                <ul class="log" v-if="log.length" ref="logEl">
                    <li v-for="(l, i) in log" :key="i">{{ l }}</li>
                </ul>
            </div>
        </div>
        <p class="msg" v-if="message">{{ message }}</p>
    </div>
</template>

<script setup>
import { inject, ref, computed, nextTick } from 'vue';

const api = inject("api");

// —— 与 index.ts 保持一致 ——
const DIR_DELTA = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const KIND_ICON = {
    plain: "", calm: "",
    seagull: "🕊️", bottle: "🍾", whale: "🐋", lighthouse: "🗼",
    warmCurrent: "♨️", driftwood: "🪵", fishSchool: "🐟", starfish: "⭐",
    dolphin: "🐬", shipwreck: "⚓", island: "🏝️", shark: "🦈",
    jellyfish: "🪼", reef: "🪨", seaSnake: "🐍", whirlpool: "🌀",
    fog: "🌫️", storm: "⛈️", turtle: "🐢", land: "🏖️",
};
const ITEM_META = {
    fish: { icon: "🐟", name: "鱼", desc: "使用后恢复 5 点体力", usable: true },
    starfish: { icon: "⭐", name: "海星", desc: "使用后恢复 8 点体力", usable: true },
    compass: { icon: "🧭", name: "罗盘", desc: "揭示大陆所在的方向", usable: true },
    telescope: { icon: "🔭", name: "望远镜", desc: "视野 +2，持续 4 回合", usable: true },
    lifeRing: { icon: "🛟", name: "救生圈", desc: "被动：替你抵挡一次鲨鱼袭击", usable: false },
};
const MAP_W = 560;
const MAP_H = 400;
const SIZE_BY_VISION = { 1: 44, 2: 36, 3: 30, 4: 26 };

const pos = ref({ q: 0, r: 0 });
const stamina = ref(100);
const turn = ref(0);
const current = ref(0);
const vision = ref(2);
const items = ref({});
const islands = ref(false);
const buffs = ref({ fog: 0, storm: 0, dolphin: 0, vision: 0 });
const paralyze = ref(false);
const dead = ref(false);
const deadCause = ref("");
const won = ref(false);
const log = ref([]);
const message = ref("");
const busy = ref(false);
const wash = ref(false);
const logEl = ref(null);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function hexDistLocal(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q - b.q + a.r - b.r)) / 2;
}

// 已探索格子的永久外观（跨回合缓存；dim 为当前是否在视野外）
const cache = ref(new Map());

function apply(res) {
    if (!res || res.ok === false) {
        message.value = res?.reason || "操作失败，请重试";
        return;
    }
    message.value = "";
    pos.value = res.pos;
    stamina.value = res.stamina;
    turn.value = res.turn;
    current.value = typeof res.current === "number" ? res.current : 0;
    vision.value = res.vision;
    items.value = res.items || {};
    islands.value = !!res.islands;
    buffs.value = res.buffs || { fog: 0, storm: 0, dolphin: 0, vision: 0 };
    paralyze.value = !!res.paralyze;
    dead.value = !!res.dead;
    deadCause.value = res.deadCause || "";
    won.value = !!res.won;
    // 先全部置为视野外（离开视野即变暗），再写入本回合视野
    for (const t of cache.value.values()) t.dim = true;
    for (const t of res.tiles || []) {
        cache.value.set(t.q + "," + t.r, { q: t.q, r: t.r, kind: t.kind, dim: !!t.dim, visited: !!t.visited });
    }
    if (res.log && res.log.length) {
        // 按时间正序追加，并自动滚到最新
        log.value = [...log.value, ...res.log].slice(-60);
        nextTick(() => {
            if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
        });
    }
}

const hexSize = computed(() => SIZE_BY_VISION[vision.value] || 24);

const tileList = computed(() => {
    const list = [];
    for (const t of cache.value.values()) {
        let dir = -1;
        const dq = t.q - pos.value.q;
        const dr = t.r - pos.value.r;
        if (Math.abs(dq) <= 1 && Math.abs(dr) <= 1 && Math.abs(dq + dr) <= 1 && !(dq === 0 && dr === 0)) {
            dir = DIR_DELTA.findIndex(([dx, dy]) => dx === dq && dy === dr);
        }
        list.push({
            q: t.q, r: t.r, kind: t.kind, dim: t.dim,
            done: !!t.visited && !(t.q === pos.value.q && t.r === pos.value.r),
            dir, clickable: dir >= 0,
        });
    }
    return list;
});

function hexStyle(t) {
    const S = hexSize.value;
    const w = Math.sqrt(3) * S;
    const h = 2 * S;
    const rx = Math.sqrt(3) * S * ((t.q - pos.value.q) + (t.r - pos.value.r) / 2);
    const ry = 1.5 * S * (t.r - pos.value.r);
    return {
        width: w.toFixed(1) + "px",
        height: h.toFixed(1) + "px",
        left: (MAP_W / 2 + rx - w / 2).toFixed(1) + "px",
        top: (MAP_H / 2 + ry - h / 2).toFixed(1) + "px",
        fontSize: (S * 0.42).toFixed(1) + "px",
    };
}

function compassStyle(d) {
    const ang = d * 60 * Math.PI / 180;
    return {
        left: (50 + 40 * Math.cos(ang)) + "%",
        top: (50 - 40 * Math.sin(ang)) + "%",
    };
}

function isPlayer(t) {
    return t.q === pos.value.q && t.r === pos.value.r;
}

function onTileClick(t) {
    if (!t.clickable) return;
    move(t.dir);
}

async function move(dir) {
    if (busy.value || won.value || dead.value) return;
    busy.value = true;
    try {
        const res = await api("move", { dir });
        if (!res || res.ok === false) {
            message.value = res?.reason || "操作失败，请重试";
            return;
        }
        // 沿路径动画位移：普通移动快速滑动，载人逐格前进，瞬移长距离冲走
        const path = res.path || [];
        if (path.length > 1 && !res.dead && !res.won) {
            for (let i = 1; i < path.length; i++) {
                const d = hexDistLocal(path[i - 1], path[i]);
                pos.value = { q: path[i].q, r: path[i].r };
                wash.value = d > 1;
                await sleep(d > 1 ? 240 + d * 70 : 130);
            }
            wash.value = false;
        }
        apply(res);
    } catch (e) {
        message.value = "操作失败，请重试";
        console.error(e);
    } finally {
        busy.value = false;
    }
}

async function useItem(id) {
    if (busy.value || won.value || dead.value) return;
    busy.value = true;
    try {
        const res = await api("use", { item: id });
        apply(res);
    } catch (e) {
        message.value = "操作失败，请重试";
        console.error(e);
    } finally {
        busy.value = false;
    }
}

const itemList = computed(() => {
    const list = [];
    for (const [id, count] of Object.entries(items.value || {})) {
        const meta = ITEM_META[id];
        if (!meta || count <= 0) continue;
        list.push({ id, count, ...meta });
    }
    return list;
});

api("init").then(apply).catch((e) => {
    message.value = "加载失败，请刷新页面重试";
    console.error(e);
});
</script>

<style scoped>
.water {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: 100%;
}

.hint {
    text-align: center;
    font-size: 13px;
    opacity: 0.85;
    max-width: 640px;
    line-height: 1.7;
}

.status {
    text-align: center;
    font-size: 13px;
    margin: 2px 0;
}

.status strong.low { color: #ff6b6b; }
.status strong.mid { color: #ffb86b; }

.sep { opacity: 0.5; margin: 0 4px; }

.flow-mini {
    display: inline-block;
    width: 15px;
    height: 15px;
    vertical-align: -2px;
    margin: 0 3px;
    opacity: 0.9;
}

.buff {
    display: inline-block;
    margin-left: 8px;
    padding: 1px 8px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.1);
    font-size: 12px;
}

.layout {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 18px;
    width: 100%;
    margin-top: 4px;
}

.map-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    max-width: 100%;
    overflow-x: auto;
}

.map {
    position: relative;
    width: 560px;
    height: 400px;
    background: radial-gradient(circle at 50% 50%, #16324f 0%, #0c1d31 72%);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 12px;
    overflow: hidden;
}

.hex {
    position: absolute;
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    background: #1d4e80;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
}

.k-plain { background: #1d4e80; }
.k-calm { background: #23598f; }
.k-seagull { background: #a8872f; }
.k-bottle { background: #7a5a2f; }
.k-whale { background: #33587f; }
.k-lighthouse { background: #c9b45a; }
.k-warmCurrent { background: #2e7d78; }
.k-driftwood { background: #6e5233; }
.k-fishSchool { background: #2f6f9e; }
.k-starfish { background: #b0652f; }
.k-dolphin { background: #4088bd; }
.k-shipwreck { background: #4a4f5c; }
.k-island { background: #3d8b4f; }
.k-shark { background: #59222e; }
.k-jellyfish { background: #6d3a86; }
.k-reef { background: #4c4a45; }
.k-seaSnake { background: #3a6b2e; }
.k-whirlpool { background: #2e3a6b; }
.k-fog { background: #8a9199; }
.k-storm { background: #474a60; }
.k-turtle { background: #3e7d4f; }
.k-land { background: #c9a94a; }

.hex.dim { opacity: 0.38; }
.hex.done { filter: saturate(0.3) brightness(0.55); }
.hex.done .kind-emoji { opacity: 0.55; }
.hex.clickable { cursor: pointer; }
.hex.clickable:hover { filter: brightness(1.35); }
.hex.done.clickable:hover { filter: saturate(0.3) brightness(0.9); }
.hex.player {
    filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.95)) drop-shadow(0 0 2px rgba(255, 255, 255, 0.8));
    z-index: 2;
}

.kind-emoji {
    line-height: 1;
    pointer-events: none;
}

.overlay {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 17px;
    font-weight: 700;
    line-height: 1.9;
    border-radius: 12px;
    z-index: 5;
}

.overlay.won { background: rgba(18, 58, 28, 0.55); color: #b8ffc4; }
.overlay.dead { background: rgba(58, 20, 20, 0.6); color: #ffb8b8; }
.overlay.wash {
    background: rgba(10, 30, 50, 0.4);
    color: #9fd8ff;
    font-size: 15px;
    pointer-events: none;
}

.side {
    width: 268px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
}

.panel-title {
    font-size: 12px;
    opacity: 0.7;
    align-self: flex-start;
    margin: 6px 0 4px 2px;
}

.pack {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
}

.item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    padding: 4px 10px;
}

.item-name { white-space: nowrap; }
.passive { font-size: 11px; opacity: 0.6; }

.log {
    list-style: none;
    margin: 0;
    padding: 8px 12px;
    max-height: 240px;
    overflow-y: auto;
    font-size: 12px;
    text-align: left;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    width: 100%;
}

.log li {
    padding: 2px 0;
    border-bottom: 1px dashed rgba(255, 255, 255, 0.08);
    opacity: 0.9;
}

.msg {
    text-align: center;
    font-size: 13px;
    color: #ffb86b;
}
</style>
