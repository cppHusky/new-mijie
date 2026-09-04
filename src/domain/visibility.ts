import type { Accessible, AccessContext, UnlockCondition, Visibility } from '../types';
import { evalCondition } from './unlock';

type RulesForm = {
  rules: Array<{ when: UnlockCondition[]; then: Visibility }>;
  fallback?: Visibility;
};

export function isAccessibleRules(a: Accessible): a is RulesForm {
  return typeof a === 'object' && a !== null && Array.isArray((a as RulesForm).rules);
}

/** 计算题目对某玩家的可见性（派生量，不落库） */
export function evalVisibility(
  accessible: Accessible | undefined,
  ctx: AccessContext,
  timeZone = 'Asia/Shanghai'
): Visibility {
  const a = accessible ?? 'suspended';
  if (typeof a === 'function') return a(ctx);
  if (typeof a === 'object' && a !== null) {
    // 规则式：按序评估，首个 when 全满足（AND）的规则生效，否则取 fallback
    for (const rule of (a as RulesForm).rules ?? []) {
      if (rule.when.every((cond) => evalCondition(cond, ctx, timeZone))) {
        return rule.then;
      }
    }
    return (a as RulesForm).fallback ?? 'hidden';
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
    default:
      return 'hidden';
  }
}
