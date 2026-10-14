// DEV ONLY. Written exceptions: when an iconic sound's identity needs a little
// more than its category's style limits allow (crystal bells need some
// shimmer above the bank's darkness zone), the preset says so in meta.allow,
// with a reason, and only that limit bends, only as far as written:
//   "allow": { "vibeBright": { "max": 3.2, "why": "the bells' shimmer is their identity" } }
// A consistency outlier can be allowed the same way ("consistency:brightOct").
import type { Verdict } from '../../src/quality/critic';

export interface Allowance { min?: number; max?: number; why: string }
type Meta = { [k: string]: unknown } | undefined;
const allowOf = (meta: Meta) => (meta?.allow ?? undefined) as Record<string, Allowance> | undefined;

/** The verdict with allowed issues removed. */
export function applyAllowances(v: Verdict, meta: Meta): Verdict {
  const allow = allowOf(meta);
  if (!allow) return v;
  const issues = v.issues.filter((i) => {
    const a = allow[i.code];
    return !(a && (a.min === undefined || i.value >= a.min) && (a.max === undefined || i.value <= a.max));
  });
  return { pass: issues.length === 0, issues };
}

/** True when a preset is allowed to stand out from the bank on this vibe measure. */
export function allowedOutlier(meta: Meta, key: string): boolean {
  return !!allowOf(meta)?.[`consistency:${key}`];
}
