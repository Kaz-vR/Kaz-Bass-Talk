// RUIN-1 website: the header's sparks, in the trailer's style (references/trailers/RUIN-1.md, section 3): embers
// drifting slowly up through the smoke, each at its own depth. In the focus band they are short sharp streaks;
// nearer the lens they are soft discs of the same colour. Colour follows temperature in the house colours only:
// born at a random heat, #F25D07 hot, cooling to #F23005, then #F20000, then fading out; the glow round a spark is
// one step cooler than its core. Plain canvas, 30 frames a second, only while the header is on screen; none with
// reduced motion. Sits above the smoke loop and below the synth and text.
{   // its own block: main.js has names of its own at the top level
const host = document.querySelector('.hero');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (still) { const v = host?.querySelector('.hero-bg video'); if (v) { v.removeAttribute('autoplay'); v.pause(); } }   // the still poster frame instead of the loop
if (host && !still) {
  const cv = document.createElement('canvas'); cv.className = 'sparks'; cv.setAttribute('aria-hidden', 'true');
  host.querySelector('.hero-bg')?.after(cv) ?? host.prepend(cv);
  const g = cv.getContext('2d');
  const HOT = [242, 93, 7], MID = [242, 48, 5], RED = [242, 0, 0];
  const colour = (t) => (t > 0.66 ? HOT : t > 0.33 ? MID : RED);
  const cooler = (t) => colour(t - 0.34);
  let W = 0, H = 0, dpr = 1, list = [], on = false, last = 0;
  const spawn = (s, anywhere) => {
    s.z = Math.random();                                         // 0 = in the focus band, 1 = close to the lens
    s.z = s.z < 0.6 ? s.z * 0.15 : s.z;                          // most sparks sharp, some soft
    s.x = Math.random() * W; s.y = anywhere ? Math.random() * H : H + 20;
    s.t0 = 0.5 + 0.5 * Math.pow(Math.random(), 0.7);             // how hot it is born; hotter ones rise a little faster
    s.v = (12 + Math.random() * 22) * (0.6 + 0.6 * s.t0) * (1 + s.z * 1.5) * dpr;   // px a second; nearer ones move faster
    s.ph = Math.random() * 6.28; s.max = 3 + Math.random() * 4; s.life = anywhere ? Math.random() * s.max : s.max;
    return s;
  };
  const size = () => {
    const r = host.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2);
    W = Math.round(r.width * dpr); H = Math.round(r.height * dpr); cv.width = W; cv.height = H;
    list = Array.from({ length: Math.round(46 * r.width / 1440) + 10 }, () => spawn({}, true));
  };
  const draw = (dt) => {
    g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter';
    for (const s of list) {
      s.life -= dt; s.y -= s.v * dt; s.x += Math.sin(performance.now() / 1000 * 0.9 + s.ph) * 6 * dpr * dt;
      if (s.life <= 0 || s.y < -30) spawn(s);
      const f = s.life / s.max, t = s.t0 * (0.25 + 0.75 * f);
      const fade = Math.min(1, f * 6, (s.max - s.life) * 2) * (t > 0.33 ? 1 : t / 0.33) * (0.55 + 0.45 * t);
      const c = colour(t), gc = cooler(t);
      if (s.z < 0.2) {                                             // sharp: a short streak with a glow one step cooler
        const len = s.v * 0.05, w = 1.3 * dpr;
        g.strokeStyle = `rgba(${gc},${0.22 * fade})`; g.lineWidth = w * 6; g.lineCap = 'round';
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x, s.y + len); g.stroke();
        g.strokeStyle = `rgba(${c},${fade})`; g.lineWidth = w;
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x, s.y + len); g.stroke();
      } else {                                                     // soft: a disc, its light spread over its size
        const rad = (4 + s.z * 22) * dpr, a = fade * Math.min(0.55, 5 / (rad / dpr));
        const rg = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, rad);
        rg.addColorStop(0, `rgba(${c},${a})`); rg.addColorStop(0.75, `rgba(${c},${a * 0.8})`); rg.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = rg; g.beginPath(); g.arc(s.x, s.y, rad, 0, 6.2832); g.fill();
      }
    }
    g.globalCompositeOperation = 'source-over';
  };
  const loop = (ts) => { if (!on) return; const dt = Math.min(0.1, (ts - last) / 1000 || 0); if (ts - last > 1000 / 30) { draw(dt); last = ts; } requestAnimationFrame(loop); };
  size(); new ResizeObserver(size).observe(host);
  new IntersectionObserver(([e]) => { const was = on; on = e.isIntersecting; if (on && !was) { last = performance.now(); requestAnimationFrame(loop); } }).observe(host);
}
}
