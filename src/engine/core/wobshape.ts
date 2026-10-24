/**
 * The Wobbler's shapes. A shape is up to 12 points (time 0..1, level 0..1), each hard or soft,
 * as in ShaperBox: a hard point sits on the line (a corner); a soft point is not on the line but
 * pulls it towards itself, rounding the shape (a quadratic curve from halfway to its neighbours,
 * or from the neighbour itself when that one is hard). The first and last points are always on
 * the line. Shared by the engine and the page, so what you see is what you hear.
 */

export interface WobPoint {
  x: number;
  y: number;
  s: boolean;
}

const pt = (x: number, y: number, s = false): WobPoint => ({ x, y, s });

/** The palette's shapes as points (Random has none: it draws new steps every cycle). */
export const WOB_TEMPLATES: Record<string, WobPoint[]> = {
  // a smooth bell from the bottom to the top and back
  sine: [pt(0, 0), pt(0.2, 0, true), pt(0.3, 1, true), pt(0.7, 1, true), pt(0.8, 0, true), pt(1, 0)],
  // ducked on the beat, curving quickly back up and holding
  duck: [pt(0, 0), pt(0.04, 0.85, true), pt(0.35, 1), pt(1, 1)],
  // opens hard and falls (the last bit rises back so the wrap doesn't click)
  'saw down': [pt(0, 1), pt(0.95, 0), pt(1, 1)],
  // open for half the cycle, shut for the other half
  square: [pt(0, 1), pt(0.49, 1), pt(0.51, 0), pt(0.99, 0), pt(1, 1)],
  // a 3-3-2 rhythm in sixteenths: hits on 1, the "and" of 2 and 4
  'sync gate': [pt(0, 1), pt(0.24, 1), pt(0.25, 0), pt(0.365, 0), pt(0.375, 1), pt(0.615, 1), pt(0.625, 0), pt(0.74, 0), pt(0.75, 1), pt(0.93, 1), pt(0.94, 0), pt(1, 0)],
  // four steps up
  staircase: [pt(0, 0), pt(0.245, 0), pt(0.25, 0.333), pt(0.495, 0.333), pt(0.5, 0.667), pt(0.745, 0.667), pt(0.75, 1), pt(1, 1)],
};

/** How many steps Random draws per cycle. */
export const WOB_RANDOM_STEPS = 8;

/** Value of a quadratic Bezier (a, c, b) at the t where its x equals px (x is monotonic). */
function quadAt(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, px: number): number {
  // x(t) = (1-t)^2 ax + 2t(1-t) cx + t^2 bx  →  solve for t
  const A = ax - 2 * cx + bx, B = 2 * (cx - ax), C = ax - px;
  let t: number;
  if (Math.abs(A) < 1e-9) t = Math.abs(B) < 1e-12 ? 0 : -C / B;
  else {
    const d = Math.max(0, B * B - 4 * A * C), r = Math.sqrt(d);
    const t1 = (-B + r) / (2 * A), t2 = (-B - r) / (2 * A);
    t = t1 >= -1e-9 && t1 <= 1 + 1e-9 ? t1 : t2;
  }
  t = Math.min(1, Math.max(0, t));
  const u = 1 - t;
  return u * u * ay + 2 * t * u * cy + t * t * by;
}

/**
 * The shape's level (0..1) at phase p (0..1). xs / ys / soft hold n points, sorted by x, the first
 * at 0 and the last at 1.
 */
export function wobShapeAt(xs: ArrayLike<number>, ys: ArrayLike<number>, soft: ArrayLike<number | boolean>, n: number, p: number): number {
  if (n < 2) return ys[0] ?? 0;
  // Walk the path piece by piece: lines between hard points, a curve around each soft point.
  let cx = xs[0], cy = ys[0];
  for (let i = 1; i < n; i++) {
    const isSoft = !!soft[i] && i < n - 1;
    if (!isSoft) {
      // a line from where we are to this point (unless a curve already ended here)
      const x1 = xs[i], y1 = ys[i];
      if (p <= x1 || i === n - 1) {
        const w = x1 - cx;
        const v = w <= 1e-9 ? y1 : cy + ((Math.min(Math.max(p, cx), x1) - cx) / w) * (y1 - cy);
        return Math.min(1, Math.max(0, v));
      }
      cx = x1;
      cy = y1;
      continue;
    }
    // a curve from here to halfway to the next point (or to the next point when that one is hard)
    const nextSoft = !!soft[i + 1] && i + 1 < n - 1;
    const ex = nextSoft ? (xs[i] + xs[i + 1]) / 2 : xs[i + 1], ey = nextSoft ? (ys[i] + ys[i + 1]) / 2 : ys[i + 1];
    if (p <= ex) return Math.min(1, Math.max(0, quadAt(cx, cy, xs[i], ys[i], ex, ey, Math.max(p, cx))));
    cx = ex;
    cy = ey;
    if (!nextSoft) i++; // the curve already reached the next (hard) point
  }
  return ys[n - 1];
}

/** wobShapeAt for a list of points. */
export function wobPointsAt(pts: readonly WobPoint[], p: number): number {
  return wobShapeAt(pts.map((q) => q.x), pts.map((q) => q.y), pts.map((q) => q.s), pts.length, p);
}

/** Points in a smoothed shape's table (one cycle). */
export const WOB_TABLE = 256;

/** Smooth's window (half-width in table points): 0 = off; at 1 the averaging spans a quarter cycle. */
export function wobSmoothRadius(sm: number): number {
  return Math.round(Math.max(0, Math.min(1, sm)) * (WOB_TABLE / 16));
}

/**
 * Smooth, as in ShaperBox: the shape's corners rounded where they are (not delayed like a glide).
 * One cycle of `f` is sampled into `out` (WOB_TABLE points), then averaged twice over a window of
 * 2r + 1 points that wraps around the cycle (a triangle, so the curve stays smooth). Shared by the
 * engine and the page, so the line you see is the one you hear. `tmp` is scratch of the same size.
 */
export function wobSmoothTable(f: (p: number) => number, r: number, out: Float64Array, tmp: Float64Array): void {
  const N = out.length;
  for (let i = 0; i < N; i++) out[i] = f(i / N);
  if (r < 1) return;
  const w = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += out[(k + N) % N];
    for (let i = 0; i < N; i++) {
      tmp[i] = acc / w;
      acc += out[(i + r + 1) % N] - out[(i - r + N) % N];
    }
    out.set(tmp);
  }
}

/** A smoothed table's value at phase p (0..1), interpolated, wrapping around the cycle. */
export function wobTableAt(t: ArrayLike<number>, p: number): number {
  const N = t.length, f = (p - Math.floor(p)) * N, i = Math.floor(f) % N, u = f - Math.floor(f);
  return t[i] + (t[(i + 1) % N] - t[i]) * u;
}
