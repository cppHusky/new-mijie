<template>
    <hr />
    <p style="text-align: center;">
        第 <strong>{{ turn }}</strong> 回合 · 剩余火焰 {{ burning }}{{water===2?" · 水之加持":""}}
    </p>
    <div style="display: flex; flex-direction: column; align-items: center;">
        <div class="grid">
            <button v-for="i in 64" :key="i" class="cell" :class="cellClass(i - 1)"
                :disabled="busy" @click="handleClick(i - 1)">
                <span class="wet-num">{{ wet[i - 1] > 0 ? wet[i - 1] : '' }}</span>
            </button>
        </div>
    </div>
    <p style="text-align: center; margin-top: 12px;">
        <span class="legend"><span class="dot burning"></span>着火</span>
        <span class="legend"><span class="dot wet"></span>水之加持（1 回合）</span>
        <span class="legend"><span class="dot clear"></span>已熄灭</span>
    </p>
</template>

<script setup>
import { inject, ref, computed } from 'vue';
const api = inject("api");
const fire = ref(Array(64).fill(1));
const wet = ref(Array(64).fill(0));
const turn = ref(0);
const water = ref(2);
const busy = ref(false);
const burning = computed(() => fire.value.reduce((acc, cur) => acc + cur, 0));

function apply(s) {
    fire.value = s.fire;
    wet.value = s.wet;
    turn.value = s.turn;
    water.value = s.water;
}

function cellClass(i) {
    if (fire.value[i] === 1) return 'burning';
    if (wet.value[i] > 0) return 'wet';
    return '';
}

api("init").then(apply).catch(console.error);

async function handleClick(i) {
    if (busy.value) return;
    busy.value = true;
    try {
        apply(await api("spray", i));
    } finally {
        busy.value = false;
    }
}

</script>

<style scoped>
.grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 2px;
    max-width: 520px;
    min-width: 300px;
    width: 100%;
}
.cell {
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    background-color: #666;
    color: white;
    aspect-ratio: 1 / 1;
    padding: 0;
    position: relative;
    cursor: pointer;
    transition: background-color 0.15s ease;
}
.cell:hover:not(:disabled) {
    filter: brightness(1.25);
}
.cell:disabled {
    cursor: not-allowed;
}
.cell.burning {
    background-color: #e65100;
    box-shadow: 0 0 6px rgba(230, 64, 0, 0.8);
}
.cell.wet {
    background-color: #1565c0;
}
.wet-num {
    font-size: 11px;
    position: absolute;
    top: 1px;
    right: 3px;
    opacity: 0.85;
}
.legend {
    display: inline-block;
    margin: 0 8px;
    font-size: 12px;
}
.dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    margin-right: 4px;
    vertical-align: -1px;
    background-color: #666;
}
.dot.burning {
    background-color: #e65100;
}
.dot.wet {
    background-color: #1565c0;
}
.dot.clear {
    background-color: #666;
}
</style>
