import createPlugin, { type ServerContext } from "../../src/types";

// —— 平衡常量（可调） ——
const START_STAMINA = 100;   // 初始体力
const BASE_COST = 5;         // 移动基础消耗（顺流 -1 / 逆流 +1）
const VISION_BASE = 2;       // 基础视野半径
const LAND_MIN = 13;         // 定居点距离下限
const LAND_SPAN = 10;        // 定居点距离 ∈ [13, 22]
const BOTTLE_DAYS_PER_TILE = 1; // 漂流瓶信件：每远离定居点 1 格，投瓶日期就早 1 天
const RIDE_WHALE = 3;        // 鲸鱼搭载格数
const RIDE_TURTLE = 4;       // 老鼋第一次搭载格数
const DUMP_MIN = 4;          // 甩飞/传送距离下限
const DUMP_MAX = 7;          // 甩飞/传送距离上限
const MAX_CHAIN = 4;         // 单次移动连锁触发事件上限
const FOG_TURNS = 3;         // 雾区持续时间
const STORM_TURNS = 3;       // 暴风雨持续时间
const DOLPHIN_TURNS = 3;     // 海豚伴游持续时间
const LIGHTHOUSE_TURNS = 5;  // 灯塔视野加成持续时间
const TELESCOPE_TURNS = 4;   // 望远镜视野加成持续时间

const DIR_VECTORS: ReadonlyArray<readonly [number, number]> = [
	[1, 0],   // 0 东
	[1, -1],  // 1 东北
	[0, -1],  // 2 西北
	[-1, 0],  // 3 西
	[-1, 1],  // 4 西南
	[0, 1],   // 5 东南
];
const DIR_NAMES = ["东", "东北", "西北", "西", "西南", "东南"];

// 事件种类与权重（千分比，剩余为普通水域）
const EVENT_KINDS = [
	"seagull", "bottle", "whale", "lighthouse",
	"warmCurrent", "driftwood", "fishSchool", "starfish",
	"dolphin", "shipwreck", "island", "shark",
	"jellyfish", "reef", "seaSnake", "whirlpool",
	"fog", "storm", "turtle", "calm",
] as const;
const EVENT_WEIGHTS = [
	200, 380, 100, 60,
	320, 400, 450, 250,
	160, 150, 400, 200,
	250, 250, 100, 150,
	120, 60, 250, 600,
];

type EventKind = (typeof EVENT_KINDS)[number];

const ITEM_INFO: Record<string, { name: string; desc: string }> = {
	fish: { name: "鱼", desc: "使用后恢复 5 点体力" },
	starfish: { name: "海星", desc: "使用后恢复 8 点体力" },
	compass: { name: "罗盘", desc: "揭示定居点所在的方向" },
	telescope: { name: "望远镜", desc: "视野 +2，持续 4 回合" },
	lifeRing: { name: "救生圈", desc: "被动：替你抵挡一次鲨鱼袭击" },
};
const SHIPWRECK_ITEMS = [
	"fish","fish","fish","fish","fish","fish","fish",
	"starfish","starfish","starfish","starfish",
	"compass","compass",
	"telescope","telescope","telescope",
	"lifeRing","lifeRing","lifeRing",
];

interface Pos {
	q: number;
	r: number;
}

interface State {
	seed: number;
	D: number;           // 定居点方向（0-5）
	landQ: number;
	landR: number;
	today: number;       // 本局「今天」的零点时间戳（UTC+8），漂流瓶日期以此为基准
	pos: Pos;
	prevPos: Pos;
	stamina: number;
	turn: number;
	visited: Record<string, true>;
	items: Record<string, number>;
	turtleRides: number; // 本局遇到老鼋的次数（第一次帮，之后坑）
	fogTurns: number;
	stormTurns: number;
	dolphinTurns: number;
	visionTurns: number;
	visionBoost: number;
	paralyze: boolean;
	islands: boolean;    // 土之加持
	dead: boolean;
	deadCause: string;
	won: boolean;
	path?: Pos[];        // 本次移动经过的路径（供前端动画，snapshot 读取后即清除）
}

// —— 确定性随机（无限海同格恒定；种子只在开局随机一次） ——
function hash3(a: number, b: number, c: number, d = 0): number {
	let h = (a ^ Math.imul(b, 374761393) ^ Math.imul(c, 668265263) ^ Math.imul(d, 1068323861)) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
	h ^= h >>> 16;
	return h >>> 0;
}
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function isLandPos(state: State, q: number, r: number): boolean {
	return q === state.landQ && r === state.landR;
}
function hexDist(aq: number, ar: number, bq: number, br: number): number {
	return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq - bq + ar - br)) / 2;
}
function tileKind(state: State, q: number, r: number): EventKind | "land" | "plain" {
	if (isLandPos(state, q, r)) return "land";
	if (q === 0 && r === 0) return "plain"; // 出生点永远安全
	let roll = hash3(state.seed, q, r) % 10000;
	for (let i = 0; i < EVENT_KINDS.length; i++) {
		const kind = EVENT_KINDS[i];
		if (kind === "island" && !state.islands) continue;
		if (roll < EVENT_WEIGHTS[i]) return kind;
		roll -= EVENT_WEIGHTS[i];
	}
	return "plain";
}
/** 全图统一的洋流方向（每回合刷新） */
function currentAt(state: State, turn: number): number {
	return hash3(state.seed, 0, 0, turn * 7919 + 1) % 6;
}
function visionRadius(state: State): number {
	let v = state.fogTurns > 0 || state.stormTurns > 0 ? 1 : VISION_BASE;
	if (state.visionTurns > 0) v += state.visionBoost;
	return v;
}
function visibleTiles(state: State) {
	const R = visionRadius(state);
	const tiles: { q: number; r: number; kind: string; visited?: boolean }[] = [];
	for (let dq = -R; dq <= R; dq++) {
		for (let dr = Math.max(-R, -dq - R); dr <= Math.min(R, -dq + R); dr++) {
			const q = state.pos.q + dq;
			const r = state.pos.r + dr;
			tiles.push({
				q,
				r,
				kind: tileKind(state, q, r),
				visited: state.visited[`${q},${r}`] === true,
			});
		}
	}
	return tiles;
}

/** 漂流瓶信件：投瓶日期 = 今天 - 与定居点的格距（严格单调：日期越新，离定居点越近） */
function bottleInfo(state: State, q: number, r: number) {
	const daysAgo = Math.max(1, hexDist(q, r, state.landQ, state.landR) * BOTTLE_DAYS_PER_TILE);
	const d = new Date(state.today + 8 * 3600 * 1000 - daysAgo * 86400 * 1000);
	const dateStr = `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
	return dateStr;
}

/** 从玩家当前位置指向定居点的六方向（动态：走过定居点后方向自然翻转） */
function dirToLand(state: State): number {
	const dq = state.landQ - state.pos.q;
	const dr = state.landR - state.pos.r;
	let best = 0;
	let bestScore = -Infinity;
	for (let d = 0; d < 6; d++) {
		const [vq, vr] = DIR_VECTORS[d];
		// cube 坐标内积：单位方向与实际偏移越一致分越高
		const score = vq * dq + (vq + vr) * (dq + dr) + vr * dr;
		if (score > bestScore) {
			bestScore = score;
			best = d;
		}
	}
	return best;
}

function heal(state: State, amount: number) {
	state.stamina = Math.min(START_STAMINA, state.stamina + amount);
}
function addItem(state: State, id: string, n: number) {
	state.items[id] = (state.items[id] ?? 0) + n;
}
function moveCost(state: State, dir: number): number {
	let cost = BASE_COST;
	const cur = currentAt(state, state.turn);
	if (dir === cur) cost -= 2;
	else if (dir === (cur + 3) % 6) cost += 2;
	if (state.stormTurns > 0) cost += 1;
	if (state.dolphinTurns > 0) cost -= 1;
	if (state.paralyze) cost += 1;
	return Math.max(1, cost);
}
function tickBuffs(state: State) {
	if (state.fogTurns > 0) state.fogTurns--;
	if (state.stormTurns > 0) state.stormTurns--;
	if (state.dolphinTurns > 0) state.dolphinTurns--;
	if (state.visionTurns > 0) state.visionTurns--;
}

function win(state: State, log: string[], ctx: ServerContext) {
	state.won = true;
	log.push("前方出现了一条海岸线——你终于踏上了定居点！");
	ctx.pass(`在第 ${state.turn} 回合成功抵达定居点`);
}
function die(state: State, cause: string, log: string[], ctx: ServerContext) {
	if (state.dead) return;
	state.dead = true;
	state.deadCause = cause;
	log.push(cause);
	ctx.nopass(cause);
}

/** 载人移动：逐格朝定居点前进（动态导航），遇鲨鱼停止，抵达定居点直接通关 */
function ride(state: State, log: string[], steps: number, who: string, depth: number, ctx: ServerContext) {
	state.prevPos = { ...state.pos };
	for (let i = 0; i < steps; i++) {
		const d = dirToLand(state);
		const nq = state.pos.q + DIR_VECTORS[d][0];
		const nr = state.pos.r + DIR_VECTORS[d][1];
		if (isLandPos(state, nq, nr)) {
			state.pos = { q: nq, r: nr };
			state.path?.push({ ...state.pos });
			win(state, log, ctx);
			return;
		}
		if (tileKind(state, nq, nr) === "shark") break;
		state.pos = { q: nq, r: nr };
		state.path?.push({ ...state.pos });
	}
	log.push(`${who}载着你前进了。`);
	arrive(state, log, depth + 1, ctx);
}

/** 随机甩飞：落点避开鲨鱼与定居点，防止摔死/白嫖通关 */
function dump(state: State, log: string[], fallbackLog: string, depth: number, ctx: ServerContext) {
	const ox = state.pos.q, oy = state.pos.r;
	for (let i = 0; i < 16; i++) {
		const h = hash3(state.seed, ox, oy, state.turn * 31 + i * 7 + 5);
		const d = h % 6;
		const steps = DUMP_MIN + (Math.floor(h / 6) % (DUMP_MAX - DUMP_MIN + 1));
		const nq = ox + DIR_VECTORS[d][0] * steps;
		const nr = oy + DIR_VECTORS[d][1] * steps;
		if (isLandPos(state, nq, nr)) continue;
		if (tileKind(state, nq, nr) === "shark") continue;
		state.prevPos = { q: ox, r: oy };
		state.pos = { q: nq, r: nr };
		state.path?.push({ ...state.pos });
		log.push(fallbackLog);
		arrive(state, log, depth + 1, ctx);
		return;
	}
	log.push("浪头把你卷起来又放下，你居然还在原地。");
}

/** 到达新格子：效果只发动一次 */
function arrive(state: State, log: string[], depth: number, ctx: ServerContext) {
	if (state.won || state.dead || depth >= MAX_CHAIN) return;
	const key = `${state.pos.q},${state.pos.r}`;
	if (state.visited[key]) return;
	const kind = tileKind(state, state.pos.q, state.pos.r);
	if (kind === "shark") {
		// 鲨鱼：可被救生圈抵挡（弹回上一格，且该格不算已探索，仍可再次触发）
		if ((state.items.lifeRing ?? 0) > 0) {
			state.items.lifeRing--;
			if (state.items.lifeRing <= 0) delete state.items.lifeRing;
			state.pos = { ...state.prevPos };
			state.path?.push({ ...state.pos });
			log.push("鲨鱼向你扑来！多亏救生圈，你被弹回了上一格。");
			return;
		}
		state.visited[key] = true;
		die(state, "你闯入了鲨鱼的领地，命丧鲨口……", log, ctx);
		return;
	}
	// 被载/被浪冲而落在老鼋格不算「遭遇」：只有玩家主动游进去才计数（帮→坑按主动遭遇算）
	if (kind === "turtle" && depth > 0) return;
	state.visited[key] = true;
	switch (kind) {
		case "plain":
			break;
		case "calm":
			log.push("风平浪静，海面一望无际。");
			break;
		case "seagull":
			log.push(`一群海鸥掠过海面，朝着${DIR_NAMES[dirToLand(state)]}方飞去。`);
			break;
		case "bottle": {
			const dateStr = bottleInfo(state, state.pos.q, state.pos.r);
			log.push(`你捞起一只漂流瓶，瓶中的信上写着：「随波逐流，不知身处何方……」，落款日期是${dateStr}。`);
			break;
		}
		case "whale":
			log.push(`一头鲸鱼浮出海面，喷出一柱水花。它正朝${DIR_NAMES[dirToLand(state)]}方洄游。你攀上鲸背……`);
			ride(state, log, RIDE_WHALE, "鲸鱼", depth, ctx);
			break;
		case "lighthouse":
			state.visionTurns = LIGHTHOUSE_TURNS;
			state.visionBoost = 1;
			log.push(`礁石上矗立着一座灯塔。守塔人告诉你：定居点在${DIR_NAMES[dirToLand(state)]}方。灯火让远处的海面清晰起来（视野 +1，持续 ${LIGHTHOUSE_TURNS} 回合）。`);
			break;
		case "warmCurrent":
			heal(state, 5);
			log.push("一股暖流涌过，你感到体力恢复了 5 点。");
			break;
		case "driftwood":
			heal(state, 3);
			log.push("你趴上一根浮木歇息，恢复了 3 点体力。");
			break;
		case "fishSchool":
			addItem(state, "fish", 1);
			log.push("一群鱼从你脚下游过，你眼疾手快捉住一条（获得道具「鱼」）。");
			break;
		case "starfish":
			addItem(state, "starfish", 1);
			log.push("你在水底捡到一只肥硕的海星（获得道具「海星」）。");
			break;
		case "dolphin":
			state.dolphinTurns = DOLPHIN_TURNS;
			log.push(`几只海豚游了过来，绕着你嬉戏，决定伴你一程（随后 ${DOLPHIN_TURNS} 回合移动消耗 -1）。`);
			break;
		case "shipwreck": {
			const pick = SHIPWRECK_ITEMS[hash3(state.seed, state.pos.q, state.pos.r, 23) % SHIPWRECK_ITEMS.length];
			addItem(state, pick, 1);
			log.push(`你发现了一艘沉船，在船舱里搜到一件道具（获得「${ITEM_INFO[pick].name}」）。`);
			break;
		}
		case "island":
			heal(state, 20);
			log.push("你爬上一座小岛，晒干身子，恢复了 20 点体力。");
			break;
		case "jellyfish":
			state.stamina -= 8;
			state.paralyze = true;
			log.push("你被水母蜇了一下，浑身发麻（体力 -8，下一回合移动消耗 +1）。");
			break;
		case "reef":
			state.stamina -= 4;
			log.push("你擦过一片暗礁，划伤了手臂（体力 -4）。");
			break;
		case "seaSnake":
			state.stamina -= 10;
			log.push("一条海蛇从海草丛中窜出，咬了你一口（体力 -10）。");
			break;
		case "whirlpool":
			state.stamina -= 5;
			log.push("你被卷进一个漩涡，天旋地转（体力 -5）……");
			dump(state, log, "你被冲到了远处。", depth, ctx);
			break;
		case "fog":
			state.fogTurns = FOG_TURNS;
			log.push(`浓雾弥漫，你的视野缩小了（持续 ${FOG_TURNS} 回合）。`);
			break;
		case "storm":
			state.stormTurns = STORM_TURNS;
			log.push(`暴风雨来袭！视野缩小，游动也愈发艰难（持续 ${STORM_TURNS} 回合）。`);
			break;
		case "turtle":
			state.turtleRides++;
			if (state.turtleRides === 1) {
				log.push("一只老鼋浮在水面：「小师傅，上来吧，我驮你一程。」你坐了上去……");
				ride(state, log, RIDE_TURTLE, "老鼋", depth, ctx);
				log.push("在驮你前进的时候，老鼋请求你向佛祖询问牠何时能修得人身。");
			} else {
				state.stamina -= 5;
				log.push("老鼋浮在水面，朝你喊道：「上次托你问的事，可问了吗？」你答不上来。老鼋大怒，身子一翻，把你掀进水里（体力 -5）！");
				dump(state, log, "你被浪头冲到了远处。", depth, ctx);
			}
			break;
		case "land":
			win(state, log, ctx);
			break;
	}
}

function snapshot(state: State, log: string[], cost?: number) {
	const path = state.path;
	state.path = undefined;
	return {
		ok: true,
		pos: state.pos,
		stamina: state.stamina,
		turn: state.turn,
		current: currentAt(state, state.turn),
		vision: visionRadius(state),
		tiles: visibleTiles(state),
		path,
		items: state.items,
		islands: state.islands,
		buffs: {
			fog: state.fogTurns,
			storm: state.stormTurns,
			dolphin: state.dolphinTurns,
			vision: state.visionTurns,
		},
		paralyze: state.paralyze,
		dead: state.dead,
		deadCause: state.deadCause || undefined,
		won: state.won,
		cost,
		log,
	};
}

export default createPlugin({
	pid:"Water",
	name:"Water",
	label:"09",
	unlock:[
		{
			type:"pass",
			pid:"Shirt",
		},
		{
			type:"custom",
			when:(ctx)=>(ctx.now.getMinutes()%4===0?true:false),
			desc:(ctx,_)=>(ctx.now.getMinutes()%4===0?"可以解锁":"不在时间窗口内"),
		},
	],
	accessible:(ctx)=>(ctx.visitedPids.has("BlockedCharacters")?"visible":"hidden"),
	description:{
		before_solve:{
			mdv:{
				main:"app/main.md",
				include:["app/**/*"],
			},
		},
	},
	scores:[
		{
			id:"Wind.30Turns",
			desc:"坚持 30 回合",
			points:5,
		},
		{
			id:"Wind.60Turns",
			desc:"坚持 60 回合",
			points:5,
		},
	],
	inputs:false,
	server:(app)=>{
		app.on("init", (_, ctx) => {
			// 无进度恢复：每次挂载（刷新/重试）重新开局
			ctx.gameStorage.clear();
			const seed = (Math.random() * 0xffffffff) >>> 0;
			const rng = mulberry32(seed);
			const D = Math.floor(rng() * 6);
			const L = LAND_MIN + Math.floor(rng() * LAND_SPAN);
			// 「今天」：UTC+8 零点时间戳（漂流瓶日期以此为准）
			const utc8Now = Date.now() + 8 * 3600 * 1000;
			const today = Math.floor(utc8Now / 86400 / 1000) * 86400 * 1000 - 8 * 3600 * 1000;
			const state: State = {
				seed,
				D,
				landQ: DIR_VECTORS[D][0] * L,
				landR: DIR_VECTORS[D][1] * L,
				today,
				pos: { q: 0, r: 0 },
				prevPos: { q: 0, r: 0 },
				stamina: START_STAMINA,
				turn: 0,
				visited: { "0,0": true },
				items: {},
				turtleRides: 0,
				fogTurns: 0,
				stormTurns: 0,
				dolphinTurns: 0,
				visionTurns: 0,
				visionBoost: 0,
				paralyze: false,
				islands: ctx.gameProcess.passed.has("Earth"),
				dead: false,
				deadCause: "",
				won: false,
			};
			ctx.gameStorage.set("state", state);
			const log = ["你被海浪卷到了茫茫大海之中。定居点的方向尚未可知……"];
			if (state.islands) log.push("大地的庇护与你同在：海洋中散布着可以歇脚的岛屿。");
			return snapshot(state, log);
		});
		app.on("move", (data: { dir?: unknown }, ctx) => {
			const state = ctx.gameStorage.get<State>("state");
			if (!state) return { ok: false, reason: "尚未开始游戏，请刷新页面重试" };
			if (state.won) return { ok: false, reason: "你已经到达了定居点" };
			if (state.dead) return { ok: false, reason: "你已经沉入大海，请刷新页面重新开始" };
			const dir = data?.dir;
			if (typeof dir !== "number" || !Number.isInteger(dir) || dir < 0 || dir > 5) {
				return { ok: false, reason: "无效的方向" };
			}
			const cost = moveCost(state, dir);
			tickBuffs(state);
			const log: string[] = [];
			state.stamina -= cost;
			state.paralyze = false;
			state.prevPos = { ...state.pos };
			state.path = [{ ...state.pos }];
			state.pos = {
				q: state.pos.q + DIR_VECTORS[dir][0],
				r: state.pos.r + DIR_VECTORS[dir][1],
			};
			state.path.push({ ...state.pos });
			state.turn += 1;
			log.push(`你向${DIR_NAMES[dir]}方游去（体力 -${cost}）。`);
			if (isLandPos(state, state.pos.q, state.pos.r)) {
				win(state, log, ctx);
			} else {
				arrive(state, log, 0, ctx);
				if (state.stamina <= 0) {
					die(state, "体力耗尽，你沉入了大海……", log, ctx);
				}
			}
			if (!state.dead) {
				if (state.turn === 30)
					ctx.award("Wind.30Turns");
				if (state.turn === 60)
					ctx.award("Wind.60Turns");
			}
			ctx.gameStorage.set("state", state);
			return snapshot(state, log, cost);
		});
		app.on("use", (data: { item?: unknown }, ctx) => {
			const state = ctx.gameStorage.get<State>("state");
			if (!state) return { ok: false, reason: "尚未开始游戏，请刷新页面重试" };
			if (state.won) return { ok: false, reason: "你已经到达了定居点" };
			if (state.dead) return { ok: false, reason: "你已经沉入大海，请刷新页面重新开始" };
			const id = data?.item;
			if (typeof id !== "string" || !Object.hasOwn(ITEM_INFO, id)) {
				return { ok: false, reason: "无效的道具" };
			}
			const count = state.items[id] ?? 0;
			if (count <= 0) return { ok: false, reason: "你没有这件道具" };
			const log: string[] = [];
			switch (id) {
				case "fish":
					heal(state, 5);
					log.push("你吃掉了鱼，恢复了 5 点体力。");
					break;
				case "starfish":
					heal(state, 8);
					log.push("你把海星贴在伤口上，恢复了 8 点体力。");
					break;
				case "compass":
					log.push(`罗盘的指针转了几圈，最终指向${DIR_NAMES[dirToLand(state)]}方。`);
					break;
				case "telescope":
					state.visionTurns = TELESCOPE_TURNS;
					state.visionBoost = 2;
					log.push(`你举起望远镜瞭望四周（视野 +2，持续 ${TELESCOPE_TURNS} 回合）。`);
					break;
				case "lifeRing":
					return { ok: false, reason: "救生圈会在你遭遇鲨鱼时自动生效" };
			}
			state.items[id] = count - 1;
			if (state.items[id] <= 0) delete state.items[id];
			ctx.gameStorage.set("state", state);
			return snapshot(state, log);
		});
	},
	record:true,
});
