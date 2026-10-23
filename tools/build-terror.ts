// DEV ONLY. Builds the Terror presets: basses that get as close as the engine
// can to LORN's sound. Written to data/library/terror-<id>.json with
// meta.collection = "terror" (the UI lists them in their own menu; the Sound
// Tree and macros treat them like any other library patch, family "terror").
//
// What makes them LORN (see CLAUDE.md, "terror" family):
//   - thick tube/tape saturation that stays dark (high cut 4-6 kHz, mud cut)
//   - a clean mono sub under a wide, detuned, distorted mid layer
//   - worn tape: wow, age, a little crush and hiss
//   - space: dark reverb and smeared delay on the mids, never on the sub
//   - heavy compression, OTT and a breathing pump
//   - ALIVE: many small, independent, non-repeating motions on different time
//     scales, mostly in front of the distortion so the tone (not just the
//     level) changes: smooth random LFOs at unrelated rates, two drift
//     sources, a slow bloom envelope, per-note variation, analog drift,
//     LFO fade-in so each note hits clean and then comes alive.
// The critic checks the "alive" part by measurement (lifeSlowDb, lifeFastDb,
// lifeRepeat in data/quality.json).
//
//   npm run build:terror   (then: npm run level:patches && npm run analyze:library)

import { foldOctave } from './lib/octave';
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { params, validatePatch } from '../src/schema';
import { wheelDefault } from '../src/quality/categories';
import { ROOT } from './lib/data';
import { applyBassTemplate } from './bank/bass-templates';

type Mod = [source: string, dest: string, amount: number];
interface Def {
  id: string;
  dir: string;
  name: string;
  description: string;
  tags: string[];
  set: Record<string, number | string | boolean>;
  /** Replaces the shared movement kit when given. */
  mods?: Mod[];
  /** Added to the shared movement kit (or to `mods`). */
  extra?: Mod[];
  /** Texture bed: type, level, tone, tail (ms). */
  texture?: [type: string, level: number, tone: number, tail: number];
  /** Written exceptions to the style limits (tools/lib/allow.ts). */
  allow?: Record<string, { min?: number; max?: number; why: string }>;
}

const TERROR_BASE: Record<string, number | string | boolean> = {
  'voice.analog': 0.7, 'voice.velocity': 0.4,
  // Character layer: detuned saws, an octave-down saw underneath; clean sine sub.
  'osc1.wave': 'saw', 'osc1.unison_voices': 4, 'osc1.unison_detune': 16, 'osc1.unison_spread': 0.8, 'osc1.level': 0.6,
  'osc2.wave': 'saw', 'osc2.semi': -12, 'osc2.fine': -4, 'osc2.level': 0.35,
  'sub.level': 0.55, 'sub.wave': 'sine', 'sub.octave': -1,
  // Most of the dirt goes in front of the filter, so the filter's movement shapes the grit.
  // Heavy distortion after the filter would regenerate the harmonics and mask that movement.
  'drive.amount': 0.6,
  'filter.type': 'lowpass', 'filter.cutoff': 650, 'filter.resonance': 0.22, 'filter.keytrack': 0.5, 'filter.env_amount': 0.12,
  'mod_env.attack': 5, 'mod_env.decay': 600, 'mod_env.sustain': 0.3, 'mod_env.release': 300,
  'amp_env.attack': 6, 'amp_env.decay': 800, 'amp_env.sustain': 0.95, 'amp_env.release': 450,
  'env2.attack': 1800, 'env2.decay': 4000, 'env2.sustain': 0.8, 'env2.release': 1200,
  // Dirt above the sub, kept dark.
  'dist.type': 'tube', 'dist.drive': 0.28, 'dist.mix': 0.65, 'dist.post_tone': 0.35, 'dist.clean_below': 120,
  'tape.drive': 0.45, 'tape.wow': 0.22, 'tape.age': 0.45,
  'crush.mix': 0,
  // Glue and breath.
  'comp.amount': 0.5, 'comp.speed': 0.4, 'comp.pump': 0.25, 'ott.amount': 0.2,
  // Space, above the low cut only.
  'chorus.mix': 0.18, 'chorus.depth': 0.4, 'chorus.mode': 'classic',
  'delay.mix': 0.1, 'delay.time': '1/4D', 'delay.feedback': 0.4, 'delay.tone': 0.25,
  'reverb.mix': 0.2, 'reverb.size': 0.75, 'reverb.tone': 0.8,
  'fx.lowcut': 250, 'eq.mid_freq': 320, 'eq.mid_gain': -2.5, 'eq.high_gain': -2, 'eq.highcut': 5500,
  // Movement sources at unrelated rates (none of them divide into each other).
  'lfo1.shape': 'wander', 'lfo1.rate': 0.31, 'lfo1.retrigger': false,
  'lfo2.shape': 'wander', 'lfo2.rate': 1.7, 'lfo2.retrigger': false, 'lfo2.fade': 600,
  'lfo3.shape': 'sine', 'lfo3.rate': 0.11, 'lfo3.retrigger': false,
  'lfo4.shape': 'wander', 'lfo4.rate': 0.6, 'lfo4.retrigger': false,
};

/** The shared movement kit: slow wander, faster wander, bloom, drift, width, space. */
const ALIVE: Mod[] = [
  ['lfo1', 'filter_cutoff', 0.14],
  ['lfo2', 'filter_cutoff', 0.05],
  ['env2', 'filter_cutoff', 0.12],
  ['drift_slow', 'drive', 0.15],
  ['lfo3', 'unison_detune', 0.06],
  ['lfo4', 'width', 0.35],
  ['drift', 'osc2_pitch', 0.002],
  ['lfo1', 'delay_time', 0.04],
  ['drift_slow', 'reverb_mix', 0.2],
  ['lfo4', 'chorus_depth', 0.25],
  ['velocity', 'filter_cutoff', 0.15],
  ['random', 'filter_cutoff', 0.05],
];

/**
 * The kit with changes: `overrides` change the amount of a kit slot (same
 * source and destination); `swaps` ("source>dest" → mod) reuse a kit slot for
 * a different routing. Keeps the slot count at 12.
 */
function kit(overrides: Mod[], swaps: Record<string, Mod> = {}): Mod[] {
  const out = ALIVE.map((m) => [...m] as Mod);
  const find = (src: string, dst: string) => {
    const i = out.findIndex((m) => m[0] === src && m[1] === dst);
    if (i < 0) throw new Error(`kit has no ${src}>${dst} slot`);
    return i;
  };
  for (const o of overrides) out[find(o[0], o[1])] = o;
  for (const [k, m] of Object.entries(swaps)) {
    const [src, dst] = k.split('>');
    out[find(src, dst)] = m;
  }
  return out;
}

const D: Def[] = [
  {
    id: 'wall', dir: 'lorn-tape-flutter', name: 'Terror Wall',
    texture: ['dust', 0.62, 0.4, 600],
    description: 'A sustained wall of tube-saturated saws over a clean sub, crushed by compression and breathing with the beat.',
    tags: ['lorn', 'terror', 'wall', 'saturated', 'dark', 'pumping', 'cinematic'],
    set: {
      'osc1.unison_voices': 5, 'osc1.unison_detune': 18, 'filter.cutoff': 760, 'dist.drive': 0.38, 'dist.mix': 0.75,
      'comp.amount': 0.6, 'comp.pump': 0.45, 'ott.amount': 0.3, 'reverb.mix': 0.16,
    },
  },
  {
    id: 'cavern', dir: 'lorn-tape-flutter', name: 'Cavern',
    texture: ['air', 0.45, 0.3, 1600],
    description: 'A dark bass drowned in a huge, dark room: the mids bloom open over seconds and sink into a long tail.',
    tags: ['lorn', 'terror', 'reverb', 'cavern', 'dark', 'space', 'slow', 'cinematic'],
    set: {
      'osc1.unison_voices': 3, 'osc1.unison_detune': 12, 'osc2.wave': 'triangle', 'osc2.level': 0.4,
      'filter.cutoff': 480, 'filter.resonance': 0.26, 'amp_env.attack': 25, 'amp_env.release': 1400,
      'env2.attack': 2600, 'reverb.mix': 0.34, 'reverb.size': 0.92, 'reverb.tone': 0.85,
      'delay.mix': 0.14, 'delay.time': '1/2', 'delay.feedback': 0.5, 'delay.tone': 0.2, 'eq.highcut': 4800, 'comp.pump': 0.15,
    },
    mods: kit([['env2', 'filter_cutoff', 0.2], ['drift_slow', 'reverb_mix', 0.25], ['lfo1', 'filter_cutoff', 0.28]]),
    allow: { aliasDb: { max: -30, why: "an equal-tempered fifth (Ominous Fifth template) puts its upper partials a few Hz off the harmonic lattice the fizz probe expects; the voice is oversampled and doesn't alias" } },
  },
  {
    id: 'worn-tape', dir: 'lorn-tape-flutter', name: 'Worn Tape',
    texture: ['crackle', 0.5, 0.35, 800],
    description: 'Bass from a tape that has been played to death: sick wow and flutter, crushed grain, hiss and a dull, warm top.',
    tags: ['lorn', 'terror', 'tape', 'lo-fi', 'worn', 'wonky', 'grain', 'haunted'],
    set: {
      'tape.drive': 0.6, 'tape.wow': 0.55, 'tape.age': 0.7, 'crush.mix': 0.3, 'crush.bits': 6, 'crush.rate': 10,
      'noise.level': 0.025, 'filter.cutoff': 700, 'eq.highcut': 5000,
    },
    mods: kit([['drift', 'osc2_pitch', 0.004]]),
  },
  {
    id: 'slow-growl', dir: 'lorn-tape-flutter', name: 'Slow Growl',
    texture: ['dust', 0.62, 0.3, 600],
    description: 'A throat that slowly changes its vowel: formant filter wandering over bars, chewed by tube distortion.',
    tags: ['lorn', 'terror', 'growl', 'formant', 'vowel', 'slow', 'dark', 'talking'],
    set: {
      'filter.type': 'formant', 'filter.cutoff': 1100, 'filter.resonance': 0.45, 'filter.vowel': 0.35, 'filter.keytrack': 0.3,
      'dist.drive': 0.35, 'eq.highcut': 5200,
    },
    mods: kit([], {
      'lfo1>filter_cutoff': ['lfo1', 'filter_vowel', 0.3],
      'env2>filter_cutoff': ['env2', 'filter_vowel', 0.2],
      'lfo2>filter_cutoff': ['lfo2', 'filter_vowel', 0.06],
    }),
  },
  {
    id: 'dread', dir: 'lorn-tape-flutter', name: 'Dread',
    texture: ['rumble', 0.45, 0.35, 1200],
    description: 'A heavy bass with a quiet tritone layer above it that beats and rubs: uneasy, like something is wrong.',
    tags: ['lorn', 'terror', 'dissonant', 'tritone', 'dread', 'horror', 'dark'],
    set: {
      'osc2.wave': 'triangle', 'osc2.semi': 6, 'osc2.fine': 7, 'osc2.level': 0.16, 'filter.cutoff': 620,
    },
    mods: kit([['drift', 'osc2_pitch', 0.003]]),
  },
  {
    id: 'reverse-swell', dir: 'lorn-tape-flutter', name: 'Reverse Swell',
    texture: ['air', 0.3, 0.12, 1400],
    description: 'Notes that swell in backwards and rush to a saturated peak, then hang in a dark echo.',
    tags: ['lorn', 'terror', 'reverse', 'swell', 'backwards', 'cinematic', 'tension'],
    set: {
      'amp_env.attack': 900, 'amp_env.attack_curve': 1, 'amp_env.release': 900, 'env2.attack': 1100,
      'delay.mix': 0.16, 'delay.time': '1/4', 'delay.feedback': 0.45, 'reverb.mix': 0.24, 'comp.pump': 0.1,
    },
    mods: kit([['env2', 'filter_cutoff', 0.18]]),
  },
  {
    id: 'metal-hull', dir: 'lorn-tape-flutter', name: 'Metal Hull',
    texture: ['rumble', 0.5, 0.5, 1000],
    description: 'A bass that groans like a ship hull: a comb resonance drifting slowly through the distortion.',
    tags: ['lorn', 'terror', 'metallic', 'comb', 'groan', 'industrial', 'horror'],
    set: {
      'filter.type': 'comb', 'filter.cutoff': 240, 'filter.resonance': 0.5, 'filter.keytrack': 0,
      'eq.highcut': 5000,
    },
    mods: kit([['lfo1', 'filter_cutoff', 0.1], ['lfo2', 'filter_cutoff', 0.02], ['env2', 'filter_cutoff', 0.05]]),
    allow: { aliasDb: { max: -30, why: "an equal-tempered fifth (Ominous Fifth template) puts its upper partials a few Hz off the harmonic lattice the fizz probe expects; the voice is oversampled and doesn't alias" } },
  },
  {
    id: 'crushed-808', dir: 'lorn-tape-flutter', name: 'Crushed 808',
    texture: ['crackle', 0.45, 0.3, 900],
    description: 'A long, dark 808 through a wandering wavefolder, tape and a little crush: its grit never sits still as it rings out.',
    tags: ['lorn', 'terror', '808', 'crushed', 'distorted', 'long', 'dark'],
    set: {
      'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'osc1.level': 0.75, 'osc2.wave': 'triangle', 'osc2.level': 0.2,
      'pitch_env.amount': 12, 'pitch_env.decay': 60,
      'amp_env.attack': 1, 'amp_env.decay': 3200, 'amp_env.sustain': 0.4, 'amp_env.release': 700,
      'drive.amount': 0.6, 'filter.cutoff': 1200, 'dist.type': 'fold', 'dist.drive': 0.3, 'dist.mix': 0.75, 'dist.clean_below': 90, 'sub.level': 0.5,
      'crush.mix': 0.25, 'crush.bits': 5, 'crush.rate': 7, 'comp.pump': 0.1, 'chorus.mix': 0.24, 'tape.wow': 0.3, 'lfo2.rate': 3.1,
    },
    // A sine body has few harmonics before the distortion, so the filter can't move it:
    // a wavefolder whose depth wanders reshapes the strong low harmonics instead.
    mods: kit([], {
      'lfo1>filter_cutoff': ['lfo1', 'dist_drive', 0.15],
      'lfo2>filter_cutoff': ['lfo2', 'dist_drive', 0.08],
      'lfo3>unison_detune': ['lfo3', 'tape_wow', 0.3],
      // The 808 / Thump template has no oscillator 2: its slots move the drive and oscillator 1 instead.
      'env2>filter_cutoff': ['env2', 'drive', 0.2],
      'drift>osc2_pitch': ['drift', 'osc1_pitch', 0.002],
      'random>filter_cutoff': ['random', 'dist_drive', 0.06],
    }),
  },
  {
    id: 'breather', dir: 'lorn-tape-flutter', name: 'Breather',
    texture: ['air', 0.4, 0.4, 700],
    description: 'A wide, sustained bass that inhales and exhales with the beat under heavy sidechain-style pumping.',
    tags: ['lorn', 'terror', 'pump', 'sidechain', 'breathing', 'wide', 'dark'],
    set: {
      'osc1.unison_voices': 6, 'osc1.unison_detune': 20, 'osc1.unison_spread': 1, 'comp.amount': 0.6, 'comp.pump': 0.7,
      'chorus.mix': 0.24, 'chorus.mode': 'ensemble', 'filter.cutoff': 700,
    },
    // The faster wander needs a little more depth to be heard under the pump.
    mods: kit([['lfo2', 'filter_cutoff', 0.09]]),
  },
  // ---------------------------------------------------- texture is the point
  {
    id: 'old-record', dir: 'lorn-tape-flutter', name: 'Old Record',
    description: 'A round, warm bass lifted off a worn record: loud crackle and pops around it, narrow, dull and saturated.',
    tags: ['lorn', 'terror', 'texture', 'crackle', 'vinyl', 'sampled', 'lo-fi', 'warm'],
    texture: ['crackle', 1, 0.45, 1500],
    set: {
      'osc1.wave': 'triangle', 'osc1.unison_voices': 1, 'osc1.level': 0.7, 'osc2.wave': 'saw', 'osc2.level': 0.3, 'osc2.semi': 0, 'osc2.fine': 6,
      'filter.cutoff': 380, 'filter.resonance': 0.15, 'drive.amount': 0.5, 'tape.drive': 0.6, 'tape.wow': 0.35, 'tape.age': 0.65,
      'chorus.mix': 0.06, 'reverb.mix': 0.12, 'reverb.size': 0.5, 'delay.mix': 0.05, 'comp.pump': 0.15, 'eq.highcut': 6000,
    },
    mods: kit([['lfo2', 'filter_cutoff', 0.1]], {
      'lfo4>width': ['lfo4', 'width', -0.4],
      'lfo4>chorus_depth': ['drift_slow', 'texture_level', 0.3],
      'lfo3>unison_detune': ['lfo3', 'osc2_pitch', 0.003],
    }),
  },
  {
    id: 'dust-ghost', dir: 'lorn-tape-flutter', name: 'Dust Ghost',
    description: 'A soft, half-there bass that blooms out of a cloud of dust and fades back into it, with a dark echo behind.',
    tags: ['lorn', 'terror', 'texture', 'dust', 'ghostly', 'soft', 'haunted', 'ambient'],
    texture: ['dust', 1, 0.2, 2200],
    set: {
      'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'osc1.level': 0.7, 'osc2.wave': 'triangle', 'osc2.semi': 12, 'osc2.level': 0.25, 'osc2.fine': 5,
      'osc2.unison_voices': 3, 'osc2.unison_detune': 14,
      'drive.amount': 0.45, 'filter.cutoff': 600, 'amp_env.attack': 60, 'amp_env.release': 1500, 'env2.attack': 2200,
      'reverb.mix': 0.3, 'reverb.size': 0.85, 'delay.mix': 0.16, 'delay.time': '1/2', 'delay.feedback': 0.5, 'comp.pump': 0.1, 'eq.highcut': 7500, 'tape.age': 0.25,
    },
    // A sine body barely reacts to the filter: move its drive and the octave layer instead, and let the dust breathe.
    mods: kit([['drift_slow', 'drive', 0.25]], {
      'lfo1>filter_cutoff': ['lfo1', 'osc2_level', 0.4],
      'lfo2>filter_cutoff': ['lfo2', 'dist_drive', 0.08],
      'lfo3>unison_detune': ['lfo3', 'texture_level', 0.2],
      'env2>filter_cutoff': ['env2', 'osc2_level', 0.15],
      'random>filter_cutoff': ['random', 'drive', 0.1],
    }),
  },
  {
    id: 'exhale', dir: 'lorn-tape-flutter', name: 'Exhale',
    description: 'Every note is a breath: a wash of air swells with it and drains away, around a dark, slowly talking bass.',
    tags: ['lorn', 'terror', 'texture', 'air', 'breath', 'vocal', 'dark', 'cinematic'],
    texture: ['air', 0.85, 0.35, 2500],
    set: {
      'filter.type': 'formant', 'filter.cutoff': 1100, 'filter.resonance': 0.35, 'filter.vowel': 0.35, 'filter.keytrack': 0.3, 'eq.mid_gain': -3.5,
      'amp_env.attack': 40, 'amp_env.release': 1200, 'reverb.mix': 0.24, 'eq.highcut': 6000,
    },
    mods: kit([], {
      'lfo1>filter_cutoff': ['lfo1', 'filter_vowel', 0.25],
      'env2>filter_cutoff': ['env2', 'texture_level', 0.15],
      'lfo2>filter_cutoff': ['lfo2', 'filter_vowel', 0.05],
    }),
  },
  {
    id: 'undertow', dir: 'lorn-tape-flutter', name: 'Undertow',
    description: 'A deep, detuned bass dragged along by a dark rumble that surges and pulls back underneath it.',
    tags: ['lorn', 'terror', 'texture', 'rumble', 'deep', 'detuned', 'dark', 'heavy'],
    texture: ['rumble', 0.9, 0.3, 1800],
    set: {
      'osc1.unison_voices': 5, 'osc1.unison_detune': 22, 'osc2.semi': -12, 'osc2.fine': -9, 'osc2.level': 0.4,
      'eq.mid_gain': -3.5, 'reverb.mix': 0.18, 'comp.pump': 0.3, 'tape.age': 0.6, 'drive.amount': 0.75, 'dist.drive': 0.36, 'filter.cutoff': 640,
    },
    mods: kit([], {
      'drift_slow>reverb_mix': ['drift_slow', 'texture_level', 0.35],
    }),
  },
];

function build(def: Def): Record<string, unknown> {
  const mods = [...(def.mods ?? ALIVE), ...(def.extra ?? [])];
  if (mods.length > 12) throw new Error(`${def.id}: more than 12 mod slots`);
  const raw: Record<string, unknown> = {
    meta: {
      name: def.name, description: def.description, tags: def.tags, directory: def.dir, family: 'terror',
      category: 'bass', collection: 'terror', audition: 'dread',
      ...(def.allow ? { allow: def.allow } : {}),
    },
    'wheel.preset': wheelDefault('bass'),
    ...TERROR_BASE,
    ...def.set,
  };
  if (def.texture) {
    const [type, level, tone, tail] = def.texture;
    Object.assign(raw, { 'texture.type': type, 'texture.level': level, 'texture.tone': tone, 'texture.tail': tail });
  }
  (raw.meta as { tags: string[] }).tags = applyBassTemplate(def.id, raw, def.tags);
  mods.forEach(([src, dst, amt], i) => {
    raw[`mod${i + 1}.source`] = src;
    raw[`mod${i + 1}.dest`] = dst;
    raw[`mod${i + 1}.amount`] = amt;
  });
  foldOctave(raw, def.id);
  const { patch, issues } = validatePatch(raw);
  if (issues.length) throw new Error(`${def.id}: ${JSON.stringify(issues)}`);
  const out: Record<string, unknown> = { meta: patch.meta };
  for (const p of params) out[p.id] = patch[p.id];
  return out;
}

const libDir = join(ROOT, 'data/library');
mkdirSync(libDir, { recursive: true });
const only = process.argv[2];
if (!only) for (const f of readdirSync(libDir)) if (f.startsWith('terror-')) unlinkSync(join(libDir, f));
for (const def of D) {
  if (only && def.id !== only) continue;
  writeFileSync(join(libDir, `terror-${def.id}.json`), JSON.stringify(build(def), null, 2) + '\n');
}
console.log(`built ${only ? 1 : D.length} terror patch(es)`);
