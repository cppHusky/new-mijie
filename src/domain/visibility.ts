import type { Accessible, AccessContext, Visibility } from '../types';
import { evalCondition } from './unlock';

/** 判断 accessible 是否为声明式规则形态 */
function isRuleForm(
  accessible: NonNullable<Accessible>
): accessible is { rules: { when: any[]; then: Visibility }[]; fallback?: Visibility } {
  return typeof accessible === 'object' && Array.isArray((accessible as any).rules);
}

/**
 * 计算题目对某玩家的可见性（派生量，不落库）：
 * - 预设：always / hidden / suspended（空悬）/ lurking（潜伏）
 * - 函数：自定义（可用 ctx.met() 评估声明式条件）
 * - 规则：按序匹配，首个 when 全满足的规则生效，否则 fallback ?? 'hidden'
 */
export function evalVisibility(
  accessible: Accessible | undefined,
  ctx: AccessContext,
  timeZone = 'Asia/Shanghai'
): Visibility {
  const a = accessible ?? 'suspended';
  if (typeof a === 'function') return a(ctx);
  if (isRuleForm(a)) {
    for (const rule of a.rules) {
      if (rule.when.every((cond) => evalCondition(cond, ctx, timeZone))) {
        return rule.then;
      }
    }
    return a.fallback ?? 'hidden';
  }
  switch (a) {
    case 'always':
      return 'visible';
    case 'hidden':
      return 'hidden';
    case 'suspended':
      return ctx.unlocked ? 'visible' : 'ghost';
    case 'lurking':
      return ctx.visited ? 'visible' : 'hidden';
  }
}
