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
  // owner's reference: near-black in the middle, a worn lighter bevel round the edge, quiet mottling and wear
  const r = rng(seed);
  const m1 = valueNoise(70, r), m2 = valueNoise(18, r), row = valueNoise(3, r), rim = valueNoise(9, r), wear = valueNoise(4, r);
  const cv = pixels(w, h, (x, y) => {
    const e = Math.min(x, y, w - 1 - x, h - 1 - y);
    let l = 15.5 + (m1(x, y) - 0.5) * 10 + (m2(x, y) - 0.5) * 5 + (r() - 0.5) * 7 + (row(0, y) - 0.5) * 1.5;
    // the bevel: a lighter, chipped band a few pixels in from the edge, then a soft dark falloff inside it
    if (e < 7) l += (7 - e) * 3.6 * (0.4 + 0.6 * rim(x, y)) * (wear(x, y) > 0.25 ? 1 : 0.3);
    else l -= 3 * Math.exp(-(e - 7) / 30);
    if (e < 1.5) l += 10 * rim(x + 50, y);
    return [Math.max(0, l), 255];
  });
  const g = cv.getContext('2d')!;
  const area = (w * h) / (600 * 460);
  for (let i = 0; i < 320 * area; i++) {
    const x = r() * w, y = r() * h, light = r() < 0.7;
    g.fillStyle = light ? `rgba(225,225,228,${0.06 + r() * r() * 0.4})` : `rgba(0,0,0,${0.4 + r() * 0.4})`;
    g.fillRect(x, y, 1 + (r() < 0.15 ? 1 : 0), 1 + (r() < 0.15 ? 1 : 0));
  }
  for (let i = 0; i < 20 * area; i++) {
    const x = r() * w, y = r() * h, ang = (r() - 0.5) * 0.5 + (r() < 0.3 ? Math.PI / 2 : 0), len = 8 + r() * r() * 70;
    g.strokeStyle = `rgba(220,220,225,${0.025 + r() * 0.05})`;
    g.lineWidth = 0.6 + r() * 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }
  return cv.toDataURL();
}

/**
 * The frame behind the boxes (owner's reference): scuffed, scratched dark metal, lighter than the boxes'
 * middles, with worn patches, grime, pitting, specks and many fine scratches, faintly warm. Tiled.
 */
export function frameTexture(s = 512, seed = 21): string {
  const r = rng(seed);
  const big = valueNoise(120, r), mid = valueNoise(30, r), fine = valueNoise(6, r), pit = valueNoise(3, r);
  const cv = pixels(s, s, (x, y) => {
    let l = 17 + (big(x, y) - 0.5) * 14 + (mid(x, y) - 0.5) * 10 + (fine(x, y) - 0.5) * 6 + (r() - 0.5) * 10;
    const b = big(x + 300, y + 100);
    if (b > 0.62) l += (b - 0.62) * 90 * mid(x + 40, y);
    if (b < 0.25) l -= (0.25 - b) * 30;
    if (pit(x, y) > 0.8) l -= 5;
    return [Math.max(0, l), 255];
  });
  const g = cv.getContext('2d')!;
  for (let i = 0; i < 1400; i++) {
    const light = r() < 0.6;
    g.fillStyle = light ? `rgba(230,226,220,${0.05 + r() * r() * 0.45})` : `rgba(0,0,0,${0.35 + r() * 0.45})`;
    g.fillRect(r() * s, r() * s, 1 + (r() < 0.2 ? 1 : 0), 1 + (r() < 0.2 ? 1 : 0));
  }
  for (let i = 0; i < 240; i++) {
    const x = r() * s, y = r() * s, ang = r() * Math.PI, len = 6 + r() * r() * 140;
    g.strokeStyle = r() < 0.7 ? `rgba(225,222,216,${0.03 + r() * 0.11})` : `rgba(0,0,0,${0.25 + r() * 0.3})`;
    g.lineWidth = 0.5 + r() * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }
  // a faint warm cast, like aged metal
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgb(255,246,236)';
  g.fillRect(0, 0, s, s);
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

/** Colour pixels: `f` returns [r, g, b, a] (0-255) for each pixel. */
function rgba(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!, img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = f(x, y), o = (y * w + x) * 4;
      img.data[o] = p[0]; img.data[o + 1] = p[1]; img.data[o + 2] = p[2]; img.data[o + 3] = p[3];
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/** A crack: a jagged dark line with a faint lit edge. */
function crack(g: CanvasRenderingContext2D, r: () => number, x: number, y: number, len: number, ang: number, a = 0.8): void {
  const pts: [number, number][] = [[x, y]];
  for (let i = 0; i < 8; i++) {
    ang += (r() - 0.5) * 0.9;
    x += Math.cos(ang) * (len / 8);
    y += Math.sin(ang) * (len / 8);
    pts.push([x, y]);
  }
  for (const [col, wd, dy] of [[`rgba(200,190,175,${0.12 * a})`, 1, 1], [`rgba(0,0,0,${a})`, 1.2, 0]] as const) {
    g.strokeStyle = col;
    g.lineWidth = wd;
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px, py + dy) : g.moveTo(px, py + dy)));
    g.stroke();
  }
}

/**
 * The header's corroded plate (owner's reference): dark paint flaking off to grey-brown metal and rust round
 * the logo and the name, cracks and specks, fading out into the black bar towards the right.
 */
export function corrosionTexture(w = 1100, h = 156, seed = 31): string {
  const r = rng(seed), big = valueNoise(26, r), mid = valueNoise(8, r), fine = valueNoise(3, r), edge = valueNoise(22, r);
  const cv = rgba(w, h, (x, y) => {
    const f = 0.55 * big(x, y) + 0.3 * mid(x, y) + 0.15 * fine(x, y);
    // how far the paint has gone: most at the left, none past ~60 % (a noisy edge)
    const t = x / w, fade = Math.max(0, Math.min(1, (0.62 - t + (edge(x, y) - 0.5) * 0.25) / 0.22));
    const g0 = (r() - 0.5) * 14;
    if (f > 0.58 - 0.08 * fade && fade > 0) {
      // exposed metal: grey-brown, rust where it is deepest, a dark rim at the flake's edge
      const deep = Math.min(1, (f - 0.5) * 4), rim = f < 0.61 - 0.08 * fade ? 0.4 : 1;
      const lr = (34 + 26 * deep + g0) * rim, lg = (31 + 16 * deep + g0) * rim, lb = (28 + 6 * deep + g0) * rim;
      return [lr, lg, lb, 255 * fade];
    }
    // the paint: near black, worn and grainy
    const l = 9 + (mid(x + 50, y) - 0.5) * 8 + g0 * 0.5;
    return [l, l, l, 255 * Math.min(1, fade * 1.3)];
  });
  const g = cv.getContext('2d')!;
  for (let i = 0; i < 40; i++) {
    const x = r() * w * 0.55, y = r() * h;
    crack(g, r, x, y, 20 + r() * 90, r() * Math.PI * 2, 0.5 + r() * 0.4);
  }
  for (let i = 0; i < 900; i++) {
    const x = Math.pow(r(), 1.6) * w * 0.6, y = r() * h, light = r() < 0.55;
    g.fillStyle = light ? `rgba(215,200,180,${0.08 + r() * r() * 0.5})` : `rgba(0,0,0,${0.4 + r() * 0.5})`;
    g.fillRect(x, y, 1 + (r() < 0.25 ? 1 : 0), 1 + (r() < 0.25 ? 1 : 0));
  }
  return cv.toDataURL();
}

/** Wear over the logo: dark specks and chips, transparent elsewhere (laid on top of the mark). */
export function logoWear(s = 128, seed = 41): string {
  const r = rng(seed), m = valueNoise(10, r);
  const cv = rgba(s, s, (x, y) => (m(x, y) > 0.72 ? [10, 9, 8, 150] : [0, 0, 0, 0]));
  const g = cv.getContext('2d')!;
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(8,7,6,${0.3 + r() * 0.6})`;
    g.fillRect(r() * s, r() * s, 1 + (r() < 0.3 ? 1 : 0), 1);
  }
  return cv.toDataURL();
}

/**
 * The wooden sides, all code, with the reference's own damage in the reference's own places (owner's call):
 * dark red-brown weathered boards with vertical grain and pits; pale paint flakes lifting (lit top edge, dark
 * rim) clustered at the top and in streaks; round nail heads; a pale flaked patch low on the left; one long
 * thin scratch across the right. Places are in the reference's units (a 66 x 711 board), stretched to fit.
 */
type Blob = [number, number, number, number, number]; // x, y, radius x, radius y, strength
const WOOD_DAMAGE: Record<'l' | 'r', { flakes: Blob[]; nails: [number, number, number][]; scratches: [number, number, number, number][] }> = {
  l: {
    flakes: [[20, 22, 28, 34, 1], [50, 160, 16, 130, 0.85], [46, 340, 14, 80, 0.6], [50, 540, 16, 44, 0.8], [46, 650, 18, 52, 1.1], [20, 692, 20, 22, 0.6]],
    nails: [[37, 610, 5.5]],
    scratches: [],
  },
  r: {
    flakes: [[20, 30, 28, 42, 1], [46, 80, 14, 32, 0.7], [20, 220, 18, 115, 0.95], [30, 420, 16, 64, 0.6], [26, 600, 22, 95, 0.9], [50, 560, 12, 42, 0.5]],
    nails: [[24, 40, 5], [4, 133, 3.5], [34, 513, 7.5], [10, 470, 3.5], [43, 667, 4]],
    scratches: [[-4, 278, 70, 342]],
  },
};
/** Smooth noise without a visible grid: several octaves, each rotated and offset, quintic-faded. */
function fbmNoise(r: () => number, oct: number): (x: number, y: number) => number {
  const N = 256, tab = Array.from({ length: N * N }, () => r());
  const at = (i: number, j: number) => tab[(j & (N - 1)) * N + (i & (N - 1))];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const base = (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y), u = fade(x - i), v = fade(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const rot = Array.from({ length: oct }, (_, k) => { const a = 0.6 + k * 1.1; return [Math.cos(a), Math.sin(a), r() * 97, r() * 97]; });
  return (x, y) => {
    let s = 0, amp = 0.5, f = 1, n = 0;
    for (let k = 0; k < oct; k++) {
      const [c, sn, ox, oy] = rot[k];
      s += amp * base((x * c - y * sn) * f + ox, (x * sn + y * c) * f + oy);
      n += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return s / n;
  };
}

export function woodTexture(side: 'l' | 'r' = 'l', w = 134, h = 1422, seed = 61): string {
  const r = rng(seed + (side === 'r' ? 7 : 0));
  const sx = w / 66, sy = h / 711, D = WOOD_DAMAGE[side];
  const warp = fbmNoise(r, 3), grainN = fbmNoise(r, 4), mottle = fbmNoise(r, 4), crustN = fbmNoise(r, 5), flakeN = fbmNoise(r, 5), tone = fbmNoise(r, 3), pitN = fbmNoise(r, 3);
  // how damaged each place is: the reference's areas, their edges made ragged by noise
  const amount = (x: number, y: number) => {
    let a = 0;
    for (const [bx, by, rx, ry, k] of D.flakes) {
      const dx = (x / sx - bx) / rx, dy = (y / sy - by) / ry;
      a += k * (side === 'r' ? 1.3 : 1) * Math.exp(-(dx * dx + dy * dy) * 1.4);
    }
    return Math.min(1.2, a * (0.55 + 0.9 * warp(x * 0.05, y * 0.02)));
  };
  // the fields, in pixels; everything is stretched along the board like real weathering
  const H = new Float32Array(w * h), MAT = new Float32Array(w * h), TONE = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // domain warp: the grain wanders a little instead of running in straight lines
      const wx = x + 6 * (warp(x * 0.02, y * 0.004) - 0.5), wy = y + 30 * (warp(x * 0.03 + 9, y * 0.006) - 0.5);
      const grain = grainN(wx * 0.22, wy * 0.008);
      const am = amount(x, y);
      // paint lost where the damage is: a warped, grain-stretched field, thresholded into flakes
      const fl = flakeN(wx * 0.18, wy * 0.05) + 0.32 * Math.min(1, am) - 0.28;
      const lost = fl > 0.5 ? 1 : 0;
      const crust = crustN(x * 0.35, y * 0.2);
      let hgt = 0.35 * grain + (lost ? -0.3 + 0.6 * crust : (crust - 0.5) * (0.03 + 0.6 * Math.min(1, am)));
      // the paint's edge curls up a little round a flake
      if (!lost && fl > 0.47) hgt += (fl - 0.47) * 5;
      // pits: clustered, not sprinkled
      const pt = pitN(x * 0.3, y * 0.12);
      if (pt > 0.74 + 0.1 * (1 - Math.min(1, am))) hgt -= (pt - 0.74) * 2.2;
      H[i] = hgt;
      MAT[i] = lost;
      TONE[i] = 0.45 * mottle(wx * 0.04, wy * 0.012) + 0.25 * tone(x * 0.12, y * 0.06) + 0.3 * grainN(wx * 0.3 + 50, wy * 0.004);
    }
  }
  // nail heads: domes in the height field (a dished rim where they sink into the wood)
  const NAIL = new Float32Array(w * h);
  for (const [nx, ny, nr] of D.nails) {
    const cx = nx * sx, cy = ny * sy, rad = nr * sx;
    for (let y = Math.max(0, Math.floor(cy - rad * 2)); y < Math.min(h, cy + rad * 2); y++) {
      for (let x = Math.max(0, Math.floor(cx - rad * 2)); x < Math.min(w, cx + rad * 2); x++) {
        const d = Math.hypot(x - cx, y - cy) / rad, i = y * w + x;
        const rough = crustN(x * 0.6 + 40, y * 0.6) - 0.5;
        if (d < 1 + 0.2 * rough) { H[i] += 0.9 * Math.sqrt(Math.max(0, 1 - d * d)) + 0.9 * rough; NAIL[i] = 1; }
        else if (d < 1.6) H[i] -= 0.35 * (1.6 - d);
      }
    }
  }
  // light it from the top left, like the rest of the page, and colour it
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!, img = g.createImageData(w, h);
  const L = [-0.5, -0.7, 0.5], Ln = Math.hypot(L[0], L[1], L[2]);
  const hAt = (x: number, y: number) => H[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * 2.2, dy = (hAt(x, y + 1) - hAt(x, y - 1)) * 2.2;
      const nl = Math.hypot(dx, dy, 1), dot = (-dx * L[0] - dy * L[1] + L[2]) / (nl * Ln);
      const am2 = Math.min(1, amount(x, y)), shade = 0.66 + (0.42 + 0.3 * am2) * dot;
      const t = TONE[i];
      let R: number, G: number, B: number;
      if (NAIL[i]) { R = 42 + 34 * t; G = 19 + 13 * t; B = 12 + 7 * t; }
      else if (MAT[i]) {
        // exposed: a crust, dark brown in its hollows and pale tan on its raised bits
        const c = Math.max(0, Math.min(1, (H[i] + 0.3) / 0.6));
        R = 34 + 50 * c + 16 * (t - 0.5); G = 15 + 27 * c + 6 * (t - 0.5); B = 10 + 18 * c + 4 * (t - 0.5);
      }
      else { R = 76 + 74 * (t - 0.5); G = 35 + 27 * (t - 0.5); B = 24 + 15 * (t - 0.5); }
      // grime gathers low down: pits and grooves go dark
      const ao = Math.min(1, Math.max(0.45, 1 + 0.9 * (H[i] - 0.15)));
      const e = Math.min(x, w - 1 - x) / w, dk = e < 0.06 ? 0.35 + 0.65 * (e / 0.06) : 1;
      const k = shade * ao * dk, o = i * 4;
      img.data[o] = R * k; img.data[o + 1] = G * k; img.data[o + 2] = B * k; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // scratches: thin and wavering, fading in and out along their length, a dark groove under a pale lip
  for (const [x0, y0, x1, y1] of D.scratches) {
    const n = 60;
    for (let k = 0; k < n; k++) {
      const a = k / n, b = (k + 1) / n, al = Math.sin(Math.PI * a) * (0.5 + 0.5 * warp(a * 9, 3));
      const p = (u: number) => [(x0 + (x1 - x0) * u) * sx + 1.5 * (warp(u * 14, 7) - 0.5), (y0 + (y1 - y0) * u - 4 * Math.sin(Math.PI * u)) * sy];
      const [ax, ay] = p(a), [bx, by] = p(b);
      for (const [col, oy, lw] of [[`rgba(10,4,2,${0.6 * al})`, 1.1, 1.3], [`rgba(215,175,145,${0.55 * al})`, 0, 0.8]] as const) {
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.beginPath();
        g.moveTo(ax, ay + oy);
        g.lineTo(bx, by + oy);
        g.stroke();
      }
    }
  }
  return cv.toDataURL();
}
