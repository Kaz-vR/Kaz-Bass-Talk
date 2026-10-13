// Bank consistency: on the vibe measurements (darkness relative to the note,
// air, dirt, width, space), every bank preset should sit with the rest of
// the bank. Robust z-scores (median / MAD) across the whole bank; a preset
// far out on any vibe measurement is flagged even if it passes everything
// else. Category traits (register, attack, length) are not compared.

import type { RawMeasures } from '../analysis';

export interface Vibe {
  brightOct: number;
  airDb: number;
  dirt: number;
  widthDb: number;
  tailDb: number;
}

export const VIBE_KEYS: (keyof Vibe)[] = ['brightOct', 'airDb', 'dirt', 'widthDb', 'tailDb'];

/**
 * Smallest spread assumed per measurement (about a sixth of a typical
 * fingerprint zone), so designed variety (a dry pluck next to a drenched
 * cavern) isn't flagged; only presets far outside the bank's character are.
 */
const MIN_SPREAD: Vibe = { brightOct: 0.4, airDb: 6, dirt: 0.2, widthDb: 5, tailDb: 8 };

/** How far out (robust z) counts as an outlier. */
export const OUTLIER_Z = 3.5;

export function vibeOf(raw: RawMeasures): Vibe {
  const r = (v: number, d = 100) => Math.round(v * d) / d;
  return {
    brightOct: r(raw.brightOct),
    airDb: r(raw.airDb, 10),
    dirt: r(2 * Math.sqrt(raw.flatness)),
    widthDb: r(raw.widthDb, 10),
    tailDb: r(raw.tailDb, 10),
  };
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

export interface Outlier {
  name: string;
  key: keyof Vibe;
  value: number;
  median: number;
  z: number;
}

/** Presets that sit far from the rest of the bank on any vibe measurement. */
export function outliers(items: { name: string; vibe: Vibe }[], zMax = OUTLIER_Z): Outlier[] {
  const out: Outlier[] = [];
  if (items.length < 5) return out;
  for (const key of VIBE_KEYS) {
    const vals = items.map((i) => i.vibe[key]);
    const med = median(vals);
    const mad = 1.4826 * median(vals.map((v) => Math.abs(v - med)));
    const spread = Math.max(mad, MIN_SPREAD[key]);
    for (const i of items) {
      const z = Math.abs(i.vibe[key] - med) / spread;
      if (z > zMax) out.push({ name: i.name, key, value: i.vibe[key], median: med, z });
    }
  }
  return out;
}
