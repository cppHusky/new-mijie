import createPlugin, { type GameStorage, type ServerContext } from "../../src/types.ts";

// 特殊条件：作者待实现（满足时洒水保护持续 3 回合）
let waterPower = false;

const N = 8;
const LEN = N * N;
const idx = (r: number, c: number) => r * N + c;
const inBoard = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;

interface FireState {
	fire: number[];
	wet: number[];
	turn: number;
}

const fresh = (): FireState => ({
	fire: Array<number>(LEN).fill(1),
	wet: Array<number>(LEN).fill(0),
	turn: 0,
});

const save = (gs: GameStorage, s: FireState) => {
	gs.set("board.fire", s.fire);
	gs.set("board.wet", s.wet);
	gs.set("board.turn", s.turn);
};

const ensure = (gs: GameStorage): FireState => {
	const fire = gs.get<number[]>("board.fire");
	if (!fire) {
		const s = fresh();
		save(gs, s);
		return s;
	}
	return {
		fire,
		wet: gs.get<number[]>("board.wet") ?? Array<number>(LEN).fill(0),
		turn: gs.get<number>("board.turn") ?? 0,
	};
};

const snap = (s: FireState) => ({
	fire: [...s.fire],
	wet: [...s.wet],
	turn: s.turn,
	burning: s.fire.reduce((acc, cur) => acc + cur, 0),
	water: waterPower ? 2 : 1,
});

/** 执行一次洒水：浇灭 3×3 → 火蔓延 → 保护倒计时 −1 → 回合 +1 */
const doSpray = (s: FireState, cell: number) => {
	const water = waterPower ? 2 : 1;
	const r = Math.floor(cell / N), c = cell % N;
	for (let dr = -1; dr <= 1; dr++) {
		for (let dc = -1; dc <= 1; dc++) {
			const rr = r + dr, cc = c + dc;
			if (!inBoard(rr, cc)) continue;
			const i = idx(rr, cc);
			s.fire[i] = 0;
			s.wet[i] = water;
		}
	}
	const ignite: number[] = [];
	for (let i = 0; i < LEN; i++) {
		if (!s.fire[i]) continue;
		const rr = Math.floor(i / N), cc = i % N;
		for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
			const nr = rr + dr, nc = cc + dc;
			if (!inBoard(nr, nc)) continue;
			const ni = idx(nr, nc);
			if (!s.fire[ni] && s.wet[ni] === 0) ignite.push(ni);
		}
	}
	for (const i of ignite) s.fire[i] = 1;
	for (let i = 0; i < LEN; i++) if (s.wet[i] > 0) s.wet[i]--;
	s.turn++;
};

export default createPlugin({
	pid:"Fire",
	name:"Fire",
	label:"08",
	unlock:[
		{
			type:"pass",
			pid:"Shirt"
		},
		{
			type:"custom",
			when:(ctx)=>ctx.now.getMinutes()%4===3?true:false,
			desc:(ctx,_)=>ctx.now.getMinutes()%4===3?"可以解锁":"不在时间窗口内",
		},
	],
	accessible:(ctx)=>ctx.visitedPids.has("BlockedCharacters")?"visible":"hidden",
	description:{
		before_solve:{
			mdv:{
				main:"app/main.md",
				include:["app/**/*"],
			},
		}
	},
	scores:[
		{
			id:"Fire.In18Turns",
			desc:"在 18 回合内将大火全部扑灭",
			points:5,
		},
		{
			id:"Fire.In10Turns",
			desc:"在 10 回合内将大火全部扑灭",
			points:5,
		},
	],
	inputs:false,
	server:(app)=>{
		app.on("init", (_, ctx) => {
			if(ctx.gameProcess.passed.has("Water"))
				waterPower=true;
			const s = fresh();
			save(ctx.gameStorage, s);
			return snap(s);
		});
		app.on("spray", (cell: number, ctx: ServerContext) => {
			const s = ensure(ctx.gameStorage);
			if (typeof cell === "number" && cell >= 0 && cell < LEN) {
				doSpray(s, Math.floor(cell));
				save(ctx.gameStorage, s);
			}
			if (s.fire.every((f) => !f)) {
				if(s.turn <=18){
					ctx.award("Fire.In18Turns");
					if (s.turn <= 10)
						ctx.award("Fire.In10Turns");
				}
				ctx.pass(`在第 ${s.turn} 回合将大火全部扑灭`);
			}
			return snap(s);
		});
	},
});
