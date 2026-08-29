import { describe, it, expect } from 'vitest';
import { api, registerUser } from './helpers';

// 测试文件内共享同一个 D1（per-file 隔离），各用例按顺序执行；
// 首个注册的用户必须是 admin_first，才能成为 admin=2。
describe('认证与用户', () => {
  it('首个注册用户自动成为超级管理员', async () => {
    const token = await registerUser('admin_first');
    const me = await api('/me', { token });
    expect(me.status).toBe(200);
    expect(me.json.username).toBe('admin_first');
    expect(me.json.admin).toBe(2);
    expect(me.json.totalPoints).toBe(0);
    expect(me.json.passedCount).toBe(0);
  });

  it('第二个用户是普通玩家', async () => {
    const token = await registerUser('player_second');
    const me = await api('/me', { token });
    expect(me.json.admin).toBe(0);
  });

  it('重复注册返回 409', async () => {
    const r = await api('/register', { body: { username: 'admin_first', password: 'x' } });
    expect(r.status).toBe(409);
  });

  it('错误密码登录返回 401', async () => {
    const r = await api('/login', { body: { username: 'admin_first', password: 'wrong' } });
    expect(r.status).toBe(401);
  });

  it('未登录访问受保护路由返回 401', async () => {
    expect((await api('/me')).status).toBe(401);
    expect((await api('/problems')).status).toBe(401);
    expect((await api('/rank')).status).toBe(401);
  });

  it('QQ 设置与校验', async () => {
    const token = await registerUser('qq_user');
    expect((await api('/change-qq', { body: { qq: '12345' }, token })).status).toBe(200);
    expect((await api('/me', { token })).json.qq).toBe('12345');
    expect((await api('/change-qq', { body: { qq: '0123' }, token })).status).toBe(400);
    expect((await api('/change-qq', { body: { qq: 'abc' }, token })).status).toBe(400);
  });

  it('修改密码后可用新密码登录', async () => {
    const token = await registerUser('pw_user');
    expect(
      (await api('/change-password', { body: { password: 'bad', newPassword: 'y' }, token })).status
    ).toBe(401);
    expect(
      (await api('/change-password', { body: { password: 'pw123456', newPassword: 'newpw789' }, token }))
        .status
    ).toBe(200);
    const l = await api('/login', { body: { username: 'pw_user', password: 'newpw789' } });
    expect(l.status).toBe(200);
  });
});

describe('题目列表与解锁', () => {
  it('列表呈现可见性、名称与解锁条件', async () => {
    const token = await registerUser('list_user');
    const r = await api('/problems', { token });
    expect(r.status).toBe(200);
    const byPid = new Map<string, any>(
      r.json.problems.map((p: any) => [p.pid, p] as [string, any])
    );

    const hello = byPid.get('hello')!;
    expect(hello.state).toBe('visible');
    expect(hello.name).toBe('你好，谜题');
    expect(hello.label).toBe('01');
    expect(hello.unlocked).toBe(true);

    const meta = byPid.get('meta')!;
    expect(meta.state).toBe('ghost');
    expect(meta.name).toBeUndefined();
    expect(meta.label).toBe('02');
    expect(meta.unlocked).toBe(false);
    expect(meta.conditions).toHaveLength(2);
    expect(meta.conditions[0]).toEqual({ desc: '通过关卡《你好，谜题》', met: false });
    expect(meta.conditions[1].desc).toContain('奇数分钟');

    const gate = byPid.get('gatekeeper')!;
    expect(gate.state).toBe('ghost');
    expect(gate.canUnlock).toBe(false);
    expect(gate.conditions.map((x: any) => x.met)).toEqual([false, false]);
  });

  it('未解锁题目返回 404（隐藏存在性）', async () => {
    const token = await registerUser('locked_user');
    expect((await api('/problem/gatekeeper', { token })).status).toBe(404);
    expect((await api('/problem/gatekeeper', { method: 'POST', body: {}, token })).status).toBe(404);
  });

  it('不存在的 pid 同样 404', async () => {
    const token = await registerUser('nosuch_user');
    expect((await api('/problem/nosuch', { token })).status).toBe(404);
    expect((await api('/problems/nosuch/unlock', { method: 'POST', body: {}, token })).status).toBe(404);
  });
});

describe('提交、award 与得分流水线', () => {
  it('提交判定 + 通关得分 + 幂等', async () => {
    const token = await registerUser('submit_user');

    const wrong = await api('/problem/hello', { method: 'POST', body: { ans: 'nope' }, token });
    expect(wrong.json.passed).toBe(false);
    expect(wrong.json.awarded ?? []).toEqual([]);

    const right = await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token });
    expect(right.json.passed).toBe(true);
    expect(right.json.awarded).toEqual([{ id: 'pass', desc: '通过本题', points: 10 }]);
    expect(right.json.after_solve?.content).toContain('恭喜');

    // 幂等：重复通过不再计分
    const again = await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token });
    expect(again.json.passed).toBe(true);
    expect(again.json.awarded).toEqual([]);
    expect(again.json.after_solve).toBeUndefined();

    const me = await api('/me', { token });
    expect(me.json.passedCount).toBe(1);
    expect(me.json.totalPoints).toBe(10);

    // 任务清单：已通过的条件 achieved
    const detail = await api('/problem/hello', { token });
    expect(detail.json.scores).toEqual([
      { id: 'pass', desc: '通过本题', points: 10, achieved: true },
    ]);
  });

  it('解锁 → 可见 → server 事件 → 负分 award → gameStorage 持久化', async () => {
    const token = await registerUser('event_user');

    // 未满足条件时无法解锁
    const early = await api('/problems/gatekeeper/unlock', { method: 'POST', body: {}, token });
    expect(early.json.unlocked).toBe(false);

    // 通过 hello 后满足全部条件（pass + 总分 10 ≥ 5）
    await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token });
    const unlock = await api('/problems/gatekeeper/unlock', { method: 'POST', body: {}, token });
    expect(unlock.json.unlocked).toBe(true);

    // 解锁后空悬转可见
    const list = await api('/problems', { token });
    const gate = list.json.problems.find((p: any) => p.pid === 'gatekeeper')!;
    expect(gate.state).toBe('visible');
    expect(gate.name).toBe('守门人');

    // 第一次敲门：award -3，gameStorage 计数 1
    const k1 = await api('/problem/gatekeeper/server', {
      method: 'POST',
      body: { event: 'knock' },
      token,
    });
    expect(k1.json.passed).toBe(false);
    expect(k1.json.awarded).toEqual([{ id: 'knock', desc: '敲了一次门（扣分警告）', points: -3 }]);
    expect(k1.json.res).toBe(1);

    // 第二次敲门：award 幂等不再扣，计数继续（gameStorage 跨事件持久化）
    const k2 = await api('/problem/gatekeeper/server', {
      method: 'POST',
      body: { event: 'knock' },
      token,
    });
    expect(k2.json.awarded).toEqual([]);
    expect(k2.json.res).toBe(2);

    const pass = await api('/problem/gatekeeper/server', {
      method: 'POST',
      body: { event: 'pass' },
      token,
    });
    expect(pass.json.passed).toBe(true);
    expect(pass.json.after_solve?.content).toContain('开门');

    const me = await api('/me', { token });
    expect(me.json.passedCount).toBe(2);
    expect(me.json.totalPoints).toBe(7); // 10 - 3
  });

  it('skipProblem 回看 after_solve', async () => {
    const token = await registerUser('skip_user');
    expect((await api('/skipProblem/hello', { token })).status).toBe(400);
    await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token });
    const r = await api('/skipProblem/hello', { token });
    expect(r.status).toBe(200);
    expect(r.json.after_solve?.content).toContain('恭喜');
    expect(r.json.myScore).toBe(10);
  });
});

describe('排行榜与提交记录', () => {
  it('排行榜：通关数降序、分数降序、并列同名次', async () => {
    const strong = await registerUser('rank_strong');
    await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token: strong });
    const weak1 = await registerUser('rank_weak1');
    const weak2 = await registerUser('rank_weak2');

    const r = await api('/rank', { token: strong });
    expect(r.status).toBe(200);
    const byName = new Map<string, any>(
      r.json.rank.map((x: any) => [x.username, x] as [string, any])
    );

    const strongRow = byName.get('rank_strong')!;
    expect(strongRow.passedCount).toBe(1);
    expect(strongRow.totalPoints).toBe(10);

    // 两名全零用户数据完全相同 → 排名相同，且低于有进度的用户
    const w1 = byName.get('rank_weak1')!;
    const w2 = byName.get('rank_weak2')!;
    expect(w1.rank).toBe(w2.rank);
    expect(strongRow.rank).toBeLessThan(w1.rank);
  });

  it('提交记录与各题提交次数', async () => {
    const token = await registerUser('record_user');
    await api('/problem/hello', { method: 'POST', body: { ans: 'x' }, token });
    await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token });

    const rec = await api('/record', { token });
    expect(rec.json.total).toBe(2);
    expect(rec.json.records[0].passed).toBe(1);
    expect(rec.json.records[0].gained_points).toBe(10);
    expect(rec.json.records[1].passed).toBe(0);

    const onlyPassed = await api('/record?passed=true', { token });
    expect(onlyPassed.json.total).toBe(1);

    const subs = await api('/submitted_problems', { token });
    expect(subs.json.submitted_problems).toEqual([
      { pid: 'hello', name: '你好，谜题', count: 2 },
    ]);
  });
});
