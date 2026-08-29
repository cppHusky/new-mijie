import { describe, it, expect } from 'vitest';
import {
  evalCondition,
  evalUnlock,
  conditionDesc,
  minuteInTimezone,
} from '../src/domain/unlock';
import type { UnlockContext } from '../src/types';

const TZ = 'Asia/Shanghai';

const baseCtx = (over: Partial<UnlockContext> = {}): UnlockContext => ({
  passed: new Set(['hello']),
  problemScores: new Map([
    ['hello', 10],
    ['meta', -5],
  ]),
  totalPoints: 5,
  passedCount: 1,
  now: new Date('2026-08-29T12:34:56Z'),
  ...over,
});

const nameOf = (pid: string) => ({ hello: '你好，谜题', meta: '荟萃' })[pid] ?? pid;

describe('evalCondition', () => {
  it('pass：通过指定关卡', () => {
    expect(evalCondition({ type: 'pass', pid: 'hello' }, baseCtx(), TZ)).toBe(true);
    expect(evalCondition({ type: 'pass', pid: 'meta' }, baseCtx(), TZ)).toBe(false);
  });

  it('passCount：集合中通过 N 关', () => {
    const cond = { type: 'passCount', pids: ['hello', 'meta', 'x'], count: 1 } as const;
    expect(evalCondition(cond, baseCtx(), TZ)).toBe(true);
    expect(evalCondition({ ...cond, count: 2 }, baseCtx(), TZ)).toBe(false);
  });

  it('points：总分达标（含负分场景）', () => {
    expect(evalCondition({ type: 'points', atLeast: 5 }, baseCtx(), TZ)).toBe(true);
    expect(evalCondition({ type: 'points', atLeast: 6 }, baseCtx(), TZ)).toBe(false);
    expect(evalCondition({ type: 'points', atLeast: -10 }, baseCtx(), TZ)).toBe(true);
  });

  it('problemPoints：某关得分达标', () => {
    expect(evalCondition({ type: 'problemPoints', pid: 'hello', atLeast: 10 }, baseCtx(), TZ)).toBe(true);
    expect(evalCondition({ type: 'problemPoints', pid: 'hello', atLeast: 11 }, baseCtx(), TZ)).toBe(false);
    expect(evalCondition({ type: 'problemPoints', pid: 'nosuch', atLeast: 0 }, baseCtx(), TZ)).toBe(true);
  });

  it('sumPoints：若干关分数之和达标', () => {
    const cond = { type: 'sumPoints', pids: ['hello', 'meta'], atLeast: 5 } as const;
    expect(evalCondition(cond, baseCtx(), TZ)).toBe(true);
    expect(evalCondition({ ...cond, atLeast: 6 }, baseCtx(), TZ)).toBe(false);
  });

  it('time：after/before 窗口', () => {
    const ctx = baseCtx({ now: new Date('2026-09-01T12:00:00Z') });
    expect(evalCondition({ type: 'time', after: '2026-09-01T00:00:00Z' }, ctx, TZ)).toBe(true);
    expect(evalCondition({ type: 'time', after: '2026-09-02T00:00:00Z' }, ctx, TZ)).toBe(false);
    expect(evalCondition({ type: 'time', before: '2026-09-02T00:00:00Z' }, ctx, TZ)).toBe(true);
    expect(evalCondition({ type: 'time', before: '2026-09-01T00:00:00Z' }, ctx, TZ)).toBe(false);
    expect(
      evalCondition(
        { type: 'time', after: '2026-09-01T00:00:00Z', before: '2026-09-02T00:00:00Z' },
        ctx,
        TZ
      )
    ).toBe(true);
  });

  it('time：分钟奇偶按 TIMEZONE 求值（UTC 20:34 = 北京 04:34+? 见下）', () => {
    // 12:34 UTC → 20:34 Asia/Shanghai，分钟 34 为偶
    expect(evalCondition({ type: 'time', minuteParity: 'even' }, baseCtx(), TZ)).toBe(true);
    expect(evalCondition({ type: 'time', minuteParity: 'odd' }, baseCtx(), TZ)).toBe(false);
    // 12:35 UTC → 20:35 Asia/Shanghai，分钟 35 为奇
    const odd = baseCtx({ now: new Date('2026-08-29T12:35:00Z') });
    expect(evalCondition({ type: 'time', minuteParity: 'odd' }, odd, TZ)).toBe(true);
  });

  it('custom：调用自定义谓词', () => {
    const cond = {
      type: 'custom',
      desc: '自定义',
      when: (ctx: UnlockContext) => ctx.passedCount >= 1 && ctx.totalPoints > 0,
    } as const;
    expect(evalCondition(cond, baseCtx(), TZ)).toBe(true);
    expect(evalCondition(cond, baseCtx({ totalPoints: -1 }), TZ)).toBe(false);
  });
});

describe('minuteInTimezone', () => {
  it('按目标时区取分钟（含半时区偏移）', () => {
    const now = new Date('2026-08-29T12:34:00Z');
    expect(minuteInTimezone(now, 'Asia/Shanghai')).toBe(34); // UTC+8 整点偏移
    expect(minuteInTimezone(now, 'Asia/Kolkata')).toBe(4); // UTC+5:30 → 18:04
    expect(minuteInTimezone(now, 'UTC')).toBe(34);
  });
});

describe('conditionDesc', () => {
  it('为声明式条件自动生成中文描述', () => {
    expect(conditionDesc({ type: 'pass', pid: 'hello' }, nameOf)).toBe('通过关卡《你好，谜题》');
    expect(conditionDesc({ type: 'passCount', pids: ['hello', 'meta'], count: 1 }, nameOf)).toBe(
      '在《你好，谜题》《荟萃》中通过任意 1 关'
    );
    expect(conditionDesc({ type: 'points', atLeast: 100 }, nameOf)).toBe('总分达到 100 分');
    expect(conditionDesc({ type: 'problemPoints', pid: 'hello', atLeast: 10 }, nameOf)).toBe(
      '关卡《你好，谜题》的得分达到 10 分'
    );
    expect(conditionDesc({ type: 'sumPoints', pids: ['hello'], atLeast: 5 }, nameOf)).toBe(
      '《你好，谜题》的得分之和达到 5 分'
    );
    expect(conditionDesc({ type: 'time', minuteParity: 'odd' }, nameOf)).toBe('时间窗口：仅奇数分钟');
    expect(conditionDesc({ type: 'time', after: '2026-09-01' }, nameOf)).toBe('时间窗口：2026-09-01 之后');
  });

  it('desc 字段优先于自动生成', () => {
    expect(conditionDesc({ type: 'pass', pid: 'hello', desc: '先过小关' }, nameOf)).toBe('先过小关');
    expect(conditionDesc({ type: 'custom', desc: '缘分到了', when: () => true }, nameOf)).toBe('缘分到了');
  });
});

describe('evalUnlock', () => {
  it('unlock === true 直接可解锁', () => {
    expect(evalUnlock(true, baseCtx(), TZ, nameOf)).toEqual({ conditions: [], canUnlock: true });
  });

  it('数组为 AND 语义，逐项给出 met', () => {
    const res = evalUnlock(
      [
        { type: 'pass', pid: 'hello' },
        { type: 'time', minuteParity: 'odd' },
      ],
      baseCtx(), // 偶数分钟
      TZ,
      nameOf
    );
    expect(res.conditions).toEqual([
      { desc: '通过关卡《你好，谜题》', met: true },
      { desc: '时间窗口：仅奇数分钟', met: false },
    ]);
    expect(res.canUnlock).toBe(false);
  });

  it('全部满足时 canUnlock', () => {
    const res = evalUnlock(
      [{ type: 'pass', pid: 'hello' }, { type: 'points', atLeast: 5 }],
      baseCtx(),
      TZ,
      nameOf
    );
    expect(res.canUnlock).toBe(true);
  });
});
