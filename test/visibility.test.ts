import { describe, it, expect } from 'vitest';
import { evalVisibility } from '../src/domain/visibility';
import type { AccessContext } from '../src/types';

const ctx = (over: Partial<AccessContext> = {}): AccessContext => ({
  passed: new Set(),
  problemScores: new Map(),
  totalPoints: 0,
  passedCount: 0,
  now: new Date('2026-08-29T12:00:00Z'),
  unlocked: false,
  visited: false,
  ...over,
});

describe('evalVisibility 预设', () => {
  it('always：永远可见', () => {
    expect(evalVisibility('always', ctx())).toBe('visible');
  });

  it('hidden：永不显示', () => {
    expect(evalVisibility('hidden', ctx())).toBe('hidden');
    expect(evalVisibility('hidden', ctx({ unlocked: true }))).toBe('hidden');
  });

  it('suspended：空悬（未解锁→幽灵，已解锁→可见）', () => {
    expect(evalVisibility('suspended', ctx({ unlocked: false }))).toBe('ghost');
    expect(evalVisibility('suspended', ctx({ unlocked: true }))).toBe('visible');
  });

  it('lurking：潜伏（未访问→隐藏，访问过→可见）', () => {
    expect(evalVisibility('lurking', ctx({ visited: false }))).toBe('hidden');
    expect(evalVisibility('lurking', ctx({ visited: true }))).toBe('visible');
  });

  it('未配置 accessible 时默认 suspended', () => {
    expect(evalVisibility(undefined, ctx())).toBe('ghost');
    expect(evalVisibility(undefined, ctx({ unlocked: true }))).toBe('visible');
  });
});

describe('evalVisibility 自定义函数', () => {
  it('按玩家进度逐步披露', () => {
    const fn = (c: AccessContext) =>
      c.passedCount >= 2 ? (c.unlocked ? 'visible' : 'ghost') : 'hidden';
    expect(evalVisibility(fn, ctx({ passedCount: 1 }))).toBe('hidden');
    expect(evalVisibility(fn, ctx({ passedCount: 2 }))).toBe('ghost');
    expect(evalVisibility(fn, ctx({ passedCount: 2, unlocked: true }))).toBe('visible');
  });
});
