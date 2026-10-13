// "Earns its place": every ingredient of a preset must audibly matter.
// Each ingredient (each mod slot, the texture bed, tape, each effect, the
// second oscillator, the sub, drive, distortion, ...) is switched off in turn,
// the preset is rendered again, and the difference to the full sound is
// measured. An ingredient that changes nothing measurable is fake complexity.
//
// Pure TypeScript; renders offline (dev tools and tests, later the generator).

import { bandPower, powerSpectrum } from '../analysis/spectrum';
import { renderPatch } from '../engine/core/render';
import type { Loop } from '../engine/core/sequencer';
import { validatePatch, type ParamValue, type Patch } from '../schema';

export interface Ingredient {
  id: string;
  label: string;
  /** Parameter values that switch it off. */
  off: Record<string, ParamValue>;
}

export interface AblationResult {
  ingredient: Ingredient;
  /** Average audible change when it is switched off, dB. */
  diffDb: number;
  pass: boolean;
}

/**
 * Smallest change (dB) an ingredient must make. Low on purpose: a sound is
 * alive through many small motions that are each subtle on their own; this
 * catches ingredients that do (next to) nothing.
 */
export const EARNS_PLACE_DB = 0.15;

const n = (p: Patch, id: string) => p[id] as number;

/** The ingredients present in a patch (things a designer chose to add). */
export function ingredients(p: Patch): Ingredient[] {
  const out: Ingredient[] = [];
  const add = (id: string, label: string, off: Record<string, ParamValue>) => out.push({ id, label, off });
  for (let s = 1; s <= 12; s++) {
    const dst = p[`mod${s}.dest`] as string;
    if (dst !== 'none' && p[`mod${s}.source`] !== 'none' && Math.abs(n(p, `mod${s}.amount`)) > 0.0005) {
      add(`mod${s}`, `mod ${s} (${p[`mod${s}.source`]} → ${dst})`, { [`mod${s}.amount`]: 0 });
    }
  }
  if (n(p, 'osc2.level') > 0.02) add('osc2', 'oscillator 2', { 'osc2.level': 0 });
  if (n(p, 'osc1.unison_voices') > 1 && n(p, 'osc1.unison_detune') > 1) add('unison1', 'osc 1 unison', { 'osc1.unison_voices': 1 });
  if (n(p, 'osc2.level') > 0.02 && n(p, 'osc2.unison_voices') > 1 && n(p, 'osc2.unison_detune') > 1) add('unison2', 'osc 2 unison', { 'osc2.unison_voices': 1 });
  if (n(p, 'sub.level') > 0.02) add('sub', 'sub', { 'sub.level': 0 });
  if (n(p, 'noise.level') > 0.005) add('noise', 'noise', { 'noise.level': 0 });
  if (n(p, 'fm.amount') > 0.01 || n(p, 'fm.punch') > 0.01 || n(p, 'fm2.amount') > 0.01) add('fm', 'FM', { 'fm.amount': 0, 'fm.punch': 0, 'fm2.amount': 0 });
  if (n(p, 'click.level') > 0.01) add('click', 'transient', { 'click.level': 0 });
  if (n(p, 'breath.chiff') > 0.01 || n(p, 'breath.level') > 0.01) add('breath', 'breath', { 'breath.chiff': 0, 'breath.level': 0 });
  if (n(p, 'vibrato.depth') > 0.5) add('vibrato', 'vibrato', { 'vibrato.depth': 0 });
  if (Math.abs(n(p, 'pitch_env.amount')) > 0.1) add('pitchEnv', 'pitch envelope', { 'pitch_env.amount': 0 });
  if (Math.abs(n(p, 'filter.env_amount')) > 0.01) add('filterEnv', 'filter envelope', { 'filter.env_amount': 0 });
  if (n(p, 'drive.amount') > 0.02) add('drive', 'pre-filter drive', { 'drive.amount': 0 });
  if (n(p, 'dist.mix') > 0.02 && n(p, 'dist.drive') > 0.01) add('dist', 'distortion', { 'dist.mix': 0 });
  if (n(p, 'crush.mix') > 0.01) add('crush', 'bitcrusher', { 'crush.mix': 0 });
  if (n(p, 'tape.drive') > 0.01 || n(p, 'tape.wow') > 0.01 || n(p, 'tape.age') > 0.01) add('tape', 'tape', { 'tape.drive': 0, 'tape.wow': 0, 'tape.age': 0 });
  if (n(p, 'texture.level') > 0.01) add('texture', 'texture bed', { 'texture.level': 0 });
  if (n(p, 'comp.pump') > 0.01) add('pump', 'pump', { 'comp.pump': 0 });
  if (n(p, 'ott.amount') > 0.01) add('ott', 'multiband OTT', { 'ott.amount': 0 });
  for (const fx of ['chorus', 'flanger', 'phaser', 'delay', 'reverb']) {
    if (n(p, `${fx}.mix`) > 0.01) add(fx, fx, { [`${fx}.mix`]: 0 });
  }
  return out;
}

const EDGES = (() => {
  const e: number[] = [];
  for (let f = 40; f < 16000; f *= Math.pow(2, 1 / 3)) e.push(f);
  return e;
})();

/** Band energies (third-octave, 40 Hz-16 kHz) per frame, dB, of a stereo render folded to L+R and L-R. */
function bandFrames(l: Float32Array, r: Float32Array, fs: number): Float64Array[] {
  const N = 2048, hop = 1024;
  const frames: Float64Array[] = [];
  const mid = Float64Array.from(l, (v, i) => 0.5 * (v + r[i]));
  const side = Float64Array.from(l, (v, i) => 0.5 * (v - r[i]));
  for (let s = 0; s + N <= mid.length; s += hop) {
    const sm = powerSpectrum(mid, fs, s, s + N, N);
    const ss = powerSpectrum(side, fs, s, s + N, N);
    const row = new Float64Array(2 * (EDGES.length - 1));
    for (let b = 0; b < EDGES.length - 1; b++) {
      row[b] = 10 * Math.log10(bandPower(sm, EDGES[b], EDGES[b + 1]) + 1e-12);
      row[EDGES.length - 1 + b] = 10 * Math.log10(bandPower(ss, EDGES[b], EDGES[b + 1]) + 1e-12);
    }
    frames.push(row);
  }
  return frames;
}

/**
 * Audible difference between two renders, dB. Per frame: the level
 * difference of each band (mid and side), counted only where either render
 * is within 45 dB of that frame's loudest band and weighted toward louder
 * bands. Across frames: the 80th percentile, because movement only shows
 * while the modulator is away from its centre.
 */
export function audibleDifference(a: Float64Array[], b: Float64Array[]): number {
  const perFrame: number[] = [];
  for (let f = 0; f < Math.min(a.length, b.length); f++) {
    const ra = a[f], rb = b[f];
    let top = -Infinity;
    for (let i = 0; i < ra.length; i++) top = Math.max(top, ra[i], rb[i]);
    if (top < -90) continue; // silence
    let acc = 0, wsum = 0;
    for (let i = 0; i < ra.length; i++) {
      const loud = Math.max(ra[i], rb[i]);
      if (loud < top - 45) continue;
      const w = Math.pow(10, (loud - top) / 40); // softer weighting than power: quiet detail still counts
      acc += Math.min(12, Math.abs(ra[i] - rb[i])) * w;
      wsum += w;
    }
    perFrame.push(acc / wsum);
  }
  if (!perFrame.length) return 0;
  perFrame.sort((x, y) => x - y);
  return perFrame[Math.floor(0.8 * (perFrame.length - 1))];
}

export interface AblationOptions {
  /** Seconds of the loop to render (at least 6, so slow movement has time to show). */
  seconds: number;
  tail?: number;
  sampleRate?: number;
}

/** Switch each ingredient off in turn and measure how much the sound changes. */
export function earnsItsPlace(input: unknown, loop: Loop, opts: AblationOptions): AblationResult[] {
  const p = validatePatch(input).patch;
  const fs = opts.sampleRate ?? 48000;
  const render = (q: Patch) => {
    const r = renderPatch(q, loop, { sampleRate: fs, seconds: Math.max(6, opts.seconds), tail: opts.tail ?? 1 });
    return bandFrames(r.left, r.right, fs);
  };
  const full = render(p);
  return ingredients(p).map((ing) => {
    const diffDb = audibleDifference(full, render({ ...p, ...ing.off, meta: p.meta }));
    return { ingredient: ing, diffDb, pass: diffDb >= EARNS_PLACE_DB };
  });
}
