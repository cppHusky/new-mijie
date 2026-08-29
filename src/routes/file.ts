import { Hono } from 'hono';
import { minimatch } from 'minimatch';
import type { Env, Variables } from '../env';
import { normalizeRelPath } from '../plugins/registry';
import { rawAssets } from '../plugins/manifest.generated';
import { requirePlayable } from '../lib/playable';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const CONTENT_TYPES: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  vue: 'text/plain; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  js: 'text/plain; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  json: 'application/json',
  html: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

/** include/exclude 白名单（minimatch，沿袭 mijie checkAllowedFiles 语义） */
function checkAllowed(
  patterns: { include?: string[]; exclude?: string[] },
  relPath: string
): boolean {
  if (patterns.exclude?.some((p) => minimatch(relPath, p))) return false;
  if (!patterns.include) return false;
  return patterns.include.some((p) => minimatch(relPath, p));
}

app.get('/file/:pid/:path{.*}', async (c) => {
  const pid = c.req.param('pid');
  const playable = await requirePlayable(c, pid);
  if (playable instanceof Response) return playable;
  const { plugin, state } = playable;

  const relPath = normalizeRelPath(c.req.param('path') ?? '');
  if (!relPath) return c.text('Access denied', 403);

  const desc = plugin.description;
  const isAdmin = c.get('admin') >= 1;
  const passed = state.gameProcess.passed.has(pid);
  const allowed =
    checkAllowed(
      { include: desc.before_solve.mdv?.include, exclude: desc.before_solve.mdv?.exclude },
      relPath
    ) ||
    (passed &&
      checkAllowed(
        { include: desc.after_solve?.mdv?.include, exclude: desc.after_solve?.mdv?.exclude },
        relPath
      )) ||
    (isAdmin &&
      checkAllowed({ include: desc.admin?.include, exclude: desc.admin?.exclude }, relPath)) ||
    (plugin.files ?? []).some((f) => f.filename === relPath);
  if (!allowed) return c.text('Access denied', 403);

  const key = `${plugin.folder}/${relPath}`;
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  const isMdvFetch = c.req.header('x-application-id') === 'mdv';

  // 1) 打包内文本资产
  const content = rawAssets[key];
  if (content !== undefined) {
    const type =
      isMdvFetch && ['md', 'js', 'ts', 'vue'].includes(ext)
        ? 'text/plain; charset=utf-8'
        : (CONTENT_TYPES[ext] ?? 'application/octet-stream');
    return c.text(content, 200, { 'Content-Type': type });
  }

  // 2) R2 回退（大二进制附件，键为 game/<folder>/<path>）
  if (c.env.R2_BUCKET) {
    const obj = await c.env.R2_BUCKET.get(`game/${key}`);
    if (obj) {
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      if (!headers.has('content-type')) {
        headers.set('content-type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
      }
      headers.set('etag', obj.httpEtag);
      return new Response(obj.body, { headers });
    }
  }

  return c.text('Not Found', 404);
});

export default app;
