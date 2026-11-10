/**
 * The worn look, all procedural (no image files): a mottled, scratched panel surface, grain and
 * scanlines inside the light of every print, grimy white keys, and the decayed-signal edges of
 * the header picture. Each texture is generated once at startup.
 */

function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Smooth value noise on a grid of `cell` pixels, 0..1. */
function valueNoise(cell: number, r: () => number): (x: number, y: number) => number {
  const N = 64, grid = Array.from({ length: N * N }, () => r());
  const at = (i: number, j: number) => grid[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy), u = sm(fx - i), v = sm(fy - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function pixels(w: number, h: number, f: (x: number, y: number) => [number, number]): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!, img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [l, a] = f(x, y), o = (y * w + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = l;
      img.data[o + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/**
 * A box's surface (300 x 230 at 2x, stretched over each box): near-black with slow mottling, fine
 * grain, faint horizontal wear, dust specks, a few scratches, darker towards the edges and an
 * uneven, slightly lit rim.
 */
export function panelTexture(w = 600, h = 460, seed = 5): string {
  // lifted charcoal (owner's reference): a bit less dark than black so the boxes read, with heavier wear:
  // broad stains, mottling, grain, horizontal wear, specks and scratches, darker towards the edges
  const r = rng(seed);
  const m1 = valueNoise(70, r), m2 = valueNoise(18, r), row = valueNoise(3, r), rim = valueNoise(9, r), stain = valueNoise(150, r), pit = valueNoise(5, r);
  const cv = pixels(w, h, (x, y) => {
    const e = Math.min(x, y, w - 1 - x, h - 1 - y);
    let l = 20 + (m1(x, y) - 0.5) * 12 + (m2(x, y) - 0.5) * 6 + (r() - 0.5) * 10 + (row(0, y) - 0.5) * 2.5;
    // broad worn patches: lighter scuffed areas and darker grime
    const st = stain(x, y);
    l += st > 0.62 ? (st - 0.62) * 26 : st < 0.3 ? (st - 0.3) * 18 : 0;
    // fine pitting in the surface
    if (pit(x, y) > 0.82) l -= 4;
    l -= 10 * Math.exp(-e / 30);
    if (e < 2.5 && rim(x, y) > 0.3) l += 24 * (1 - e / 2.5);
    return [Math.max(0, l), 255];
  });
  const g = cv.getContext('2d')!;
  const area = (w * h) / (600 * 460);
  for (let i = 0; i < 700 * area; i++) {
    const x = r() * w, y = r() * h, light = r() < 0.65;
    g.fillStyle = light ? `rgba(225,225,228,${0.08 + r() * r() * 0.5})` : `rgba(0,0,0,${0.4 + r() * 0.45})`;
    g.fillRect(x, y, 1 + (r() < 0.15 ? 1 : 0), 1 + (r() < 0.15 ? 1 : 0));
  }
  for (let i = 0; i < 46 * area; i++) {
    const x = r() * w, y = r() * h, ang = (r() - 0.5) * 0.5 + (r() < 0.3 ? Math.PI / 2 : 0), len = 8 + r() * r() * 110;
    g.strokeStyle = r() < 0.75 ? `rgba(220,220,225,${0.03 + r() * 0.08})` : `rgba(0,0,0,${0.2 + r() * 0.25})`;
    g.lineWidth = 0.6 + r() * 0.7;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }
  return cv.toDataURL();
}

/**
 * Laid over the prints with multiply: almost white, so it only shows where there is light. Grain
 * plus slightly uneven rows, like a photographed phosphor trace.
 */
export function lightGrain(): string {
  const s = 192, r = rng(9), rows = Array.from({ length: s }, () => 0.9 + r() * 0.1);
  return pixels(s, s, (_x, y) => [255 * rows[y] * (0.72 + 0.28 * r()), 255]).toDataURL();
}

/** Grime for the white keys (multiply): blotches, grain and darker dust, mostly near the front. */
export function keyGrime(): string {
  const w = 160, h = 520, r = rng(13), m = valueNoise(9, r), m2 = valueNoise(3, r);
  const cv = pixels(w, h, (x, y) => {
    const front = y / h;
    const v = 1 - 0.045 * m(x, y) - 0.03 * m2(x, y) - 0.04 * r() - 0.04 * front * m(x + 99, y);
    return [255 * v, 255];
  });
  const g = cv.getContext('2d')!;
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(60,58,54,${0.15 + r() * 0.35})`;
    g.fillRect(r() * w, r() * h, 1, 1);
  }
  return cv.toDataURL();
}

/**
 * The header picture as a decaying signal: scanlines, rows torn sideways, horizontal smear streaks
 * gathered at the sides and the bottom, and a bottom edge that dissolves into the panel.
 */
export function decaySignal(cv: HTMLCanvasElement, seed = 3): void {
  const g = cv.getContext('2d')!, W = cv.width, H = cv.height, r = rng(seed);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  // black and white
  const img = g.getImageData(0, 0, W, H), p = img.data;
  for (let i = 0; i < p.length; i += 4) p[i] = p[i + 1] = p[i + 2] = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11;
  g.putImageData(img, 0, 0);
  // torn rows: a band copied sideways, more often at the sides and towards the bottom
  for (let i = 0; i < 34; i++) {
    const y = Math.floor(H * Math.pow(r(), 0.6)), hh = Math.max(2, Math.floor(r() * r() * H * 0.05));
    const side = r() < 0.5, x0 = side ? 0 : Math.floor(W * (0.55 + r() * 0.2)), ww = Math.floor(W * (0.2 + r() * 0.3));
    g.globalAlpha = 0.5 + r() * 0.5;
    g.drawImage(cv, x0, y, ww, hh, x0 + (r() - 0.5) * W * 0.06, y, ww, hh);
  }
  g.globalAlpha = 1;
  // smear streaks: thin bright dashes, densest in the corners
  for (let i = 0; i < 520; i++) {
    const y = H * (0.25 + 0.75 * Math.pow(r(), 0.7)), xr = r(), x = (xr < 0.5 ? Math.pow(xr * 2, 1.6) * 0.42 : 1 - Math.pow((1 - xr) * 2, 1.6) * 0.42) * W;
    g.fillStyle = `rgba(230,230,230,${0.04 + r() * r() * 0.32})`;
    g.fillRect(x, y, (4 + r() * r() * 90) * (W / 1200), Math.max(1, (r() < 0.8 ? 1 : 2) * (W / 1200)));
  }
  // scanlines
  g.fillStyle = 'rgba(0,0,0,0.28)';
  const step = Math.max(2, Math.round(W / 1200) * 2);
  for (let y = 0; y < H; y += step) g.fillRect(0, y, W, step / 2);
  // the bottom dissolves
  const fade = g.createLinearGradient(0, H * 0.72, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,0.92)');
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  g.restore();
}
