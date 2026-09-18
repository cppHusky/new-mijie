import type { Accessible, AccessContext, Visibility } from '../types';

/** 计算题目对某玩家的可见性（派生量，不落库） */
export function evalVisibility(
  accessible: Accessible | undefined,
  ctx: AccessContext
): Visibility {
  const a = accessible ?? 'suspended';
  if (typeof a === 'function') return a(ctx);
  switch (a) {
    case 'always':
      return 'visible';
    case 'never':
      return 'hidden';
    case 'suspended':
      return ctx.unlocked ? 'visible' : 'ghost';
    case 'lurking':
      return ctx.visited ? 'visible' : 'hidden';
    default:
      return 'hidden';
  }
}
