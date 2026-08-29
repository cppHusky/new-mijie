import { describe, it, expect } from 'vitest';
import {
  plugins,
  pluginByPid,
  nameOf,
  validatePlugin,
  referencedPids,
  type RegistryIssue,
} from '../src/plugins/registry';
import type { Plugin } from '../src/types';

describe('registry：构建时加载 game/', () => {
  it('加载示例题并按 label 排序', () => {
    expect(plugins.map((p) => p.pid)).toEqual([
      'hello', 'meta', 'gatekeeper', 'mdvtest',
      'digitalcircuit', 'countlightsout', 'besiegewithoutassault',
    ]);
  });

  it('pluginByPid / nameOf', () => {
    expect(pluginByPid.get('meta')?.name).toBe('荟萃');
    expect(nameOf('hello')).toBe('你好，谜题');
    expect(nameOf('nosuch')).toBe('nosuch');
  });

  it('字符串 checker 归一化为全等比较', async () => {
    const hello = pluginByPid.get('hello')!;
    const checker = hello.checker as (ans: string, ctx: any) => boolean;
    expect(await checker('flag{hello}', {})).toBe(true);
    expect(await checker('flag{nope}', {})).toBe(false);
  });

  it('示例题的解锁条件引用均存在', () => {
    expect(referencedPids(pluginByPid.get('meta')!.unlock)).toEqual(['hello']);
  });
});

describe('validatePlugin 校验规则', () => {
  const valid = (): Plugin<any> => ({
    pid: 'p1',
    name: '题一',
    label: '1',
    unlock: true,
    description: { before_solve: { content: '题面' } },
    checker: 'flag{x}',
  });

  const run = (plugin: any) => {
    const issues: RegistryIssue[] = [];
    const result = validatePlugin('test-folder', plugin, issues);
    return { issues, result };
  };

  it('合法插件通过且无告警', () => {
    const { issues, result } = run(valid());
    expect(result).not.toBeNull();
    expect(issues).toEqual([]);
    expect(result!.folder).toBe('test-folder');
  });

  it('unlock 必填', () => {
    const p = valid() as any;
    delete p.unlock;
    const { issues, result } = run(p);
    expect(result).toBeNull();
    expect(issues.some((i) => i.level === 'error' && i.message.includes('unlock'))).toBe(true);
  });

  it('缺 label 仅告警不拒绝', () => {
    const p = valid() as any;
    delete p.label;
    const { issues, result } = run(p);
    expect(result).not.toBeNull();
    expect(issues.some((i) => i.level === 'warning' && i.message.includes('label'))).toBe(true);
  });

  it('scores.id 题内必须唯一且 desc 必填', () => {
    const p = { ...valid(), scores: [
      { id: 'a', desc: 'x', points: 1 },
      { id: 'a', desc: 'y', points: 2 },
    ] } as any;
    expect(run(p).result).toBeNull();
    const p2 = { ...valid(), scores: [{ id: 'a', points: 1 }] } as any;
    const r2 = run(p2);
    expect(r2.result).toBeNull();
    expect(r2.issues.some((i) => i.message.includes('desc'))).toBe(true);
  });

  it('scores.points 可为负但不能为非有限数', () => {
    const neg = { ...valid(), scores: [{ id: 'a', desc: '扣分', points: -5 }] } as any;
    expect(run(neg).result).not.toBeNull();
    const inf = { ...valid(), scores: [{ id: 'a', desc: 'x', points: Infinity }] } as any;
    expect(run(inf).result).toBeNull();
  });

  it('lurking + unlock 非 true 告警（无意义组合）', () => {
    const p = { ...valid(), accessible: 'lurking', unlock: [{ type: 'pass', pid: 'x' }] } as any;
    const { issues, result } = run(p);
    expect(result).not.toBeNull();
    expect(issues.some((i) => i.level === 'warning' && i.message.includes('lurking'))).toBe(true);
  });

  it('inputs: false 时不能设置 checker；无 checker/server/inputs:false 拒绝', () => {
    const p = { ...valid(), inputs: false } as any;
    expect(run(p).result).toBeNull();
    const p2 = valid() as any;
    delete p2.checker;
    expect(run(p2).result).toBeNull();
    const p3 = valid() as any;
    delete p3.checker;
    p3.inputs = false;
    expect(run(p3).result).not.toBeNull();
  });
});
