// Quality critic: turns analysis measurements into pass/fail with plain
// reasons. Thresholds live in data/quality.json (shared with the plugin).

import qualityJson from '../../data/quality.json';
import type { RawMeasures } from '../analysis';
import { categoryById, type Limit } from './categories';

type Limits = Record<string, Limit>;

interface QualityData {
  defaults: Limits;
  families: Record<string, Limits>;
}

const data = qualityJson as unknown as QualityData;

export type CheckCode =
  | 'aliasDb' | 'harshDb' | 'mudDb' | 'fundamentalDb' | 'whistleDb' | 'noteSpreadDb' | 'sideLowDb' | 'limiterDb' | 'dc'
  | 'lifeSlowDb' | 'lifeFastDb' | 'lifeRepeat' | 'textureDb'
  | 'vibeBright' | 'vibeAir' | 'vibeDirt' | 'vibeWidth' | 'vibeTail';

const VIBE_LABELS: Record<string, string> = {
  vibeBright: 'off-style brightness (octaves above the note)',
  vibeAir: 'off-style air above 6 kHz',
  vibeDirt: 'off-style dirt (too clean or too broken)',
  vibeWidth: 'off-style stereo width',
  vibeTail: 'off-style space (tail after the notes stop)',
};

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

/** True when the family's or category's limits check life (the analysis then renders the long held notes). */
export function wantsLife(family?: string, category?: string): boolean {
  const lim = limitsFor(family, category);
  return LIFE_CODES.some((c) => c in lim);
}

/**
 * Effective limits: defaults, then the family's overrides, then the
 * category's critic overrides and its fingerprint zone (data/categories.json).
 */
export function limitsFor(family?: string, category?: string): Limits {
  const out: Limits = {};
  const merge = (src: Limits | undefined) => {
    if (src) for (const [k, v] of Object.entries(src)) out[k] = { ...out[k], ...v };
  };
  merge(data.defaults);
  merge(family ? data.families[family] : undefined);
  const cat = categoryById(category);
  merge(cat?.limits);
  if (cat) for (const [k, v] of Object.entries(cat.zone)) out[k] = { label: VIBE_LABELS[k], ...out[k], ...v };
  return out;
}

function fmt(v: number, unit: string): string {
  return unit === '' ? v.toFixed(4) : `${v.toFixed(1)} ${unit}`;
}

/** Judge a sound's measurements. `family` and `category` select their limits and fingerprint zone. */
export function judge(raw: RawMeasures, family?: string, category?: string): Verdict {
  const lim = limitsFor(family, category);
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
  check('textureDb', raw.textureDb);
  check('vibeBright', raw.brightOct, 'oct');
  check('vibeAir', raw.airDb);
  check('vibeDirt', 2 * Math.sqrt(raw.flatness), '');
  check('vibeWidth', raw.widthDb);
  check('vibeTail', raw.tailDb);
  if (wantsLife(family, category)) {
    // A family that must sound alive fails outright when life wasn't measured.
    check('lifeSlowDb', raw.life ? raw.life.slowDb : -1);
    check('lifeFastDb', raw.life ? raw.life.fastDb : -1);
    check('lifeRepeat', raw.life ? raw.life.repeat : 1, '');
  }
  issues.sort((a, b) => b.excess - a.excess);
  return { pass: issues.length === 0, issues };
}
