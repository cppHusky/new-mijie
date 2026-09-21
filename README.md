# new-mijie

new-mijie 是一个在线解谜游戏/比赛的设计框架。

它的灵感与设计来源于 [YouXam/mijie](https://github.com/YouXam/mijie)，我借助它成功举办了往年各届[解谜末班车](https://solution.cpphusky.xyz)的解谜赛事。

原版 mijie 的一些机制存在不足，无法适应新的出题要求，也不利于长期留存、回顾题目。于是我改进了 mijie 的设计和架构，命名为 new-mijie。它具备以下优点：

1. 机制更加灵活，为题目设计提供了更多样的可能性。
2. 可以完全运行在 Cloudflare Workers 上，成本极低。

感兴趣的玩家可以在[反哈同盟公测赛](https://mijie.cpphusky.xyz)中体验本仓库提供的数道示例谜题。

## 本地开发和部署

### 环境密钥配置

**本地开发**时，请按照 [.dev.vars.example](./.dev.vars.example) 的格式，写一个 `.dev.vars` 文件。

不要在本地开发时填写 `TURNSTILE_KEY` 和 `TURNSTILE_SECRET`。

**部署**时，请将所涉及的环境变量填写到 Cloudflare Workers 的 Settings/Runtime Variables and secrets 中。更多信息详见[文档](https://developers.cloudflare.com/workers/configuration/secrets/)。

### 环境变量配置 - Variables

还有一些环境变量位于 [wrangler.jsonc](./wrangler.jsonc) 当中，建议在此文件的 `vars` 项中直接修改它们。

### 目录结构

本项目的主要结构大致为：

```
.
├── frontend/ # mijie 框架的前端代码
├── game/ # 游戏主体的前后端代码
├── scripts/ # 一些便利化脚本
├── src/ # mijie 框架的后端代码
└── wrangler.jsonc # wrangler 配置文件
```

**如果你不是框架开发者，只想使用它来做一个解谜游戏，那么你只需着眼于 `game/` 和 `wrangler.jsonc` 二者即可。**

### 本地搭建

请先确保安装了 [pnpm](https://pnpm.io/) 和 [Wrangler](https://developers.cloudflare.com/workers/wrangler/)。

1. 先 Clone 本仓库代码并进入目录。
2. 构建。
```bash
pnpm build # 构建
```
3. 删除 [wrangler.jsonc](./wrangler.jsonc) 中 `d1_databases` 的已有项。
4. 创建 D1 数据库。其中，`puzzle_db` 可以换成其它的名字，而之后也需保持一致，均使用此名。在创建过程中，程序将询问你是否需要直接将其写入 Wrangler 配置文件。你可以选择“yes”，但请注意，binding 名一定要使用 `DB`。
```bash
wrangler d1 create puzzle_db
```
5. 然后在本地应用数据库迁移。请使用 `puzzle_db` 或你自定义的名字。
```bash
wrangler d1 migrations apply --local puzzle_db
```
6. 最后就可以进入预览了。
```bash
pnpm dev
```

另请注意：`game/` 下的题目在**构建时**由 `scripts/gen-manifest.mjs` 打包进 Worker（`pnpm dev/deploy` 与 postinstall 会自动重新生成清单）。新增/删除/重命名题目后，`wrangler dev` 不会自动感知新目录，需重启 dev。

### 部署

请至少完成 [本地搭建](#本地搭建) 中的第 4 步，然后从这里开始。

1. 在远端应用数据库迁移。请使用 `puzzle_db` 或你自定义的名字。
```bash
wrangler d1 migrations apply --remote puzzle_db
```
2. 请根据需要配置[密钥](#环境密钥配置)。
```bash
wrangler secret put JWT_SECRET
# wrangler secret put TURNSTILE_KEY
# wrangler secret put TURNSTILE_SECRET
# wrangler secret put GLOT_IO_API_KEY
```
3. 进行部署。
```bash
pnpm deploy
```

然后就可以访问你的站点进行试用了。

## 游戏管理

### 管理员

访问站点并注册的**首个用户自动成为超级管理员**。超级管理员可以授权其他用户成为管理员。

管理员可以在 `/users` 管理用户，无条件地看到用户的通关、得分、提交记录等信息，且有权隐藏用户（从排行榜中去除）、封禁用户（不允许登录）。

管理员也可在 `/admin` 中配置比赛时间/规则/关于等信息，在 `/notice` 中发送比赛公告。

### 比赛模式和回顾模式

默认情况下，游戏使用比赛模式。

如果在 [wrangler.jsonc](./wrangler.jsonc) 中，将 `REVIEW_MODE` 置为 `true`，就能启用回顾模式。

在回顾模式下，没有开始时间和结束时间的限制，玩家可以自由进行游戏体验。

回顾模式仅供玩家体验题目，而不用于成绩比较，所以取消了排行榜的功能。

玩家可以在**账户设置**中自行重置游戏进度（清空解锁、通关、得分、提交记录等），以便重新体验。**超过 180 天未登录**的非管理员账号会被自动删除账号及其全部游戏数据。

而在题目体验方面，回顾模式和比赛模式没有差别。

## 游戏功能

每场比赛包含若干个题目。比赛开始后，玩家可以在**题目列表**中看到它们。

### 题目列表

题目列表展示了本游戏的所有题目，但非每个题目都会在一开始就显现出来。决定题目是否可以被玩家看到的内部变量是**可见性 `Visibility`**，它有以下三种情况：
- 可见 `visible`：题目在题目列表中完整可见。
- 幽灵 `ghost`：题目在题目列表中可见，但**除非玩家已经解锁本题**，否则玩家只能看到其 label 和 解锁条件，无法看到其标题。
- 隐藏 `hidden`：题目在题目列表中不可见，玩家无法通过题目列表访问它。

### 题目解锁

有些题目是默认解锁的，玩家可以直接访问；而有些题目则需要满足各式各样的解锁条件，才能解锁。常见的解锁条件通常有以下几类：
- 通过特定的前置题目，或在某些特定题目中通过一定数量的题目。
- 总分达到一定的分数，或在某些特定题目中达到一定的总计分数。
- 只在特定的时间段开放，玩家只能在开放时间段内解锁。
- 其它可以自定义的解锁条件。

题目解锁只能在题目列表中手动进行。如果一道题目未解锁，那么玩家从 URL 访问本题也会直接返回 404。

### 通关要求

**通关**意味着玩家达到了本题的通关要求。

通关要求因题目而异：有些题目需要玩家输入特定内容，有些题目需要玩家通过交互，来达成指定的目标。还有些题目本身不可通关，此时自然无需设置通关要求。

### 得分条件

有些题目会设置一系列得分条件。玩家在达成得分条件时，可以得到对应的**分数**。

请注意，得分和通关是互不相干的两件事。得分不意味着通关，通关也不意味着得到分数。

不同的得分条件在题目中起到的作用各不相同：
- 有些得分条件的要求比单纯通关更加严格。此时，这些得分点是挑战任务。
- 有些得分条件就是原题的简化版翻版。此时，这些得分点可以视为对原题解法的提示。
- 有些得分条件的分值是负数。此时，这些得分点是对玩家犯下特定错误，或进行特定操作的惩罚。
- 有些得分条件和原题难度相当，但要求却背道而驰。此时，这些得分点可能承担了一些特殊的作用，比如分支。

## 题目编写

[game](./game) 目录是所有题目代码所在的区域。以本仓库为例，此处共存在 12 个子目录，对应 12 道题目。

每道题目必须包含一个 `index.ts` 文件，这既是题目的配置文件，又包含了题目的后端代码。

而前端代码依具体情况，可能有以下两种方案：
- 题目描述非常简单，也没有需要交互的前端组件。此时前端代码可以直接嵌入 `index.ts` 文件。
- 题目描述需使用 Markdown，或存在需要交互的前端组件。此时前端（含题目描述）代码需与 `index.ts` 分离。

接下来我将介绍 `index.ts` 的各个配置项及它们的用法。

### `createPlugin`

它是一个定义在 [src/types.ts](./src/types.ts) 中的函数，负责接收指定的对象，生成一个完整的题目。

```ts
import createPlugin from "../../src/types";

export default createPlugin({
    //...
    //欲知内容如何，留待下文分解
    //...
});
```

### `pid`, `name` 和 `label`

这是题目的标识字段。`pid` 决定了题目的 URL 相对路径 `/game/${pid}`，而 `name` 是显示在题目标题中的题目名字。二者可以相同也可以不同，但习惯上还是建议设置为相同。

在可见性为 `ghost` 的情况下，玩家不能在题目列表中看到题目的 `name`。因此，为了区分无名的幽灵题目，建议为不同的题目设置不同的 `label`。

`label` 的格式不限，但习惯上使用 `01` `02` `03` 这样表示数字的字符串。这是因为数字比较易于记忆和表达；另外，题目列表的题目也是根据 `label` 来进行排序的，数字越小会排得越靠前。

一例：[CountLightsOut](./game/CountLightsOut/index.ts)

```ts
    //这是 CountLightsOut，题号为 02，可通过 /game/CountLightsOut 访问
    pid:"CountLightsOut",
    name:"CountLightsOut",
    label:"02",
```

一例：[Calculate](./game/Calculate/index.ts)

```ts
    //这是 Calculate，题号为 03.5，可通过 /game/Calculate 访问
    pid:"Calculate",
    name:"Calculate",
    label:"03.5",
```

### `accessible`

不同于 `Visibility`，它是一种对题目可见性的规则描述。你可以认为它是一个根据玩家的进度信息 `AccessContext` 返回 `Visibility` 的函数。

一例：[Fire](./game/Fire/index.ts)

```ts
    //如果玩家已经访问过 BlockedCharacters，可见性为 visible，否则为 hidden
    accessible:(ctx)=>ctx.visitedPids.has("BlockedCharacters")?"visible":"hidden",
```

一例：[Shirt](./game/Shirt/index.ts)

```ts
    accessible:(ctx)=>{
        //如果本题已解锁，可见性为 visible
        if(ctx.unlocked)
            return "visible";
        //如果达到了两个 met 条件之一，可见性为 ghost
        if(ctx.met({type:"points",atLeast:15})||ctx.met({type:"pass",pid:"CountLightsOut"}))
            return "ghost";
        //如果上述条件均不满足，可见性为 hidden
        return "hidden";
    },
```

这里的 `ctx` 是一个 `AccessContext` 类型的参数。`AccessContext` 包含一些在计算可见性时需要用到的背景信息，诸如：
- 本题的解锁情况 `unlocked: boolean`；
- 本题是否已经访问过 `visited: boolean`；
- 已解锁的题目集合 `unlockedPids: ReadonlySet<string>`；
- 已访问过的题目集合 `visitedPids: ReadonlySet<string>`；
- 对于特定[解锁条件](#unlock)的校验函数 `met(cond: UnlockCondition): boolean`。

另外，为了简化一些常见规则的描述，你可以使用下述四个语法糖来直接进行声明：
- `always` 表示本题永远可见（总是返回 `visible`）；
- `never` 表示本题永远不可见（总是返回 `hidden`）；
- `suspended` 表示本题空悬，在本题已解锁时返回 `visible`，未解锁时返回 `ghost`；
- `lurking` 表示本题潜伏，在玩家没有访问时返回 `hidden`，访问后返回 `visible`。

一例：[Calculate](./game/Calculate/index.ts)

```ts
    //本题不可以从题目列表中直接访问，必须通过 URL，因为它在被访问之前都是隐藏的
    //而在被访问之后，它将正常出现在题目列表之中，此时可以通过题目列表访问
    accessible:"lurking",
```

### `unlock`

它表示本题的解锁要求。如果直接用 `true`，则本题无需解锁，自然开放。

你也可以填写一个列表 `UnlockCondition[]`，此时玩家必须达成列表中的所有条件，并且**在题目列表中手动点击`解锁`**，才能解锁本题。

一例：[Wind](./game/Wind/index.ts)

```ts
    unlock:[
        //总分需达到 20 分
        {
            type:"points",
            atLeast:20,
        },
        //当前时间的分钟数模 4 余 2
        {
            type:"custom",
            when:(ctx)=>ctx.now.getMinutes()%4===2?true:false,
            desc:(ctx,_)=>ctx.now.getMinutes()%4===2?"可以解锁":"不在时间窗口内",
        },
    ],
```

其中 `desc` 是对解锁条件的描述。一般情况下，desc 是自动生成的，无需自行编写。比如
- `{type:"points",atLeast:20}` 生成的描述为 `总分达到 20 分`；
- `{type:"pass",pid:"GuessNumber"}` 生成的描述为 `通过关卡《GuessNumber》`；
- `{type:"passCount",pids:["ISBN","Dialling","Calculate"]}` 生成的描述为 `在《ISBN》《Dialling》《Calculate》中通过任意 2 关`。

名称查询函数 `nameOf: (pid: string) => string` 用于在生成的描述中获取题目名。如果对应题目处于 `ghost` 状态，将返回 `label` 代替其名字；而如果处于 `hidden` 状态，将返回 `???` 代替其名字。

如果你不希望使用默认生成的描述，那么你也可以自行编写 `desc`。你可以直接使用 `string` 类型的固定内容，或者使用返回 `string` 类型的函数 `(ctx: UnlockContext, nameOf) => string`。

`UnlockContext` 包含一些在解锁条件中需要用到的背景信息，诸如：
- 已解锁的题目集合 `passed: readonlySet<string>`；
- 每道题目的分数 `problemScores: ReadonlyMap<string, number>`；
- 玩家的总分 `totalPoints: number`；
- 玩家通过题目的数量 `passedCount: number`；
- 当前的时间 `now: Date`。

一例：[Shirt](./game/Shirt/index.ts)

```ts
    unlock:[
        //需在 ISBN, Dialling, Calculate 中通过至少两题
        {
            type:"passCount",
            pids:[
                "ISBN",
                "Dialling",
                "Calculate",
            ],
            count:2,
            desc:(ctx,nameOf)=>{
                //Calculate 必须要让玩家知道名字，不能用 ???，所以设此特例
                const showName=(pid:string)=>pid==="Calculate"?"Calculate":nameOf(pid);
                //如果玩家做出了 Dialling 或 ISBN 中的一个，那么玩家能在解锁条件中看到 Calculate 的名字
                //否则，他只能看到 ??? 而不知道 Calculate 的存在
                const condition=ctx.passed.has("Dialling")||ctx.passed.has("ISBN");
                const names=[
                    "ISBN",
                    "Dialling",
                    "Calculate",
                ].map(condition?showName:nameOf).join("》《");
                return `在《${names}》中通过任意 2 关`;
            },
        },
    ],
```

### `description`

它表示本题的题面（前端），是一个 `Description` 类型的对象，包含三个部分：
- `before_solve` 是一个 `ProblemDescription` 对象，表示在通关前题面的内容；
- `after_solve` 是一个 `ProblemDescription` 对象，表示在通关后题目的内容（通过本关时，`before_solve` 将消失，由 `after_solve` 取而代之）；
- `admin` 是一个 `MdvRef` 对象，表示只有管理员可以访问的特权内容。

`ProblemDescription` 可以是以下三种情况之一：
- `{ content: string; }` 使用一个固定的字符串，支持基本的 Markdown 语法。
- `{ md: string; }` 使用一个 Markdown 文件的相对路径。
- `{ mdv: MdvRef; }` 使用一个 [Markdown-Vue.js](https://github.com/youXam/mdvc) 组件，其中，`MdvRef` 的定义包含：
    - `main: string` 是主 Markdown 文件的想对路径；
    - `include?: string[]` 是允许前端引入的文件；
    - `exclude?: string[]` 是在 `include` 之中，不允许前端引入的文件。

一例：[Shirt](./game/Shirt/index.ts)

```ts
    description:{
        //显示在通关之前的内容
        before_solve:{
            content:"How much is the shirt in pounds?",
        },
        //显示在通关之后的内容，会覆盖掉通关之前的内容
        after_solve:{
            content:"Yes, it's nine fifteen.",
        },
    },
```

一例：[GuessNumber](./game/GuessNumber/index.ts)

```ts
    description: {
        //如果不定义 after_solve，那么通关后 before_solve 的内容将保持
        before_solve: {
            md:"main.md",
        },
        //这是 Admin Area 区的特权内容，使用 `admin.vue` 组件
        admin:{
            main:"admin.vue",
            include:["admin.vue"],
        },
    },
```

关于 vue 组件的相关介绍将在 [server](#server) 部分详细展开。

### `server`

它定义了一个属于本题的后端服务。前端可以通过调用 API 来获得后端传来的数据。

它只接收一个 `app: PluginServerApi` 参数，可以返回前端需要的任何数据。

一例：后端 [BlockedCharacters/index.ts](./game/BlockedCharacters/index.ts)

```ts
    server:(app)=>{
        //对名为 refresh 的事件进行监听
        app.on("refresh",(_,ctx)=>{
            //ctx 可以用 gameProcess 获取玩家进度信息
            const water=ctx.gameProcess.passed.has("Water");
            const fire=ctx.gameProcess.passed.has("Fire");
            const wind=ctx.gameProcess.passed.has("Wind");
            const earth=ctx.gameProcess.passed.has("Earth");
            const set=new Set();
            [water,fire,wind,earth].forEach((ele,idx)=>{
                if(!ele)
                    set.add(idx);
            });
            //blockedCharacters 是一个自定义的返回 string 的函数，所以 refresh 事件的返回数据是一个字符串
            return blockCharacters(origin,set);
        });
    },
```

前端 [BlockedCharacters/app/main.md](./game/BlockedCharacters/app/main.md)

```md
本关需要你输入一段内容。

不过，这段内容被四种不同的力量共同屏蔽掉了。每当你解开一道前置谜题，都能恢复一部分的内容。现在你可以回到题目列表去查看它们。

你需要输入完整的内容才可以通关。

<!--这里的 content 起初是空字符串，而后经过 api("refresh",...) 解析，变为相应的返回值->
<blockquote>
{{ content }}
</blockquote>
<!--以<App/>为分界线，上方是前端展现给玩家的 markdown 内容，而下方是 vue 组件-->

<App/>

<script setup>
//加载组件时前端会依次执行下述代码
import {inject,ref} from "vue";
//这是普通组件，前端通过 inject("api") 注入一个 api 函数，从而实现前后端的通信
const api=inject("api");
//content 是自定义的引用，此时它的内容为空
const content=ref("");
//通过 api 函数发送一个 refresh 事件，处理返回值 data，将其赋值给 content
//执行完毕后 content 将变为后端传回的字符串内容
api("refresh").then(data=>{
    content.value=data;
});
</script>
```

在上例中，后端使用 `app.on(event,handler)` 监听事件 `event`，并在前端发送 `event` 事件时，通过 `handler` 给出结果。这里的 `handler` 是一个回调函数 `(data: any,ctx: ServerContext) => any)`，其中 `data` 是前端向后端传入的数据，而 `ctx` 是后端使用的背景信息和特殊操作，诸如：
- `username: string` 玩家的用户名；
- `gameProcess: GameProcess` 玩家的游戏进度（通关状况、分数等）；
- `gameStorage: GameStorage` 玩家的游戏数据（很多题目都需要保存玩家的游戏数据）；
- `pass: (str?: string) => void` 给出“通关”的判定，使玩家通过本关；
- `award: (id: string) => void` 给出“得分”的判定，使玩家得到 `id` 相对应的分数。

前端通过执行 `api` 函数可以与后端进行通信，并使用后端的返回值，为前端定义好的引用赋值。这些引用可以在前端处被使用，这样就完成了前后端交互的过程。

一例：后端 [Fire/index.ts](./game/Fire/index.ts)

```ts
    server:(app)=>{
        //前端可以调用 init 函数来进行火场初始化，初始化的结果将保存到 ctx.gameStorage 中
        app.on("init", (_, ctx) => {
            if(ctx.gameProcess.passed.has("Water"))
                waterPower=true;
            const s = fresh();
            save(ctx.gameStorage, s);
            return snap(s);
        });
        //每次前端发送 spary 事件并携带一个 cell 值，表示玩家点击的格子位置
        //后端返回本次操作后的游戏状况，供前端呈现给玩家
        app.on("spray", (cell: number, ctx: ServerContext) => {
            const s = ensure(ctx.gameStorage);
            if (typeof cell === "number" && cell >= 0 && cell < LEN) {
                doSpray(s, Math.floor(cell));
                save(ctx.gameStorage, s);
            }
            //通关判断，如果满足条件，调用 ctx.pass 使玩家通关
            if (s.fire.every((f) => !f)) {
                //得分判断，如果满足条件，调用 ctx.award 使玩家得到对应分数
                if(s.turn <=18){
                    ctx.award("Fire.In18Turns");
                    if (s.turn <= 10)
                        ctx.award("Fire.In10Turns");
                }
                ctx.pass(`在第 ${s.turn} 回合将大火全部扑灭`);
            }
            return snap(s);
        });
    }
```

对于只有管理员可见的特权内容，在后端监听事件须使用 `adminOn`，前端注入 api 须使用 `admin_api`。

一例：后端 [GuessNumber/index.ts](./game/GuessNumber/index.ts)

```ts
    server:(app)=>{
        //如果目标数字不存在，则使用 resetTarget 生成一个目标数字
        app.on("init_if_not_defined",(_,ctx)=>{
            let target=ctx.gameStorage.get<number>("GuessNumber.target");
            if(!target)
                resetTarget(ctx);
        });
        //查询 target 的值并返回给前端
        //这是只有管理员可以使用的事件，所以要用 adminOn
        app.adminOn("get",(_,ctx)=>{
            return ctx.gameStorage.get<number>("GuessNumber.target");
        });
    },
```

前端 [GuessNumber/main.md](./game/GuessNumber/main.md)

```md
<!--这是所有玩家都能看到的前端内容-->
**目标数字**是一个位于 1-99 范围内的整数。你可以随意输入任何一个数字，我会告诉你这个数字比目标大了还是小了，还是正好相同。

如果正好相同，那你就过关了。

你有 7 次机会来猜出数字；如果在 7 次之内都没有猜对，那么本关将进行重置。

<script setup>
import {inject} from "vue";
//这里使用 api
const api=inject("api");
//初始化 target
await api("init_if_not_defined");
</script>
```

管理员前端 [GuessNumber/admin.vue](./game/GuessNumber/admin.vue)

```md
<!--这是只在 Admin Area 中可以看到的特权内容，普通玩家无法获得-->
<template>
    <!--在 get 函数执行完毕后，此处将变为目标数字-->
    <p>{{ ans }}</p>
    <!--该按钮绑定了一个函数 get，按下后将执行下面的 get 函数-->
    <button @click="get">查看答案</button>
</template>
<script setup>
import {inject,ref} from "vue";
const ans=ref("ans");
//注意这里使用的是 admin_api
const api=inject("admin_api");
//定义一个函数 get，它会调用后端 API 发送 get 事件，并将返回值赋给 ans
async function get(){
    ans.value=await api("get");
}
</script>
```

### `inputs` 和 `checker`

`inputs` 表示本题接受玩家文本输入的情况，而 `checker` 则是输入检查器。很多题目只需要玩家做很简单的文本输入，此时用 `inputs` 和 `checker` 就可以以通过少量代码实现题目逻辑，方便简洁。

如果一道题目不需要玩家进行文本输入，此时 `input` 的值应为 `false`，且不可以设置 `checker`。

一例：[QQGroup](./game/QQGroup/index.ts)

```ts
    inputs:false,
```

如果一道题目只需要玩家进行简单输入，此时 `input` 的值须设为 `true`，而 `checker` 需设置为 `(ans: string, ctx: Context) => Promise<boolean>`。这个 boolean 返回值就用来判定玩家本次的回答能否通关。

一例：[Calculator](./game/Calculator/index.ts)

```ts
    inputs:true,
    //检查玩家输入是否为 0.3
    checker:async(ans,_)=>ans.trim()==="0.3",
```

这里的 `ans` 是一个 `string`，表示玩家的输入；而 `ctx` 是一个 `Context` 类型的背景信息。`Context` 和 `ServerContext` 略有不同，例如，它不能调用 `pass` 来登记玩家通关。`Context` 包含很多数据和操作，诸如：
- `username: string` 玩家的用户名；
- `gameProcess: GameProcess` 玩家的游戏进度；
- `gameStorage: GameStorage` 玩家的游戏数据；
- `msg: (str: string) => void` 在反馈框中为玩家提供的反馈信息；
- `content: (str: string) => void` 重设题目内容；
- `award: (id: string) => void` 给出“得分”的判定，使玩家得到 `id` 相对应的分数。

一例：[GuessNumber](./game/GuessNumber/index.ts)

```ts
    checker:async(ans,ctx)=>{
        //从游戏数据中查询玩家的输入次数和目标数字
        let inputTime=ctx.gameStorage.get<number>("GuessNumber.time");
        let target=ctx.gameStorage.get<number>("GuessNumber.target");
        //解析 ans:string 使其变为 input:number
        const input=parseFloat(ans);
        inputTime++;
        //向游戏数据中保存玩家的新数据
        ctx.gameStorage.set("GuessNumber.time",inputTime);
        //判定玩家输入的正确性
        if(Math.abs(input-target)<1e-5){
            //调用 msg 将一则信息加入输入反馈中
            ctx.msg(`对了，用时 ${inputTime} 回合`);
            //如果输入次数在 5 之内，得到 GuessNumber.in5times 的分数
            if(inputTime <=5){
                ctx.award("GuessNumber.in5times");
                //如果输入次数在 3 之内，得到 GuessNumber.in3times 的分数
                if(inputTime <=3){
                    ctx.award("GuessNumber.in3times");
                    //如果输入次数为 1，得到 GuessNumber.in1times 的分数
                    if(inputTime===1){
                        ctx.award("GuessNumber.inonce");
                    }
                }
            }
            //重设输入次数和目标数字
            resetTarget(ctx);
            //多次调用 msg 时，多条反馈信息将拼成多段内容呈现给玩家，所以最终玩家将看到：
            //    对了，用时 ${inputTime} 回合
            //    题目已重置
            ctx.msg(`题目已重置`);
            //返回 true，代表玩家通关了
            return true;
        }
        else if(input <target){
            ctx.msg(`小了（次数：${inputTime}/7）`);
        }
        else if(input>target){
            ctx.msg(`大了（次数：${inputTime}/7）`);
        }
        if(inputTime>=7){
            resetTarget(ctx);
            ctx.msg(`输入 7 次还未猜出，本轮作废。题目已重置`);
        }
        //返回 false，代表玩家仍未通关
        return false;
    },
```

如果一道题目需要玩家进行多个输入，或者需要在输入框中加占位符，那么 `input` 的格式应为 `{ name: string; placeholder: string }[]`，而 `checker` 的 `ans` 类型需与 `input` 的实际格式对应。

一例：[ISBN](./game/ISBN/index.ts)

```ts
    //inputs 第一个输入框的名字是 x（虽然也就只有一个），占位符显示“地名”
    inputs:[
        {name:"x",placeholder:"地名"},
    ],
    //在 checker 中，需使用 ans.x 来表示玩家的第一个输入。
    checker:async(ans,_)=>ans.x.trim()==="长安",
```

### `scores`

它定义了本题的各项得分条件及相关逻辑。`scores` 是一个 `ScoreCondition[]` 类型的数组，可以定义若干项得分条件。`ScoreCondition` 需要的信息包括：
- `id: string` 本得分条件的 `id`，该 `id` 在所有题目范围内不可重复。
- `desc: string` 本得分条件的描述，只能使用简单的字符串，不支持 Markdown。
- `points: number` 本得分条件的分数，玩家在达成得分条件时就会得到相应的分数。这个分数也可以是负数。
- `when?: (ans: any, ctx: Context, info: { passed: boolean }) => boolean | Promise<boolean>` 得分条件的逻辑实现；
- `renotify?: boolean` 再次达到本得分条件时，是否为玩家发送通知，默认为 `false`。

得分条件的逻辑可以在 `when` 中直报写明，前提是 `ans`、`ctx` 或 `info.passed` 足以表达这个逻辑。

一例：[Dialling](./game/Dialling/index.ts)

```ts
    scores:[
        {
            id:"Dialling.CN",
            desc:"CN",
            points:5,
            //判断玩家的输入是否等于 86，这个逻辑和 checker 很像
            when:async(ans,_)=>parseFloat(ans)===86,
            //因为这个得分条件有提示的作用，所以当玩家输入正确时，再次提醒玩家很有必要
            renotify:true,
        },
        {
            id:"Dialling.JPUS",
            desc:"JPUS",
            points:5,
            when:async(ans,_)=>parseFloat(ans)===82,
            renotify:true,
        },
    ],
```

一例：[BlockedCharacters](./game/BlockedCharacters/index.ts)

```ts
    scores:[{
        id:"BlockedCharacters.incomplete",
        //如果四个前置关卡都通关了，那么玩家一定会得到完整内容
        //所以这个通关要求的本质是：没有全部通关四个前置关卡
        desc:"在未得到完整内容时，就通过了本关",
        when:(_,ctx,info)=>{
            const water=ctx.gameProcess.passed.has("Water");
            const fire=ctx.gameProcess.passed.has("Fire");
            const wind=ctx.gameProcess.passed.has("Wind");
            const earth=ctx.gameProcess.passed.has("Earth");
            //info.passed 只有在本题通关时为 true
            //而通关是由 `checker` 决定的，此处无需关注，我们只需要使用这个结果
            return info.passed&&!(water&&fire&&wind&&earth);
        },
        points:10,
    }],
```

而有些情况下 `when` 的参数不足以表达我们需要的逻辑，那就可以在 `server` 或 `checker` 中使用 `ctx.award` 来实现得分逻辑，`when` 不作定义。

一例：[CountLightsOut](./game/CountLightsOut/index.ts)

```ts
    scores:[
        //其实用 ctx 再做一些处理也能表达，但不是很方便，不如直接和 server 代码放在一起
        {id:"CountLightsOut.allOn",desc:"把所有灯打开",points:15},
    ],
```

### `files`

它表示了用户在游戏过程中可以下载的文件，是一个 `Array<{ filename: string; info?: string }>` 类型的数据。

一例：[Shirt](./game/Shirt/index.ts)

```ts
    files:[{
        //filename 是本文件的相对路径
        filename:"audio.mp3",
        //鼠标悬浮时显示 info
        info:"下载听力音频",
    }],
```

### `captcha`

它控制本题是否启用验证码。如果你[配置了 Turnstile](#环境密钥配置)，又在题目中启用了 `captcha`，那么玩家在输入过于频繁时，将被要求进行人机验证。

一例：[GuessNumber](./game/GuessNumber/index.ts)

```ts
    captcha:true,
```

### `record` 和 `showPercent`

`record: boolean` 控制玩家能否查看自己的提交记录，默认打开。

`showPercetn: boolean` 控制玩家能否看到本题的通关率，默认打开。
