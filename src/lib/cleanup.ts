import type { Env } from '../env';

/** 长期未登录账号的保留期：180 天 */
export const INACTIVE_MS = 180 * 24 * 60 * 60 * 1000;

/** 清理目标：非管理员且 180 天未登录（存量用户以 created_at 为宽限起点） */
const INACTIVE_USERS =
  'SELECT username FROM users WHERE admin = 0 AND COALESCE(last_login_at, created_at) < ?';

/**
 * 删除长期未登录的账号及其全部关联数据（管理员豁免）。
 * 由 Cron Trigger 调用；batch 内顺序执行且处于同一事务，
 * 子表删除先于 users 删除，故子查询仍能看到目标用户名。
 */
export async function cleanupInactiveUsers(env: Env, now = Date.now()): Promise<number> {
  const cutoff = now - INACTIVE_MS;
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM (${INACTIVE_USERS})`)
    .bind(cutoff)
    .first<{ n: number }>();
  const count = row?.n ?? 0;
  if (count === 0) return 0;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM records WHERE username IN (${INACTIVE_USERS})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM score_events WHERE username IN (${INACTIVE_USERS})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM problem_state WHERE username IN (${INACTIVE_USERS})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM game_storage WHERE username IN (${INACTIVE_USERS})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM users WHERE admin = 0 AND COALESCE(last_login_at, created_at) < ?`).bind(
      cutoff
    ),
  ]);
  console.log(`[cleanup] 已清理 ${count} 个超过 180 天未登录的账号`);
  return count;
}
