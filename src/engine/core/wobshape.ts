/**
 * The custom wobble shape: up to 12 points (time 0..1, level 0..1), each with a soft or hard
 * corner. Between two points the line is a cubic Hermite: a hard corner keeps the straight line's
 * slope, a soft one flattens it to zero, so two hard ends give a straight line and two soft ends an
 * S-curve. Shared by the engine and the LFO page so what you see is what you hear.
 */
export function wobShapeAt(xs: ArrayLike<number>, ys: ArrayLike<number>, soft: ArrayLike<number | boolean>, n: number, p: number): number {
  if (n < 2) return ys[0] ?? 0;
  if (p <= xs[0]) return ys[0];
  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    if (p > x1 && i < n - 2) continue;
    const w = x1 - x0;
    if (w <= 1e-6) return ys[i + 1];
    const t = Math.min(1, Math.max(0, (p - x0) / w)), y0 = ys[i], y1 = ys[i + 1], dy = y1 - y0;
    const m0 = soft[i] ? 0 : dy, m1 = soft[i + 1] ? 0 : dy;
    const t2 = t * t, t3 = t2 * t;
    const v = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
    return Math.min(1, Math.max(0, v));
  }
  return ys[n - 1];
}
