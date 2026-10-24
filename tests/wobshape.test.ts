import { describe, expect, it } from 'vitest';
import { WOB_TABLE, WOB_TEMPLATES, wobPointsAt, wobShapeAt, wobSmoothRadius, wobSmoothTable, wobTableAt } from '../src/engine/core/wobshape';
import { getParam } from '../src/schema';
import { WOB_SHAPES, WOBBLE_BEATS, wobRateBeats } from '../src/engine/core/params';

describe('wobbler shapes', () => {
  const xs = [0, 0.5, 1], ys = [0, 1, 0];
  it('hard points sit on the line, joined by straight lines', () => {
    expect(wobShapeAt(xs, ys, [0, 0, 0], 3, 0.25)).toBeCloseTo(0.5, 6);
    expect(wobShapeAt(xs, ys, [0, 0, 0], 3, 0.5)).toBeCloseTo(1, 6);
  });
  it('a soft point pulls the line towards itself without the line reaching it (as in ShaperBox)', () => {
    const peak = wobShapeAt(xs, ys, [0, 1, 0], 3, 0.5);
    expect(peak).toBeCloseTo(0.5, 6);
    // a smooth curve: rising, no corner
    expect(wobShapeAt(xs, ys, [0, 1, 0], 3, 0.25)).toBeGreaterThan(0.3);
    expect(wobShapeAt(xs, ys, [0, 1, 0], 3, 0.25)).toBeLessThan(0.5);
  });
  it('the first and last points stay on the line even when marked soft', () => {
    expect(wobShapeAt(xs, ys, [1, 0, 1], 3, 0)).toBeCloseTo(0, 6);
    expect(wobShapeAt(xs, ys, [1, 0, 1], 3, 1)).toBeCloseTo(0, 6);
  });
  it('every preset shape stays in 0..1 and is continuous enough to never click', () => {
    for (const [name, pts] of Object.entries(WOB_TEMPLATES)) {
      let prev = wobPointsAt(pts, 0);
      for (let i = 1; i <= 4000; i++) {
        const v = wobPointsAt(pts, i / 4000);
        expect(v, name).toBeGreaterThanOrEqual(0);
        expect(v, name).toBeLessThanOrEqual(1);
        prev = v;
      }
      expect(prev, name).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('wobble rates and shapes', () => {
  it('reads every rate as beats, shortest first', () => {
    const opts = getParam('wobble.rate')!.options!;
    expect(WOBBLE_BEATS.length).toBe(opts.length);
    for (let i = 1; i < WOBBLE_BEATS.length; i++) expect(WOBBLE_BEATS[i]).toBeGreaterThan(WOBBLE_BEATS[i - 1]);
    expect(wobRateBeats('1/8')).toBe(0.5);
    expect(wobRateBeats('1/8T')).toBeCloseTo(1 / 3);
    expect(wobRateBeats('1/8d')).toBe(0.75);
    expect(wobRateBeats('1 Bar')).toBe(4);
    expect(wobRateBeats('1.5 Bars')).toBe(6);
    expect(wobRateBeats('32 Bars')).toBe(128);
  });

  it('saw down is the first shape and the default; the engine reads shapes in schema order', () => {
    const p = getParam('wobble.shape')!;
    expect(p.default).toBe('saw down');
    expect(p.options).toEqual(WOB_SHAPES);
  });
});

describe('smooth', () => {
  const square = (p: number) => wobPointsAt(WOB_TEMPLATES.square, p);
  const table = (r: number) => {
    const t = new Float64Array(WOB_TABLE);
    wobSmoothTable(square, r, t, new Float64Array(WOB_TABLE));
    return t;
  };
  it('rounds the corners where they are, without delaying the shape', () => {
    const t = table(wobSmoothRadius(1));
    // the edge stays at the middle of the cycle: halfway down exactly there
    expect(wobTableAt(t, 0.5)).toBeCloseTo(0.5, 1);
    // the middle of each half still reaches the top and the bottom
    expect(wobTableAt(t, 0.25)).toBeGreaterThan(0.95);
    expect(wobTableAt(t, 0.75)).toBeLessThan(0.05);
    // and the corners are rounded: just before the edge it has started to fall
    expect(wobTableAt(t, 0.46)).toBeLessThan(0.9);
  });
  it('is off at 0', () => {
    expect(wobSmoothRadius(0)).toBe(0);
    const t = table(0);
    expect(wobTableAt(t, 0.46)).toBeCloseTo(1, 6);
  });
});
