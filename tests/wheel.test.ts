// The mod wheel's connected moves and the wobble: they do nothing at rest,
// change the sound when used, and a sample of presets keeps its quality and
// safety with every move fully up (the moves are the same recipes everywhere,
// so a sample catches what a full sweep would).
import { describe, expect, it } from 'vitest';
import { analyzePatch } from '../src/analysis';
import { renderPatch } from '../src/engine/core/render';
import { analysisSetup } from '../src/quality/categories';
import { judge } from '../src/quality/critic';
import { audioFingerprint } from '../src/quality/stamp';
import { getParam, validatePatch } from '../src/schema';
import { judgeHash } from '../tools/lib/codehash';
import { heldNote, libraryPatches, loop } from './helpers/audio';

const MOVES = getParam('wheel.preset')!.options!;
const base = { meta: { name: 't' }, 'osc1.wave': 'saw', 'filter.cutoff': 700, 'amp_env.sustain': 1, 'reverb.mix': 0.2, 'texture.level': 0.3 };
const FS = 24000;
const diffDb = (a: Float32Array, b: Float32Array) => {
  let d = 0, e = 0;
  for (let i = 0; i < a.length; i++) {
    d += (a[i] - b[i]) ** 2;
    e += a[i] ** 2;
  }
  return 10 * Math.log10(d / e + 1e-30);
};

describe('mod wheel', () => {
  it('at rest it changes nothing, whatever the move', () => {
    const plain = renderPatch(base, heldNote(45, 2), { seconds: 1, sampleRate: FS }).left;
    for (const m of ['preset default', ...MOVES]) {
      const r = renderPatch({ ...base, 'wheel.move': m }, heldNote(45, 2), { seconds: 1, sampleRate: FS }).left;
      expect(diffDb(plain, r), m).toBeLessThan(-200);
    }
  });

  it.each(MOVES)('%s changes the sound when the wheel is up', (m) => {
    const p = { ...base, 'wheel.move': m };
    const rest = renderPatch(p, heldNote(45, 4), { seconds: 2, sampleRate: FS }).left;
    const up = renderPatch(p, heldNote(45, 4), { seconds: 2, sampleRate: FS, modWheel: 1 }).left;
    expect(diffDb(rest, up)).toBeGreaterThan(-20);
  });

  it("preset default plays the preset's own move", () => {
    const own = renderPatch({ ...base, 'wheel.preset': 'choke' }, heldNote(45, 2), { seconds: 1, sampleRate: FS, modWheel: 1 }).left;
    const named = renderPatch({ ...base, 'wheel.move': 'choke' }, heldNote(45, 2), { seconds: 1, sampleRate: FS, modWheel: 1 }).left;
    expect(diffDb(own, named)).toBeLessThan(-200);
  });

  const lib = libraryPatches();
  it('Atlas stamps match the current sound and judges', () => {
    // (Bank presets are verified the same way in tests/bank.test.ts.)
    for (const { file, json } of lib.filter(({ json }) => !json.meta.category)) {
      const setup = analysisSetup(json.meta);
      expect(json.meta.checks?.judge, file).toBe(judgeHash());
      expect(json.meta.checks?.audio, file).toBe(audioFingerprint(validatePatch(json).patch, loop(setup.loop), setup.opts));
    }
  }, 300000);

  // A few presets from across the bank, every move fully up: quality and safety hold.
  const bank = lib.filter(({ json }) => json.meta.category);
  // Three presets spread across the bank (the shelves are in file order), moving as the bank grows.
  const sample = [0, 1, 2].map((k) => bank[(Math.floor((bank.length * (2 * k + 1)) / 6) + bank.length) % bank.length]);
  it.each(sample.map((e) => [e.file, e.json]))('%s: every move, fully up, keeps quality and safety', (_f, json) => {
    const setup = analysisSetup(json.meta);
    const bad: string[] = [];
    for (const m of MOVES) {
      const p = { ...json, 'wheel.move': m };
      const v = judge(analyzePatch(p, loop(setup.loop), { ...setup.opts, life: false, modWheel: 1 }).raw, json.meta.family, json.meta.category);
      for (const i of v.issues.filter((x) => !/^(vibe|life)/.test(x.code))) bad.push(`${m}: ${i.message}`);
    }
    expect(bad).toEqual([]);
  }, 600000);
});

describe('wobble', () => {
  const wob = { ...base, 'texture.level': 0, 'reverb.mix': 0, 'filter.cutoff': 200, 'wobble.depth': 1, 'wobble.life': 0, 'voice.analog': 0 };
  /** Brightness (first-difference energy ratio) in consecutive windows. */
  const brightness = (x: Float32Array, win: number, n: number) =>
    Array.from({ length: n }, (_, k) => {
      let d = 0, e = 0;
      for (let i = k * win + 1; i < (k + 1) * win; i++) {
        d += (x[i] - x[i - 1]) ** 2;
        e += x[i] ** 2;
      }
      return d / e;
    });

  it('depth 0 is off: nothing changes', () => {
    const a = renderPatch({ ...base }, heldNote(45, 4), { seconds: 2, sampleRate: FS }).left;
    const b = renderPatch({ ...base, 'wobble.rate': '1/16', 'wobble.volume': true }, heldNote(45, 4), { seconds: 2, sampleRate: FS }).left;
    expect(diffDb(a, b)).toBeLessThan(-200);
  });

  const corr = (a: number[], b: number[]) => {
    const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
      n += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return n / Math.sqrt(da * db);
  };

  it('cutoff: moves the tone through each cycle and repeats with the tempo', () => {
    // 120 BPM, 1/8: a cycle every 0.25 s; windows of 1/8 cycle, skipping the first cycle.
    // A3 (220 Hz): a whole number of waveform periods per cycle, so the oscillator lines up too.
    const x = renderPatch({ ...wob, 'filter.type': 'lowpass' }, heldNote(57, 4), { seconds: 2, sampleRate: FS }).left;
    const b = brightness(x, (0.25 * FS) / 8, 32).slice(8);
    expect(Math.max(...b) / Math.min(...b)).toBeGreaterThan(1.3);
    // One cycle later the tone is where it was; half a cycle later it isn't.
    expect(corr(b.slice(0, 16), b.slice(8, 24))).toBeGreaterThan(0.9);
    expect(corr(b.slice(0, 16), b.slice(4, 20))).toBeLessThan(0.5);
  });

  it('life makes each cycle a little different; 0 repeats exactly', () => {
    const peaks = (life: number) => {
      const x = renderPatch({ ...wob, 'wobble.life': life }, heldNote(57, 8), { seconds: 4, sampleRate: FS }).left;
      const b = brightness(x, (0.25 * FS) / 8, 128);
      // Each cycle's average brightness.
      return Array.from({ length: 12 }, (_, c) => b.slice(8 * (c + 2), 8 * (c + 3)).reduce((s, v) => s + v, 0) / 8);
    };
    const spread = (v: number[]) => (Math.max(...v) - Math.min(...v)) / Math.max(...v);
    expect(spread(peaks(0))).toBeLessThan(0.05);
    expect(spread(peaks(1))).toBeGreaterThan(0.15);
  });
});

describe('wobble on the volume', () => {
  it('gates the level with each cycle and never makes it louder', () => {
    const p = { meta: { name: 't' }, 'osc1.wave': 'saw', 'amp_env.sustain': 1, 'wobble.depth': 1, 'wobble.life': 0, 'wobble.rate': '1/8', 'reverb.mix': 0, 'delay.mix': 0, 'texture.level': 0 };
    const still = renderPatch({ ...p, 'wobble.depth': 0 }, heldNote(57, 4), { seconds: 2, sampleRate: 24000 }).left;
    const gated = renderPatch({ ...p, 'wobble.cutoff': false, 'wobble.volume': true }, heldNote(57, 4), { seconds: 2, sampleRate: 24000 }).left;
    const win = 24000 * 0.25 / 8;
    const rms = (x: Float32Array) => Array.from({ length: 48 }, (_, k) => {
      let e = 0;
      for (let i = (k + 8) * win; i < (k + 9) * win; i++) e += x[i] ** 2;
      return Math.sqrt(e / win);
    });
    const r = rms(gated), r0 = rms(still);
    expect(Math.max(...r) / Math.max(1e-9, Math.min(...r))).toBeGreaterThan(4);
    expect(Math.max(...r)).toBeLessThan(Math.max(...r0) * 1.05);
  });
});

describe('wobble on cutoff and volume together', () => {
  it('both lamps: different from either alone', () => {
    const p = { meta: { name: 't' }, 'osc1.wave': 'saw', 'amp_env.sustain': 1, 'wobble.depth': 1, 'wobble.life': 0, 'reverb.mix': 0, 'delay.mix': 0, 'texture.level': 0 };
    const r = (c: boolean, v: boolean) => renderPatch({ ...p, 'wobble.cutoff': c, 'wobble.volume': v }, heldNote(57, 4), { seconds: 1, sampleRate: 24000 }).left;
    const both = r(true, true), cut = r(true, false), vol = r(false, true);
    const diff = (a: Float32Array, b: Float32Array) => {
      let d = 0, e = 0;
      for (let i = 0; i < a.length; i++) { d += (a[i] - b[i]) ** 2; e += a[i] ** 2; }
      return 10 * Math.log10(d / e + 1e-30);
    };
    expect(diff(both, cut)).toBeGreaterThan(-20);
    expect(diff(both, vol)).toBeGreaterThan(-20);
  });
});
