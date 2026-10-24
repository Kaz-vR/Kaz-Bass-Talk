import { describe, expect, it } from 'vitest';
import { WOB_TEMPLATES, wobPointsAt, wobShapeAt } from '../src/engine/core/wobshape';

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
