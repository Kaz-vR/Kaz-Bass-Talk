// Texture bed: the six beds (crackle … static) and their six hits. Follows the notes with its own
// tail, stays silent between notes, keeps off the sub, and leaves the rest of
// the patch untouched.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { bandPower, powerSpectrum } from '../src/analysis/spectrum';
import { heldNote, rms } from './helpers/audio';
import { textureLoudness } from '../src/engine/core/loudness';
import { validatePatch } from '../src/schema';
import { Texture, TEX_CRACKLE, TEX_CRACKLE_HIT, TEX_DUST, TEX_DUST_HIT, TEX_STATIC, TEX_STATIC_HIT, TEX_TAPE } from '../src/engine/core/voicefx';

const FS = 48000;
const base = {
  meta: { name: 't' }, 'voice.analog': 0, 'sub.level': 0.5, 'filter.cutoff': 800, 'amp_env.attack': 1, 'amp_env.sustain': 1, 'amp_env.release': 30,
  'osc1.wave': 'saw', 'osc1.level': 0.7, 'texture.level': 0.8, 'texture.tail': 300,
};
const TYPES = ['crackle', 'dust', 'rumble', 'air', 'tape hiss', 'static'];
const HITS = ['crackle hit', 'dust hit', 'static hit', 'tape hiss hit', 'air hit', 'rumble hit'];
/** Texture alone: the same render minus the render without texture. */
function bed(p: object, seconds: number, tail = 0) {
  const a = renderPatch(p, heldNote(45, 1), { seconds, tail });
  const b = renderPatch({ ...p, 'texture.level': 0 }, heldNote(45, 1), { seconds, tail });
  return {
    left: Float32Array.from(a.left, (v, i) => v - b.left[i]),
    right: Float32Array.from(a.right, (v, i) => v - b.right[i]),
  };
}

describe('texture bed', () => {
  it.each(TYPES)('%s is audible while a note plays', (type) => {
    const x = bed({ ...base, 'texture.type': type }, 0.5);
    expect(rms(x.left, 0.1 * FS, 0.45 * FS)).toBeGreaterThan(1e-3);
  });

  it.each(TYPES)('%s lingers for its tail, then goes silent', (type) => {
    // Note: 0.5 s held, released; the loop then rests (heldNote(…, 1) is 1 beat on, 1 off at 120 BPM).
    // (crackle denser here: a handful of sparse pops is too few to measure a tail on)
    const x = bed({ ...base, 'texture.type': type, 'texture.tail': 400, 'texture.density': type === 'crackle' ? 0.9 : 0.5 }, 0.95);
    const during = rms(x.left, 0.2 * FS, 0.45 * FS);
    expect(rms(x.left, 0.52 * FS, 0.7 * FS)).toBeGreaterThan(during * 0.05);
    expect(rms(x.left, 0.88 * FS, 0.95 * FS)).toBeLessThan(during * 0.05);
  });

  it('leaves the rest of the patch untouched when off', () => {
    const a = renderPatch({ ...base, 'texture.level': 0 }, heldNote(45, 1), { seconds: 0.5 });
    const b = renderPatch({ ...base, 'texture.level': 0, 'texture.type': 'air', 'texture.tone': 1 }, heldNote(45, 1), { seconds: 0.5 });
    let d = 0;
    for (let i = 0; i < a.left.length; i++) d = Math.max(d, Math.abs(a.left[i] - b.left[i]));
    expect(d).toBe(0);
  });

  it.each(TYPES)('%s: Density changes it', (type) => {
    const a = bed({ ...base, 'texture.type': type, 'texture.density': 0 }, 0.5).left;
    const b = bed({ ...base, 'texture.type': type, 'texture.density': 1 }, 0.5).left;
    let d = 0, e = 0;
    for (let i = 0.1 * FS; i < 0.45 * FS; i++) {
      d += (a[i] - b[i]) ** 2;
      e += a[i] ** 2 + b[i] ** 2;
    }
    expect(d / e).toBeGreaterThan(0.01);
  });

  it.each(['dust', 'rumble', 'air', 'static'])('%s: an octave down is darker, an octave up brighter', (type) => {
    const centroid = (oct: number) => {
      const x = bed({ ...base, 'texture.type': type, 'texture.octave': oct, 'filter.route_n': false }, 0.5);
      const m = Float64Array.from(x.left, (v, i) => 0.5 * (v + x.right[i]));
      const sp = powerSpectrum(m, FS, Math.round(0.1 * FS), Math.round(0.45 * FS), 8192);
      let num = 0, den = 0;
      for (let f = 100; f < 16000; f *= 1.1) {
        const p = bandPower(sp, f, f * 1.1);
        num += p * f;
        den += p;
      }
      return num / den;
    };
    const down = centroid(-1), mid = centroid(0), up = centroid(1);
    expect(down).toBeLessThan(mid * 0.85);
    expect(up).toBeGreaterThan(mid * 1.1);
  });

  it.each(TYPES)('%s: the octave changes it', (type) => {
    const a = bed({ ...base, 'texture.type': type }, 0.5).left;
    const b = bed({ ...base, 'texture.type': type, 'texture.octave': -1 }, 0.5).left;
    let d = 0, e = 0;
    for (let i = 0.1 * FS; i < 0.45 * FS; i++) {
      d += (a[i] - b[i]) ** 2;
      e += a[i] ** 2 + b[i] ** 2;
    }
    expect(d / e).toBeGreaterThan(0.05);
  });

  // straight from the bed (no voice, no envelope), a few seconds of it
  const raw = (type: number, density = 0.5, seconds = 3) => {
    const t = new Texture(), o = new Float64Array(2), x = new Float64Array(seconds * FS);
    for (let i = 0; i < x.length; i++) {
      t.process(type, 0.5, density, FS, o);
      x[i] = o[0];
    }
    return x;
  };

  it('crackle is pops only: silent between them', () => {
    const x = raw(TEX_CRACKLE);
    const a = Float64Array.from(x, Math.abs).sort();
    // most of the time nothing at all (no surface hiss under the pops)
    expect(a[Math.floor(a.length * 0.5)]).toBeLessThan(a[a.length - 1] * 0.002);
  });

  it.each([['tape hiss', TEX_TAPE], ['static', TEX_STATIC]] as const)('%s has no rhythm: its level stays even at any density', (_, type) => {
    for (const d of [0, 0.5, 1]) {
      const x = raw(type, d);
      const hop = 0.05 * FS, lv: number[] = [];
      for (let i = 0; i + hop <= x.length; i += hop) {
        let e = 0;
        for (let j = i; j < i + hop; j++) e += x[j] * x[j];
        lv.push(10 * Math.log10(e / hop));
      }
      lv.sort((p, q) => p - q);
      // 50 ms frames within a few dB of each other (the old bursts and dropouts swung 10 dB and more)
      expect(lv[Math.floor(lv.length * 0.95)] - lv[Math.floor(lv.length * 0.05)]).toBeLessThan(3);
    }
  });

  it('more density: more grains on crackle, dust and static', () => {
    const count = (x: Float64Array) => {
      let n = 0, peak = 0;
      for (const v of x) peak = Math.max(peak, Math.abs(v));
      for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > 0.3 * peak && Math.abs(x[i - 1]) <= 0.3 * peak) n++;
      return n;
    };
    for (const type of [TEX_CRACKLE, TEX_DUST]) expect(count(raw(type, 1))).toBeGreaterThan(count(raw(type, 0)) * 2);
    const e = (x: Float64Array) => x.reduce((a, v) => a + v * v, 0);
    expect(e(raw(TEX_STATIC, 1))).toBeGreaterThan(e(raw(TEX_STATIC, 0)));
  });

  it('rumble is mono and stays off the sub', () => {
    const x = bed({ ...base, 'texture.type': 'rumble', 'texture.level': 1 }, 1);
    const side = Float64Array.from(x.left, (v, i) => 0.5 * (v - x.right[i]));
    const mid = Float64Array.from(x.left, (v, i) => 0.5 * (v + x.right[i]));
    expect(rms(Float32Array.from(side), 0.1 * FS, 0.45 * FS)).toBeLessThan(1e-6);
    const s = powerSpectrum(mid, FS, Math.round(0.05 * FS), Math.round(0.45 * FS), 8192);
    expect(bandPower(s, 20, 60)).toBeLessThan(bandPower(s, 120, 400) * 0.1);
  });

  it.each(HITS)('%s: one burst on each note, nothing between', (type) => {
    const p = { ...base, 'osc1.level': 0, 'sub.level': 0, 'texture.type': type, 'texture.tail': 250, 'texture.level': 1 };
    const r = renderPatch(p, heldNote(45, 4), { seconds: 1 }).left;
    const start = rms(r, 0, 0.08 * FS), late = rms(r, 0.6 * FS, 0.95 * FS);
    expect(start).toBeGreaterThan(1e-3);
    expect(late).toBeLessThan(start * 0.01);
  });

  it.each([['crackle hit', TEX_CRACKLE_HIT], ['dust hit', TEX_DUST_HIT], ['static hit', TEX_STATIC_HIT]] as const)('%s always starts with its attack, and harder notes burst bigger', (_, type) => {
    const burst = (vel: number) => {
      const t = new Texture(), o = new Float64Array(2);
      t.puffLen = 0.3;
      t.trigger(vel);
      let peak = 0;
      for (let i = 0; i < 0.01 * FS; i++) {
        t.process(type, 0.5, 0.5, FS, o);
        peak = Math.max(peak, Math.abs(o[0]));
      }
      return peak;
    };
    expect(burst(1)).toBeGreaterThan(0.01);
    expect(burst(1)).toBeGreaterThan(burst(0.2) * 1.5);
  });

  it('KEY: the noise follows the note (higher is faster, brighter); off, the note makes no difference', () => {
    const centroid = (note: number, key: boolean) => {
      const p = { ...base, 'osc1.level': 0, 'sub.level': 0, 'texture.type': 'air', 'texture.key': key, 'texture.level': 1 };
      const r = renderPatch(p, heldNote(note, 4), { seconds: 0.6 });
      const m = Float64Array.from(r.left, (v, i) => 0.5 * (v + r.right[i]));
      const sp = powerSpectrum(m, FS, Math.round(0.15 * FS), Math.round(0.55 * FS), 8192);
      let num = 0, den = 0;
      for (let f = 60; f < 16000; f *= 1.1) {
        const p2 = bandPower(sp, f, f * 1.1);
        num += p2 * f;
        den += p2;
      }
      return num / den;
    };
    expect(centroid(72, true)).toBeGreaterThan(centroid(48, true) * 1.4);
    expect(Math.abs(centroid(72, false) / centroid(48, false) - 1)).toBeLessThan(0.05);
  });

  it('the matrix\'s Noise pitch moves the noise speed (down darker, up brighter)', () => {
    const centroid = (amount: number) => {
      const p = {
        ...base, 'osc1.level': 0, 'sub.level': 0, 'texture.type': 'air', 'texture.level': 1,
        'env3.on': true, 'env3.attack': 1, 'env3.sustain': 1, 'mod1.source': 'env3', 'mod1.dest': 'noise_pitch', 'mod1.amount': amount, 'mod1.on': true,
      };
      const r = renderPatch(p, heldNote(60, 4), { seconds: 0.6 });
      const m = Float64Array.from(r.left, (v, i) => 0.5 * (v + r.right[i]));
      const sp = powerSpectrum(m, FS, Math.round(0.15 * FS), Math.round(0.55 * FS), 8192);
      let num = 0, den = 0;
      for (let f = 60; f < 16000; f *= 1.1) {
        const p2 = bandPower(sp, f, f * 1.1);
        num += p2 * f;
        den += p2;
      }
      return num / den;
    };
    const mid = centroid(0);
    expect(centroid(-0.3)).toBeLessThan(mid * 0.7);
    expect(centroid(0.15)).toBeGreaterThan(mid * 1.2);
  });

  it('every type plays at the same loudness, wherever its Tone is', () => {
    const all: number[] = [];
    for (let type = 0; type < 12; type++) {
      for (const tone of [0, 0.4, 0.85]) all.push(textureLoudness(new Texture(), type, tone, 0.5, FS));
    }
    expect(Math.max(...all) - Math.min(...all)).toBeLessThan(3);
  });

  it('old types load as their nearest: wind as air, breath as air hit, hum and machine as rumble', () => {
    expect(validatePatch({ 'texture.type': 'wind' }).patch['texture.type']).toBe('air');
    expect(validatePatch({ 'texture.type': 'breath' }).patch['texture.type']).toBe('air hit');
    expect(validatePatch({ 'texture.type': 'hum' }).patch['texture.type']).toBe('rumble');
  });

  it('an old breath goes where it leaned: an attack chiff becomes air hit, a sustained breath the air bed', () => {
    const brass = validatePatch({ 'texture.type': 'breath', 'breath.chiff': 0.35, 'breath.level': 0.12, 'breath.decay': 100 }).patch;
    expect(brass['texture.type']).toBe('air hit');
    expect(brass['texture.tail']).toBe(300);
    const choir = validatePatch({ 'texture.type': 'breath', 'breath.chiff': 0.1, 'breath.level': 0.45 }).patch;
    expect(choir['texture.type']).toBe('air');
  });

  it('crackle and air are stereo', () => {
    for (const type of ['crackle', 'air']) {
      const x = bed({ ...base, 'texture.type': type, 'texture.level': 1 }, 0.5);
      const side = Float32Array.from(x.left, (v, i) => 0.5 * (v - x.right[i]));
      expect(rms(side, 0.1 * FS, 0.45 * FS), type).toBeGreaterThan(1e-4);
    }
  });
});

describe('texture solo / mute', () => {
  const p = { ...base, 'texture.type': 'dust' };
  const render = (mode?: 'solo' | 'mute', q: object = p) =>
    renderPatch(q, heldNote(45, 1), { seconds: 0.5, monitor: mode ? { [mode]: ['texture'] } : undefined }).left;

  it('mute plays the sound without the bed', () => {
    const muted = render('mute'), none = render(undefined, { ...p, 'texture.level': 0 });
    let d = 0;
    for (let i = 0.05 * FS; i < muted.length; i++) d = Math.max(d, Math.abs(muted[i] - none[i]));
    expect(d).toBeLessThan(1e-6);
  });

  it('solo plays only the bed', () => {
    const solo = render('solo'), full = render(), none = render(undefined, { ...p, 'texture.level': 0 });
    const bedOnly = Float32Array.from(full, (v, i) => v - none[i]);
    expect(rms(solo, 0.1 * FS, 0.45 * FS)).toBeGreaterThan(1e-3);
    // Without the body the bed alone is what's left (the limiter may treat it a touch differently).
    expect(Math.abs(rms(solo, 0.1 * FS, 0.45 * FS) / rms(bedOnly, 0.1 * FS, 0.45 * FS) - 1)).toBeLessThan(0.2);
  });
});
