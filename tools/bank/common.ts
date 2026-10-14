// DEV ONLY. Shared building blocks for the preset bank (tools/build-bank.ts):
// the LORN base every category starts from, the movement kit, and the
// preset builder. The recipe (CLAUDE.md): layers, dirt that shapes tone
// (mostly before the filter), alive (independent non-repeating motion at
// several time scales), dark and worn, space, glue.

import { params, validatePatch } from '../../src/schema';
import { wheelDefault } from '../../src/quality/categories';

export type Mod = [source: string, dest: string, amount: number];
export type Settings = Record<string, number | string | boolean>;

export interface PresetDef {
  id: string;
  name: string;
  description: string;
  tags: string[];
  set: Settings;
  /** Replaces the category's movement kit when given. */
  mods?: Mod[];
  /** Texture bed: type, level, tone, tail (ms). */
  texture?: [type: string, level: number, tone: number, tail: number];
}

export interface CategoryDef {
  category: string;
  /** Category base on top of LORN_BASE. */
  base: Settings;
  /** The category's movement kit (12 slots at most). */
  kit: Mod[];
  presets: PresetDef[];
}

/** What every bank preset starts from. */
export const LORN_BASE: Settings = {
  'voice.analog': 0.6, 'voice.velocity': 0.5,
  'osc1.wave': 'saw', 'osc1.unison_voices': 3, 'osc1.unison_detune': 14, 'osc1.unison_spread': 0.8, 'osc1.level': 0.6,
  'osc2.level': 0, 'sub.level': 0,
  // Dirt mostly in front of the filter, so the filter's movement shapes the grit.
  'drive.amount': 0.45,
  'filter.type': 'lowpass', 'filter.cutoff': 1200, 'filter.resonance': 0.18, 'filter.keytrack': 0.6, 'filter.env_amount': 0.1,
  'mod_env.attack': 5, 'mod_env.decay': 800, 'mod_env.sustain': 0.3, 'mod_env.release': 600,
  'amp_env.attack': 10, 'amp_env.decay': 1000, 'amp_env.sustain': 0.9, 'amp_env.release': 800,
  'env2.attack': 2000, 'env2.decay': 5000, 'env2.sustain': 0.8, 'env2.release': 1500,
  'dist.type': 'tube', 'dist.drive': 0.22, 'dist.mix': 0.55, 'dist.post_tone': 0.4, 'dist.clean_below': 20,
  'tape.drive': 0.4, 'tape.wow': 0.18, 'tape.age': 0.4,
  'comp.amount': 0.35, 'comp.speed': 0.4, 'comp.pump': 0, 'ott.amount': 0.15,
  'chorus.mix': 0.2, 'chorus.depth': 0.45,
  'delay.mix': 0.14, 'delay.time': '1/4D', 'delay.feedback': 0.4, 'delay.tone': 0.25,
  'reverb.mix': 0.28, 'reverb.size': 0.8, 'reverb.tone': 0.8,
  'fx.lowcut': 200, 'eq.mid_freq': 350, 'eq.mid_gain': -2, 'eq.high_gain': -2, 'eq.highcut': 7000,
  // Movement sources at unrelated rates.
  'lfo1.shape': 'wander', 'lfo1.rate': 0.31, 'lfo1.retrigger': false,
  'lfo2.shape': 'wander', 'lfo2.rate': 1.9, 'lfo2.retrigger': false, 'lfo2.fade': 600,
  'lfo3.shape': 'sine', 'lfo3.rate': 0.13, 'lfo3.retrigger': false,
  'lfo4.shape': 'wander', 'lfo4.rate': 0.55, 'lfo4.retrigger': false,
};

/** The default movement kit (categories adapt it). */
export const ALIVE: Mod[] = [
  ['lfo1', 'filter_cutoff', 0.14],
  ['lfo2', 'filter_cutoff', 0.08],
  ['env2', 'filter_cutoff', 0.12],
  ['drift_slow', 'drive', 0.15],
  ['lfo3', 'unison_detune', 0.06],
  ['lfo4', 'width', 0.35],
  ['drift', 'pitch', 0.0012],
  ['lfo1', 'delay_time', 0.04],
  ['drift_slow', 'reverb_mix', 0.2],
  ['lfo4', 'chorus_depth', 0.25],
  ['velocity', 'filter_cutoff', 0.15],
  ['random', 'filter_cutoff', 0.08],
];

/**
 * A kit with changes: `overrides` change the amount of a slot (same source
 * and destination); `swaps` ("source>dest" → mod, or null to drop) reuse or
 * remove a slot.
 */
export function kit(base: Mod[], overrides: Mod[] = [], swaps: Record<string, Mod | null> = {}): Mod[] {
  let out: (Mod | null)[] = base.map((m) => [...m] as Mod);
  const find = (src: string, dst: string) => {
    const i = out.findIndex((m) => m && m[0] === src && m[1] === dst);
    if (i < 0) throw new Error(`kit has no ${src}>${dst} slot`);
    return i;
  };
  for (const o of overrides) out[find(o[0], o[1])] = o;
  for (const [k, m] of Object.entries(swaps)) {
    const [src, dst] = k.split('>');
    out[find(src, dst)] = m;
  }
  out = out.filter((m) => m !== null);
  return out as Mod[];
}

/** Build one complete preset (every schema parameter written out). */
export function buildPreset(cat: CategoryDef, def: PresetDef, audition: string): Record<string, unknown> {
  const mods = def.mods ?? cat.kit;
  if (mods.length > 12) throw new Error(`${cat.category}/${def.id}: more than 12 mod slots`);
  const raw: Record<string, unknown> = {
    meta: {
      name: def.name, description: def.description, tags: def.tags, category: cat.category, family: cat.category,
      collection: 'bank', audition,
    },
    'wheel.preset': wheelDefault(cat.category),
    ...LORN_BASE,
    ...cat.base,
    ...def.set,
  };
  if (def.texture) {
    const [type, level, tone, tail] = def.texture;
    Object.assign(raw, { 'texture.type': type, 'texture.level': level, 'texture.tone': tone, 'texture.tail': tail });
  }
  mods.forEach(([src, dst, amt], i) => {
    raw[`mod${i + 1}.source`] = src;
    raw[`mod${i + 1}.dest`] = dst;
    raw[`mod${i + 1}.amount`] = amt;
  });
  const { patch, issues } = validatePatch(raw);
  if (issues.length) throw new Error(`${cat.category}/${def.id}: ${JSON.stringify(issues)}`);
  const out: Record<string, unknown> = { meta: patch.meta };
  for (const p of params) out[p.id] = patch[p.id];
  return out;
}
