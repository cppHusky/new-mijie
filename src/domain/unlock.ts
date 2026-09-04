import type { Unlock, UnlockCondition, UnlockContext } from '../types';

export interface ConditionStatus {
  desc: string;
  met: boolean;
}

export interface UnlockStatus {
  /** unlock === true 时为空数组 */
  conditions: ConditionStatus[];
  canUnlock: boolean;
}

/** 求 now 在指定时区下的分钟数（0-59） */
export function minuteInTimezone(now: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    minute: 'numeric',
    hour12: false,
  });
  return parseInt(fmt.format(now), 10);
}

export function evalCondition(
  cond: UnlockCondition,
  ctx: UnlockContext,
  timeZone: string
): boolean {
  switch (cond.type) {
    case 'pass':
      return ctx.passed.has(cond.pid);
    case 'passCount': {
      let n = 0;
      for (const pid of cond.pids) if (ctx.passed.has(pid)) n++;
      return n >= cond.count;
    }
    case 'points':
      return ctx.totalPoints >= cond.atLeast;
    case 'problemPoints':
      return (ctx.problemScores.get(cond.pid) ?? 0) >= cond.atLeast;
    case 'sumPoints': {
      let sum = 0;
      for (const pid of cond.pids) sum += ctx.problemScores.get(pid) ?? 0;
      return sum >= cond.atLeast;
    }
    case 'time': {
      const t = ctx.now.getTime();
      if (cond.after && t < Date.parse(cond.after)) return false;
      if (cond.before && t > Date.parse(cond.before)) return false;
      if (cond.minuteParity) {
        const m = minuteInTimezone(ctx.now, timeZone);
        if (m % 2 !== (cond.minuteParity === 'odd' ? 1 : 0)) return false;
      }
      return true;
    }
    case 'custom':
      return cond.when(ctx);
  }
}

/** 生成解锁条件的人类可读描述；cond.desc 优先（custom 必须自带 desc） */
export function conditionDesc(
  cond: UnlockCondition,
  ctx: UnlockContext,
  nameOf: (pid: string) => string
): string {
  // desc 为函数：动态生成；抛异常时回退，绝不让一道题打挂整个列表
  if ('desc' in cond && typeof cond.desc === 'function') {
    try {
      const text = cond.desc(ctx, nameOf);
      if (typeof text === 'string' && text.length) return text;
    } catch (e) {
      console.error(`[unlock] 条件 ${cond.type} 的 desc 函数执行异常：`, e);
    }
  } else if ('desc' in cond && typeof cond.desc === 'string' && cond.desc) {
    return cond.desc;
  }
  switch (cond.type) {
    case 'pass':
      return `通过关卡《${nameOf(cond.pid)}》`;
    case 'passCount': {
      const names = cond.pids.map(nameOf).join('》《');
      return `在《${names}》中通过任意 ${cond.count} 关`;
    }
    case 'points':
      return `总分达到 ${cond.atLeast} 分`;
    case 'problemPoints':
      return `关卡《${nameOf(cond.pid)}》的得分达到 ${cond.atLeast} 分`;
    case 'sumPoints': {
      const names = cond.pids.map(nameOf).join('》《');
      return `《${names}》的得分之和达到 ${cond.atLeast} 分`;
    }
    case 'time': {
      const parts: string[] = [];
      if (cond.after) parts.push(`${cond.after} 之后`);
      if (cond.before) parts.push(`${cond.before} 之前`);
      if (cond.minuteParity) {
        parts.push(cond.minuteParity === 'odd' ? '仅奇数分钟' : '仅偶数分钟');
      }
      return `时间窗口：${parts.join('，')}`;
    }
    case 'custom':
      // 函数 desc 执行失败（或返回空串）时的兜底
      return '（描述生成失败）';
  }
}

/** 求值整组解锁条件（AND 语义；true 直接可解锁） */
export function evalUnlock(
  unlock: Unlock,
  ctx: UnlockContext,
  timeZone: string,
  nameOf: (pid: string) => string
): UnlockStatus {
  if (unlock === true) return { conditions: [], canUnlock: true };
  const conditions = unlock.map((c) => ({
    desc: conditionDesc(c, ctx, nameOf),
    met: evalCondition(c, ctx, timeZone),
  }));
  return { conditions, canUnlock: conditions.every((c) => c.met) };
}
