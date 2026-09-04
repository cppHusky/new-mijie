import type { Plugin, UnlockCondition } from '../types';
import { compareProblems } from '../domain/sort';
import { PluginServer } from './server';
import { modules, rawAssets } from './manifest.generated';

export interface RegisteredPlugin extends Plugin<any> {
  folder: string;
  serverInstance?: PluginServer;
}

export interface RegistryIssue {
  level: 'error' | 'warning';
  folder: string;
  message: string;
}

export interface HintEntry {
  content: string;
  pid: string;
}

/** 规范化题目内相对路径，拒绝越界（../）引用 */
export function normalizeRelPath(rel: string): string | null {
  const parts: string[] = [];
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}


/** 单个 UnlockCondition 的形状校验；返回错误文案或 null（合法） */
export function validateConditionShape(cond: any): string | null {
  if (!cond || typeof cond !== 'object') return '条件必须是对象';
  const hasAtLeast = (c: any) => typeof c.atLeast === 'number' && Number.isFinite(c.atLeast);
  const hasPids = (c: any) =>
    Array.isArray(c.pids) && c.pids.length > 0 && c.pids.every((p: any) => typeof p === 'string' && p);
  switch (cond.type) {
    case 'pass':
      if (!cond.pid || typeof cond.pid !== 'string') return 'pass 缺少 pid';
      break;
    case 'problemPoints':
      if (!cond.pid || typeof cond.pid !== 'string') return 'problemPoints 缺少 pid';
      if (!hasAtLeast(cond)) return 'problemPoints 的 atLeast 必须是有限数字';
      break;
    case 'passCount':
      if (!hasPids(cond)) return 'passCount 的 pids 必须是非空字符串数组';
      if (!Number.isInteger(cond.count) || cond.count < 1) return 'passCount 的 count 必须是 ≥1 的整数';
      break;
    case 'sumPoints':
      if (!hasPids(cond)) return 'sumPoints 的 pids 必须是非空字符串数组';
      if (!hasAtLeast(cond)) return 'sumPoints 的 atLeast 必须是有限数字';
      break;
    case 'points':
      if (!hasAtLeast(cond)) return 'points 的 atLeast 必须是有限数字';
      break;
    case 'time':
      if (!cond.after && !cond.before && !cond.minuteParity)
        return 'time 必须至少包含 after / before / minuteParity 之一';
      if (cond.after && isNaN(Date.parse(cond.after))) return 'time.after 不是合法时间';
      if (cond.before && isNaN(Date.parse(cond.before))) return 'time.before 不是合法时间';
      if (cond.minuteParity && cond.minuteParity !== 'odd' && cond.minuteParity !== 'even')
        return 'minuteParity 必须是 odd / even';
      break;
    case 'custom':
      if (!cond.desc || (typeof cond.desc !== 'string' && typeof cond.desc !== 'function'))
        return 'custom 必须提供 desc（字符串或函数）';
      if (typeof cond.when !== 'function') return 'custom 必须提供 when 函数';
      break;
    default:
      return `未知条件类型「${(cond as any).type}」`;
  }
  if (
    'desc' in cond &&
    cond.desc !== undefined &&
    typeof cond.desc !== 'string' &&
    typeof cond.desc !== 'function'
  ) {
    return 'desc 必须是字符串或函数（UnlockDesc）';
  }
  return null;
}

/** 单插件校验与归一化。返回 null 表示拒绝加载（error 已写入 issues）。 */
export function validatePlugin(
  folder: string,
  plugin: Plugin<any>,
  issues: RegistryIssue[]
): RegisteredPlugin | null {
  const error = (message: string) => issues.push({ level: 'error', folder, message });
  const warning = (message: string) => issues.push({ level: 'warning', folder, message });

  if (!plugin || typeof plugin !== 'object') {
    error('默认导出不是插件对象');
    return null;
  }
  if (!plugin.pid || typeof plugin.pid !== 'string') {
    error('缺少 pid');
    return null;
  }
  if (!plugin.name) {
    error('缺少 name');
    return null;
  }
  if (plugin.unlock === undefined) {
    error('unlock 必填（true 或条件数组）');
    return null;
  }
  if (plugin.unlock !== true && !Array.isArray(plugin.unlock)) {
    error('unlock 必须是 true 或条件数组');
    return null;
  }
  if (Array.isArray(plugin.unlock)) {
    for (const cond of plugin.unlock as any[]) {
      const shapeError = validateConditionShape(cond);
      if (shapeError) {
        error(`unlock 条件非法：${shapeError}`);
        return null;
      }
    }
  }
  const before = plugin.description?.before_solve;
  if (!before || (!before.mdv && !before.md && !before.content)) {
    error('description.before_solve 必须提供 mdv / md / content 之一');
    return null;
  }
  if (plugin.checker === undefined && !plugin.server && plugin.inputs !== false) {
    error('缺少 checker 或 server（或显式 inputs: false）');
    return null;
  }
  if (plugin.inputs === false && plugin.checker !== undefined) {
    error('inputs 为 false 时不能设置 checker');
    return null;
  }

  if (!plugin.label) {
    warning(`未配置 label，将按 pid「${plugin.pid}」排在列表末尾`);
  }
  if (plugin.accessible === 'lurking' && plugin.unlock !== true) {
    warning('accessible 为 lurking 但 unlock 非 true：未解锁无法访问，潜伏无从谈起（无意义组合）');
  }

  // accessible 声明式规则形态校验
  const VISIBILITIES = ['visible', 'ghost', 'hidden'];
  if (
    plugin.accessible !== undefined &&
    typeof plugin.accessible === 'object' &&
    plugin.accessible !== null
  ) {
    const a = plugin.accessible as any;
    if (!Array.isArray(a.rules)) {
      error('accessible 对象形态必须包含 rules 数组');
      return null;
    }
    for (const [i, rule] of a.rules.entries()) {
      if (!Array.isArray(rule?.when) || !VISIBILITIES.includes(rule?.then)) {
        error(`accessible.rules[${i}] 必须是 { when: UnlockCondition[], then: visible|ghost|hidden }`);
        return null;
      }
      for (const cond of rule.when as any[]) {
        const shapeError = validateConditionShape(cond);
        if (shapeError) {
          error(`accessible.rules[${i}] 条件非法：${shapeError}`);
          return null;
        }
      }
    }
    if (a.fallback !== undefined && !VISIBILITIES.includes(a.fallback)) {
      error('accessible.fallback 必须是 visible|ghost|hidden');
      return null;
    }
  }

  if (plugin.scores) {
    const ids = new Set<string>();
    for (const s of plugin.scores) {
      if (!s.id || typeof s.id !== 'string') {
        error('scores 存在缺少 id 的条件');
        return null;
      }
      if (ids.has(s.id)) {
        error(`scores.id「${s.id}」题内重复`);
        return null;
      }
      ids.add(s.id);
      if (!s.desc) {
        error(`scores[${s.id}] 缺少 desc（得分条件全部可见，desc 必填）`);
        return null;
      }
      if (typeof s.points !== 'number' || !Number.isFinite(s.points)) {
        error(`scores[${s.id}] 的 points 必须是有限数字`);
        return null;
      }
    }
  }

  // description.md 引用的文件内联为 content（沿袭 mijie 加载时读入的行为）
  for (const solve of ['before_solve', 'after_solve'] as const) {
    const desc = plugin.description?.[solve];
    if (desc?.md) {
      const rel = normalizeRelPath(desc.md);
      const content = rel === null ? undefined : rawAssets[`${folder}/${rel}`];
      if (content === undefined) {
        error(`description.${solve}.md 引用的文件「${desc.md}」不存在`);
        return null;
      }
      desc.content = content;
    }
  }

  if (plugin.hints) {
    for (const h of plugin.hints) {
      if (!h?.uid || !h?.content) {
        error('hints 元素必须包含 uid 与 content');
        return null;
      }
    }
  }

  // 字符串 checker 归一化为全等比较（沿袭 mijie）
  if (typeof plugin.checker === 'string') {
    const expected = plugin.checker;
    plugin.checker = ((ans: string) => ans === expected) as any;
  }

  return Object.assign(plugin, { folder }) as RegisteredPlugin;
}

/** 收集一组解锁条件中引用的全部 pid */
export function referencedPids(conds: UnlockCondition[] | true | undefined): string[] {
  if (!Array.isArray(conds)) return [];
  const refs: string[] = [];
  for (const c of conds) {
    switch (c.type) {
      case 'pass':
      case 'problemPoints':
        refs.push(c.pid);
        break;
      case 'passCount':
      case 'sumPoints':
        refs.push(...c.pids);
        break;
    }
  }
  return refs;
}

/** 收集 accessible 规则形态中各规则的 when 条件数组 */
export function accessibleRuleConditions(
  accessible: Plugin<any>['accessible']
): UnlockCondition[][] {
  if (accessible && typeof accessible === 'object' && Array.isArray((accessible as any).rules)) {
    return ((accessible as any).rules as { when?: UnlockCondition[] }[]).map((r) => r.when ?? []);
  }
  return [];
}

function buildRegistry() {
  const issues: RegistryIssue[] = [];
  const list: RegisteredPlugin[] = [];

  for (const [folder, mod] of Object.entries(modules)) {
    try {
      const plugin = validatePlugin(folder, mod.default, issues);
      if (plugin) list.push(plugin);
    } catch (e) {
      issues.push({ level: 'error', folder, message: `加载异常：${e}` });
    }
  }

  // pid 唯一性（大小写敏感）与仅大小写不同告警（决策 6）
  const byPid = new Map<string, RegisteredPlugin>();
  const byLower = new Map<string, string>();
  for (const p of list) {
    if (byPid.has(p.pid)) {
      issues.push({ level: 'error', folder: p.folder, message: `pid「${p.pid}」重复` });
      continue;
    }
    byPid.set(p.pid, p);
    const lower = p.pid.toLowerCase();
    const prev = byLower.get(lower);
    if (prev !== undefined && prev !== p.pid) {
      issues.push({
        level: 'warning',
        folder: p.folder,
        message: `pid「${p.pid}」与「${prev}」仅大小写不同，易混淆`,
      });
    } else {
      byLower.set(lower, p.pid);
    }
  }

  // 解锁条件与可见性规则引用的 pid 必须存在
  for (const p of byPid.values()) {
    const refs = [
      ...referencedPids(p.unlock),
      ...accessibleRuleConditions(p.accessible).flatMap((conds) => referencedPids(conds)),
    ];
    for (const ref of refs) {
      if (!byPid.has(ref)) {
        issues.push({
          level: 'error',
          folder: p.folder,
          message: `unlock/accessible 引用了不存在的 pid「${ref}」`,
        });
      }
    }
  }

  // hints 全局注册表 / hiddenRecord 集合 / server 实例化
  const hints = new Map<string, HintEntry>();
  const hiddenRecord = new Set<string>();
  for (const p of byPid.values()) {
    if (p.record === false) hiddenRecord.add(p.pid);
    for (const h of p.hints ?? []) {
      if (hints.has(h.uid)) {
        issues.push({ level: 'error', folder: p.folder, message: `hint uid「${h.uid}」重复` });
        continue;
      }
      hints.set(h.uid, { content: h.content, pid: p.pid });
    }
    if (p.server) {
      const instance = new PluginServer();
      try {
        const r = p.server(instance);
        if (r instanceof Promise) {
          r.catch((e) => console.error(`[registry] ${p.folder} server 异步初始化失败：`, e));
        }
        p.serverInstance = instance;
      } catch (e) {
        issues.push({ level: 'error', folder: p.folder, message: `server 初始化失败：${e}` });
      }
    }
  }

  const sorted = Array.from(byPid.values()).sort(compareProblems);
  return { plugins: sorted, pluginByPid: byPid, issues, hints, hiddenRecord };
}

const registry = buildRegistry();

export const plugins: RegisteredPlugin[] = registry.plugins;
export const pluginByPid: Map<string, RegisteredPlugin> = registry.pluginByPid;
export const registryIssues: RegistryIssue[] = registry.issues;
export const hints: Map<string, HintEntry> = registry.hints;
export const hiddenRecord: Set<string> = registry.hiddenRecord;

for (const issue of registryIssues) {
  console[issue.level === 'error' ? 'error' : 'warn'](
    `[registry] ${issue.folder}: ${issue.message}`
  );
}

/** pid → 显示名（解锁条件 desc 生成用） */
export function nameOf(pid: string): string {
  return pluginByPid.get(pid)?.name ?? pid;
}
