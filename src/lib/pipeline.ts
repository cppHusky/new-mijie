import type { RegisteredPlugin } from '../plugins/registry';

export interface AwardedItem {
  id: string;
  desc: string;
  points: number;
}

/**
 * ctx.award 原语：仅登记到 pending（请求结束统一落库）。
 * 对已入账（score_events）或已 pending 的条件幂等；未定义的 id 视为插件 bug，抛错。
 * 已入账的条件再次达成时，若该条件 renotify 为 true 则登记到 reAchieved（不重复计分，仅用于前端提醒）。
 */
export function createAward(
  plugin: RegisteredPlugin,
  alreadyAwarded: ReadonlySet<string>,
  pending: AwardedItem[],
  reAchieved: AwardedItem[]
): (id: string) => void {
  return (id: string) => {
    const cond = plugin.scores?.find((s) => s.id === id);
    if (!cond) throw new Error(`插件 ${plugin.pid} 未定义得分条件「${id}」`);
    if (alreadyAwarded.has(id)) {
      if (cond.renotify === true && !reAchieved.some((r) => r.id === id)) {
        reAchieved.push({ id: cond.id, desc: cond.desc, points: cond.points });
      }
      return;
    }
    if (pending.some((p) => p.id === id)) return;
    pending.push({ id, desc: cond.desc, points: cond.points });
  };
}

export interface PersistInput {
  db: D1Database;
  username: string;
  plugin: RegisteredPlugin;
  isServer: boolean;
  /** 提交内容（checker 的 ans 或 server 的 {event, data}），原样 JSON 落 records */
  ans?: unknown;
  /** 本次是否判定通过（server 事件无判定时传 false，且 recordEvent 传 false） */
  passed: boolean;
  alreadyPassed: boolean;
  msg: string;
  content?: string;
  pendingAwards: AwardedItem[];
  /** gameStorage 等伴随写 */
  extraStatements: D1PreparedStatement[];
  /** 是否写 records（mijie：提交总写；server 事件仅在产生判定时写） */
  recordEvent: boolean;
}

export interface PersistResult {
  /** 实际入账的得分（幂等过滤后） */
  awarded: AwardedItem[];
  gainedPoints: number;
  newlyPassed: boolean;
}

/**
 * 写入不变式（AGENTS.md 第 8 节）：
 * award 仅在实际插入 score_events 行时联动 problem_state/users；
 * 首次通关联动 passed_at、passed_count；题数或分数变化才更新 last_progress_at。
 */
export async function persistOutcome(input: PersistInput): Promise<PersistResult> {
  const now = Date.now();

  // 1. 幂等插入 score_events（INSERT OR IGNORE，并发安全：只有真正插入的一方才计分）
  let awarded: AwardedItem[] = [];
  if (input.pendingAwards.length) {
    const results = await input.db.batch(
      input.pendingAwards.map((a) =>
        input.db
          .prepare(
            'INSERT OR IGNORE INTO score_events (username, pid, score_id, points, awarded_at) VALUES (?, ?, ?, ?, ?)'
          )
          .bind(input.username, input.plugin.pid, a.id, a.points, now)
      )
    );
    awarded = input.pendingAwards.filter((_, i) => (results[i].meta.changes ?? 0) > 0);
  }
  const gainedPoints = awarded.reduce((s, a) => s + a.points, 0);
  const newlyPassed = input.passed && !input.alreadyPassed;
  const progressChanged = gainedPoints !== 0 || newlyPassed;

  // 2. 汇总写（单 batch）
  const stmts: D1PreparedStatement[] = [...input.extraStatements];
  if (input.recordEvent) {
    stmts.push(
      input.db
        .prepare(
          'INSERT INTO records (username, pid, ans_json, server, passed, gained_points, msg, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          input.username,
          input.plugin.pid,
          input.ans === undefined ? null : JSON.stringify(input.ans),
          input.isServer ? 1 : 0,
          input.passed ? 1 : 0,
          gainedPoints,
          input.msg || null,
          input.content || null,
          now
        )
    );
  }
  if (progressChanged) {
    stmts.push(
      input.db
        .prepare(
          `INSERT INTO problem_state (username, pid, score, passed_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(username, pid) DO UPDATE SET
             score = score + excluded.score,
             passed_at = CASE WHEN problem_state.passed_at IS NULL THEN excluded.passed_at ELSE problem_state.passed_at END`
        )
        .bind(input.username, input.plugin.pid, gainedPoints, newlyPassed ? now : null),
      input.db
        .prepare(
          'UPDATE users SET total_points = total_points + ?, passed_count = passed_count + ?, last_progress_at = ? WHERE username = ?'
        )
        .bind(gainedPoints, newlyPassed ? 1 : 0, now, input.username)
    );
  }
  if (stmts.length) await input.db.batch(stmts);
  return { awarded, gainedPoints, newlyPassed };
}
