import type { Env } from '../env';

export type Channel = 'notice' | 'rank';

/** 发布实时消息（失败仅记日志，不影响主流程） */
export async function publish(env: Env, channel: Channel, data: unknown): Promise<void> {
  try {
    await env.REALTIME_HUB.getByName('global').publish(channel, data);
  } catch (e) {
    console.error('[publish] 发布失败：', channel, e);
  }
}
