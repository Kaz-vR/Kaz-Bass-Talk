import { describe, expect, it } from 'vitest';
import { Envelope, envSegment } from '../src/engine/core/dsp';
import { Reverb } from '../src/engine/core/fx';
import { UndoHistory } from '../src/history/undo';
import type { Patch } from '../src/schema';

const FS = 48000;
/** Level halfway through a 100 ms attack. */
function midAttack(bend: number): number {
  const e = new Envelope();
  e.set(100, 100, 0.5, 100, FS, bend);
  e.trigger();
  let v = 0;
  for (let i = 0; i < FS * 0.05; i++) v = e.tick();
  return v;
}

describe('envelope curves', () => {
  it('a bend of 0 is a straight line, up is fast first, down is a swell', () => {
    expect(midAttack(0)).toBeCloseTo(0.5, 2);
    expect(midAttack(0.5)).toBeGreaterThan(0.8);
    expect(midAttack(-0.5)).toBeLessThan(0.2);
    expect(envSegment(0.5, 0.5)).toBeCloseTo(midAttack(0.5), 2);
  });

  it('every segment lands where it should, whatever its bend', () => {
    for (const b of [-1, -0.3, 0, 0.38, 1]) {
      const e = new Envelope();
      e.set(10, 50, 0.4, 80, FS, b, b, b);
      e.trigger();
      for (let i = 0; i < FS * 0.2; i++) e.tick();
      expect(e.level).toBeCloseTo(0.4, 5);
      e.release();
      for (let i = 0; i < FS * 0.081; i++) e.tick();
      expect(e.stage).toBe(0);
    }
  });

  it('retriggering mid-release continues from the level (no click)', () => {
    const e = new Envelope();
    e.set(200, 100, 0.8, 300, FS, 0.4);
    e.trigger();
    for (let i = 0; i < FS * 0.5; i++) e.tick();
    e.release();
    for (let i = 0; i < FS * 0.1; i++) e.tick();
    const before = e.level;
    e.trigger();
    expect(Math.abs(e.tick() - before)).toBeLessThan(0.01);
  });
});

describe('reverb', () => {
  it('each type rings out for about its decay time, stays finite and wide', () => {
    for (let type = 0; type < 4; type++) {
      const r = new Reverb(FS);
      const out = new Float64Array(2);
      let early = 0, late = 0, side = 0;
      for (let i = 0; i < FS * 3; i++) {
        r.process(i < 64 ? 1 : 0, type, 1, 10, out);
        expect(Number.isFinite(out[0])).toBe(true);
        if (i < FS * 0.3) early += out[0] ** 2;
        else if (i > FS * 1.2 && i < FS * 1.5) late += out[0] ** 2;
        side += (out[0] - out[1]) ** 2;
      }
      // 1 s decay: at ~1.3 s it is well below the start (more than 30 dB)
      expect(10 * Math.log10(late / early)).toBeLessThan(-30);
      expect(side).toBeGreaterThan(0);
    }
  });
});

describe('undo', () => {
  it('a burst of edits is one step; undo and redo walk the steps', () => {
    const h = new UndoHistory(50, 500);
    let p = { meta: { name: 'a' }, x: 0 } as unknown as Patch;
    const edit = (v: number, t: number) => { h.edit(p, t); p = { ...p, x: v }; };
    edit(1, 0); edit(2, 100); edit(3, 200); // one gesture
    edit(4, 2000); // another
    p = h.undo(p)!;
    expect(p.x).toBe(3);
    p = h.undo(p)!;
    expect(p.x).toBe(0);
    expect(h.undo(p)).toBeNull();
    p = h.redo(p)!;
    expect(p.x).toBe(3);
  });
});
