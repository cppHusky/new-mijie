import { describe, it, expect } from 'vitest';
import { compareProblems } from '../src/domain/sort';

describe('compareProblems（label 排序，决策 7）', () => {
  it('label 数字感知自然序', () => {
    const list = [
      { label: '10', pid: 'a' },
      { label: '2', pid: 'b' },
      { label: '01', pid: 'c' },
    ].sort(compareProblems);
    expect(list.map((x) => x.label)).toEqual(['01', '2', '10']);
  });

  it('无 label 的按 pid 排在最后', () => {
    const list = [
      { pid: 'aaa' },
      { label: '1', pid: 'zzz' },
      { pid: 'bbb' },
    ].sort(compareProblems);
    expect(list.map((x) => x.pid)).toEqual(['zzz', 'aaa', 'bbb']);
  });

  it('label 相同按 pid 稳定决胜', () => {
    const list = [
      { label: '1', pid: 'b' },
      { label: '1', pid: 'a' },
    ].sort(compareProblems);
    expect(list.map((x) => x.pid)).toEqual(['a', 'b']);
  });
});
