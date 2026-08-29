import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { hashPassword, verifyPassword } from '../lib/password';
import { signToken } from '../lib/jwt';
import { verifyTurnstile } from '../lib/turnstile';
import { getGameConfig, type GameConfig } from '../lib/config';

const QQ_RE = /^[1-9]\d{4,10}$/;

export const publicRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
export const authedRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

publicRoutes.post('/register', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const { username, password, qq, token } = body;
  if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET, token))) {
    return c.text('验证失败', 401);
  }
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return c.text('缺少用户名或密码', 400);
  }
  if (username.length > 64 || password.length > 128) {
    return c.text('用户名或密码过长', 400);
  }
  if (qq !== undefined && qq !== null && qq !== '' && !QQ_RE.test(qq)) {
    return c.text('QQ 号格式不正确', 400);
  }
  const exists = await c.env.DB.prepare('SELECT username FROM users WHERE username = ?')
    .bind(username)
    .first();
  if (exists) {
    return c.text('该用户名已经被使用', 409);
  }
  const { hash, salt } = await hashPassword(password);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  // 首个注册用户自动成为超级管理员（沿用 mijie 约定）；管理员 hidden 默认置 1（决策 9）
  const admin = (count?.n ?? 0) === 0 ? 2 : 0;
  await c.env.DB.prepare(
    'INSERT INTO users (username, password_hash, salt, qq, admin, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(username, hash, salt, qq || null, admin, admin > 0 ? 1 : 0, Date.now())
    .run();
  return c.json({ message: '注册成功' });
});

publicRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const { username, password, token } = body;
  if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET, token))) {
    return c.text('验证失败', 401);
  }
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return c.text('缺少用户名或密码', 400);
  }
  const user = await c.env.DB.prepare(
    'SELECT username, password_hash, salt, admin, banned FROM users WHERE username = ?'
  )
    .bind(username)
    .first<{ username: string; password_hash: string; salt: string; admin: number; banned: number }>();
  if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
    return c.text('用户名或密码错误', 401);
  }
  if (user.banned) {
    return c.text('您已被封禁', 403);
  }
  const jwt = await signToken(c.env.JWT_SECRET, { sub: user.username, admin: user.admin });
  return c.json({ message: '登录成功', token: jwt, username: user.username });
});

publicRoutes.get('/keys', (c) => {
  return c.json({ turnstile: c.env.TURNSTILE_KEY ?? null });
});

const CONFIG_OPTIONS: (keyof GameConfig)[] = ['startTime', 'endTime', 'gamerule', 'about'];

publicRoutes.get('/game-config/:option', async (c) => {
  const option = c.req.param('option') as keyof GameConfig;
  if (!CONFIG_OPTIONS.includes(option)) {
    return c.text('Unknown option', 404);
  }
  const config = await getGameConfig(c.env.DB);
  const defaults: Record<string, string | null> = {
    endTime: '3000-01-01 00:00:00',
    startTime: '2000-01-01 00:00:00',
  };
  return c.json({ [option]: config[option] ?? defaults[option] ?? null });
});

authedRoutes.get('/me', async (c) => {
  const user = await c.env.DB.prepare(
    'SELECT username, admin, qq, total_points, passed_count FROM users WHERE username = ?'
  )
    .bind(c.get('username'))
    .first<{ username: string; admin: number; qq: string | null; total_points: number; passed_count: number }>();
  if (!user) return c.text('用户不存在', 401);
  return c.json({
    username: user.username,
    admin: user.admin,
    qq: user.qq,
    totalPoints: user.total_points,
    passedCount: user.passed_count,
  });
});

authedRoutes.post('/change-password', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const { password, newPassword } = body;
  if (typeof password !== 'string' || typeof newPassword !== 'string' || !password || !newPassword) {
    return c.text('缺少旧密码或新密码', 400);
  }
  if (newPassword.length > 128) {
    return c.text('密码过长', 400);
  }
  const user = await c.env.DB.prepare('SELECT password_hash, salt FROM users WHERE username = ?')
    .bind(c.get('username'))
    .first<{ password_hash: string; salt: string }>();
  if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
    return c.text('旧密码错误', 401);
  }
  const { hash, salt } = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE username = ?')
    .bind(hash, salt, c.get('username'))
    .run();
  return c.json({ message: '密码修改成功' });
});

authedRoutes.post('/change-qq', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const { qq } = body;
  if (qq !== null && qq !== '' && (typeof qq !== 'string' || !QQ_RE.test(qq))) {
    return c.text('QQ 号格式不正确', 400);
  }
  await c.env.DB.prepare('UPDATE users SET qq = ? WHERE username = ?')
    .bind(qq || null, c.get('username'))
    .run();
  return c.json({ message: 'QQ 号修改成功' });
});
