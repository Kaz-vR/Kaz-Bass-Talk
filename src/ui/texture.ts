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
export function woodTexture(side: 'l' | 'r' = 'l', w = 134, h = 1422, seed = 61): string {
  const r = rng(seed + (side === 'r' ? 7 : 0));
  const grainA = valueNoise(3, r), grainB = valueNoise(9, r), mott = valueNoise(26, r), fleck = valueNoise(5, r), pit = valueNoise(3, r);
  const flakeN = valueNoise(2.5, r), flakeN2 = valueNoise(7, r), flakeTone = valueNoise(6, r), crust = valueNoise(1.6, r);
  const sx = w / 66, sy = h / 711, D = WOOD_DAMAGE[side];
  // how much flaking there is here: soft blobs at the reference's places, stretched along the grain
  const amount = (x: number, y: number) => {
    let a = 0;
    for (const [bx, by, rx, ry, k] of D.flakes) {
      const dx = (x / sx - bx) / rx, dy = (y / sy - by) / ry;
      a += k * Math.exp(-(dx * dx + dy * dy) * 1.6);
    }
    return Math.min(1.2, a);
  };
  // the flake field: grain-stretched noise, so flakes come away in vertical slivers like old paint
  const fl = (x: number, y: number) => (0.65 * flakeN(x, y / 2.2) + 0.35 * flakeN2(x, y / 1.6)) * (0.35 + 0.75 * amount(x, y));
  const T = 0.5;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!, img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gr = 0.6 * grainA(x, y / 40) + 0.4 * grainB(x, y / 25), m = mott(x, y / 3);
      // where it is damaged the surface is crusty: a rough, fine-grained relief over the grain
      const am = amount(x, y), cr = (crust(x, y) - 0.5) * (8 + 26 * am) + 7 * Math.min(1, am);
      let R = 67 + (gr - 0.5) * 18 + (m - 0.5) * 22 + (r() - 0.5) * 9 + cr;
      let G = 30 + (gr - 0.5) * 8 + (m - 0.5) * 10 + (r() - 0.5) * 5 + cr * 0.45;
      let B = 21 + (gr - 0.5) * 5 + (m - 0.5) * 6 + (r() - 0.5) * 4 + cr * 0.3;
      const f = fleck(x, y / 1.5);
      if (f > 0.76) { const k = (f - 0.76) * 3; R += 22 * k; G += 10 * k; B += 3 * k; }
      if (pit(x, y / 1.2) > 0.86) { R *= 0.62; G *= 0.6; B *= 0.6; }
      // paint flakes: pale grey-tan where the flake has lifted, a dark rim round it, its top edge catching light
      const v = fl(x, y);
      if (v > T) {
        const t = flakeTone(x, y), up = fl(x, y - 2) <= T, down = fl(x, y + 2) <= T;
        let l = 0.8 + 0.35 * (t - 0.5) + (r() - 0.5) * 0.16;
        if (up) l *= 1.18;
        if (down) l *= 0.7;
        // grey-brown scale with some of the rust still in it
        R = (112 + 30 * (t - 0.5)) * l; G = (66 + 16 * (t - 0.5)) * l; B = (48 + 8 * (t - 0.5)) * l;
      } else if (v > T - 0.04) {
        R *= 0.6; G *= 0.56; B *= 0.55;
      }
      const e = Math.min(x, w - 1 - x) / w, dk = e < 0.06 ? 0.35 + 0.65 * (e / 0.06) : 1;
      const o = (y * w + x) * 4;
      img.data[o] = R * dk; img.data[o + 1] = G * dk; img.data[o + 2] = B * dk; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // nail heads: a domed, rusted head, lit from the top left, a dark ring where it sinks into the board
  for (const [nx, ny, nr] of D.nails) {
    const x = nx * sx, y = ny * sy, rad = nr * sx;
    const ring = g.createRadialGradient(x, y, rad * 0.8, x, y, rad * 1.5);
    ring.addColorStop(0, 'rgba(12,5,2,0.85)');
    ring.addColorStop(1, 'rgba(12,5,2,0)');
    g.fillStyle = ring;
    g.beginPath(); g.arc(x, y, rad * 1.5, 0, Math.PI * 2); g.fill();
    const head = g.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.1, x, y, rad);
    head.addColorStop(0, 'rgb(100,48,30)');
    head.addColorStop(0.5, 'rgb(58,25,14)');
    head.addColorStop(1, 'rgb(28,11,6)');
    g.fillStyle = head;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    // rust crust on the head and flaking round it
    for (let i = 0; i < rad * 14; i++) {
      const a = r() * Math.PI * 2, d = r() * rad * 1.35;
      g.fillStyle = r() < 0.55 ? `rgba(18,7,3,${0.4 + r() * 0.4})` : `rgba(120,70,50,${0.25 + r() * 0.3})`;
      g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + (r() < 0.3 ? 1 : 0), 1 + (r() < 0.3 ? 1 : 0));
    }
  }
  // scratches: a thin pale line with a dark groove under it
  for (const [x0, y0, x1, y1] of D.scratches) {
    for (const [col, dy, lw] of [['rgba(10,4,2,0.55)', 1.2, 1.4], ['rgba(205,165,135,0.55)', 0, 0.9]] as const) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(x0 * sx, y0 * sy + dy);
      g.quadraticCurveTo(((x0 + x1) / 2) * sx, ((y0 + y1) / 2 - 4) * sy + dy, x1 * sx, y1 * sy + dy);
      g.stroke();
    }
  }
  // faint fine scratches along the board
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, ang = Math.PI / 2 + (r() - 0.5) * 0.7, len = 30 + r() * r() * 260;
    g.strokeStyle = r() < 0.6 ? `rgba(14,6,3,${0.2 + r() * 0.25})` : `rgba(140,80,55,${0.06 + r() * 0.1})`;
    g.lineWidth = 0.6 + r() * 0.4;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }
  return cv.toDataURL();
}
