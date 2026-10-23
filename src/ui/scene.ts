// The header scene behind the logo and preset selector, drawn in code: a misty dusk, dark city
// blocks, monoliths and a black sphere with a seam of light. A placeholder until the owner's
// painted header image replaces it (drop an image in and draw it instead).

const SW = 1536, SH = 216; // the scene's own size; it is scaled to fit the header

function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function noise(cell: number, r: () => number): (x: number, y: number) => number {
  const n = 256, grid = new Float32Array(n * n).map(r);
  const at = (a: number, b: number) => grid[(((b % n) + n) % n) * n + (((a % n) + n) % n)];
  return (x, y) => {
    const gx = x / cell, gy = y / cell, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const s = (t: number) => t * t * (3 - 2 * t);
    const p = at(ix, iy), q = at(ix + 1, iy), u = at(ix, iy + 1), v = at(ix + 1, iy + 1);
    return p + (q - p) * s(fx) + (u - p) * s(fy) + (p - q - u + v) * s(fx) * s(fy);
  };
}

/** Draw the scene into a canvas of the given CSS size (fills it, cropping the sides if needed). */
export function drawScene(cv: HTMLCanvasElement, W: number, H: number, dpr = 2): void {
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  cv.style.width = `${W}px`;
  cv.style.height = `${H}px`;
  const g = cv.getContext('2d')!;
  const r = rng(7);
  const k = Math.max(W / SW, H / SH);
  g.setTransform(dpr * k, 0, 0, dpr * k, (dpr * (W - SW * k)) / 2, (dpr * (H - SH * k)) / 2 - dpr * 10 * k);

  const sky = g.createRadialGradient(768, 70, 20, 768, 90, 520);
  sky.addColorStop(0, '#4c4c4f');
  sky.addColorStop(0.25, '#2a2a2c');
  sky.addColorStop(0.6, '#18181a');
  sky.addColorStop(1, '#0b0b0c');
  g.fillStyle = sky;
  g.fillRect(0, 0, SW, SH);

  // fog, denser in the middle
  const fog = document.createElement('canvas');
  fog.width = SW / 2;
  fog.height = SH / 2;
  const fx = fog.getContext('2d')!, img = fx.createImageData(fog.width, fog.height);
  const f1 = noise(45, r), f2 = noise(15, r), f3 = noise(5, r);
  for (let j = 0; j < fog.height; j++) {
    for (let i = 0; i < fog.width; i++) {
      const o = (j * fog.width + i) * 4, v = f1(i, j * 1.6) * 0.6 + f2(i, j * 1.5) * 0.3 + f3(i, j) * 0.1;
      const mid = Math.exp(-Math.pow((i * 2 - 768) / 420, 2));
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 150;
      img.data[o + 3] = Math.max(0, (v - 0.33) * 130 * (0.35 + 0.65 * mid));
    }
  }
  fx.putImageData(img, 0, 0);
  g.drawImage(fog, 0, 0, SW, SH);

  // far blocks on both sides
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(10,10,11,${0.5 + r() * 0.4})`;
    let x = r() * 380, w = 40 + r() * 90, t = 10 + r() * 70;
    g.fillRect(x, t, w, SH - t);
    g.fillStyle = `rgba(10,10,11,${0.5 + r() * 0.4})`;
    x = SW - 420 + r() * 420; w = 40 + r() * 90; t = 10 + r() * 70;
    g.fillRect(x, t, w, SH - t);
  }
  // close walls in perspective
  g.fillStyle = 'rgba(8,8,9,0.95)';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(330, 0); g.lineTo(330, 150); g.lineTo(0, SH); g.fill();
  g.beginPath(); g.moveTo(SW, 0); g.lineTo(SW - 330, 0); g.lineTo(SW - 330, 150); g.lineTo(SW, SH); g.fill();
  g.fillStyle = 'rgba(20,20,22,0.8)';
  g.beginPath(); g.moveTo(330, 0); g.lineTo(470, 0); g.lineTo(470, 160); g.lineTo(330, 150); g.fill();
  g.beginPath(); g.moveTo(SW - 330, 0); g.lineTo(SW - 470, 0); g.lineTo(SW - 470, 160); g.lineTo(SW - 330, 150); g.fill();
  // ground
  const ground = g.createLinearGradient(0, 150, 0, SH);
  ground.addColorStop(0, '#2a2a2c');
  ground.addColorStop(1, '#0c0c0d');
  g.fillStyle = ground;
  g.beginPath(); g.moveTo(330, 150); g.lineTo(SW - 330, 150); g.lineTo(SW, SH); g.lineTo(0, SH); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  for (const d of [-600, -250, 0, 250, 600]) { g.beginPath(); g.moveTo(768 + d * 0.08, 152); g.lineTo(768 + d, SH); g.stroke(); }
  // monoliths
  const pillar = (x: number, w: number, top: number, bot: number) => {
    const pg = g.createLinearGradient(x, 0, x + w, 0);
    pg.addColorStop(0, '#2c2c2f'); pg.addColorStop(0.4, '#141416'); pg.addColorStop(1, '#0a0a0b');
    g.fillStyle = pg;
    g.fillRect(x, top, w, bot - top);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(x, top, 1.2, bot - top);
  };
  pillar(520, 27, 10, 160); pillar(570, 18, 48, 156); pillar(952, 18, 48, 156); pillar(993, 27, 10, 160);
  // the sphere on the horizon
  g.save();
  g.beginPath(); g.rect(0, 0, SW, 152); g.clip();
  const sg = g.createRadialGradient(740, 40, 10, 768, 110, 100);
  sg.addColorStop(0, '#2a2a2c'); sg.addColorStop(0.5, '#141416'); sg.addColorStop(1, '#09090a');
  g.fillStyle = sg;
  g.beginPath(); g.arc(768, 112, 96, 0, 7); g.fill();
  g.strokeStyle = 'rgba(200,200,205,0.18)';
  g.lineWidth = 1.5;
  g.beginPath(); g.arc(768, 112, 96, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  g.restore();
  // the seam of light
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const [w, a, b] of [[6, 0.15, 14], [1.5, 0.9, 4]]) {
    g.strokeStyle = '#f2f2f6'; g.globalAlpha = a; g.lineWidth = w; g.shadowColor = '#fff'; g.shadowBlur = b;
    g.beginPath(); g.moveTo(768, 22); g.lineTo(768, 152); g.stroke();
  }
  g.restore();
  // vignette and grain
  const v = g.createRadialGradient(768, 90, 200, 768, 110, 900);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.fillStyle = v;
  g.fillRect(0, 0, SW, SH);
  const vb = g.createLinearGradient(0, 110, 0, SH);
  vb.addColorStop(0, 'rgba(0,0,0,0)'); vb.addColorStop(1, 'rgba(0,0,0,0.8)');
  g.fillStyle = vb;
  g.fillRect(0, 110, SW, SH - 110);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
    g.fillRect(r() * SW, r() * SH, 1, 1);
  }
}
