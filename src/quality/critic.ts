// Quality critic: turns analysis measurements into pass/fail with plain
// reasons. Thresholds live in data/quality.json (shared with the plugin).

import qualityJson from '../../data/quality.json';
import type { RawMeasures } from '../analysis';

type Limit = { max?: number; min?: number; maxAbs?: number; label?: string };
type Limits = Record<string, Limit>;

interface QualityData {
  defaults: Limits;
  families: Record<string, Limits>;
}

const data = qualityJson as unknown as QualityData;

export type CheckCode =
  | 'aliasDb' | 'harshDb' | 'mudDb' | 'fundamentalDb' | 'whistleDb' | 'noteSpreadDb' | 'sideLowDb' | 'limiterDb' | 'dc'
  | 'lifeSlowDb' | 'lifeFastDb' | 'lifeRepeat';

const LIFE_CODES = ['lifeSlowDb', 'lifeFastDb', 'lifeRepeat'];

export interface Issue {
  code: CheckCode;
  /** Plain-language reason, e.g. "harsh 2–5 kHz: -4.1 dB (limit -8 dB)". */
  message: string;
  value: number;
  limit: number;
  /** How far past the limit (always positive). */
  excess: number;
}

export interface Verdict {
  pass: boolean;
  issues: Issue[];
}

/** True when the family's limits check life (the analysis then renders the long held note). */
export function wantsLife(family?: string): boolean {
  const fam = family ? data.families[family] : undefined;
  return !!fam && LIFE_CODES.some((c) => c in fam);
}

/** Effective limits for a family (defaults with the family's overrides merged in). */
export function limitsFor(family?: string): Limits {
  const out: Limits = {};
  for (const [k, v] of Object.entries(data.defaults)) out[k] = { ...v };
  const fam = family ? data.families[family] : undefined;
  if (fam) for (const [k, v] of Object.entries(fam)) out[k] = { ...out[k], ...v };
  return out;
}

function fmt(v: number, unit: string): string {
  return unit === '' ? v.toFixed(4) : `${v.toFixed(1)} ${unit}`;
}

/** Judge a sound's measurements. `family` selects family-specific limits. */
export function judge(raw: RawMeasures, family?: string): Verdict {
  const lim = limitsFor(family);
  const issues: Issue[] = [];
  const check = (code: CheckCode, value: number | null, unit = 'dB') => {
    const l = lim[code];
    if (!l || value === null || !Number.isFinite(value)) return;
    const label = l.label ?? code;
    if (l.max !== undefined && value > l.max) {
      issues.push({ code, value, limit: l.max, excess: value - l.max, message: `${label}: ${fmt(value, unit)} (limit ${fmt(l.max, unit)})` });
    } else if (l.min !== undefined && value < l.min) {
      issues.push({ code, value, limit: l.min, excess: l.min - value, message: `${label}: ${fmt(value, unit)} (limit ${fmt(l.min, unit)})` });
    } else if (l.maxAbs !== undefined && Math.abs(value) > l.maxAbs) {
      issues.push({ code, value, limit: l.maxAbs, excess: Math.abs(value) - l.maxAbs, message: `${label}: ${fmt(value, unit)} (limit ±${fmt(l.maxAbs, unit)})` });
    }
  };
  check('aliasDb', raw.aliasDb);
  check('harshDb', raw.harshDb);
  check('mudDb', raw.mudDb);
  check('fundamentalDb', Math.min(raw.fundamentalDb.low, raw.fundamentalDb.mid, raw.fundamentalDb.high));
  check('whistleDb', raw.whistleDb);
  check('noteSpreadDb', raw.noteSpreadDb);
  check('sideLowDb', raw.sideLowDb);
  check('limiterDb', raw.limiterDb);
  check('dc', raw.dc, '');
  if (wantsLife(family)) {
    // A family that must sound alive fails outright when life wasn't measured.
    check('lifeSlowDb', raw.life ? raw.life.slowDb : -1);
    check('lifeFastDb', raw.life ? raw.life.fastDb : -1);
    check('lifeRepeat', raw.life ? raw.life.repeat : 1, '');
  }
  issues.sort((a, b) => b.excess - a.excess);
  return { pass: issues.length === 0, issues };
}
