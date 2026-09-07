import createPlugin from "../../src/types";

// —— 物理常量 ——
const R = 100;               // 监测区域半径（km）
const V_P = 5;               // P 波波速（km/s）
const V_S = 3;               // S 波波速（km/s）
const WIND_P = 50;           // 风之加持：P 波波速 ×10
const WIND_S = 30;           // 风之加持：S 波波速 ×10
const DEPTH_MIN = 30;        // 震源深度下限（km，不告知玩家）
const DEPTH_MAX = 70;        // 震源深度上限（km，不告知玩家）
const TOLERANCE = 5;         // 通关误差上限（km）
const ADVANCE_MAX = 4;       // 发震时刻相对监测开始最多提前（s）
const DELAY_MAX = 6;         // 发震时刻相对监测开始最多延后（s）
const ARRIVAL_MARGIN = 0.8;  // 最近站 P 波相对监测开始的最小余量（s）

interface Station {
	x: number;
	y: number;
}

interface Session {
	ex: number;        // 震中 x（km）
	ey: number;        // 震中 y（km）
	h: number;         // 震源深度（km）
	vP: number;
	vS: number;
	wind: boolean;
	t0: number;        // 发震时刻（epoch ms）
	startedAt: number; // 开始监测时刻（epoch ms）
}

function validateStations(stations: unknown): string | null {
	if (!Array.isArray(stations) || stations.length < 1 || stations.length > 3) {
		return "请布署 1 到 3 个监测站";
	}
	for (const s of stations as unknown[]) {
		const st = s as Station;
		if (
			typeof st?.x !== "number" || typeof st?.y !== "number" ||
			!Number.isFinite(st.x) || !Number.isFinite(st.y)
		) {
			return "监测站坐标无效";
		}
		if (st.x * st.x + st.y * st.y > R * R + 1e-6) {
			return "监测站必须位于半径 100 km 的区域内";
		}
	}
	return null;
}

function parseCoord(v: unknown): number | null {
	if (typeof v === "number") return Number.isFinite(v) ? v : null;
	if (typeof v === "string" && v.trim() !== "") {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

export default createPlugin({
	pid:"Earth",
	name:"Earth",
	label:"06",
	unlock:[
		{
			type:"points",
			atLeast:20,
		},
		{
			type:"custom",
			when:(ctx)=>ctx.now.getMinutes()%4===1?true:false,
			desc:(ctx,_)=>ctx.now.getMinutes()%4===1?"可以解锁":"不在时间窗口内",
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
		{id:"Earth.close",desc:"误差小于 3 公里",points:5},
		{id:"Earth.precise",desc:"误差小于 0.1 公里",points:5},
	],
	inputs:false,
	server:(app)=>{
		app.on("init", (_, ctx) => {
			ctx.gameStorage.delete("session");
			return { phase: "deploy", stations: ctx.gameStorage.get<Station[]>("stations") ?? [] };
		});
		app.on("start", (data: { stations?: unknown }, ctx) => {
			const reason = validateStations(data?.stations);
			if (reason) return { ok: false, reason };
			const stations = data.stations as Station[];
			// 每次开始监测：随机生成新震源（震中圆盘内均匀、深度 30–70 km 均匀）
			const ang = Math.random() * 2 * Math.PI;
			const rr = R * Math.sqrt(Math.random());
			const ex = rr * Math.cos(ang);
			const ey = rr * Math.sin(ang);
			const h = DEPTH_MIN + Math.random() * (DEPTH_MAX - DEPTH_MIN);
			const wind = ctx.gameProcess.passed.has("Wind");
			const vP = wind ? WIND_P : V_P;
			const vS = wind ? WIND_S : V_S;
			const startedAt = Date.now();
			// 随机发震偏移：提前/延后几秒，防止用 P 波到时直接推算；
			// 下界保证最近站的 P 波在监测开始后至少 ARRIVAL_MARGIN 秒才到达
			const dist = stations.map((s) => Math.hypot(s.x - ex, s.y - ey, h));
			const tPmin = Math.min(...dist) / vP;
			const lower = Math.max(-ADVANCE_MAX, ARRIVAL_MARGIN - tPmin);
			const t0 = startedAt + (lower + Math.random() * (DELAY_MAX - lower)) * 1000;
			const schedule = stations.map((s, i) => ({
				tP: t0 + (dist[i] / vP) * 1000,
				tS: t0 + (dist[i] / vS) * 1000,
			}));
			ctx.gameStorage.set("stations", stations);
			const session: Session = { ex, ey, h, vP, vS, wind, t0, startedAt };
			ctx.gameStorage.set("session", session);
			return { ok: true, wind, schedule, serverNow: Date.now(), startedAt };
		});
		app.on("answer", (data: { x?: unknown; y?: unknown }, ctx) => {
			const session = ctx.gameStorage.get<Session>("session");
			if (!session) {
				return { ok: false, reason: "no-session" };
			}
			const x = parseCoord(data?.x);
			const y = parseCoord(data?.y);
			// 非法输入（空/非数字）不算作答：不重置、不记录
			if (x === null || y === null) {
				return { ok: false, invalid: true, reason: "请填写有效的 x、y 坐标（例如 12.3 与 -45.6）" };
			}
			// 单次提交机会：无论对错，本会话到此结束
			ctx.gameStorage.delete("session");
			const error = Math.hypot(x - session.ex, y - session.ey);
			if (error <= TOLERANCE) {
				if (error < 3) ctx.award("Earth.close");
				if (error < 0.1) ctx.award("Earth.precise");
				ctx.pass(
					`误差 ${error.toFixed(3)} km。震中实际位于 (${session.ex.toFixed(1)}, ${session.ey.toFixed(1)})`
				);
				return { ok: true, error };
			}
			ctx.nopass(
				`误差 ${error.toFixed(3)} km（超过 ${TOLERANCE} km）。监测已重置，请重新布署并开始监测。`
			);
			return { ok: false, reset: true, error };
		});
	},
});
