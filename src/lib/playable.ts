import type { Context as HonoContext } from 'hono';
import type { Env, Variables } from '../env';
import { pluginByPid, type RegisteredPlugin } from '../plugins/registry';
import { loadUserState, type UserState } from './state';

type C = HonoContext<{ Bindings: Env; Variables: Variables }>;

export const problemNotFound = (c: C, pid: string) => c.text(`Problem "${pid}" not found`, 404);

export interface Playable {
  plugin: RegisteredPlugin;
  state: UserState;
}

/** 题目存在 + 已解锁（管理员绕过）。未满足时返回 404 Response。 */
export async function requirePlayable(c: C, pid: string): Promise<Playable | Response> {
  const plugin = pluginByPid.get(pid);
  if (!plugin) return problemNotFound(c, pid);
  const state = await loadUserState(c.env.DB, c.get('username'));
  const unlocked = plugin.unlock === true || state.states.get(pid)?.unlocked_at != null;
  if (!unlocked && c.get('admin') < 1) return problemNotFound(c, pid);
  return { plugin, state };
}

/** 通过率：排除 hidden/banned 用户（口径与 mijie 一致，单一实现） */
export async function getPercent(db: D1Database, pid: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT r.username) AS total,
              COUNT(DISTINCT CASE WHEN r.passed = 1 THEN r.username END) AS passed
       FROM records r JOIN users u ON u.username = r.username
       WHERE r.pid = ? AND u.hidden = 0 AND u.banned = 0`
    )
    .bind(pid)
    .first<{ total: number; passed: number }>();
  if (!row || row.total === 0) return null;
  return Math.round((row.passed / row.total) * 10000) / 100;
}
