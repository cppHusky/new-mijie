// 扫描 game/ 生成题目清单模块（替代 import.meta.glob —— wrangler 的 esbuild 管线不支持）。
// 用法：node scripts/gen-manifest.mjs（dev / test / deploy 脚本已自动调用）
// GAME_DIR 环境变量可指定题目目录（测试用 test/fixtures/game）。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const GAME_DIR = process.env.GAME_DIR
  ? path.resolve(ROOT, process.env.GAME_DIR)
  : path.join(ROOT, 'game');
const OUT = path.join(ROOT, 'src/plugins/manifest.generated.ts');

// 会被内联为字符串的文本资产（供 description.md 与 /api/file 使用；大二进制请放 R2）
// .ts/.js/.mjs 也会被内联——mdv 题面前端需要按源文件拉取它们（如 BWA 的 app/lib.ts）
const TEXT_EXTS = new Set(['.md', '.vue', '.css', '.svg', '.json', '.txt', '.html', '.ts', '.js', '.mjs']);
const MAX_SIZE = 256 * 1024;

// 会被内联为 base64 的二进制资产（小附件，如音频/图片；更大的请放 R2）
const BINARY_EXTS = new Set(['.mp3', '.wav', '.ogg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip']);
const MAX_BINARY_SIZE = 512 * 1024;

const folders = fs.existsSync(GAME_DIR)
  ? fs.readdirSync(GAME_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => fs.existsSync(path.join(GAME_DIR, name, 'index.ts')))
      .sort()
  : [];

const assets = {};
const binaryAssets = {};
const warnings = [];

function walk(dir, prefix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = `${prefix}/${e.name}`;
    if (e.isDirectory()) {
      walk(full, rel);
      continue;
    }
    if (e.name === 'index.ts' || e.name.endsWith('.test.ts')) continue;
    const ext = path.extname(e.name).toLowerCase();
    const stat = fs.statSync(full);
    if (TEXT_EXTS.has(ext)) {
      if (stat.size > MAX_SIZE) {
        warnings.push(`跳过 ${rel}（${stat.size}B 超过 ${MAX_SIZE}B 上限），大二进制文件请放 R2`);
        continue;
      }
      assets[rel] = fs.readFileSync(full, 'utf8');
    } else if (BINARY_EXTS.has(ext)) {
      if (stat.size > MAX_BINARY_SIZE) {
        warnings.push(`跳过 ${rel}（${stat.size}B 超过 ${MAX_BINARY_SIZE}B 上限），大文件请放 R2`);
        continue;
      }
      binaryAssets[rel] = fs.readFileSync(full).toString('base64');
    }
  }
}

const ident = (name) => 'mod_' + name.replace(/[^a-zA-Z0-9_$]/g, '_');
const imports = [];
const entries = [];
for (const folder of folders) {
  imports.push(`import * as ${ident(folder)} from '../../${path.relative(ROOT, GAME_DIR)}/${folder}/index';`);
  entries.push(`  ${JSON.stringify(folder)}: ${ident(folder)},`);
  walk(path.join(GAME_DIR, folder), folder);
}

const code = `// 本文件由 scripts/gen-manifest.mjs 自动生成，请勿手改。
// 添加/删除/重命名题目后需重新生成（pnpm dev / test / deploy 已自动执行 pnpm gen）。

${imports.join('\n') || '// （题目目录下暂无题目）'}

export const modules: Record<string, any> = {
${entries.join('\n')}
};

export const rawAssets: Record<string, string> = ${JSON.stringify(assets, null, 2)};

export const binaryAssets: Record<string, string> = ${JSON.stringify(binaryAssets, null, 2)};
`;

fs.writeFileSync(OUT, code);
console.log(
  `[gen-manifest] ${folders.length} 个题目（${path.relative(ROOT, GAME_DIR)}），${Object.keys(assets).length} 个文本资产，${Object.keys(binaryAssets).length} 个二进制资产`
);
for (const w of warnings) console.warn('[gen-manifest] ' + w);
