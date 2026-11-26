// One custom LFO (owner's call: four of them, `wobble.*` and `wobble2.*` .. `wobble4.*`), run once per control
// block. Its shape (a template, random steps or the points you draw), smoothed, locked to the bar or the note,
// moves up to four targets: each follows its own line, y = master x (depth x (v - 0.5) + offset / 2) around
// where the target is set. FILTER and VOLUME are the custom LFOs' own filter and gate, which the synth runs.
// Ported line by line to plugin/engine/WobUnit.h.

import { Rng } from './dsp';
import * as K from './params';
import { WOB_MAX_POINTS, WOB_RANDOM_STEPS, WOB_TABLE, WOB_TEMPLATES, wobShapeAt, wobSmoothRadius, wobSmoothTable, wobTableAt } from './wobshape';

const WOB_TEMPLATE_ARRAYS = K.WOB_SHAPES.map((name) => {
  const pts = WOB_TEMPLATES[name] ?? WOB_TEMPLATES.sine;
  return { n: pts.length, xs: Float64Array.from(pts, (q) => q.x), ys: Float64Array.from(pts, (q) => q.y), ss: Float64Array.from(pts, (q) => (q.s ? 1 : 0)) };
});

export type WobIdx = (typeof K.P.wob)[number];

/** How many targets each custom LFO has. */
export const WOB_TARGETS = 4;

export class WobUnit {
  private readonly rng: Rng;
  /** The custom shape's points (filled per block, no allocation) and its smoothed value. */
  private readonly xs = new Float64Array(WOB_MAX_POINTS);
  private readonly ys = new Float64Array(WOB_MAX_POINTS);
  private readonly ss = new Float64Array(WOB_MAX_POINTS);
  private v = 0;
  private shapeNow = 0;
  private ptsNow = 0;
  private sig = NaN;
  private readonly table = new Float64Array(WOB_TABLE);
  private readonly tmp = new Float64Array(WOB_TABLE);
  /** The current shape, unsmoothed, at q (made once, so the table rebuild never allocates). */
  private readonly rawFn = (q: number): number => this.raw(q);
  /** Random's steps for the current cycle. */
  private readonly rand = new Float64Array(WOB_RANDOM_STEPS);
  private randCycle = -1;
  /** Where it is in its cycle (0..1), -1 when it does nothing. */
  live = -1;
  /** Its FILTER line right now (0 shut .. 1 open) and how deep it goes, -1 when it has no FILTER target. */
  filt = -1;
  filtDepth = 0;
  /** Its VOLUME line right now (the level 0..1), -1 when it has no VOLUME target. */
  gate = -1;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  /** One control block: adds its matrix targets into `x`, sets live / filt / gate. */
  step(cur: Float64Array, w: WobIdx, songBeat: number, tempo: number, start: number, note: number, x: Float64Array): void {
    this.live = -1;
    this.filt = -1;
    this.gate = -1;
    this.filtDepth = 0;
    const master = cur[w.master];
    let depth = 0;
    for (let t = 0; t < WOB_TARGETS; t++) depth = Math.max(depth, Math.abs(cur[w.amts[t]]), Math.abs(cur[w.offs[t]]));
    if (depth * master <= 1e-4) return;
    // HZ: a free rate, as a cycle in beats at the tempo (so the rest runs the same way); SYNC: a note value
    const cycle = cur[w.free] > 0.5 ? tempo / 60 / Math.max(0.01, cur[w.hz]) : K.WOBBLE_BEATS[Math.round(cur[w.rate])] ?? 0.5;
    // ONE SHOT: from the note's start, once, then holding the end; otherwise locked to the bar
    const one = cur[w.oneShot] > 0.5;
    const n = one ? -1 - note : Math.floor(songBeat / cycle);
    const p = one ? Math.min(0.99999, Math.max(0, (songBeat - start) / cycle)) : (songBeat - n * cycle) / cycle;
    this.live = p;
    // The shape, shifted later in the cycle by the shift setting.
    let q = p - cur[w.phase];
    q -= Math.floor(q);
    const shape = Math.round(cur[w.shape]);
    if (shape === K.WOB_RANDOM && this.randCycle !== n) {
      // New steps every cycle, never repeating.
      this.randCycle = n;
      for (let k = 0; k < WOB_RANDOM_STEPS; k++) this.rand[k] = 0.5 + 0.5 * this.rng.next();
    }
    let m = 0;
    if (shape === K.WOB_CUSTOM) {
      // Your own shape (points from the LFO page).
      m = Math.max(2, Math.min(WOB_MAX_POINTS, Math.round(cur[w.pts])));
      for (let k = 0; k < m; k++) {
        this.xs[k] = cur[w.x[k]];
        this.ys[k] = cur[w.y[k]];
        this.ss[k] = cur[w.s[k]] > 0.5 ? 1 : 0;
      }
    }
    this.shapeNow = shape;
    this.ptsNow = m;
    // Smooth (as in ShaperBox): the corners rounded in place, from a table rebuilt only when the
    // shape or the amount changes. Even at 0 a few ms of glide, so a jump never clicks.
    const r = wobSmoothRadius(cur[w.smooth]);
    let target: number;
    if (r === 0) target = this.raw(q);
    else {
      let sig = shape * 7919 + r * 104729 + m * 13;
      if (shape === K.WOB_RANDOM) sig += n * 1.618;
      for (let k = 0; k < m; k++) sig += this.xs[k] * (k + 1.31) * 3.7 + this.ys[k] * (k + 2.17) * 5.3 + this.ss[k] * (k + 3.1);
      if (sig !== this.sig) {
        this.sig = sig;
        wobSmoothTable(this.rawFn, r, this.table, this.tmp);
      }
      target = wobTableAt(this.table, q);
    }
    this.v += (target - this.v) * 0.35;
    const v = this.v;
    // each target follows its own line (depth 1 = the shape, 0 = flat, -1 = upside down, offset up / down), times
    // the master Depth; a matrix target moves by it around where it is set, the filter is open at 0.5 + y = 1 and
    // shut at 0, the gate is the level 0.5 + y; the deepest FILTER / VOLUME row of this LFO counts
    let fD = -1, gD = -1;
    for (let t = 0; t < WOB_TARGETS; t++) {
      const dest = Math.round(cur[w.dests[t]]), a = cur[w.amts[t]], o = cur[w.offs[t]];
      if (dest <= 0 || (a === 0 && o === 0)) continue;
      const y = master * (a * (v - 0.5) + o / 2);
      if (dest === K.D_LF_ALL) {
        if (Math.abs(a) > fD) { fD = Math.abs(a); this.filt = Math.max(0, Math.min(1, 0.5 + y)); this.filtDepth = Math.min(1, fD * master); }
      } else if (dest === K.D_AMP) {
        if (Math.abs(a) > gD) { gD = Math.abs(a); this.gate = Math.max(0, Math.min(1, 0.5 + y)); }
      } else x[dest] += y;
    }
  }

  /** The shape set up for this block, unsmoothed, at q (0..1). */
  private raw(q: number): number {
    const shape = this.shapeNow;
    if (shape === K.WOB_RANDOM) return this.rand[Math.min(WOB_RANDOM_STEPS - 1, Math.floor(q * WOB_RANDOM_STEPS))];
    if (shape === K.WOB_CUSTOM) return wobShapeAt(this.xs, this.ys, this.ss, this.ptsNow, q);
    const t = WOB_TEMPLATE_ARRAYS[shape] ?? WOB_TEMPLATE_ARRAYS[0];
    return wobShapeAt(t.xs, t.ys, t.ss, t.n, q);
  }
}

/** Two phases (0..1, or -1 = off) packed into one float for the page (12 bits each, exact in a float32). */
export function packWob(a: number, b: number): number {
  const e = (p: number) => (p < 0 ? 4095 : Math.min(4094, Math.floor(p * 4095)));
  return e(a) * 4096 + e(b);
}

/** The page's side of Synth.liveDials: parameter index -> position (0..1), from the count and the packed values. */
export function decodeDials(count: number, at: (k: number) => number): Map<number, number> {
  const out = new Map<number, number>();
  const n = Math.max(0, Math.min(23, Math.round(count)));
  for (let k = 0; k < n; k++) {
    const v = Math.round(at(k)), i = Math.floor(v / 4096);
    out.set(i, (v - i * 4096) / 4095);
  }
  return out;
}

/** The page's side of packWob: [a, b], null for off. */
export function unpackWob(v: number): [number | null, number | null] {
  const r = Math.round(v), a = Math.floor(r / 4096), b = r - a * 4096;
  const d = (e: number) => (e >= 4095 || e < 0 ? null : e / 4095);
  return [d(a), d(b)];
}
