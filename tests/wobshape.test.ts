import { describe, expect, it } from 'vitest';
import { wobShapeAt } from '../src/engine/core/wobshape';

describe('custom wobble shape', () => {
  const xs = [0, 0.5, 1], ys = [0, 1, 0];
  it('hard corners give straight lines', () => {
    expect(wobShapeAt(xs, ys, [0, 0, 0], 3, 0.25)).toBeCloseTo(0.5, 6);
    expect(wobShapeAt(xs, ys, [0, 0, 0], 3, 0.75)).toBeCloseTo(0.5, 6);
  });
  it('soft corners round the line (flat at the points, S-shaped between)', () => {
    expect(wobShapeAt(xs, ys, [1, 1, 1], 3, 0.25)).toBeCloseTo(0.5, 6);
    expect(wobShapeAt(xs, ys, [1, 1, 1], 3, 0.05)).toBeLessThan(0.1);
    expect(wobShapeAt(xs, ys, [1, 1, 1], 3, 0.45)).toBeGreaterThan(0.9);
  });
  it('passes through every point and stays in 0..1', () => {
    const x = [0, 0.2, 0.3, 0.9, 1], y = [0.5, 1, 0, 0.8, 0.5], s = [1, 0, 1, 0, 1];
    for (let i = 0; i < 5; i++) expect(wobShapeAt(x, y, s, 5, x[i])).toBeCloseTo(y[i], 6);
    for (let p = 0; p <= 1; p += 0.01) {
      const v = wobShapeAt(x, y, s, 5, p);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
