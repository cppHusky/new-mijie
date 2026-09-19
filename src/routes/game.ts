import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import type { Env, Variables } from '../env';
import {
  plugins,
  pluginByPid,
  hiddenRecord,
  type RegisteredPlugin,
} from '../plugins/registry';
import { evalCondition, evalUnlock } from '../domain/unlock';
import { evalVisibility } from '../domain/visibility';
import { gameWindowError, isReviewMode } from '../lib/config';
import { loadUserState, loadGameStorage, unlockContextOf, type UserState } from '../lib/state';
import { createAward, persistOutcome, type AwardedItem } from '../lib/pipeline';
import { buildContext } from '../lib/context';
import { problemNotFound, requirePlayable, getPercent } from '../lib/playable';
import { publish } from '../lib/publish';
import { verifyTurnstile } from '../lib/turnstile';
import type { Context, ServerContext, UnlockCondition, UnlockContext } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const tzOf = (env: Env) => env.TIMEZONE ?? 'Asia/Shanghai';

/** 排行榜变更广播（首次通关或分数变化时；回顾模式无排行榜，不广播） */
async function publishRankIfChanged(
  env: Env,
  result: { gainedPoints: number; newlyPassed: boolean }
): Promise<void> {
  if (isReviewMode(env)) return;
  if (result.newlyPassed || result.gainedPoints !== 0) {
    await publish(env, 'rank', { uuid: crypto.randomUUID() });
  }
}

/** 跨题快照（AccessContext 公共部分）：全表一次计算，供列表内所有题目共享 */
function accessBaseOf(state: UserState, base: UnlockContext, tz: string) {
  const unlockedPids = new Set<string>();
  const visitedPids = new Set<string>();
  for (const p of plugins) {
    const st = state.states.get(p.pid);
    if (p.unlock === true || st?.unlocked_at != null) unlockedPids.add(p.pid);
    if (st?.visited_at != null) visitedPids.add(p.pid);
  }
  return {
    unlockedPids,
    visitedPids,
    met: (cond: UnlockCondition) => evalCondition(cond, base, tz),
  };
}

/**
 * 玩家感知的掩码查名（desc 生成用，防泄名）：
 * visible → 题面名；ghost → label（幽灵行本就公示 label），无 label 回退 ???；hidden → ???。
 */
function maskedNameOf(
  state: UserState,
  accessBase: ReturnType<typeof accessBaseOf>,
  base: UnlockContext
) {
  return (pid: string): string => {
    const p = pluginByPid.get(pid);
    if (!p) return '???';
    const st = state.states.get(pid);
    const unlocked = p.unlock === true || st?.unlocked_at != null;
    const visited = st?.visited_at != null;
    const vis = evalVisibility(p.accessible, { ...base, ...accessBase, unlocked, visited });
    if (vis === 'visible') return p.name;
    if (vis === 'ghost') return p.label ?? '???';
    return '???';
  };
}

// —— 题目列表 ——

app.get('/problems', async (c) => {
  const err = await gameWindowError(c.env, c.get('admin') >= 1);
  if (err) return c.text(err, 400);
  const state = await loadUserState(c.env.DB, c.get('username'));
  const now = new Date();
  const tz = tzOf(c.env);
  const base = unlockContextOf(state, now);
  const accessBase = accessBaseOf(state, base, tz);
  const displayName = maskedNameOf(state, accessBase, base);
  const list = [];
  for (const p of plugins) {
    const st = state.states.get(p.pid);
    const unlocked = p.unlock === true || st?.unlocked_at != null;
    const visited = st?.visited_at != null;
    const visibility = evalVisibility(p.accessible, { ...base, ...accessBase, unlocked, visited });
    if (visibility === 'hidden') continue;
    const entry: Record<string, unknown> = {
      pid: p.pid,
      label: p.label ?? null,
      state: visibility,
      unlocked,
      passed: state.gameProcess.passed.has(p.pid),
      myScore: state.gameProcess.scores.get(p.pid) ?? 0,
    };
    if (visibility === 'visible') entry.name = p.name;
    const u = evalUnlock(p.unlock, base, tz, displayName);
    entry.conditions = u.conditions;
    entry.canUnlock = u.canUnlock;
    list.push(entry);
  }
  return c.json({ problems: list });
});

// —— 解锁（手动点击 + 持久化，决策 1） ——

app.post('/problems/:pid/unlock', async (c) => {
  const pid = c.req.param('pid');
  const plugin = pluginByPid.get(pid);
  if (!plugin) return problemNotFound(c, pid);
  const err = await gameWindowError(c.env, c.get('admin') >= 1);
  if (err) return c.text(err, 400);
  const state = await loadUserState(c.env.DB, c.get('username'));
  if (plugin.unlock === true || state.states.get(pid)?.unlocked_at != null) {
    return c.json({ unlocked: true, already: true });
  }
  const now = new Date();
  const base = unlockContextOf(state, now);
  const displayName = maskedNameOf(state, accessBaseOf(state, base, tzOf(c.env)), base);
  const u = evalUnlock(plugin.unlock, base, tzOf(c.env), displayName);
  if (!u.canUnlock) {
    return c.json({ unlocked: false, conditions: u.conditions });
  }
  await c.env.DB.prepare(
    `INSERT INTO problem_state (username, pid, unlocked_at) VALUES (?, ?, ?)
     ON CONFLICT(username, pid) DO UPDATE SET
       unlocked_at = COALESCE(problem_state.unlocked_at, excluded.unlocked_at)`
  )
    .bind(c.get('username'), pid, now.getTime())
    .run();
  return c.json({ unlocked: true, conditions: u.conditions });
});

// —— 题目详情 ——

app.get('/problem/:pid', async (c) => {
  const pid = c.req.param('pid');
  const err = await gameWindowError(c.env, c.get('admin') >= 1);
  if (err) return c.text(err, 400);
  const playable = await requirePlayable(c, pid);
  if (playable instanceof Response) return playable;
  const { plugin, state } = playable;
  const username = c.get('username');

  // 标记访问（潜伏题由此转为可见；COALESCE 保证只写一次）
  if (state.states.get(pid)?.visited_at == null) {
    await c.env.DB.prepare(
      `INSERT INTO problem_state (username, pid, visited_at) VALUES (?, ?, ?)
       ON CONFLICT(username, pid) DO UPDATE SET
         visited_at = COALESCE(problem_state.visited_at, excluded.visited_at)`
    )
      .bind(username, pid, Date.now())
      .run();
  }

  const awardedRows = await c.env.DB.prepare(
    'SELECT score_id FROM score_events WHERE username = ? AND pid = ?'
  )
    .bind(username, pid)
    .all<{ score_id: string }>();
  const awardedSet = new Set((awardedRows.results ?? []).map((r) => r.score_id));
  const isAdmin = c.get('admin') >= 1;

  return c.json({
    name: plugin.name,
    label: plugin.label ?? null,
    description: plugin.description.before_solve,
    admin: isAdmin ? plugin.description.admin : undefined,
    files: plugin.files,
    inputs: plugin.inputs,
    scores: (plugin.scores ?? []).map((s) => ({
      id: s.id,
      desc: s.desc,
      points: s.points,
      achieved: awardedSet.has(s.id),
    })),
    passed: state.gameProcess.passed.has(pid),
    myScore: state.gameProcess.scores.get(pid) ?? 0,
    percent:
      isReviewMode(c.env) || plugin.showPercent === false
        ? undefined
        : await getPercent(c.env.DB, pid),
  });
});

// —— 提交流水线（checker + award，写入不变式见 lib/pipeline） ——

app.post('/problem/:pid', async (c) => {
  const pid = c.req.param('pid');
  const playable = await requirePlayable(c, pid);
  if (playable instanceof Response) return playable;
  const { plugin, state } = playable;
  const err = await gameWindowError(c.env, c.get('admin') >= 1);
  if (err) return c.text(err, 400);
  if (plugin.inputs === false || typeof plugin.checker !== 'function') {
    return c.text('该关卡不能提交答案', 400);
  }
  const body = await c.req.json().catch(() => ({}) as any);
  const ans = body.ans;
  const username = c.get('username');

  // 限流（Rate Limiting binding）：超限回退 Turnstile。
  // captcha: false 豁免；未配置 TURNSTILE_SECRET 时限流整体停用（沿袭 mijie）。
  if (c.env.TURNSTILE_SECRET && plugin.captcha !== false && c.env.RATE_LIMITER) {
    const { success } = await c.env.RATE_LIMITER.limit({ key: username });
    if (!success && !(await verifyTurnstile(c.env.TURNSTILE_SECRET, body.token))) {
      return c.json({ passed: false, turnstile: true });
    }
  }

  const storage = await loadGameStorage(c.env.DB, username, pid);
  const alreadyAwarded = await awardedIds(c.env.DB, username, pid);
  const pending: AwardedItem[] = [];
  const reAchieved: AwardedItem[] = [];
  let msg = '';
  let content = '';
  const ctx: Context = buildContext({
    env: c.env,
    username,
    gameProcess: state.gameProcess,
    gameStorage: storage,
    msg: (s) => (msg += s + '\n'),
    content: (s) => (content += s),
    award: createAward(plugin, alreadyAwarded, pending, reAchieved),
  });

  let passed: boolean;
  try {
    passed = !!(await (plugin.checker as any)(ans, ctx));
  } catch (e) {
    console.error(`[checker] ${pid} 执行异常：`, e);
    return c.text('checker error, please contact admin', 500);
  }

  await evalDeclarativeScores(plugin, ans, ctx, passed, alreadyAwarded, pending, reAchieved);

  const result = await persistOutcome({
    db: c.env.DB,
    username,
    plugin,
    isServer: false,
    ans,
    passed,
    alreadyPassed: state.gameProcess.passed.has(pid),
    msg,
    content,
    pendingAwards: pending,
    extraStatements: storage.saveStatements(),
    recordEvent: true,
  });
  await publishRankIfChanged(c.env, result);

  return c.json({
    passed,
    msg: msg || undefined,
    content: content || undefined,
    awarded: result.awarded.map(({ id, desc, points }) => ({ id, desc, points })),
    reAchieved: reAchieved.map(({ id, desc, points }) => ({ id, desc, points })),
    after_solve: result.newlyPassed ? plugin.description.after_solve : undefined,
    percent:
      isReviewMode(c.env) || plugin.showPercent === false
        ? undefined
        : await getPercent(c.env.DB, pid),
  });
});

// —— 交互题事件流水线 ——

app.post('/problem/:pid/server', async (c) => {
  const pid = c.req.param('pid');
  const playable = await requirePlayable(c, pid);
  if (playable instanceof Response) return playable;
  const { plugin, state } = playable;
  const err = await gameWindowError(c.env, c.get('admin') >= 1);
  if (err) return c.text(err, 400);
  const isAdminApi = c.get('admin') >= 1 && c.req.query('admin') === 'true';
  const body = await c.req.json().catch(() => ({}) as any);
  const { event, data } = body;
  if (!event || typeof event !== 'string') {
    return c.text('Missing event', 400);
  }
  if (!plugin.serverInstance && !(isAdminApi && event === '__admin_bypass')) {
    return c.text('This problem does not have a server', 400);
  }
  const username = c.get('username');
  const storage = await loadGameStorage(c.env.DB, username, pid);
  const alreadyAwarded = await awardedIds(c.env.DB, username, pid);
  const pending: AwardedItem[] = [];
  const reAchieved: AwardedItem[] = [];
  let passed: boolean | undefined;
  let message = '';
  let content = '';
  const base = buildContext({
    env: c.env,
    username,
    gameProcess: state.gameProcess,
    gameStorage: storage,
    msg: (s) => (message += s + '\n'),
    content: (s) => (content += s),
    award: createAward(plugin, alreadyAwarded, pending, reAchieved),
  });
  const { msg: _msg, content: _content, ...baseRest } = base;
  const sctx: ServerContext = {
    ...baseRest,
    pass: (s?: string) => {
      passed = true;
      if (s) message += s;
    },
    nopass: (s?: string) => {
      passed = false;
      if (s) message += s;
    },
  };

  let res: unknown;
  try {
    res =
      isAdminApi && event === '__admin_bypass'
        ? (sctx.pass('Admin bypass'), undefined)
        : isAdminApi
          ? await plugin.serverInstance!.adminHandle(event, data, sctx)
          : await plugin.serverInstance!.handle(event, data, sctx);
  } catch (e) {
    console.error(`[server] ${pid} 事件 ${event} 执行异常：`, e);
    return c.text('server error, please contact admin', 500);
  }

  // 声明式兜底评估（server 事件以 data 作为 ans）
  await evalDeclarativeScores(plugin, data, base, passed === true, alreadyAwarded, pending, reAchieved);

  const judged = passed !== undefined;
  const result = await persistOutcome({
    db: c.env.DB,
    username,
    plugin,
    isServer: true,
    ans: { event, data },
    passed: passed === true,
    alreadyPassed: state.gameProcess.passed.has(pid),
    msg: message,
    content,
    pendingAwards: pending,
    extraStatements: storage.saveStatements(),
    recordEvent: judged,
  });
  await publishRankIfChanged(c.env, result);

  return c.json({
    res,
    passed: judged ? passed : undefined,
    msg: message || undefined,
    content: content || undefined,
    awarded: result.awarded.map(({ id, desc, points }) => ({ id, desc, points })),
    reAchieved: reAchieved.map(({ id, desc, points }) => ({ id, desc, points })),
    after_solve: result.newlyPassed ? plugin.description.after_solve : undefined,
    percent:
      judged && !isReviewMode(c.env) && plugin.showPercent !== false
        ? await getPercent(c.env.DB, pid)
        : undefined,
  });
});

// —— 排行榜（passed_count desc, total_points desc, last_progress_at asc；并列同名次） ——

app.get('/rank', async (c) => {
  if (isReviewMode(c.env)) return c.text('Not Found', 404);
  const err = await gameWindowError(c.env, c.get('admin') >= 1);
  if (err) return c.text(err, 400);
  const rows = await c.env.DB.prepare(
    `SELECT username, passed_count, total_points, last_progress_at FROM users
     WHERE banned = 0 AND hidden = 0
     ORDER BY passed_count DESC, total_points DESC,
              COALESCE(last_progress_at, 253402300799999) ASC, username ASC`
  ).all<{ username: string; passed_count: number; total_points: number; last_progress_at: number | null }>();
  let rank = 0;
  let idx = 0;
  let prev: { passed_count: number; total_points: number; last_progress_at: number | null } | null = null;
  const list = (rows.results ?? []).map((r) => {
    idx++;
    if (
      !prev ||
      r.passed_count !== prev.passed_count ||
      r.total_points !== prev.total_points ||
      (r.last_progress_at ?? null) !== (prev.last_progress_at ?? null)
    ) {
      rank = idx;
    }
    prev = r;
    return {
      rank,
      username: r.username,
      passedCount: r.passed_count,
      totalPoints: r.total_points,
      lastProgressAt: r.last_progress_at,
    };
  });
  return c.json({ rank: list });
});

// —— 提交记录 ——

app.get('/record', async (c) => {
  const err = await gameWindowError(c.env, c.get('admin') >= 1);
  if (err) return c.text(err, 400);
  const q = c.req.query();
  const all = q.all === 'true';
  const username = c.get('username');
  const admin = c.get('admin');
  const user = q.user || username;
  if ((user !== username || all) && admin < 1) {
    return c.text('Access denied', 403);
  }
  const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
  const size = Math.min(200, Math.max(1, parseInt(q.size ?? '50', 10) || 50));
  const canViewHidden = admin >= 2;

  const where: string[] = [];
  const binds: unknown[] = [];
  if (!all) {
    where.push('username = ?');
    binds.push(user);
  }
  if (q.pid) {
    where.push('pid = ?');
    binds.push(q.pid);
  }
  if (!canViewHidden && hiddenRecord.size) {
    where.push(`pid NOT IN (${Array.from(hiddenRecord).map(() => '?').join(',')})`);
    binds.push(...hiddenRecord);
  }
  if (q.passed !== undefined) {
    where.push('passed = ?');
    binds.push(q.passed === 'true' ? 1 : 0);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [records, total] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, username, pid, ans_json, server, passed, gained_points, msg, content, created_at
       FROM records ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    ).bind(...binds, size, (page - 1) * size),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM records ${whereSql}`).bind(...binds),
  ]);
  return c.json({
    page,
    total: (total.results[0] as { n: number }).n,
    records: (records.results as any[]).map((r) => ({
      ...r,
      name: pluginByPid.get(r.pid)?.name ?? r.pid,
      ans: r.ans_json ? JSON.parse(r.ans_json) : undefined,
      ans_json: undefined,
    })),
  });
});

app.get('/submitted_problems', async (c) => {
  const err = await gameWindowError(c.env, c.get('admin') >= 1);
  if (err) return c.text(err, 400);
  const username = c.get('username');
  const admin = c.get('admin');
  const queryUser = c.req.query('username') || username;
  if (queryUser !== username && admin < 1) {
    return c.text('Access denied', 403);
  }
  const rows = await c.env.DB.prepare(
    'SELECT pid, COUNT(*) AS n FROM records WHERE username = ? GROUP BY pid'
  )
    .bind(queryUser)
    .all<{ pid: string; n: number }>();
  const counts = new Map((rows.results ?? []).map((r) => [r.pid, r.n]));
  const canViewHidden = admin >= 2;
  const list = (admin >= 1 ? plugins : plugins.filter((p) => counts.has(p.pid))).map((p) => ({
    pid: p.pid,
    name: p.name,
    count: !canViewHidden && hiddenRecord.has(p.pid) ? 0 : (counts.get(p.pid) ?? 0),
  }));
  return c.json({ submitted_problems: list });
});

// —— 公告（只读；发布/删除在 P4 admin 路由） ——

app.get('/notice', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, content, author, created_at FROM notices ORDER BY created_at DESC'
  ).all();
  return c.json({ notices: rows.results ?? [] });
});

// —— 内部工具 ——

async function awardedIds(db: D1Database, username: string, pid: string): Promise<Set<string>> {
  const rows = await db
    .prepare('SELECT score_id FROM score_events WHERE username = ? AND pid = ?')
    .bind(username, pid)
    .all<{ score_id: string }>();
  return new Set((rows.results ?? []).map((r) => r.score_id));
}

/** 声明式糖：每次提交/事件后兜底评估 scores[].when；已入账条件再次达成时登记 reAchieved（不重复计分） */
async function evalDeclarativeScores(
  plugin: RegisteredPlugin,
  ans: unknown,
  ctx: Context,
  passed: boolean,
  alreadyAwarded: ReadonlySet<string>,
  pending: AwardedItem[],
  reAchieved: AwardedItem[]
): Promise<void> {
  for (const s of plugin.scores ?? []) {
    if (!s.when) continue;
    if (pending.some((p) => p.id === s.id)) continue;
    try {
      if (await s.when(ans, ctx, { passed })) {
        if (alreadyAwarded.has(s.id)) {
          if (!reAchieved.some((r) => r.id === s.id)) {
            reAchieved.push({ id: s.id, desc: s.desc, points: s.points });
          }
        } else {
          pending.push({ id: s.id, desc: s.desc, points: s.points });
        }
      }
    } catch (e) {
      console.error(`[scores] ${plugin.pid} 条件 ${s.id} 评估异常：`, e);
    }
  }
}

export default app;
