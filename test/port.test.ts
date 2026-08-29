import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, registerUser } from './helpers';

// —— D1 存储注入：把交互题的内部状态摆到已知位置，驱动确定性断言 ——

async function getStorage(username: string, pid: string, key: string): Promise<any> {
  const row = await (env as any).DB.prepare(
    'SELECT value_json FROM game_storage WHERE username = ? AND pid = ? AND key = ?'
  )
    .bind(username, pid, key)
    .first();
  return row ? JSON.parse((row as any).value_json) : null;
}

async function setStorage(username: string, pid: string, key: string, value: unknown): Promise<void> {
  await (env as any).DB.prepare(
    'INSERT OR REPLACE INTO game_storage (username, pid, key, value_json) VALUES (?, ?, ?, ?)'
  )
    .bind(username, pid, key, JSON.stringify(value))
    .run();
}

const server = (pid: string, event: string, data: unknown, token: string) =>
  api(`/problem/${pid}/server`, { method: 'POST', body: { event, data }, token });

/** 通过 hello（解锁链的第一步） */
async function passHello(token: string) {
  const r = await api('/problem/hello', { method: 'POST', body: { ans: 'flag{hello}' }, token });
  expect(r.json.passed).toBe(true);
}

/** 通过 CountLightsOut：注入「仅剩十字亮」状态后按一下 (0,0) */
async function passCountLightsOut(token: string, username: string) {
  await api('/problems/countlightsout/unlock', { method: 'POST', body: {}, token });
  await server('countlightsout', 'init', undefined, token);
  const cells = Array(36).fill(false);
  cells[0] = cells[1] = cells[6] = true;
  await setStorage(username, 'countlightsout', 'cells', cells);
  const r = await server('countlightsout', 'toggle', 0, token);
  expect(r.json.passed).toBe(true);
}

describe('移植：digitalcircuit（checker + gameStorage 动态判定）', () => {
  it('解锁链：hello → 幽灵 → 手动解锁 → 可见', async () => {
    const token = await registerUser('p5_dc');
    let list = await api('/problems', { token });
    let dc = list.json.problems.find((p: any) => p.pid === 'digitalcircuit')!;
    expect(dc.state).toBe('ghost');
    expect(dc.canUnlock).toBe(false);

    await passHello(token);
    list = await api('/problems', { token });
    dc = list.json.problems.find((p: any) => p.pid === 'digitalcircuit')!;
    expect(dc.canUnlock).toBe(true);
    await api('/problems/digitalcircuit/unlock', { method: 'POST', body: {}, token });
    list = await api('/problems', { token });
    dc = list.json.problems.find((p: any) => p.pid === 'digitalcircuit')!;
    expect(dc.state).toBe('visible');
    expect(dc.name).toBe('DigitalCircuit');
  });

  it('checker 逐轮演化（状态注入 last 输出）', async () => {
    const token = await registerUser('p5_dc2');
    await passHello(token);
    await api('/problems/digitalcircuit/unlock', { method: 'POST', body: {}, token });

    // 第一轮 '0000'：初始全 false → 计数器位翻转为 1，异或和为 0
    const r1 = await api('/problem/digitalcircuit', { method: 'POST', body: { ans: '0000' }, token });
    expect(r1.json.passed).toBe(false);
    expect(r1.json.msg).toContain('输出：[00100000]');

    // 第二轮 '0000'：last=00100000 → 计数器进位（out4 置位），异或和因 last[2] 翻转为 1
    const r2 = await api('/problem/digitalcircuit', { method: 'POST', body: { ans: '0000' }, token });
    expect(r2.json.msg).toContain('输出：[10001000]');

    // 非法输入长度
    const r3 = await api('/problem/digitalcircuit', { method: 'POST', body: { ans: '000' }, token });
    expect(r3.json.msg).toContain('长度不为 4');
  });
});

describe('移植：countlightsout（server + gameStorage + 背道而驰 award）', () => {
  it('全亮 award 与通关', async () => {
    const token = await registerUser('p5_clo');
    await passHello(token);
    await api('/problems/countlightsout/unlock', { method: 'POST', body: {}, token });

    const init = await server('countlightsout', 'init', undefined, token);
    expect(init.json.res).toBeGreaterThanOrEqual(0);
    expect(init.json.res).toBeLessThanOrEqual(36);

    // 注入「除十字外全亮」，toggle(0) → 全亮 → award all-on（无通关判定）
    const almostOn = Array(36).fill(true);
    almostOn[0] = almostOn[1] = almostOn[6] = false;
    await setStorage('p5_clo', 'countlightsout', 'cells', almostOn);
    const onRes = await server('countlightsout', 'toggle', 0, token);
    expect(onRes.json.res).toBe(36);
    expect(onRes.json.passed).toBeUndefined();
    expect(onRes.json.awarded).toEqual([
      { id: 'all-on', desc: '把所有灯全都打开（与通关背道而驰）', points: 10 },
    ]);

    // 注入「仅剩十字亮」，toggle(0) → 全灭 → 通关
    const cross = Array(36).fill(false);
    cross[0] = cross[1] = cross[6] = true;
    await setStorage('p5_clo', 'countlightsout', 'cells', cross);
    const offRes = await server('countlightsout', 'toggle', 0, token);
    expect(offRes.json.passed).toBe(true);
    expect(offRes.json.awarded).toEqual([{ id: 'pass', desc: '熄灭所有的灯', points: 100 }]);

    const me = await api('/me', { token });
    expect(me.json.totalPoints).toBe(120); // hello 10 + all-on 10 + pass 100
  });
});

describe('移植：besiegewithoutassault（mdv 交互 + 阶段分 + passCount 解锁）', () => {
  it('passCount 解锁：仅过 hello 不可解锁，过 CLO 后可解锁', async () => {
    const token = await registerUser('p5_bwa_gate');
    await passHello(token);
    const early = await api('/problems/besiegewithoutassault/unlock', {
      method: 'POST',
      body: {},
      token,
    });
    expect(early.json.unlocked).toBe(false);
    expect(early.json.conditions[0].desc).toContain('通过任意 1 关');
    await passCountLightsOut(token, 'p5_bwa_gate');
    const ok = await api('/problems/besiegewithoutassault/unlock', {
      method: 'POST',
      body: {},
      token,
    });
    expect(ok.json.unlocked).toBe(true);
  });

  it('移动链路 + 60 阶段分 + 通关', async () => {
    const token = await registerUser('p5_bwa');
    await passHello(token);
    await passCountLightsOut(token, 'p5_bwa');
    await api('/problems/besiegewithoutassault/unlock', { method: 'POST', body: {}, token });

    // 起点 (5,0)
    await server('besiegewithoutassault', 'start', { x: 5, y: 0 }, token);
    expect(await getStorage('p5_bwa', 'besiegewithoutassault', 'length')).toBe(0);

    // 第一移动 (5,0)→(6,0)：敌军逃离，length ≈ 0.95
    const m1 = await server(
      'besiegewithoutassault',
      'move',
      { player: { x: 5, y: 0 }, enemy: { x: 0, y: 0 }, next: { x: 6, y: 0 } },
      token
    );
    expect(m1.json.passed).toBeUndefined();
    const len1 = await getStorage('p5_bwa', 'besiegewithoutassault', 'length');
    expect(len1).toBeCloseTo(0.95, 5);
    const player1 = await getStorage('p5_bwa', 'besiegewithoutassault', 'player');
    const enemy1 = await getStorage('p5_bwa', 'besiegewithoutassault', 'enemy');
    expect(player1.x).toBeCloseTo(6, 9);
    expect(enemy1.x).toBeCloseTo(-0.95, 5);

    // 注入 length=59.9 → 第二移动跨 60 → 阶段分入账（无通关判定）
    await setStorage('p5_bwa', 'besiegewithoutassault', 'length', 59.9);
    const m2 = await server(
      'besiegewithoutassault',
      'move',
      { player: player1, enemy: enemy1, next: { x: 7, y: 0 } },
      token
    );
    expect(m2.json.passed).toBeUndefined();
    expect(m2.json.awarded).toEqual([
      { id: 'sixty', desc: '敌军累计路线长度达到 60', points: 5 },
    ]);

    // 注入 length=94.96 → 第三移动 → success → 通关
    const player2 = await getStorage('p5_bwa', 'besiegewithoutassault', 'player');
    const enemy2 = await getStorage('p5_bwa', 'besiegewithoutassault', 'enemy');
    await setStorage('p5_bwa', 'besiegewithoutassault', 'length', 94.96);
    const m3 = await server(
      'besiegewithoutassault',
      'move',
      { player: player2, enemy: enemy2, next: { x: 8, y: 0 } },
      token
    );
    expect(m3.json.passed).toBe(true);
    expect(m3.json.msg).toContain('敌军累计路程');
    expect(m3.json.awarded).toEqual([
      { id: 'pass', desc: '完成「围而不攻」（路线长度达到 95）', points: 100 },
    ]);

    // 终态：end 标记已写
    expect(await getStorage('p5_bwa', 'besiegewithoutassault', 'end')).toBe(true);
  });
});
