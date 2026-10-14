// Texture bed: crackle, dust, rumble, air. Follows the notes with its own
// tail, stays silent between notes, keeps off the sub, and leaves the rest of
// the patch untouched.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { bandPower, powerSpectrum } from '../src/analysis/spectrum';
import { heldNote, rms } from './helpers/audio';

const FS = 48000;
const base = {
  meta: { name: 't' }, 'voice.analog': 0, 'sub.level': 0.5, 'filter.cutoff': 800, 'amp_env.attack': 1, 'amp_env.sustain': 1, 'amp_env.release': 30,
  'osc1.wave': 'saw', 'osc1.level': 0.7, 'texture.level': 0.8, 'texture.tail': 300,
};
const TYPES = ['crackle', 'dust', 'rumble', 'air'];
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
    const x = bed({ ...base, 'texture.type': type, 'texture.tail': 400 }, 0.95);
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

  it('rumble is mono and stays off the sub', () => {
    const x = bed({ ...base, 'texture.type': 'rumble', 'texture.level': 1 }, 1);
    const side = Float64Array.from(x.left, (v, i) => 0.5 * (v - x.right[i]));
    const mid = Float64Array.from(x.left, (v, i) => 0.5 * (v + x.right[i]));
    expect(rms(Float32Array.from(side), 0.1 * FS, 0.45 * FS)).toBeLessThan(1e-6);
    const s = powerSpectrum(mid, FS, Math.round(0.05 * FS), Math.round(0.45 * FS), 8192);
    expect(bandPower(s, 20, 60)).toBeLessThan(bandPower(s, 120, 400) * 0.1);
  });

  it('crackle and air are stereo', () => {
    for (const type of ['crackle', 'air']) {
      const x = bed({ ...base, 'texture.type': type, 'texture.level': 1 }, 0.5);
      const side = Float32Array.from(x.left, (v, i) => 0.5 * (v - x.right[i]));
      expect(rms(side, 0.1 * FS, 0.45 * FS), type).toBeGreaterThan(1e-4);
    }
  });
});

describe('pump rate and texture position', () => {
  // 120 BPM: one beat = 0.5 s. The pump ducks at the start of each cycle and swells back.
  const pumped = { ...base, 'texture.type': 'air', 'comp.pump': 1, 'comp.amount': 0 };
  /** Level just after beat 2 starts, relative to just before it. */
  const dipAtBeat2 = (x: Float32Array) => rms(x, 0.505 * FS, 0.535 * FS) / rms(x, 0.44 * FS, 0.47 * FS);

  it('1/4 ducks on every beat, 1/2 only every other beat', () => {
    const voice = (rate: string) => renderPatch({ ...pumped, 'texture.level': 0, 'comp.pump_rate': rate }, heldNote(45, 8), { seconds: 1.2 }).left;
    expect(dipAtBeat2(voice('1/4'))).toBeLessThan(0.5);
    expect(dipAtBeat2(voice('1/2'))).toBeGreaterThan(0.8);
  });

  it('a bed before dynamics pumps with the sound; after dynamics it stays steady', () => {
    const at = (position: string) => {
      const p = { ...pumped, 'texture.position': position };
      const a = renderPatch(p, heldNote(45, 8), { seconds: 1.2 }).left;
      const b = renderPatch({ ...p, 'texture.level': 0 }, heldNote(45, 8), { seconds: 1.2 }).left;
      return dipAtBeat2(Float32Array.from(a, (v, i) => v - b[i]));
    };
    expect(at('before dynamics')).toBeLessThan(0.5);
    expect(at('after dynamics')).toBeGreaterThan(0.7);
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
