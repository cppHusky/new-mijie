const collator = new Intl.Collator('zh-CN', { numeric: true });

/**
 * 题目列表排序（决策 7）：
 * 有 label 的按 label 自然序（数字感知）在前；无 label 的按 pid 字典序在后。
 */
export function compareProblems(
  a: { label?: string; pid: string },
  b: { label?: string; pid: string }
): number {
  if (a.label != null && b.label != null) {
    const c = collator.compare(a.label, b.label);
    if (c !== 0) return c;
  } else if (a.label != null) {
    return -1;
  } else if (b.label != null) {
    return 1;
  }
  return collator.compare(a.pid, b.pid);
}
