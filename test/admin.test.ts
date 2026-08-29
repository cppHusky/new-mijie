import { describe, it, expect } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { api, registerUser } from './helpers';

// 本文件首个注册用户为管理员（admin=2）
let adminToken: string;

describe('admin 后台', () => {
  it('首个用户成为管理员，普通用户访问 admin 路由返回 403', async () => {
    adminToken = await registerUser('p4_admin');
    const userToken = await registerUser('p4_user');
    expect((await api('/users', { token: userToken })).status).toBe(403);
    expect((await api('/game-config')).status).toBe(401);
    expect((await api('/users', { token: adminToken })).status).toBe(200);
  });

  it('problemList 返回全部题目', async () => {
    const r = await api('/problemList', { token: adminToken });
    expect(r.json.problems.map((p: any) => p.pid)).toEqual([
      'hello',
      'meta',
      'gatekeeper',
      'mdvtest',
      'digitalcircuit',
      'countlightsout',
      'besiegewithoutassault',
    ]);
  });

  it('users 列表包含 QQ、得分与通关信息', async () => {
    const token = await registerUser('p4_player');
    await api('/change-qq', { body: { qq: '987654321' }, token });
    await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token });

    const r = await api('/users', { token: adminToken });
    const u = r.json.users.find((x: any) => x.username === 'p4_player')!;
    expect(u.qq).toBe('987654321');
    expect(u.passedCount).toBe(1);
    expect(u.totalPoints).toBe(10);
    expect(u.scores).toEqual({ hello: 10 });
    expect(u.passedPids).toEqual(['hello']);
  });

  it('封禁用户无法登录，已登录令牌被强制登出；解封后恢复', async () => {
    const token = await registerUser('p4_banme');
    const r = await api('/user?username=p4_banme', {
      method: 'PUT',
      body: { banned: true },
      token: adminToken,
    });
    expect(r.status).toBe(200);

    const login = await api('/login', { body: { username: 'p4_banme', password: 'pw123456' } });
    expect(login.status).toBe(403);
    const authed = await api('/me', { token });
    expect(authed.json.action).toBe('logout');

    await api('/user?username=p4_banme', {
      method: 'PUT',
      body: { banned: false },
      token: adminToken,
    });
    expect((await api('/login', { body: { username: 'p4_banme', password: 'pw123456' } })).status).toBe(200);
  });

  it('隐藏用户从排行榜消失；改 admin 权限需 admin>=2', async () => {
    const token = await registerUser('p4_hideme');
    await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token });

    await api('/user?username=p4_hideme', { method: 'PUT', body: { hidden: true }, token: adminToken });
    let rank = await api('/rank', { token: adminToken });
    expect(rank.json.rank.some((x: any) => x.username === 'p4_hideme')).toBe(false);

    await api('/user?username=p4_hideme', { method: 'PUT', body: { hidden: false }, token: adminToken });
    rank = await api('/rank', { token: adminToken });
    expect(rank.json.rank.some((x: any) => x.username === 'p4_hideme')).toBe(true);

    // admin=2 可以授予 admin=1；admin=1 无权再授予
    const sub = await registerUser('p4_subadmin');
    await api('/user?username=p4_subadmin', { method: 'PUT', body: { admin: 1 }, token: adminToken });
    const subToken = await (async () => {
      const l = await api('/login', { body: { username: 'p4_subadmin', password: 'pw123456' } });
      return l.json.token as string;
    })();
    expect((await api('/users', { token: subToken })).status).toBe(200);
    expect(
      (await api('/user?username=p4_hideme', { method: 'PUT', body: { admin: 1 }, token: subToken })).status
    ).toBe(403);
    void sub;
  });

  it('管理员 hidden 默认置 1（不上排行榜），可手动取消隐藏后上榜', async () => {
    // 首个注册管理员与被授予 admin 的用户 hidden 均为 1
    const users = await api('/users', { token: adminToken });
    expect(users.json.users.find((x: any) => x.username === 'p4_admin')!.hidden).toBe(true);
    expect(users.json.users.find((x: any) => x.username === 'p4_subadmin')!.hidden).toBe(true);

    let rank = await api('/rank', { token: adminToken });
    expect(rank.json.rank.some((x: any) => x.username === 'p4_admin')).toBe(false);
    expect(rank.json.rank.some((x: any) => x.username === 'p4_subadmin')).toBe(false);
    expect(rank.json.rank.some((x: any) => x.username === 'p4_player')).toBe(true);

    // 手动取消隐藏 → 上榜
    await api('/user?username=p4_admin', { method: 'PUT', body: { hidden: false }, token: adminToken });
    rank = await api('/rank', { token: adminToken });
    expect(rank.json.rank.some((x: any) => x.username === 'p4_admin')).toBe(true);
    await api('/user?username=p4_admin', { method: 'PUT', body: { hidden: true }, token: adminToken });
  });

  it('game-config 读写与提交时间窗口', async () => {
    const token = await registerUser('p4_window');
    const put = await api('/game-config', {
      method: 'PUT',
      body: { startTime: '2999-01-01 00:00:00' },
      token: adminToken,
    });
    expect(put.status).toBe(200);
    expect((await api('/game-config/startTime')).json.startTime).toBe('2999-01-01 00:00:00');

    // 非管理员提交被时间窗口拦截
    const blocked = await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token });
    expect(blocked.status).toBe(400);
    expect(blocked.text).toContain('未开始');

    // 管理员不受影响
    const ok = await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token: adminToken });
    expect(ok.json.passed).toBe(true);

    // 恢复
    await api('/game-config', {
      method: 'PUT',
      body: { startTime: '2000-01-01 00:00:00' },
      token: adminToken,
    });
    expect(
      (await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token })).json.passed
    ).toBe(true);
  });

  it('recalculate 重算排行榜冗余字段', async () => {
    const token = await registerUser('p4_recalc');
    await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token });
    await (env as any).DB.prepare("UPDATE users SET total_points = 999, passed_count = 0 WHERE username = 'p4_recalc'").run();
    expect((await api('/me', { token })).json.totalPoints).toBe(999);
    await api('/recalculate', { token: adminToken });
    const me = await api('/me', { token });
    expect(me.json.totalPoints).toBe(10);
    expect(me.json.passedCount).toBe(1);
  });

  it('公告发布、读取、删除与 WebSocket 广播', async () => {
    // 直连 DO 建立 WebSocket（验证「HTTP 路由 → publish RPC → DO 广播」全链路）
    const stub = (env as any).REALTIME_HUB.getByName('global');
    const wsRes = await stub.fetch(
      new Request('https://do/realtime', { headers: { Upgrade: 'websocket' } })
    );
    expect(wsRes.status).toBe(101);
    const client = wsRes.webSocket!;
    client.accept();
    const messages: any[] = [];
    client.addEventListener('message', (e: MessageEvent) => messages.push(JSON.parse(e.data as string)));

    const post = await api('/notice', { method: 'POST', body: { content: '第一条测试公告' }, token: adminToken });
    expect(post.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(messages.some((m) => m.channel === 'notice' && m.data.content.includes('测试公告'))).toBe(true);

    const list = await api('/notice', { token: adminToken });
    const notice = list.json.notices.find((n: any) => n.content === '第一条测试公告')!;
    expect(notice).toBeTruthy();
    const del = await api(`/notice/${notice.id}`, { method: 'DELETE', token: adminToken });
    expect(del.status).toBe(200);
    expect((await api('/notice', { token: adminToken })).json.notices).toHaveLength(0);
    client.close();
  });

  it('cleanRecords 清空全部提交记录', async () => {
    const before = await api('/record?all=true', { token: adminToken });
    expect(before.json.total).toBeGreaterThan(0);
    await api('/cleanRecords', { method: 'POST', token: adminToken });
    expect((await api('/record?all=true', { token: adminToken })).json.total).toBe(0);
  });
});

describe('file 服务', () => {
  it('未登录 401', async () => {
    expect((await api('/file/mdvtest/app/main.md')).status).toBe(401);
  });

  it('mdv 资产：include 内可拉取，mdv 头返回 text/plain', async () => {
    const token = await registerUser('p4_file');
    const r = await (exports as any).default.fetch('http://test.local/api/file/mdvtest/app/main.md', {
      headers: { authorization: `Bearer ${token}`, 'x-application-id': 'mdv' },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/plain');
    expect(await r.text()).toContain('# MDV 试验田');
  });

  it('exclude 命中的文件 403；白名单外路径 403', async () => {
    const token = await registerUser('p4_file2');
    expect((await api('/file/mdvtest/app/hidden.txt', { token })).status).toBe(403);
    expect((await api('/file/mdvtest/index.ts', { token })).status).toBe(403);
    expect((await api('/file/mdvtest/../hello/index.ts', { token })).status).toBe(403);
  });

  it('files 附件可下载', async () => {
    const token = await registerUser('p4_file3');
    const r = await api('/file/mdvtest/notes.txt', { token });
    expect(r.status).toBe(200);
    expect(r.text).toContain('连点三下');
  });

  it('未解锁题目的资产 404', async () => {
    const token = await registerUser('p4_file4');
    expect((await api('/file/gatekeeper/anything.txt', { token })).status).toBe(404);
  });
});
