import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { plugins } from '../plugins/registry';
import { getGameConfig, isReviewMode, type GameConfig } from '../lib/config';
import { publish } from '../lib/publish';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 管理员门槛（admin >= 1）
app.use('*', async (c, next) => {
  if (c.get('admin') < 1) return c.text('Access denied', 403);
  await next();
});

const CONFIG_KEYS: (keyof GameConfig)[] = ['startTime', 'endTime', 'gamerule', 'about'];

app.get('/game-config', async (c) => {
  const config = await getGameConfig(c.env.DB);
  return c.json({
    endTime: config.endTime || '3000-01-01 00:00:00',
    startTime: config.startTime || '2000-01-01 00:00:00',
    gamerule: config.gamerule || '',
    about: config.about || '',
  });
});

app.put('/game-config', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const config = await getGameConfig(c.env.DB);
  for (const key of CONFIG_KEYS) {
    if (typeof body[key] === 'string') config[key] = body[key] as never;
  }
  await c.env.DB.prepare(
    "INSERT INTO config (key, value) VALUES ('game-config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  )
    .bind(JSON.stringify(config))
    .run();
  return c.json({ message: '修改成功' });
});

app.post('/notice', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  if (!body.content || typeof body.content !== 'string') {
    return c.text('Missing content', 400);
  }
  await c.env.DB.prepare('INSERT INTO notices (content, author, created_at) VALUES (?, ?, ?)')
    .bind(body.content, c.get('username'), Date.now())
    .run();
  const minimal = body.content.length > 20 ? body.content.slice(0, 20) + '...' : body.content;
  await publish(c.env, 'notice', { content: minimal });
  return c.json({ message: '发布成功' });
});

app.delete('/notice/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.text('Missing id', 400);
  await c.env.DB.prepare('DELETE FROM notices WHERE id = ?').bind(id).run();
  return c.json({ message: '删除成功' });
});

app.get('/users', async (c) => {
  const [users, states] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT username, admin, banned, hidden, remark, qq, total_points, passed_count, last_progress_at
       FROM users
       ORDER BY passed_count DESC, total_points DESC,
                COALESCE(last_progress_at, 253402300799999) ASC, username ASC`
    ),
    c.env.DB.prepare('SELECT username, pid, score, passed_at FROM problem_state'),
  ]);
  const scoresByUser = new Map<string, Record<string, number>>();
  const passedByUser = new Map<string, string[]>();
  for (const r of states.results as any[]) {
    if (r.score !== 0) {
      const m = scoresByUser.get(r.username) ?? {};
      m[r.pid] = r.score;
      scoresByUser.set(r.username, m);
    }
    if (r.passed_at != null) {
      passedByUser.set(r.username, [...(passedByUser.get(r.username) ?? []), r.pid]);
    }
  }
  return c.json({
    users: (users.results as any[]).map((u) => ({
      username: u.username,
      admin: u.admin,
      banned: !!u.banned,
      hidden: !!u.hidden,
      remark: u.remark,
      qq: u.qq,
      totalPoints: u.total_points,
      passedCount: u.passed_count,
      lastProgressAt: u.last_progress_at,
      scores: scoresByUser.get(u.username) ?? {},
      passedPids: passedByUser.get(u.username) ?? [],
    })),
  });
});

app.put('/user', async (c) => {
  const username = c.req.query('username');
  if (!username) return c.text('Missing username', 400);
  const body = await c.req.json().catch(() => ({}) as any);
  const { admin, banned, hidden, remark } = body;
  if (admin !== undefined) {
    if (c.get('admin') < 2) return c.text('Access denied', 403);
    if (typeof admin !== 'number' || admin < 0 || admin > 2) {
      return c.text('Invalid admin value', 400);
    }
  }
  const updates: Record<string, unknown> = {};
  if (admin !== undefined) {
    updates.admin = admin;
    // 管理员 hidden 默认置 1（决策 9）；同一请求显式给出 hidden 时以显式为准
    if (admin >= 1 && hidden === undefined) updates.hidden = 1;
  }
  if (banned !== undefined) updates.banned = banned ? 1 : 0;
  if (hidden !== undefined) updates.hidden = hidden ? 1 : 0;
  if (remark !== undefined) updates.remark = remark;
  const uuid = crypto.randomUUID();
  const keys = Object.keys(updates);
  if (keys.length) {
    await c.env.DB.prepare(
      `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE username = ?`
    )
      .bind(...keys.map((k) => updates[k]), username)
      .run();
  }
  if ((banned !== undefined || hidden !== undefined) && !isReviewMode(c.env)) {
    await publish(c.env, 'rank', { uuid });
  }
  return c.json({ message: '修改成功', uuid });
});

/** 重算全部用户的排行榜冗余字段（修复工具；正常流程中由写入不变式维护） */
app.get('/recalculate', async (c) => {
  await c.env.DB.prepare(
    `UPDATE users SET
       total_points = COALESCE((SELECT SUM(points) FROM score_events WHERE username = users.username), 0),
       passed_count = (SELECT COUNT(*) FROM problem_state WHERE username = users.username AND passed_at IS NOT NULL),
       last_progress_at = NULLIF(MAX(
         COALESCE((SELECT MAX(awarded_at) FROM score_events WHERE username = users.username AND points != 0), 0),
         COALESCE((SELECT MAX(passed_at) FROM problem_state WHERE username = users.username), 0)
       ), 0)`
  ).run();
  const uuid = crypto.randomUUID();
  if (!isReviewMode(c.env)) await publish(c.env, 'rank', { uuid });
  return c.json({ message: '已重新计算', uuid });
});

app.post('/cleanRecords', async (c) => {
  await c.env.DB.prepare('DELETE FROM records').run();
  return c.json({ message: '清除成功' });
});

app.get('/problemList', async (c) => {
  return c.json({
    problems: plugins.map((p) => ({ pid: p.pid, name: p.name, label: p.label ?? null })),
  });
});

export default app;
