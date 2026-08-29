import type { GlotResult } from '../types';

const EXT: Record<string, string> = {
  c: 'c', cpp: 'cpp', java: 'java', python: 'py', python3: 'py', ruby: 'rb', php: 'php',
  perl: 'pl', csharp: 'cs', mysql: 'sql', oracle: 'sql', haskell: 'hs', clojure: 'clj',
  bash: 'sh', scala: 'scala', erlang: 'erl', swift: 'swift', go: 'go', lua: 'lua',
  javascript: 'js', rust: 'rs', r: 'r', typescript: 'ts', plain: 'txt',
};

async function callGlot(apiKey: string | undefined, language: string, data: any): Promise<GlotResult> {
  if (!apiKey) {
    return { code: 1, error: 'GLOT_IO_API_KEY 未配置' };
  }
  try {
    const res = await fetch(`https://glot.io/api/run/${language}/latest`, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = (await res.json()) as { stdout?: string; stderr?: string; error?: string; message?: string };
    if (!res.ok) return { code: 1, error: body.message || `glot.io HTTP ${res.status}` };
    let error = '';
    if (body.stderr) error = body.stderr;
    if (body.error) error += (error && '\n') + body.error;
    return { stdout: body.stdout, stderr: body.stderr, error, code: body.error ? 1 : 0 };
  } catch (e: any) {
    return { code: 1, error: e?.message || 'error' };
  }
}

export function glot(apiKey: string | undefined, language: string, data: any): Promise<GlotResult> {
  return callGlot(apiKey, language, data);
}

export function runCode(
  apiKey: string | undefined,
  code: string,
  language: string,
  stdin = ''
): Promise<GlotResult> {
  if (!EXT[language]) return Promise.resolve({ code: 1, error: 'Invalid language' });
  return callGlot(apiKey, language, {
    stdin,
    files: [{ name: 'main.' + EXT[language], content: code }],
  });
}
