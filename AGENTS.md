# AGENTS.md

> 本文档是 puzzle-framework 的项目基石文档，供开发者与 AI 编码代理阅读。
> 前半部分是对参考项目 mijie 的架构解析（力求"吃透"），后半部分是本框架的设计草案。
> 文档处于草稿状态，标注「待定」的条目均有待拍板。

## 项目愿景

puzzle-framework 是一个解谜游戏（Puzzle Hunt）框架，灵感与大部分设计来源于 [YouXam/mijie](https://github.com/YouXam/mijie)。三个核心设计目标：

1. **沿袭 mijie**：UI 风格、题面渲染方案（mdvc）、流程图、排行榜、公告、提交记录等体验与 mijie 保持一致；大部分技术细节直接继承。
2. **更灵活的机制**：在题目配置、解锁条件、分值、提示等机制上提供比 mijie 更灵活的方案（见「机制增强方向」）。
3. **完全运行在 Cloudflare 上**：单个 Worker + Cloudflare 全家桶（D1 / Durable Objects / R2 / Workers AI / Turnstile / Static Assets），一次 `wrangler deploy` 完成部署，以极低开销长期留存，供后人重复体验。

---

# 设计决策定稿（v1.2）

以下决策已拍板，是实现的唯一依据。下一节「新架构的设想」为原始设计输入，若与本节冲突，以本节为准。

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 解锁模型 | 手动点击「解锁」+ 持久化 `unlocked_at`，不可逆；时间类条件因此成为"解锁窗口" |
| 2 | 得分判定 | `ctx.award(id)` 原语 + 声明式 `scores[].when` 兜底评估；`score_events` 幂等（不可重复、不可撤销） |
| 3 | 得分条件可见性 | 全部可见（任务清单），`scores[].desc` 必填 |
| 4 | gameover | 机制全部删除（配置项、ejs 通关文本、页面、路由、users 字段） |
| 5 | AI 能力 | 整体移除（Context 无 `ai`，不配置 Workers AI binding；glot/runCode 属代码执行，保留待定） |
| 6 | pid 大小写 | 不强制转换，全链路大小写敏感；构建期对仅大小写不同的 pid 告警 |
| 7 | label | 新增 `label?: string`，兼任题目列表排序键与幽灵行标识，全行显示 |
| 8 | noPrize | 不实现；QQ 号仅供管理员在用户列表人工核对 |
| 9 | 管理员隐藏 | 沿用 mijie `hidden` 机制：排行榜/通过率的排除口径**只看 `hidden`，与 admin 身份无关**；管理员在获得权限时 `hidden` **默认置 1**（首个注册管理员、被授予 admin 时），可在用户列表手动取消 |
| 10 | 回顾模式 | 由 `vars.REVIEW_MODE`（`"true"`/`"1"`）开启：全局比赛起止时间不生效（题目内 `time` 条件保留原语义）；关闭排行榜/通过率与 rank 广播；玩家可凭密码硬删除自己账号（`records`/`score_events`/`problem_state`/`game_storage`/`users` 五表，最后一名管理员受保护）；公开 `GET /api/mode` 供前端感知 |

## 领域模型：四个正交维度

每个（玩家，题目）对上有四个相互独立的状态，这是架构的轴心：

- **可见性** `visible | ghost | hidden`：派生量，由 `accessible` 配置 +（解锁态，访问态）计算，不存储；
- **解锁** `unlocked_at`：持久化，玩家手动点击、条件校验通过后写入；
- **通关** `passed_at`：持久化，checker 返回 true 或 `ctx.pass()` 时写入；
- **得分** `score`：持久化，由 `score_events` 幂等累加，可正可负，与通关无关。

访问控制规则：**unlocked 是访问的必要条件**（未解锁一律 404）；visible 只影响列表展示，不影响 URL 访问（潜伏题的入口就是 URL）。

## label 精确语义

- **排序**：有 label 的题按自然序（数字感知，`Intl.Collator(..., { numeric: true })`）在前；无 label 的按 pid 字典序在后。
- **显示**：可见行 = `label + 名称`；幽灵行 = 仅 `label`（无 label 回退 `???`）；隐藏行不出现。
- **校验**：无硬性长度限制（约定两位以内）；无 label 的题构建期告警「将按 pid 排在列表末尾」。

## 与 mijie 的刻意偏离（汇总）

1. **JWT 不内嵌 gameprocess**：进度在 D1，token 仅含 `{sub, admin}`，用户摘要走 `GET /api/me`；
2. **插件无 `points` 字段**：玩家得分 = `score_events` 之和，"通关得分"用 scores 表达；
3. **改密路由移入登录后**（mijie 在 JWT 校验前，行为等价但位置更合理）；
4. AI / noPrize / gameover / 流程图（Graph 页与 `next`/`first` 配置）全部移除；
5. `gameProcess.passed` 由 `Record<pid, points>` 改为 `ReadonlySet<pid>`，移植 mijie 题目时 `Object.hasOwn(passed, pid)` 需改为 `passed.has(pid)`。

---

# 新架构的设想

> 本节为原始设计输入，实现以「设计决策定稿」为准。

接下来是我关于新谜题框架的设想：

## 题目配置

题目之间不再定义顺序，所以将弃用原有的路线图，代之以单纯的**题目列表**。

玩家开始关卡一般通过题目列表进入，通过关卡后也一律回到题目列表。

### 解锁状态

题目通过配置特定条件来解锁。

题目分为“已解锁”和“未解锁”两种状态。未解锁的题目即使通过 URL 来访问，也会返回 404 ，效果上如同这道题目不存在。

为了描述解锁状态和解锁条件，题目需增加一个配置项 `unlock`。它可以是 `true` 值，表示本题自动解锁；或者是一个自定义的校验函数，返回 `boolean` 值表示玩家是否可以解锁。原有的以定义题目顺序组织谜题和进行解锁的方法不再使用，也不再定义“第一道题”。

未解锁的题目如果处于可见态或幽灵态，将在题目列表中呈现它的解锁条件。解锁条件满足后，可在题目列表中将其解锁。

常见的解锁条件包含以下几类，必须满足本题列出的所有条件，才可以解锁：
- 通过特定的关卡
    - 通过某一个特定的关卡（类似于旧架构的 `next` 逻辑）
    - 在某个集合中，通过特定数量的前置关卡（类似于不得已而设置的 `Entrance` 的逻辑）
- 达到特定的分数
    - 总分达到特定分数
    - 某个关卡达到特定分数
    - 某些关卡的分数之和达到特定分数
- 服务端时间
    - 只在奇数分钟满足/只在偶数分钟满足
    - 只在特定时间之前开放/只在特定时间之后开放

### 可见状态

可见状态说明了一道题目是否在题目列表中可见，分为以下三种状态：

- 可见态。玩家能看到题目的名字，也能查看解锁条件。如果已解锁，还可以通过题目列表访问题目。
- 幽灵态。玩家看不到题目的名字，只能查看解锁条件，不可以通过题目列表访问题目。
- 隐藏态。在题目列表中不出现，也不会留下任何线索，玩家不会知道这道题目的存在。

为了描述题目在何种情况下可见性如何，题目需增加一个配置项 `accessible`，它是一个自定义的函数，表示题目的可见性。

- 永远可见。它会一直显示在题目列表中。
- 不可见。它不会显示在题目列表中。
- 空悬。如果这道题目已解锁，那么它将处于可见态；如果这道题目未解锁，那么它将处于幽灵态。
- 潜伏。它不会一开始就显示在题目列表中，处于隐藏态。不过，一旦玩家访问过本题，它就会变为可见态。

从实践上讲，一般只有第一题是永远可见，其后的题目多为空悬。不过，如果想要跟据玩家的进度或其它条件，来逐步披露后续题目的存在，也可以写一个更复杂的函数来描述其可见性（不可见或空悬）。至于潜伏题，一般只用在玩家必须通过 URL 才能找到的题目。

另外，“已解锁”是可以“访问”的必要条件，因为未解锁的题目只会返回 404。因此，一道题如果同时配置成潜伏和未解锁，那么它就没有意义了。

### 通关和分数

在旧架构中，通关和分数是高度相关的两件事，玩家会在通关后得到一个确定的分数（也可能由管理员手动打分）。而新架构将对其进行大刀阔斧的变更：

1. 取消管理员手动打分的功能，相关逻辑不再保留。
2. 通关不会直接获得任何分数（除非通关本身也在得分条件之中），二者没有必然联系。一个玩家可能已通关但没有获得任何分数，也可能获得了满分但未通关。
3. 通关的判定方法和原架构相仿。
4. 得分的计算方法与任务清单相似。每道题目都可以配置一系列得分条件（函数），每个条件都有自己的分值。当玩家达到了条件时，即可得到相应的分数，并更新总分。举例来说：
    1. 在 `CountLightsOut` 中，如果把所有灯全都打开了，获得 10 分。（这和通关条件完全背道而驰，但依然有一定的挑战难度，所以给分）
    2. 在 `CAPTCHA` 中，如果通过 `bug` 通关，获得 10 分。（这是通关的充分而不必要条件，可以当作是鼓励玩家通过这条路线通关）
    3. 在 `CAPTCHA` 中，如果通过 `resistor` 通关，获得 15 分。
    4. 在 `CAPTCHA` 中，如果通过 `chordate` 通关，获得 -5 分。（也就意味着，在某些情况下，玩家是会扣分的）
    5. 在 `BesiegeWithoutAssault` 中，如果敌军累计走过的路线长度达到 60 ，获得 5 分 （这是通关的必要而不充分条件，可以理解为阶段性的奖励。即使玩家没有通过本关，也可以由此得到一些分数）
    6. 在 `CatchGlowworm` 中，如果抓到萤火虫时你离原点的距离不超过 5，获得 10 分（这个条件不仅是通关的充分条件，而且比简单的通关还要高，可以理解为附加的挑战）
5. 得分判定和通关判定是一起进行的，所以可能需要对架构做一番调整。
6. 得分判定的条件达成后，即得到相应的分数，这一变化不可重复，不可撤销，也与通关状态无关。

## 用户管理

### 账户信息

添加一个 QQ 号字段（可不填），并注明这是核验领奖者身份的必须信息。

在账户设置中也可以更改 QQ 号。

### 排行榜

按照通关题数降序、分数降序、最近有效提交时间升序排序，全部相同者排名相同。

最近有效提交指的是，更新了题数或分数的提交（无论分数是增加了还是减少了）。

## 用户列表

管理员应默认隐藏。

用户信息中显示 QQ 号。原架构中使用的“学号”弃用。

## 分数栏

应将通过题目数和分数都显示出来。

---

# 第一部分：mijie 架构解析

mijie（谜界）是为解谜游戏设计的网络平台，最初为 2023 年北邮百团大战「哈士奇再现」开发。以下为对其 `main` 分支的完整剖析。

## 1. 技术栈总览

| 层 | 技术 |
|---|---|
| 后端运行时 | Bun（`bun run --hot src/index.ts` 开发） |
| Web 框架 | Koa（koa-router / koa-bodyparser / koa-compose / koa-send） |
| 数据库 | MongoDB（官方驱动，聚合管线大量使用） |
| 认证 | jsonwebtoken（JWT，1 天过期） |
| 实时推送 | Ably（pub/sub，频道：`notice`、`rank`） |
| 人机验证 | Cloudflare Turnstile（可选，secret 为空则不启用） |
| AI 能力 | Cloudflare AI REST（优先，多 key 轮询）或智谱 AI glm-4-flash |
| 代码执行 | glot.io API（`runCode` / `glot`） |
| 模板 | ejs（仅用于游戏结束文本渲染） |
| 压缩 | brotli（题目附件静态预压缩） |
| 前端 | Vue 3 + Vite + vue-router + TailwindCSS + DaisyUI |
| 题面渲染 | mdvc（Markdown + Vue SFC 混合，markdown-it + KaTeX + highlight.js） |
| 流程图 | mermaid（vue-mermaid 封装） |
| 部署 | Caddy 反代：`/api/*` → 后端，`/*` → 前端 dist（SPA fallback） |

## 2. 目录结构

```
mijie/
├── src/                  # 后端（TypeScript，Bun 运行）
│   ├── index.ts          # 入口：Koa 装配、静态服务、MongoDB 连接
│   ├── auth.ts           # 注册/登录/改密 + JWT 中间件 + 管理员路由 + gameConfig
│   ├── game.ts           # 核心：插件加载/校验、题目路由、提交判定、通过率、记录
│   ├── gameprocess.ts    # GameProcess（通关进度）与 GameStorage（每用户每题 KV）
│   ├── pluginServer.ts   # 交互题事件分发器（on / adminOn / handle / adminHandle）
│   ├── rank.ts           # 排行榜聚合 + 内存缓存 + Ably 广播
│   ├── publish.ts        # Ably 发布封装
│   ├── ai.ts             # CloudflareAI / ZhipuAI 统一接口
│   ├── turnstile.ts      # Turnstile siteverify
│   ├── compress.ts       # brotli 预压缩
│   ├── types.ts          # Plugin / Context / createPlugin 类型定义（题目 API 的源头）
│   └── games/glot.ts     # glot.io 代码执行
├── game/                 # 题目目录：每题一个文件夹，内含 index.ts + 题面/资产
├── frontend/             # Vue 3 SPA
│   └── src/
│       ├── pages/        # 17 个页面（见「前端架构」）
│       ├── components/   # Problem/Mdv/Markdown/NextList/FileList/...
│       ├── tools/        # api 封装、bus（用户状态）、subscribe（Ably）、keys
│       └── constants.js  # 每场比赛要改的：title、school_id
└── Caddyfile, dev.kdl    # 反代配置、zellij 开发布局
```

## 3. 后端架构

### 3.1 请求管线（src/index.ts）

1. 以 `/api` 开头的路径剥离前缀进入 API 路由；其余路径尝试发静态文件，404 则回退 `index.html`（SPA）。
2. 公开路由：`GET /ping`、`GET /keys`（下发 Ably public key 与 Turnstile site key）。
3. `authRoutes`：注册/登录/改密（注意：改密在 JWT 校验之前，靠请求体里的旧密码验证）；随后挂 JWT 中间件 `check_auth`。
4. `check_auth`：校验 Bearer JWT，把 `username / gameprocess / admin` 挂到 `ctx.state`，并构造 `GameStorage`。**响应阶段若 gameprocess 有变化则重新签发 JWT**（响应体带 `token` 字段，前端 api 封装自动写回 localStorage）。
5. `afterAuthRoutes` / `game(db)` / `amdinRoutes(db)` 依次挂载。

### 3.2 API 路由清单

公开（无需登录）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ping` | 健康检查 |
| GET | `/api/keys` | `{ ably, turnstile }` 公钥下发 |
| POST | `/api/register` | 注册（Turnstile 必验；**第一个注册用户 admin=2**） |
| POST | `/api/login` | 登录，签发 JWT（payload 含 gameprocess/admin/studentID） |
| POST | `/api/change-password` | 凭旧密码改密 |
| GET | `/api/game-config/:option` | 读比赛配置（`gameover` 除外，需登录） |

登录后：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/game-config/gameover` | ejs 渲染通关文本（变量：username / passed / plugins） |
| POST | `/api/change-school-id` | 补填学号 |
| GET | `/api/rank` | 排行榜（内存缓存） |
| GET | `/api/start` | 开始游戏，返回 `first` 题目 pid；受 startTime 限制 |
| GET | `/api/problem` | **当前用户已通过**的题目及其 next（流程图数据源） |
| GET | `/api/problem/:name` | 题目详情（题面/分值/通过率/附件/inputs）；`?simple` 仅元信息 |
| POST | `/api/problem/:name` | 提交答案 → checker 判定（核心路由） |
| POST | `/api/problem/:name/server` | 交互题事件分发；`?admin=true` 走 adminOn；`__admin_bypass` 直接通过 |
| GET | `/api/problemManual/:name` | 手动评分题：拉取管理员给的分数并判通过 |
| GET | `/api/skipProblem/:name` | 已通过的题重新查看 after_solve 题面 |
| GET | `/api/submitted_problems` | 当前用户（或管理员视角全部）各题提交次数 |
| GET | `/api/record` | 提交记录，分页（page/size≤200），可按 pid/passed 过滤 |
| GET | `/api/notice` | 公告列表 |
| GET | `/api/hint/:uid` | 按 uid 取提示（需满足前置） |
| GET | `/api/file/:name/:path*` | 题目文件服务（include/exclude 白名单 + brotli） |

管理员（`admin >= 1`，部分操作要求 `admin >= 2`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/PUT | `/api/game-config` | 读写比赛配置（起止时间/规则/通关文本/关于） |
| POST/DELETE | `/api/notice[/:id]` | 发布/删除公告（发布时 Ably 广播） |
| GET | `/api/users` | 用户列表（adminRank） |
| PUT | `/api/user` | 设置 admin/banned/hidden/remark（改 admin 需 admin≥2） |
| GET | `/api/recalculate` | 重算排行榜与全部通过率 |
| POST | `/api/cleanRecords` | 清空所有提交记录 |
| GET | `/api/problemList` | 全部题目元信息 |
| POST | `/api/record/:name` | 手动给某用户某题打分（manualScores 流程） |

### 3.3 关键机制

- **前置校验 `checkPre`**：由所有题目的 `next` 反向构建前置依赖表 `pluginPre`；访问某题要求其前置集合与用户 passed **有交集**（任一前置通过即可，`haveCommonKeyValuePair`）。不满足时对普通用户返回 404（隐藏存在性）。**没有被任何 `next` 指向的题目可直接通过 URL 访问**，但不出现在流程图中。
- **通过率**：`records` 聚合——按用户分组取 `max(passed)`，联表 users 排除 hidden/banned，`通过人数/提交过该题的人数`。结果缓存在 `problems` 集合与内存 Map；管理员改用户状态后需 `/api/recalculate`。
- **排行榜**：users 聚合排序 `points desc, passed desc, lastPassed asc, username asc`；内存缓存 + `update_cnt` 防并发写脏；变更时 Ably `rank` 频道广播 uuid。无 studentID 的用户标记 `noPrize`。
- **限流 TaskManager**：内存计数，3 分钟窗口内同一用户提交 10 次后强制要求 Turnstile，验证通过清零。
- **gameStorage**：每用户每题一个 KV 命名空间，落在 `users.gamestorage.<pid>`；读取后内存修改，`save()` 时**整体覆写**该题的存储对象。
- **JWT 滚动续签**：请求处理中 gameprocess 变更（通过题目）→ 响应携带新 token，前端透明更新。
- **manualScores**：现场赛模式，题目没有 checker，管理员在后台给用户打分，前端轮询 `problemManual` 领取结果。

### 3.4 数据模型（MongoDB）

- `users`：`{ username, password(明文!), studentID?, admin: 0|1|2, banned?, hidden?, remark?, gameprocess: { [pid]: points }, gamestorage: { [pid]: { [key]: any } }, points, passed, lastPassed, gameover }`
  - `points / passed / lastPassed` 是通过题目时用聚合管线（`$objectToArray` + `$reduce` + `$merge`）重算并回写的冗余字段，服务排行榜。
- `records`：`{ username, pid, ans?, server?, manualScores?, time, name, msg, content?, passed, points, gameover }` —— 全量提交流水（含失败）。
- `config`：`{ name: 'game-config', startTime, endTime, gamerule, gameover, about }`。
- `notices`：`{ content, time, author }`。
- `problems`：`{ pid, percent }` —— 通过率缓存。
- `banned`：`{ username, banned, time }` —— 封禁名单（启动时载入内存）。

## 4. 题目插件系统（核心中的核心）

### 4.1 插件定义

每题一个文件夹 `game/<folder>/`，必须含 `index.ts`（或 `index.js`），默认导出 `createPlugin({...})`。`createPlugin` 是带泛型的类型推导函数（src/types.ts），根据 `inputs` 的类型自动推导 `checker` 的入参类型。

启动时 `Plugins.loadPlugins()` 扫描 `game/` 下所有文件夹，动态 `import()` 并逐项校验（不满足则拒绝加载并打印原因）：

- `checker` 必须是函数（或省略但满足 manualScores/server/inputs===false 之一）；
- `name`、`pid` 必填；`points` 为非负数；
- `description.before_solve` 必须提供 `mdv`/`md`/`content` 之一；
- `md` 引用的文件必须存在（加载时读入 `content`）；
- `next`/`hints` 元素结构完整；`server` 必须是函数且初始化不抛错。

加载副作用：`pid` 统一转小写；`record===false` 的题进入 `hiddenRecord`（普通用户查不到其提交记录）；字符串形式的 `checker` 转为相等判定函数；`hints` 注册进全局 uid 表；`first` 题记录为起始题。

### 4.2 配置项全解

| 字段 | 类型 | 说明 |
|---|---|---|
| `pid` | string | 全局唯一标识，用于 URL 与数据库；加载时转小写 |
| `name` | string | 显示名 |
| `description` | object | 题面，见 4.3 |
| `points` | number | 通过得分（`Infinity` 显示为 ∞） |
| `checker` | fn \| string | 判题函数；字符串等价于全等比较。`inputs===false` 时不可设置 |
| `inputs` | true \| false \| `{name, placeholder}[]` | 单输入框 / 无输入（交互题）/ 多输入框（checker 收到对象） |
| `server` | fn | 交互题逻辑：`server(app) { app.on(event, (data, ctx) => ...) }` |
| `next` | `{pid, description?}[]` | 通过后解锁的题（流程图边 + 前置依赖来源） |
| `first` | boolean | 「开始游戏」直接跳转此题 |
| `gameover` | boolean | 通过后显示通关文本、置游戏状态为通关 |
| `captcha` | boolean | `false` 时该题提交永不触发 Turnstile |
| `record` | boolean | `false` 时对普通用户隐藏提交记录（管理员可见，admin≥2 可见计数） |
| `showPercent` | boolean | `false` 时不显示通过率（默认显示） |
| `manualScores` | boolean | 现场赛手动评分模式 |
| `hints` | `{uid, content}[]` | 提示；`/hint?uid=` 跳转对应题并展示；**仅存浏览器 localStorage** |
| `files` | `{filename, info?}[]` | 可下载附件（相对于题目文件夹） |

### 4.3 题面渲染 `description`

三个阶段：`before_solve`（解题前，必填）、`after_solve`（通过后，可选）、`admin`（仅管理员可见的调试面板，可选）。每种题面三种形态互斥：

- `content`：内联 Markdown 字符串；
- `md`：Markdown 文件路径（相对于题目文件夹，加载时读入内存）；
- `mdv`：`{ main, include?, exclude? }` —— Markdown-Vue 混合组件（[mdvc](https://github.com/youXam/mdvc)），`.md` 为主文件可嵌 Vue SFC；`include/exclude` 是 minimatch 白/黑名单，控制 `/api/file/:pid/*` 允许拉取哪些源文件。

前端 `Problem.vue`：`content` → `Markdown.vue` 静态渲染；否则 `Mdv.vue` 用 mdvc 运行时拉取源文件动态编译为异步组件。**mdv 组件挂载时注入 `api` 函数（admin 组件注入 `admin_api`）**，前端 `api(event, data)` → `POST /api/problem/:pid/server` → 后端 `PluginServer` 分发到 `app.on(event)` 注册的处理器。

### 4.4 Context（checker 第二参数）

```typescript
type Context = {
    username: string;
    gameProcess: GameProcess;   // { passed: Record<pid, points>, gameover }
    gameStorage: { get/set/delete/clear };  // 每用户每题 KV
    msg(str): void;             // 反馈信息（可多次调用，拼 \n）
    content(str): void;         // 重设题面内容
    glot, runCode;              // glot.io 代码执行
    jwt; ai(inputs);            // JWT 库；AI 对话
}
```

`ServerContext`（server 事件）把 `msg/content` 换成 `pass(msg?)` / `nopass(msg?)` —— 调用即判定本次事件通过/未通过题目。

### 4.5 题目形态（从 game/ 示例归纳）

1. **静态答案题**：`checker: "flag{...}"` 或函数比对；
2. **动态判分题**：checker 内用 `gameStorage` 存状态、`ctx.ai` 调 AI（如 EncryptedDialog 的字符置换对话）；
3. **纯交互题**：`inputs: false` + `server`（如 CountLightsOut 熄灯、BesiegeWithoutAssault 围而不攻）；
4. **Meta 题**：`Entrance` —— server 事件里检查 `gameProcess.passed` 中其他 6 题过了 5 题则 `ctx.pass()`（**这是 mijie 用现有机制 hack 出"解锁条件"的典型例子，本框架要把它变成一等能力**）；
5. **手动评分题**：`manualScores: true`（现场赛）。

## 5. 前端架构

- **页面**（vue-router，均懒加载）：Home / Start / Game/:pid / Graph（mermaid 流程图）/ Rank / Record/:pid? / Notice / About / Gamerule / Gameover / Login / Register / Settings / Admin / UsersList / Hint / 404。`admin` 路由 meta 守卫。
- **状态**：`tools/bus.js` 从 localStorage 的 JWT 解码出响应式 `user`（username/gameprocess/admin/points/gameover），无服务端状态库。
- **API 封装** `tools/api`：fetch 包装，自动带 token；响应里有 `token` 就换新、`message/error` 弹通知、`action:'logout'` 踢回登录页。
- **实时**：`tools/subscribe.js` 用 `/api/keys` 拿到的 Ably key 订阅 `notice`/`rank`，到达后刷新对应页面。
- **多场比赛隔离**：`constants.js` 的 `title` 写入 localStorage，发现 title 变了就清空全部缓存（**所以不同比赛 title 必须不同**）。
- **UI**：Tailwind + DaisyUI 组件、FontAwesome 图标、nprogress 顶部进度条、KaTeX 数学、highlight.js 代码高亮、github-markdown-css 暗色题面。

## 6. mijie 已知问题与怪癖（迁移时修正）

1. **密码明文存储** —— 必须改为加盐哈希。
2. `gameprocess.ts` 的 `GameProcess` 没有 `pass() / setGameover() / changed`，但 `game.ts/auth.ts` 在调用 —— TS 迁移未完成的残留（`package.json` 的 `start` 还指向不存在的 `src/index.js`）。
3. TaskManager 限流、排行榜缓存、banned 名单都在**单进程内存**，多实例部署即失效。
4. `gameStorage.save()` 整体覆写单题存储，并发提交会互相覆盖。
5. 解锁只支持"任一前置通过"，meta 题只能靠 server 事件 hack（见 4.5-4）。
6. 通过率/排行榜的重算逻辑在 `POST /problem` 与 `insertRecord` 里重复实现了两遍，口径还有细微差别（一处没排除 hidden/banned）。

---

# 第二部分：技术方案（定稿 v1.2）

## 7. Cloudflare 技术选型映射

| mijie | puzzle-framework | 状态 |
|---|---|---|
| Bun + Koa | Workers + **Hono** | 已定 |
| MongoDB | **D1 (SQLite)** | 已定，schema 见第 8 节 |
| users.gamestorage 内嵌 | D1 `game_storage` 表（请求开始时按 (user,pid) 预取为内存快照，`save()` 批量回写） | 已定 |
| Ably | **Durable Objects + WebSocket**（`notice`/`rank` 频道） | 已定，P4 实施 |
| 内存排行榜缓存 | D1 冗余字段（users.total_points/passed_count/last_progress_at）直查 | 已定 |
| jsonwebtoken | **jose**（WebCrypto）；JWT 仅含 `{sub, admin}`，不再内嵌进度 | 已定 |
| 明文密码 | **PBKDF2（WebCrypto）加盐哈希** | 已定 |
| TaskManager 内存限流 | Workers **Rate Limiting binding**，超限回退 Turnstile | 已定。⚠️ binding 的 period 只支持 10/60s（取 10 次/60s，略严于 mijie 的 10 次/180s），且无法像 mijie 那样验证通过后清零计数 |
| Cloudflare AI / 智谱 | **移除**（决策 5） | 已定 |
| glot.io | 保留（fetch 直连），`ctx.glot/runCode` 签名不变 | 待定，P4 前拍板 |
| fs 扫描 `game/` 动态 import | **构建时代码生成清单**（`scripts/gen-manifest.mjs` 扫描 `game/`，生成显式 import 的 `src/plugins/manifest.generated.ts`） | 已定。⚠️ `import.meta.glob` 在 vitest(vite) 下可用但 **wrangler 的 esbuild 管线不支持**，故弃用 |
| `/api/file` + fs + brotli | 文本资产 `import.meta.glob(..., { as: 'raw' })` 打包；大二进制附件放 **R2** | 已定，P4 实施 |
| Caddy + 静态目录 | Workers **Static Assets** + SPA fallback，`/api/*` `run_worker_first` | 已定 |
| ejs | 移除（gameover 已删，无模板需求） | 已定 |

## 8. 数据模型（D1）

见 `migrations/0001_init.sql`：

- `users(id, username UNIQUE, password_hash, salt, qq?, admin, banned, hidden, remark?, total_points, passed_count, last_progress_at, created_at)`
  - `total_points / passed_count / last_progress_at` 为排行榜冗余字段；`last_progress_at` 仅在"有效提交"（题数或分数发生变化，无论增减）时更新。
- `problem_state(username, pid, unlocked_at?, visited_at?, passed_at?, score, PK(username,pid))` —— 四维度的持久化载体。
- `score_events(username, pid, score_id, points, awarded_at, PK(username,pid,score_id))` —— award 幂等的真理之源；只允许 `INSERT OR IGNORE`。
- `game_storage(username, pid, key, value_json, PK(username,pid,key))`。
- `records(id, username, pid, ans_json?, server, passed, gained_points, msg?, content?, created_at)` —— `gained_points` 为本次提交带来的分数变化（含负）。
- `config(key PK, value)`；`notices(id, content, author, created_at)`。

**写入不变式**（单个 D1 batch 内完成）：award 仅在实际插入 score_events 行时联动 `problem_state.score += points`、`users.total_points += points`、`users.last_progress_at = now`；首次通关联动 `passed_at`、`passed_count += 1`、`last_progress_at`。

并发说明：同一玩家两次并发提交存在极小重复计分窗口（与 mijie 同级风险），v1 接受；v2 可将 award/pass 收敛进每用户 Durable Object 串行化。

## 9. 插件系统

- `game/<folder>/index.ts` 默认导出 `createPlugin({...})`；`pnpm gen`（dev/test/deploy 自动触发）运行 `scripts/gen-manifest.mjs` 扫描 `game/`，生成 `src/plugins/manifest.generated.ts`（题目模块显式 import + `.md` 等文本资产内联为字符串表），wrangler 按普通模块打包。**新增/删除/重命名题目后无需手动操作**，但注意 wrangler dev 不会监听 `game/` 新目录，需重启 dev。
- 配置面（最终）：`pid, name, label?, unlock(必填), accessible?(默认 'suspended'), description{before_solve, after_solve?, admin?}, scores?[{id, desc, points, when?, renotify?}], checker?/inputs?/server?, files?, captcha?, record?, showPercent?`。
- **得分再次达成通知**：条件已入账后再次达成时默认静默（不重复计分）；仅当该条件 `renotify: true` 时，接口返回 `reAchieved`，前端弹「再次达成【…】」。`createAward` 与 `evalDeclarativeScores` 两处均以 `renotify === true` 为守卫。
- 构建期校验：unlock 必填；pid 唯一（仅大小写不同告警）；label 缺失告警；`accessible==='lurking'` 搭配非 `true` 的 unlock 告警（无意义组合）；scores.id 题内唯一、desc 必填；unlock 引用的 pid 必须存在于注册表；unlock 条件的形状经 `validateConditionShape` 统一校验。
- **`UnlockDesc`**：解锁条件的 `desc` 除静态字符串外，可给同步函数 `(ctx: UnlockContext, nameOf) => string`（动态展示进度，如 `` `总分达到 5 分（当前 ${ctx.totalPoints} 分）` ``）；函数抛错时回退自动生成文案（custom 兜底「（描述生成失败）」），不会打挂列表。
- **desc 可见性掩码**（防泄名）：`evalUnlock` 生成/渲染文案时，引用的 pid 按**当前玩家**对其可见性掩码——visible 显名、ghost 显 `label`（无 label 回退 `???`）、hidden 显 `???`；函数 desc 收到的 `nameOf` 同为掩码版。掩码随进度动态变化（解锁后由 label 变真名）。
- `Context = { username, gameProcess, gameStorage, msg, content, award, glot, runCode, jwt }`（无 `ai`）；`ServerContext` 将 `msg/content` 换为 `pass/nopass`，其余相同。
- `gameProcess`：`{ passed: ReadonlySet<string>, scores: ReadonlyMap<string,number>, totalPoints, passedCount }`。
- `gameStorage` 接口与 mijie 相同（`get/set/delete/clear`，同步读内存快照）。
- **重试契约**：玩家点击「再试一次」时，前端强制重挂载题面组件（`Game.vue` 对 `<Problem>` 施加自增 `:key`），mdv 交互组件会重新执行 setup 并重新调用 `init` 事件。**交互题的 `init` 应视为重置入口**（覆写 gameStorage 为全新状态），这是框架级契约，不依赖玩家手动刷新页面。
- `AccessContext` 在 `UnlockContext` 之上附加 `unlocked/visited/unlockedPids/visitedPids/met(cond)`（跨题快照 + 条件求值函数糖），供 accessible 求值使用。

## 10. API 一览（新架构）

公开：`GET /api/ping` · `GET /api/keys`（turnstile site key）· `GET /api/mode`（回顾模式开关）· `POST /api/register` · `POST /api/login` · `GET /api/game-config/:option`。

登录后：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/me` | 当前用户摘要（username/admin/qq/通关数/总分） |
| POST | `/api/change-password` | 凭旧密码改密 |
| POST | `/api/change-qq` | 设置/修改 QQ |
| DELETE | `/api/account` | 删除自己的账号（仅回顾模式；凭密码，硬删全部数据） |
| GET | `/api/problems` | 题目列表：可见性、解锁条件逐项 met、canUnlock、我的得分/通过标记 |
| POST | `/api/problems/:pid/unlock` | 服务端重估条件，全满足则持久化解锁 |
| GET | `/api/problem/:pid` | 题目详情（未解锁 404）+ 得分任务清单；潜伏题在此写 visited_at |
| POST | `/api/problem/:pid` | 提交答案（checker + award 流水线） |
| POST | `/api/problem/:pid/server` | 交互事件（award 流水线） |
| GET | `/api/rank` | passed_count desc, total_points desc, last_progress_at asc；并列同名次 |
| GET | `/api/record` | 提交记录（分页/过滤，沿袭） |
| GET | `/api/submitted_problems` | 各题提交次数（沿袭） |
| GET | `/api/notice` · `GET /api/file/:pid/*` | 沿袭 |

管理员：game-config（无 gameover 字段）、notice 增删、users（显示 QQ）、user 状态修改（admin/banned/hidden/remark；授 admin 时 hidden 默认置 1，决策 9）、recalculate、cleanRecords、problemList。

**删除**：`/start`、`/problemManual`、`/game-config/gameover`、`POST /record/:name`、原 `/problem`（流程图数据源）、Graph/Start/Gameover 三个前端页面。

## 11. 目录结构

```
puzzle-framework/
├── src/
│   ├── index.ts            # Hono 入口：公开路由 → requireAuth → 认证路由
│   ├── env.ts              # Env / Variables 类型
│   ├── types.ts            # createPlugin / Context / UnlockCondition 等
│   ├── plugins/
│   │   ├── registry.ts     # 注册表 + 构建期校验（含 hiddenRecord/server 实例化）
│   │   ├── server.ts       # PluginServer 事件分发器
│   │   └── manifest.generated.ts  # 代码生成，请勿手改
│   ├── domain/             # unlock.ts（条件求值+desc 生成）/ visibility.ts / sort.ts
│   ├── routes/             # auth.ts（注册/登录/me/改密/QQ）/ game.ts（列表/解锁/详情/提交/事件/rank/记录）/ admin.ts（管理后台）/ file.ts（资产服务）
│   ├── lib/                # jwt / password / auth 中间件 / config / state（UserState+GameStorage）/ pipeline（award 幂等）/ context / glot / turnstile / publish / playable
│   └── durable/            # RealtimeHub：单例 DO + WebSocket 广播（notice/rank），RPC publish
├── game/                   # 题目（每题一文件夹 + index.ts）
├── frontend/               # Vue 3 SPA（自 mijie 改造）
├── migrations/             # D1 迁移
├── scripts/gen-manifest.mjs # 题目清单代码生成器
├── wrangler.jsonc
└── AGENTS.md
```

## 12. 开发与部署工作流

```bash
pnpm install && pnpm --dir frontend install --frozen-lockfile
pnpm dev                 # wrangler dev（Worker + 静态资产，:8787）
pnpm --dir frontend dev  # vite dev（:5173，代理 /api → :8787）
pnpm build               # 前端构建 → frontend/dist
pnpm deploy              # gen + 前端构建 + wrangler deploy（首次需先创建 D1 并填入 database_id）
```

首个注册用户自动成为超级管理员（admin=2）——沿用 mijie 约定。

## 13. 编码约定

- 全 TypeScript；后端禁止 Node API，一切存储走 CF 绑定；时间条件按 `vars.TIMEZONE`（默认 `Asia/Shanghai`）求值。
- `game/` 下只允许依赖 `src/types`。
- 提交前必须 `npx tsc --noEmit` 与 `pnpm --dir frontend build` 通过。（注：Vitest 测试设施已应所有者要求移除，`pnpm test` 不复存在）
- 密钥走 `wrangler secret`（JWT_SECRET、TURNSTILE_SECRET、GLOT_IO_API_KEY），非密变量写 `wrangler.jsonc` 的 `vars`。
- frontend 是独立 pnpm 项目（非 workspace 成员），依赖必须用 `pnpm --dir frontend install --frozen-lockfile` 按 lockfile 精确安装；升级 mermaid 等重依赖前必须验证构建（新版本曾导致 `vite build` 内存溢出）。

## 14. 实施阶段与进度

- [x] **P0 骨架**：wrangler.jsonc、Hono 入口、D1 migrations、frontend 拷入并跑通
- [x] **P1 域模型**：types.ts、插件注册表（glob + 校验）、可见性/解锁求值器、单测
- [x] **P2 流水线**：auth（jose/PBKDF2）、/api/me、problems 列表 + unlock 路由、提交/事件流水线（award 幂等）、rank、record/submitted_problems/notice 只读路由、glot 与 ctx.jwt
- [x] **P3 前端核心**：Problems.vue、Game.vue 任务清单、Rank.vue、QQ、删除 Graph/Start/Gameover；bus.js 改由 /api/me 水合；弃用 mijie 的客户端 encryptPassword（密码经 TLS 传输、服务端 PBKDF2）
- [x] **P4 周边**：公告 + RealtimeHub DO（WebSocket 广播）、admin 后台、file 服务（rawAssets + R2 回退）、Rate Limiting + Turnstile 回退
- [x] **P5 移植验证**：3 道 mijie 题（digitalcircuit 静态 checker+gameStorage、countlightsout server+全亮 award、besiegewithoutassault mdv 交互+60 阶段分+passCount 解锁）
- [x] **P6 交付**：build + deploy 全流程验证（已上线）、README 部署指南
- [x] **P7 回顾模式**：`vars.REVIEW_MODE` 开关；解除全局比赛时间限制、关闭排行榜/通过率与 rank 广播、凭密码删除账号（最后一名管理员保护）

## 15. 后备想法（未拍板，暂不实现）

提交策略（次数限制/冷却/答案归一化）、生命周期 hooks（onPass/onUnlock）、多比赛并存、score 条件的 `secret` 逃门、每用户 DO 串行化计分。
