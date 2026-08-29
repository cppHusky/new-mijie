import type { RealtimeHub } from './durable/realtime';

export interface Env {
  DB: D1Database;
  REALTIME_HUB: DurableObjectNamespace<RealtimeHub>;
  TIMEZONE?: string;
  JWT_SECRET: string;
  TURNSTILE_KEY?: string;
  TURNSTILE_SECRET?: string;
  GLOT_IO_API_KEY?: string;
  RATE_LIMITER?: RateLimit;
  /** 大二进制题目附件（可选；未配置时 /api/file 仅服务打包内文本资产） */
  R2_BUCKET?: R2Bucket;
}

export interface Variables {
  username: string;
  admin: number;
}
