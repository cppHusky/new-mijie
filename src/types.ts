/**
 * puzzle-framework 题目插件类型定义。
 * game/ 下的题目只允许依赖本文件（见 AGENTS.md 第 13 节）。
 */

// —— 题面 ——

export type MdvRef = {
  main: string;
  include?: string[];
  exclude?: string[];
};

/** 一种题面的三种互斥形态：mdv 混合组件 / md 文件 / 内联 markdown */
export type ProblemDescription = {
  mdv?: MdvRef;
  md?: string;
  content?: string;
};

export type Description = {
  before_solve: ProblemDescription;
  after_solve?: ProblemDescription;
  admin?: MdvRef;
};

// —— 可见性（四维度之一，派生量） ——

export type Visibility = 'visible' | 'ghost' | 'hidden';

export interface AccessContext extends UnlockContext {
  /** 本题是否已解锁（unlock===true 或已持久化解锁） */
  readonly unlocked: boolean;
  /** 本题是否访问过（潜伏题用） */
  readonly visited: boolean;
  /** 跨题：已解锁的 pid 集合（unlock===true 或已持久化解锁） */
  readonly unlockedPids: ReadonlySet<string>;
  /** 跨题：已访问过（visited_at 非空）的 pid 集合 */
  readonly visitedPids: ReadonlySet<string>;
  /** 函数糖：在当前快照上直接评估声明式解锁条件（与 unlock 求值同时区语义） */
  met(cond: UnlockCondition): boolean;
}

export type Accessible =
  | 'always'     // 永远可见
  | 'never'      // 永不显示（但已解锁时可经 URL 访问）
  | 'suspended'  // 空悬：已解锁→visible，未解锁→ghost（默认值）
  | 'lurking'    // 潜伏：访问前 hidden，访问后 visible
  | ((ctx: AccessContext) => Visibility);

// —— 解锁（四维度之二，持久化） ——

/** 解锁条件求值上下文：只读快照，禁止 DB 访问 */
export interface UnlockContext {
  readonly passed: ReadonlySet<string>;
  readonly problemScores: ReadonlyMap<string, number>;
  readonly totalPoints: number;
  readonly passedCount: number;
  readonly now: Date;
}

/**
 * 解锁条件描述：静态字符串，或基于只读快照动态生成的同步函数。
 * 第二参 nameOf 用于引用其他题目的显示名。
 */
export type UnlockDesc =
  | string
  | ((ctx: UnlockContext, nameOf: (pid: string) => string) => string);

export type UnlockCondition =
  | { type: 'pass'; pid: string; desc?: UnlockDesc }
  | { type: 'passCount'; pids: readonly string[]; count: number; desc?: UnlockDesc }
  | { type: 'points'; atLeast: number; desc?: UnlockDesc }
  | { type: 'problemPoints'; pid: string; atLeast: number; desc?: UnlockDesc }
  | { type: 'sumPoints'; pids: readonly string[]; atLeast: number; desc?: UnlockDesc }
  | {
      type: 'time';
      /** ISO 时间字符串，如 '2026-09-01T12:00:00+08:00' */
      after?: string;
      before?: string;
      /** 按 vars.TIMEZONE 求值的分钟奇偶 */
      minuteParity?: 'odd' | 'even';
      desc?: UnlockDesc;
    }
  | { type: 'custom'; desc: UnlockDesc; when: (ctx: UnlockContext) => boolean };

/** true = 自动解锁；数组 = 全部满足（AND）才可解锁 */
export type Unlock = true | UnlockCondition[];

// —— 得分（四维度之四，与通关无关） ——

export type ScoreCondition = {
  id: string;
  /** 任务清单展示文案（决策 3：全部可见，必填） */
  desc: string;
  /** 可为负 */
  points: number;
  /**
   * 声明式糖：每次提交/事件后由框架兜底评估（info.passed 为本次判定结果）。
   * 「通关即得」写为 `(ans, ctx, { passed }) => passed`。
   * 省略时只能由题目代码通过 ctx.award(id) 显式触发（用于路线相关得分）。
   */
  when?: (ans: any, ctx: Context, info: { passed: boolean }) => boolean | Promise<boolean>;
};

// —— 运行时上下文 ——

export interface GameProcess {
  /** 已通关 pid 集合（注意：与 mijie 的 Record<pid, points> 不同，见 AGENTS.md 偏离 5） */
  readonly passed: ReadonlySet<string>;
  /** 各题得分 */
  readonly scores: ReadonlyMap<string, number>;
  readonly totalPoints: number;
  readonly passedCount: number;
}

/** 每用户每题 KV，同步读内存快照，框架在请求结束时批量回写 */
export interface GameStorage {
  get<T = any>(key: string): T | null;
  set(key: string, value: any): void;
  delete(key: string): void;
  clear(): void;
}

export interface GlotResult {
  stdout?: string;
  stderr?: string;
  error: string;
  code: number;
}

export type Context = {
  username: string;
  gameProcess: GameProcess;
  gameStorage: GameStorage;
  /** 反馈信息（可多次调用，拼 \n） */
  msg: (str: string) => void;
  /** 重设题面内容 */
  content: (str: string) => void;
  /** 得分原语：为玩家记一次 scores[id] 对应的分数（幂等，不可重复） */
  award: (id: string) => void;
  glot: (language: string, data: any) => Promise<GlotResult>;
  runCode: (code: string, language: string, stdin?: string) => Promise<GlotResult>;
  jwt: {
    sign: (payload: Record<string, unknown>) => Promise<string>;
    verify: (token: string) => Promise<Record<string, unknown>>;
  };
};

export type ServerContext = Omit<Context, 'msg' | 'content'> & {
  /** 判定通过本题 */
  pass: (str?: string) => void;
  /** 判定未通过（仅反馈，不计通过） */
  nopass: (str?: string) => void;
};

/** server(app) 拿到的事件注册器（对应 mijie 的 PluginServer 去掉 handle 侧） */
export interface PluginServerApi {
  on<E = any>(event: string, handler: (data: E, ctx: ServerContext) => any): void;
  adminOn<E = any>(event: string, handler: (data: E, ctx: ServerContext) => any): void;
}

// —— 插件本体 ——

export type KeysType = readonly string[] | true | false | undefined;

type CheckerAnswer<T extends KeysType> = T extends false
  ? never
  : T extends true
  ? string
  : T extends readonly string[]
  ? { [K in T[number]]: string }
  : never;

export type Plugin<T extends KeysType> = {
  /** 全局唯一标识，用于 URL 与数据库；大小写敏感，不做转换（决策 6） */
  pid: string;
  name: string;
  /** 排序键 + 幽灵行标识，全行显示（决策 7）；缺省按 pid 排在列表末尾并告警 */
  label?: string;
  /** 必填：true 自动解锁；数组则全部满足才可解锁（AND） */
  unlock: Unlock;
  /** 默认 'suspended' */
  accessible?: Accessible;
  description: Description;
  scores?: ScoreCondition[];
  checker?: T extends false
    ? undefined
    : ((ans: CheckerAnswer<T>, ctx: Context) => boolean | Promise<boolean>) | string;
  inputs?: T extends undefined
    ? undefined
    : T extends readonly string[]
    ? { [K in keyof T]: T[K] extends string ? { name: T[K]; placeholder: string } : never }
    : boolean;
  server?: (app: PluginServerApi) => any;
  files?: Array<{ filename: string; info?: string }>;
  /** false 时该题提交永不触发 Turnstile */
  captcha?: boolean;
  /** false 时对普通用户隐藏提交记录 */
  record?: boolean;
  /** false 时不显示通过率（默认显示） */
  showPercent?: boolean;
};

type ExtractNames<T extends readonly { name: string }[]> = {
  [K in keyof T]: T[K] extends { name: infer N extends string } ? N : never;
};

type AutoPlugin<H> = Plugin<
  H extends undefined ? undefined
    : H extends any[] ? ExtractNames<H>
    : H extends true ? true
    : false
>;

export default function createPlugin<
  const H extends readonly { name: string; placeholder: string }[] | true | false = true
>(
  plugin: Omit<AutoPlugin<H>, 'pid'> & {
    pid: string;
    inputs?: H;
  }
): AutoPlugin<H> {
  return plugin as any;
}
