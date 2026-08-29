import type { GameProcess, GameStorage, UnlockContext } from '../types';

export interface ProblemStateRow {
  pid: string;
  unlocked_at: number | null;
  visited_at: number | null;
  passed_at: number | null;
  score: number;
}

export interface UserState {
  gameProcess: GameProcess;
  /** pid → problem_state 行（无记录则不在 Map 中） */
  states: Map<string, ProblemStateRow>;
}

/** 加载玩家在全部题目上的状态，构建 GameProcess 快照 */
export async function loadUserState(db: D1Database, username: string): Promise<UserState> {
  const [user, rows] = await db.batch([
    db.prepare('SELECT total_points, passed_count FROM users WHERE username = ?').bind(username),
    db
      .prepare('SELECT pid, unlocked_at, visited_at, passed_at, score FROM problem_state WHERE username = ?')
      .bind(username),
  ]);
  const userRow = user.results[0] as { total_points: number; passed_count: number } | undefined;
  const passed = new Set<string>();
  const scores = new Map<string, number>();
  const states = new Map<string, ProblemStateRow>();
  for (const r of rows.results as unknown as ProblemStateRow[]) {
    states.set(r.pid, r);
    if (r.passed_at != null) passed.add(r.pid);
    if (r.score !== 0) scores.set(r.pid, r.score);
  }
  return {
    gameProcess: {
      passed,
      scores,
      totalPoints: userRow?.total_points ?? 0,
      passedCount: userRow?.passed_count ?? 0,
    },
    states,
  };
}

/** 解锁/可见性求值上下文（UnlockContext 与 GameProcess 字段名不同，做一次映射） */
export function unlockContextOf(state: UserState, now: Date): UnlockContext {
  return {
    passed: state.gameProcess.passed,
    problemScores: state.gameProcess.scores,
    totalPoints: state.gameProcess.totalPoints,
    passedCount: state.gameProcess.passedCount,
    now,
  };
}

export interface GameStorageHandle extends GameStorage {
  /** 脏数据回写语句，并入请求结束的 D1 batch（与计分/通关写同事务） */
  saveStatements(): D1PreparedStatement[];
}

/**
 * 每用户每题 KV：请求开始时预取为内存快照（同步 get/set），
 * 结束时通过 saveStatements() 批量回写（按 key 粒度，修 mijie 整体覆写问题）。
 */
export async function loadGameStorage(
  db: D1Database,
  username: string,
  pid: string
): Promise<GameStorageHandle> {
  const rows = await db
    .prepare('SELECT key, value_json FROM game_storage WHERE username = ? AND pid = ?')
    .bind(username, pid)
    .all<{ key: string; value_json: string }>();
  const data = new Map<string, any>(
    (rows.results ?? []).map((r) => [r.key, JSON.parse(r.value_json)])
  );
  const dirty = new Set<string>();
  let cleared = false;
  return {
    get<T = any>(key: string): T | null {
      return data.has(key) ? (data.get(key) as T) : null;
    },
    set(key: string, value: any) {
      data.set(key, value);
      dirty.add(key);
    },
    delete(key: string) {
      data.delete(key);
      dirty.add(key);
    },
    clear() {
      data.clear();
      dirty.clear();
      cleared = true;
    },
    saveStatements() {
      const stmts: D1PreparedStatement[] = [];
      if (cleared) {
        stmts.push(
          db.prepare('DELETE FROM game_storage WHERE username = ? AND pid = ?').bind(username, pid)
        );
      }
      for (const key of dirty) {
        if (data.has(key)) {
          stmts.push(
            db
              .prepare(
                'INSERT OR REPLACE INTO game_storage (username, pid, key, value_json) VALUES (?, ?, ?, ?)'
              )
              .bind(username, pid, key, JSON.stringify(data.get(key)))
          );
        } else {
          stmts.push(
            db
              .prepare('DELETE FROM game_storage WHERE username = ? AND pid = ? AND key = ?')
              .bind(username, pid, key)
          );
        }
      }
      return stmts;
    },
  };
}
