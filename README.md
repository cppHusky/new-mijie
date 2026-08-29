# puzzle-framework

一个完全运行在 Cloudflare 上的解谜游戏（Puzzle Hunt）框架：单个 Worker + D1 + Durable Objects + Static Assets，一次 `wrangler deploy` 完成部署，以极低开销长期留存，供后人重复体验。

灵感与大部分设计来源于 [YouXam/mijie](https://github.com/YouXam/mijie)，并在此之上重构了题目机制：

- **题目列表**：题目无顺序，玩家在统一的列表中浏览、解锁、进入题目（取代 mijie 的流程图）；
- **四个正交维度**：每个（玩家，题目）对有独立的**可见性**（可见/幽灵/隐藏）、**解锁**（条件满足后手动点击，持久化）、**通关**、**得分**状态；
- **声明式解锁条件**：通过某关/集合过 N 关/总分/单关得分/多关得分之和/时间窗口（含分钟奇偶）/自定义函数，自动生成中文描述；
- **得分与通关解耦**：每题配置任务清单式的得分条件（全部可见，可为负分），由 `ctx.award(id)` 或声明式 `when` 触发，幂等且不可撤销；
- **mijie 体验沿袭**：mdvc（Markdown+Vue）题面、交互题 `server` 事件、排行榜（题数→分数→时间，并列同名次）、公告实时推送（WebSocket）、提交记录、提示、管理后台。

题目配置 API、架构细节与设计决策见 [AGENTS.md](./AGENTS.md)。

## 本地开发

```bash
pnpm install && pnpm --dir frontend install --frozen-lockfile
cp .dev.vars.example .dev.vars   # 填入 JWT_SECRET（其余可选）
pnpm dev                         # Worker + 静态资产，http://localhost:8787
pnpm --dir frontend dev          # 前端热更新，http://localhost:5173（代理 /api → 8787）
pnpm test                        # Vitest（@cloudflare/vitest-pool-workers，含 D1 迁移）
```

注意：

- `game/` 下的题目在**构建时**由 `scripts/gen-manifest.mjs` 打包进 Worker（`pnpm dev/test/deploy` 会自动重新生成清单）。新增/删除/重命名题目后，`wrangler dev` 不会自动感知新目录，需重启 dev。
- 前端是独立 pnpm 项目，依赖必须按 lockfile 精确安装（见 AGENTS.md 第 13 节）。

## 部署

```bash
# 1. 登录并创建 D1，把输出的 database_id 填入 wrangler.jsonc
wrangler login
wrangler d1 create puzzle_db

# 2. 应用远端迁移
pnpm db:migrate:remote

# 3. 配置密钥（必须 JWT_SECRET；TURNSTILE 与 GLOT 可选）
wrangler secret put JWT_SECRET
# wrangler secret put TURNSTILE_SECRET   # 配置后启用注册/登录验证码与提交限流
# wrangler secret put GLOT_IO_API_KEY    # ctx.glot/runCode 代码执行

# 4. 一键部署（自动重新生成题目清单并构建前端）
pnpm deploy
```

非密变量（如 `TIMEZONE`、Turnstile site key `TURNSTILE_KEY`）写在 `wrangler.jsonc` 的 `vars` 里。

部署完成后访问站点注册账号，**首个注册用户自动成为超级管理员**（admin=2），可在 `/admin` 配置比赛时间/规则/关于，在 `/users` 管理用户。

### 可选绑定

- **R2 大附件**：文本题目资产（md/vue/ts 等，≤256KB）随 Worker 打包；更大的二进制附件放 R2——创建 bucket 并在 `wrangler.jsonc` 配置 `"r2_buckets": [{ "binding": "R2_BUCKET", "bucket_name": "..." }]`，然后按键 `game/<题目文件夹>/<路径>` 上传（如 `wrangler r2 object put <bucket>/game/foo/problem.pdf --file problem.pdf`），`/api/file` 会在打包资产未命中时回退到 R2。

## 写一道题

`game/<folder>/index.ts` 默认导出 `createPlugin({...})`：

```typescript
import { createPlugin } from '../../src/types';

export default createPlugin({
  pid: 'example',
  name: '示例题',
  label: '01',                    // 列表排序键 + 幽灵行标识
  unlock: [{ type: 'pass', pid: 'hello' }],   // 或 true（自动解锁）
  accessible: 'suspended',        // 未解锁→幽灵，已解锁→可见（默认）
  description: {
    before_solve: { md: 'problem.md' },       // 也支持 content / mdv（mdvc 混合组件）
    after_solve: { content: '恭喜通过！' },
  },
  checker: 'flag{example}',       // 字符串=全等比较；也支持 async (ans, ctx) => boolean
  scores: [
    // 任务清单全部对玩家可见；desc 必填，points 可为负
    { id: 'pass', desc: '通过本题', points: 100, when: (_a, _c, { passed }) => passed },
    { id: 'hard-way', desc: '用困难路线通过', points: 50 },  // 由 ctx.award('hard-way') 触发
  ],
})
```

交互题（`inputs: false` + `server(app)`）、`hints`/`files`/`captcha`/`record`/`showPercent` 等配置与 mijie 一致；`ctx` 提供 `username / gameProcess / gameStorage / msg / content / award / glot / runCode / jwt`。详见 AGENTS.md 第 9 节与 `game/` 下的示例题。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 本地运行 Worker（含 D1 本地库、DO、静态资产） |
| `pnpm test` | 全部测试（域模型 + API 集成 + 移植题验证） |
| `pnpm gen` | 手动重新生成题目清单 |
| `pnpm build` | 构建前端到 `frontend/dist` |
| `pnpm deploy` | 生成清单 + 构建前端 + `wrangler deploy` |
| `pnpm db:migrate:local` / `:remote` | 应用 D1 迁移到本地/远端 |
