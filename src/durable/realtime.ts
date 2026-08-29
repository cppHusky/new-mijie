import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

/**
 * 实时推送中枢（替代 mijie 的 Ably）：单例 DO + WebSocket 广播。
 * 频道语义沿袭 mijie：notice（新公告）/ rank（排行榜变更，data 为 { uuid }）。
 * 广播内容对所有登录用户一致且非敏感，故 WS 接入不做鉴权；
 * 数据量极小，客户端按 channel 自行过滤。
 */
export class RealtimeHub extends DurableObject<Env> {
  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    // hibernation API：连接空闲时 DO 可休眠，不持续计费
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** RPC：向全部连接广播一条消息，返回送达数 */
  async publish(channel: string, data: unknown): Promise<number> {
    const msg = JSON.stringify({ channel, data });
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
        sent++;
      } catch {
        // 连接已断开，hibernation 会清理
      }
    }
    return sent;
  }

  webSocketError(_ws: WebSocket, error: unknown): void {
    console.error('[realtime] WebSocket 错误：', error);
  }
}
