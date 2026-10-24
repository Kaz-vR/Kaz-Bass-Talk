// The randomizer: rolls new sounds from the bank's own parts. Not random
// knob values: a roll starts from a preset, swaps whole boxes in from other
// presets (from the same category, or from anywhere when it gets weird),
// nudges values inside the range good presets use, and adds a few "wild
// ideas" as weirdness rises. A quick silent render throws away anything
// silent, clipping, harsh or muddy, and levels what's left. Locked boxes are
// kept from the current sound. Plain code, no AI; no browser APIs.

import { bandPower, powerSpectrum } from '../analysis/spectrum';
import { renderPatch } from '../engine/core/render';
import type { Loop } from '../engine/core/sequencer';
import { categoryById, wheelDefault } from '../quality/categories';
import { fromNormalized, params, toNormalized, validatePatch, type ParamDef, type Patch } from '../schema';

export interface RollOptions {
  /** A category id, or 'any' to draw from the whole bank. */
  basedOn: string;
  /** 0 = a close cousin of the category's presets, 1 = collisions, wild ideas, far from the bank. */
  weirdness: number;
  /** Boxes (schema groups) kept exactly as they are in `current`. */
  locked: ReadonlySet<string>;
  /** The sound on screen (locked boxes come from it). */
  current: Patch;
  /** The bank presets (those with a category). */
  bank: readonly Patch[];
  /** The loop to test-render with. */
  loop: Loop;
  seed: number;
}

export interface Roll {
  patch: Patch;
  name: string;
  /** Where it might fit, and what's unusual about it. */
  hint: string;
}

// ------------------------------------------------------------ randomness

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = () => number;
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const between = (r: Rand, lo: number, hi: number) => lo + (hi - lo) * r();

// ------------------------------------------------------------ boxes

/** Boxes a roll can swap in from another preset. */
const SWAP_GROUPS = [
  'osc1', 'osc2', 'fm', 'string', 'sub', 'noise', 'texture', 'drive', 'filter', 'dist', 'crush', 'tape', 'amp_env', 'mod_env',
  'env2', 'pitch_env', 'vibrato', 'breath', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'mod', 'fx', 'eq',
];
/** Never randomized: level and the low-end crossover are set by the leveler and the safety rules. */
const FIXED = new Set(['output.gain', 'output.crossover', 'wheel.move']);
const byGroup = new Map<string, ParamDef[]>();
for (const p of params) {
  if (!byGroup.has(p.group)) byGroup.set(p.group, []);
  byGroup.get(p.group)!.push(p);
}

/** The range (normalized) each float takes across a pool of presets: the "safe region". */
function ranges(pool: readonly Patch[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const p of params) {
    if (p.type !== 'float') continue;
    let lo = 1, hi = 0;
    for (const q of pool) {
      const n = toNormalized(p, q[p.id] as number);
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
    }
    out.set(p.id, [lo, hi]);
  }
  return out;
}
const rangeCache = new Map<string, Map<string, [number, number]>>();

// ------------------------------------------------------------ wild ideas

interface Idea {
  /** Boxes it touches (skipped if any is locked). */
  groups: string[];
  /** How the hint describes it. */
  text: string;
  apply(p: Patch, r: Rand): void;
}

/** Free mod slot (amount 0), or the last one. */
function freeSlot(p: Patch): number {
  for (let n = 1; n <= 12; n++) if (!p[`mod${n}.amount`]) return n;
  return 12;
}

const IDEAS: Idea[] = [
  { groups: ['fm'], text: 'an inharmonic FM edge', apply: (p, r) => {
    p['fm.amount'] = between(r, 0.15, 0.45);
    p['fm.ratio'] = pick(r, [1.41, 2.76, 3.7, 0.71, 5.19, 1.13]);
  } },
  { groups: ['filter'], text: 'a comb-filter resonance', apply: (p, r) => {
    p['filter.type'] = 'comb';
    p['filter.cutoff'] = between(r, 90, 400);
    p['filter.resonance'] = between(r, 0.3, 0.55);
  } },
  { groups: ['filter', 'mod'], text: 'a talking formant filter', apply: (p, r) => {
    p['filter.type'] = 'formant';
    p['filter.vowel'] = r();
    const n = freeSlot(p);
    p[`mod${n}.source`] = pick(r, ['lfo1', 'lfo2', 'drift_slow', 'env2']);
    p[`mod${n}.dest`] = 'filter_vowel';
    p[`mod${n}.amount`] = between(r, 0.15, 0.4);
  } },
  { groups: ['dist'], text: 'folded distortion', apply: (p, r) => {
    p['dist.type'] = 'fold';
    p['dist.drive'] = between(r, 0.3, 0.65);
    p['dist.mix'] = between(r, 0.4, 0.8);
  } },
  { groups: ['pitch_env'], text: 'a pitch drop on every note', apply: (p, r) => {
    p['pitch_env.amount'] = pick(r, [-1, 1]) * between(r, 7, 24);
    p['pitch_env.decay'] = between(r, 40, 400);
  } },
  { groups: ['wobble'], text: 'a tempo wobble', apply: (p, r) => {
    p['wobble.depth'] = between(r, 0.35, 0.75);
    p['wobble.rate'] = pick(r, ['1/4', '1/8', '1/8T', '1/16', '1/4T']);
    p['wobble.shape'] = pick(r, ['sine', 'duck', 'saw down', 'square', 'sync gate', 'staircase', 'random']);
    const t = pick(r, ['cutoff', 'cutoff', 'volume', 'both']);
    p['wobble.cutoff'] = t !== 'volume';
    p['wobble.volume'] = t !== 'cutoff';
  } },
  { groups: ['crush'], text: 'crushed digital grain', apply: (p, r) => {
    p['crush.mix'] = between(r, 0.25, 0.5);
    p['crush.bits'] = Math.round(between(r, 4, 7));
    p['crush.rate'] = Math.round(between(r, 3, 10));
  } },
  { groups: ['osc2'], text: 'an endless gliding layer', apply: (p, r) => {
    p['osc2.wave'] = 'shepard';
    p['shepard.rate'] = pick(r, [-1, 1]) * between(r, 0.1, 0.5);
    p['osc2.level'] = between(r, 0.2, 0.4);
  } },
  { groups: ['osc1', 'string'], text: 'a plucked-string body', apply: (p, r) => {
    p['osc1.wave'] = 'string';
    p['string.tone'] = r();
    p['string.decay'] = between(r, 0.3, 0.9);
  } },
  { groups: ['amp_env', 'env2', 'mod'], text: 'a reversed swell', apply: (p, r) => {
    p['amp_env.attack'] = between(r, 400, 2500);
    p['env2.attack'] = between(r, 800, 3000);
    p['env2.sustain'] = 1;
    const n = freeSlot(p);
    p[`mod${n}.source`] = 'env2';
    p[`mod${n}.dest`] = 'filter_cutoff';
    p[`mod${n}.amount`] = between(r, 0.15, 0.35);
  } },
  { groups: ['mod'], text: 'an unusual modulation', apply: (p, r) => {
    const n = freeSlot(p);
    p[`mod${n}.source`] = pick(r, ['velocity', 'env2', 'drift_slow', 'random', 'keytrack', 'lfo_product']);
    p[`mod${n}.dest`] = pick(r, ['dist_drive', 'fm_amount', 'filter_resonance', 'osc2_pitch', 'crush_mix', 'delay_time', 'unison_detune', 'tape_wow']);
    p[`mod${n}.amount`] = pick(r, [-1, 1]) * between(r, 0.1, 0.35);
  } },
  { groups: ['filter', 'mod'], text: 'a band-pass sweep', apply: (p, r) => {
    p['filter.type'] = 'bandpass';
    p['filter.cutoff'] = between(r, 300, 1500);
    p['filter.resonance'] = between(r, 0.25, 0.5);
    const n = freeSlot(p);
    p[`mod${n}.source`] = pick(r, ['lfo1', 'drift_slow', 'env2']);
    p[`mod${n}.dest`] = 'filter_cutoff';
    p[`mod${n}.amount`] = between(r, 0.15, 0.3);
  } },
];

// ------------------------------------------------------------ the quick check

interface Heard {
  ok: boolean;
  /** Level, dB (for leveling). */
  rmsDb: number;
}

/** One short silent render: reject silence, clipping (a hard-working limiter), harshness and mud. */
function listen(p: Patch, loop: Loop): Heard {
  const fs = 16000;
  const r = renderPatch(p, loop, { sampleRate: fs, seconds: 1.6, tail: 0.3 });
  const n = r.left.length;
  const mono = new Float32Array(n);
  let e = 0;
  for (let i = 0; i < n; i++) {
    mono[i] = 0.5 * (r.left[i] + r.right[i]);
    e += mono[i] * mono[i];
  }
  const rmsDb = 10 * Math.log10(e / n + 1e-30);
  if (rmsDb < -48) return { ok: false, rmsDb };
  if (r.limiterMinGain < 0.4) return { ok: false, rmsDb };
  const sp = powerSpectrum(mono, fs, 0, n, 8192);
  const total = bandPower(sp, 20, 7900) + 1e-30;
  const harsh = bandPower(sp, 2000, 5000) / total;
  const mud = bandPower(sp, 200, 400) / total;
  return { ok: harsh < 0.3 && mud < 0.55, rmsDb };
}

/** Bank-like loudness for a rolled sound. */
const TARGET_RMS_DB = -20;

// ------------------------------------------------------------ rolling

/** How far a sound sits from the nearest bank preset (mean normalized difference over the floats). */
function novelty(p: Patch, bank: readonly Patch[]): { distance: number; nearest: Patch } {
  const floats = params.filter((d) => d.type === 'float' && !FIXED.has(d.id));
  let best = Infinity, nearest = bank[0];
  for (const q of bank) {
    let s = 0;
    for (const d of floats) s += Math.abs(toNormalized(d, p[d.id] as number) - toNormalized(d, q[d.id] as number));
    // Different wave / filter / distortion types count as a real difference.
    for (const id of ['osc1.wave', 'osc2.wave', 'filter.type', 'dist.type', 'texture.type']) if (p[id] !== q[id]) s += 1.5;
    if (s < best) {
      best = s;
      nearest = q;
    }
  }
  return { distance: best / floats.length, nearest };
}

const ADJECTIVES = ['Rust', 'Ghost', 'Static', 'Hollow', 'Glass', 'Iron', 'Ash', 'Velvet', 'Broken', 'Night', 'Dust', 'Cold', 'Black', 'Worn',
  'Sunken', 'Ember', 'Fog', 'Signal', 'Bone', 'Chrome', 'Smoke', 'Wire', 'Pale', 'Low'];
const NOUNS: Record<string, string[]> = {
  bass: ['Bass', 'Low', 'Weight', 'Floor'], lead: ['Lead', 'Line', 'Call', 'Voice'], pad: ['Pad', 'Cloud', 'Field', 'Haze'],
  keys: ['Keys', 'Piano', 'Organ'], pluck: ['Pluck', 'Pick', 'Drop'], arp: ['Pulse', 'Sequence', 'Engine'], strings: ['Strings', 'Section', 'Bow'],
  brass: ['Horn', 'Brass', 'Call'], choir: ['Choir', 'Voices', 'Hymn'], bells: ['Bell', 'Chime', 'Mallet'], hits: ['Hit', 'Impact', 'Slam'],
  risers: ['Rise', 'Fall', 'Swell'], drone: ['Drone', 'Hum', 'Machine'], texture: ['Bed', 'Grain', 'Air'],
};

/** Build one candidate. */
function build(o: RollOptions, r: Rand): { patch: Patch; ideas: string[]; donors: Set<string> } {
  const w = Math.min(1, Math.max(0, o.weirdness));
  const pool = o.basedOn === 'any' ? o.bank : o.bank.filter((p) => p.meta.category === o.basedOn);
  const from = pool.length ? pool : o.bank;
  const base = pick(r, from);
  const p: Patch = structuredClone(base);
  const donors = new Set<string>([base.meta.category as string]);

  // Swap boxes in from other presets: the same category when tame, anywhere as it gets weird (collisions).
  const swapChance = 0.15 + 0.45 * w;
  for (const g of SWAP_GROUPS) {
    if (o.locked.has(g) || r() > swapChance) continue;
    const donor = r() < 0.85 * w ? pick(r, o.bank) : pick(r, from);
    donors.add(donor.meta.category as string);
    for (const d of byGroup.get(g) ?? []) if (!FIXED.has(d.id)) p[d.id] = donor[d.id];
  }

  // Nudge the floats inside the range good presets use (widening with weirdness).
  const key = o.basedOn;
  if (!rangeCache.has(key)) rangeCache.set(key, ranges(from));
  const range = rangeCache.get(key)!;
  const step = 0.04 + 0.12 * w;
  const widen = 0.3 * w;
  for (const d of params) {
    if (d.type !== 'float' || FIXED.has(d.id) || o.locked.has(d.group)) continue;
    const [lo, hi] = range.get(d.id) ?? [0, 1];
    const n = toNormalized(d, p[d.id] as number) + (2 * r() - 1) * step;
    p[d.id] = fromNormalized(d, Math.min(1, Math.max(0, Math.min(hi + widen, Math.max(lo - widen, n)))));
  }

  // The weirdness budget: a few wild ideas on otherwise solid ground.
  const count = w < 0.2 ? 0 : w < 0.5 ? 1 : w < 0.8 ? 2 : 3;
  const ideas: string[] = [];
  const open = IDEAS.filter((i) => i.groups.every((g) => !o.locked.has(g)));
  for (let k = 0; k < count && open.length; k++) {
    const idea = open.splice(Math.floor(r() * open.length), 1)[0];
    idea.apply(p, r);
    ideas.push(idea.text);
  }

  // Locked boxes: exactly as on screen.
  for (const g of o.locked) for (const d of byGroup.get(g) ?? []) p[d.id] = o.current[d.id];
  p['wheel.move'] = 'preset default';
  p['wheel.preset'] = wheelDefault(o.basedOn === 'any' ? (base.meta.category as string) : o.basedOn);
  return { patch: validatePatch(p).patch, ideas, donors };
}

/**
 * Roll a new sound. Tries a handful of candidates (more as weirdness rises),
 * keeps those that pass the quick check, and picks the most unusual one when
 * it's meant to be weird. Synchronous; a roll takes about a second.
 */
export function roll(o: RollOptions): Roll {
  const r = rng(o.seed);
  const w = Math.min(1, Math.max(0, o.weirdness));
  const wanted = 1 + Math.round(3 * w);
  const good: { patch: Patch; ideas: string[]; donors: Set<string>; distance: number; nearest: Patch; rmsDb: number }[] = [];
  for (let tries = 0; tries < 10 && good.length < wanted; tries++) {
    const c = build(o, r);
    const heard = listen(c.patch, o.loop);
    if (!heard.ok) continue;
    good.push({ ...c, ...novelty(c.patch, o.bank), rmsDb: heard.rmsDb });
  }
  // Nothing passed (rare): a gentle roll of the base sound.
  if (!good.length) {
    const c = build({ ...o, weirdness: 0 }, r);
    good.push({ ...c, ...novelty(c.patch, o.bank), rmsDb: listen(c.patch, o.loop).rmsDb });
  }
  const chosen = w < 0.3 ? good[0] : good.reduce((a, b) => (b.distance > a.distance ? b : a));
  const p = chosen.patch;

  // Level it like the bank.
  const gain = (p['output.gain'] as number) + (TARGET_RMS_DB - chosen.rmsDb);
  p['output.gain'] = Math.round(Math.min(12, Math.max(-24, gain)) * 10) / 10;

  // A name and where it might fit.
  const near = (chosen.nearest.meta.category as string) ?? 'pad';
  const nearName = categoryById(near)?.name ?? near;
  const name = `${pick(r, ADJECTIVES)} ${pick(r, NOUNS[near] ?? ['Sound'])}`;
  const mixed = [...chosen.donors].filter((c) => c && c !== near).map((c) => categoryById(c)?.name ?? c);
  let hint = `Behaves most like the ${nearName} presets`;
  if (mixed.length) hint += `, with parts from ${mixed.slice(0, 2).join(' and ')}`;
  if (chosen.ideas.length) hint += `; ${chosen.ideas.join(', ')}`;
  hint += '.';
  p.meta = { name, description: hint, tags: ['rolled'], category: undefined, collection: 'rolled' } as Patch['meta'];
  return { patch: p, name, hint };
}
