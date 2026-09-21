import { Hono } from 'hono';
import type { Env, Variables } from './env';
import { publicRoutes, authedRoutes } from './routes/auth';
import gameRoutes from './routes/game';
import adminRoutes from './routes/admin';
import fileRoutes from './routes/file';
import { requireAuth } from './lib/auth';
import { cleanupInactiveUsers } from './lib/cleanup';
import { RealtimeHub } from './durable/realtime';

export { RealtimeHub };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get('/api/ping', (c) => c.text('pong'));

// 实时推送 WebSocket（公开，数据非敏感；客户端按频道过滤）
app.get('/api/realtime', (c) => c.env.REALTIME_HUB.getByName('global').fetch(c.req.raw));

// 公开路由（注册/登录/keys/game-config）
app.route('/api', publicRoutes);

// 以下均需登录
app.use('/api/*', requireAuth);
app.route('/api', authedRoutes);
app.route('/api', gameRoutes);
app.route('/api', fileRoutes);
app.route('/api', adminRoutes);

app.notFound((c) => c.text('Not Found', 404));
app.onError((err, c) => {
  console.error('[worker] 未捕获异常：', err);
  return c.text('Internal Server Error', 500);
});

export default {
  fetch: app.fetch,
  // Cron Trigger：清理长期（180 天）未登录的账号，管理员豁免
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(cleanupInactiveUsers(env));
  },
};
