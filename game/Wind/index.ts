import createPlugin from "../../src/types";

const N = 9;
const IGNITE_MAX = 3;

interface Box {
	x: number;
	y: number;
	kind: "yellow" | "red" | "green";
}

interface State {
	boxes: Box[];
	trunks: { x: number; y: number }[];
	turn: number;
	igniteUsed: number;
}

// 固定棋盘：箱子位于行 4–6 × 列 3–6（红在绿左、居阵型中间），12 棵树干在其余位置
const TRUNKS: { x: number; y: number }[] = [
	{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 },
	{ x: 7, y: 1 },
	{ x: 6, y: 2 },
	{ x: 0, y: 3 }, { x: 5, y: 3 },
	{ x: 0, y: 5 },
	{ x: 0, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 },
	{ x: 2, y: 8 },
];

function fresh(): State {
	const boxes: Box[] = [];
	for (let y = 4; y <= 6; y++) {
		for (let x = 3; x <= 6; x++) {
			boxes.push({ x, y, kind: "yellow" });
		}
	}
	boxes.find((b) => b.x === 4 && b.y === 5)!.kind = "red";
	boxes.find((b) => b.x === 5 && b.y === 5)!.kind = "green";
	return {
		boxes,
		trunks: TRUNKS.map((t) => ({ ...t })),
		turn: 0,
		igniteUsed: 0,
	};
}

const DIRS: Record<string, [number, number]> = {
	up: [0, -1],
	down: [0, 1],
	left: [-1, 0],
	right: [1, 0],
};

/** 全体箱子沿方向同时滑动，直到边界/树干/其它箱子阻挡（树干不挡风，只挡箱子） */
function doBlow(boxes: Box[], trunks: { x: number; y: number }[], dir: string): void {
	const [dx, dy] = DIRS[dir];
	const order = [...boxes].sort((a, b) => (dx ? (b.x - a.x) * dx : (b.y - a.y) * dy));
	const occ = new Set(trunks.map((t) => `${t.x},${t.y}`));
	for (const p of order) occ.delete(`${p.x},${p.y}`);
	for (const p of order) {
		let nx = p.x + dx;
		let ny = p.y + dy;
		while (nx >= 0 && nx < N && ny >= 0 && ny < N && !occ.has(`${nx},${ny}`)) {
			p.x = nx;
			p.y = ny;
			nx += dx;
			ny += dy;
		}
		occ.add(`${p.x},${p.y}`);
	}
}

/** 胜利：红箱恰好在绿箱右侧一格（同行相邻） */
function isWin(boxes: Box[]): boolean {
	const red = boxes.find((b) => b.kind === "red")!;
	const green = boxes.find((b) => b.kind === "green")!;
	return red.x === green.x + 1 && red.y === green.y;
}

function snapshot(state: State, canIgnite: boolean) {
	return {
		boxes: state.boxes.map((b) => ({ ...b })),
		trunks: state.trunks.map((t) => ({ ...t })),
		turn: state.turn,
		igniteUsed: state.igniteUsed,
		canIgnite,
	};
}

export default createPlugin({
	pid:"Wind",
	name:"Wind",
	label:"07",
	unlock:[
		{
			type:"points",
			atLeast:20,
		},
		{
			type:"custom",
			when:(ctx)=>ctx.now.getMinutes()%4===2?true:false,
			desc:(ctx,_)=>ctx.now.getMinutes()%4===2?"可以解锁":"不在时间窗口内",
		},
	],
	accessible:(ctx)=>ctx.visitedPids.has("BlockedCharacters")?"visible":"hidden",
	description:{
		before_solve:{
			mdv:{
				main:"app/main.md",
				include:["app/**/*"],
			},
		},
	},
	scores:[
		{ id:"Wind.in12", desc:"在 12 回合内通过本关", points:5 },
		{ id:"Wind.in3", desc:"在 3 回合内通过本关", points:5 },
	],
	inputs:false,
	server:(app)=>{
		app.on("init", (_, ctx) => {
			// 无进度恢复：每次挂载（刷新/重试）重新开局
			ctx.gameStorage.clear();
			const state = fresh();
			ctx.gameStorage.set("state", state);
			return snapshot(state, ctx.gameProcess.passed.has("Fire"));
		});
		app.on("blow", (data: { dir?: unknown }, ctx) => {
			const state = ctx.gameStorage.get<State>("state");
			if (!state) return { ok: false, reason: "尚未开始游戏，请刷新页面重试" };
			const dir = data?.dir;
			if (typeof dir !== "string" || !Object.hasOwn(DIRS, dir)) {
				return { ok: false, reason: "无效的方向" };
			}
			doBlow(state.boxes, state.trunks, dir);
			state.turn++;
			const won = isWin(state.boxes);
			if (won) {
				if (state.turn <= 12) ctx.award("Wind.in12");
				if (state.turn <= 3) ctx.award("Wind.in3");
				ctx.pass(`在第 ${state.turn} 回合，你将红箱子吹到了绿箱子的右侧`);
			}
			ctx.gameStorage.set("state", state);
			return { ...snapshot(state, ctx.gameProcess.passed.has("Fire")), won };
		});
		app.on("ignite", (data: { x?: unknown; y?: unknown }, ctx) => {
			const state = ctx.gameStorage.get<State>("state");
			if (!state) return { ok: false, reason: "尚未开始游戏，请刷新页面重试" };
			if (!ctx.gameProcess.passed.has("Fire")) {
				return { ok: false, reason: "尚未获得「火之加持」" };
			}
			if (state.igniteUsed >= IGNITE_MAX) {
				return { ok: false, reason: "点火次数已用尽" };
			}
			const x = data?.x;
			const y = data?.y;
			if (typeof x !== "number" || typeof y !== "number") {
				return { ok: false, reason: "无效的坐标" };
			}
			const at = state.trunks.findIndex((t) => t.x === x && t.y === y);
			if (at < 0) return { ok: false, reason: "这里没有树干" };
			state.trunks.splice(at, 1);
			state.igniteUsed++;
			ctx.gameStorage.set("state", state);
			return snapshot(state, ctx.gameProcess.passed.has("Fire"));
		});
	},
	record:true,
});
