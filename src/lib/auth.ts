import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../env';
import { verifyToken } from './jwt';

/** JWT 鉴权中间件：校验 Bearer token；会话失效返回 401 + action: logout，封禁用户返回 200 + action: logout */
export const requireAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const header = c.req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return c.json({ error: '未登录', action: 'logout' }, 401);
    }
    const payload = await verifyToken(c.env.JWT_SECRET, header.slice(7));
    if (!payload) {
      return c.json({ error: '登录过期，请重新登录', action: 'logout' }, 401);
    }
    const user = await c.env.DB.prepare('SELECT banned FROM users WHERE username = ?')
      .bind(payload.sub)
      .first<{ banned: number }>();
    if (!user) {
      return c.json({ error: '用户不存在', action: 'logout' }, 401);
    }
    if (user.banned) {
      // 沿袭 mijie：200 + action: logout，前端 api 封装强制登出
      return c.json({ error: '您已被封禁', action: 'logout' });
    }
    c.set('username', payload.sub);
    c.set('admin', payload.admin);
    await next();
  }
);
