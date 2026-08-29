import { expect } from 'vitest';
import { exports } from 'cloudflare:workers';

export interface ApiResult {
  status: number;
  json: any;
  text: string;
}

export async function api(
  path: string,
  opts: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}
): Promise<ApiResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...opts.headers };
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  const res = await (exports as any).default.fetch(`http://test.local/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 文本错误响应 */
  }
  return { status: res.status, json, text };
}

export async function registerUser(name: string, password = 'pw123456'): Promise<string> {
  const r = await api('/register', { body: { username: name, password } });
  expect(r.status).toBe(200);
  const l = await api('/login', { body: { username: name, password } });
  expect(l.status).toBe(200);
  return l.json.token as string;
}
