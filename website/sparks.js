// RUIN-1 website: the trailer's sparks (references/trailers/RUIN-1.md, section 3), live, in two places:
// - the header: a few embers (as many as in mockup E, the owner's pick) drifting very slowly up through the smoke,
//   born where they glow;
// - the Buy part: the sparks of fire pitch 6, rising out of the fire along the bottom as fast as the fire rises, and
//   dying on the way up.
// Each spark sits at its own depth: in the focus band a short sharp streak, nearer the lens a soft disc of the same
// colour. Colour follows temperature in the house colours only: born at a random heat, #F25D07 hot, cooling to #F23005,
// then #F20000, then fading out; the glow round a spark is one step cooler than its core. Plain canvas, 30 frames a
// second, only while its part is on screen; none with reduced motion. Above the background loop, below the content.
{   // its own block: main.js has names of its own at the top level
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOT = [242, 93, 7], MID = [242, 48, 5], RED = [242, 0, 0];
const colour = (t) => (t > 0.66 ? HOT : t > 0.33 ? MID : RED);
const cooler = (t) => colour(t - 0.34);

const sparks = (host, o) => {
  const bg = host.querySelector(o.bg);
  if (still) { const v = bg?.querySelector('video'); if (v) { v.removeAttribute('autoplay'); v.pause(); } const im = bg?.querySelector('img[data-still]'); if (im) im.src = im.dataset.still; return; }
  const cv = document.createElement('canvas'); cv.className = 'sparks'; cv.setAttribute('aria-hidden', 'true');
  bg ? bg.after(cv) : host.prepend(cv);
  const g = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, list = [], on = false, last = 0;
  const spawn = (s, first) => {
    s.z = Math.random(); s.z = s.z < o.sharp ? s.z * 0.15 : s.z;                    // most sparks sharp, a few soft
    s.x = Math.random() * W;
    s.y = o.rise ? (first ? H * (0.35 + 0.65 * Math.random()) : H + 10 * dpr) : Math.random() * H;
    s.t0 = 0.5 + 0.5 * Math.pow(Math.random(), 0.7);                               // how hot it is born; hotter ones rise a little faster
    // px a second; nearer ones move faster. o.fire: as fast as the fire behind them rises (the loop's smoke moves about
    // 2 % of its picture's width a second, and the picture is cover-fitted, so its width on screen sets the speed)
    const base = o.fire ? o.fire * Math.max(W, H * 16 / 9) / dpr * (0.6 + Math.random() * 0.8) : o.v[0] + Math.random() * o.v[1];
    s.v = base * (0.6 + 0.6 * s.t0) * (1 + s.z * (o.fire ? 0.5 : 1.5)) * dpr;
    s.vx = o.rise ? (Math.random() - 0.5) * s.v * 0.35 : 0;                        // pitch 6: a slight diagonal
    s.ph = Math.random() * 6.28; s.max = o.life[0] + Math.random() * o.life[1]; s.life = first ? Math.random() * s.max : s.max;
    return s;
  };
  const size = () => {
    const r = host.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2);
    W = Math.round(r.width * dpr); H = Math.round(r.height * dpr); cv.width = W; cv.height = H;
    list = Array.from({ length: Math.round(o.count * r.width / 1440) + o.base }, () => spawn({}, true));
  };
  const draw = (dt) => {
    g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter';
    for (const s of list) {
      s.life -= dt; s.y -= s.v * dt; s.x += (s.vx + Math.sin(performance.now() / 1000 * 0.9 + s.ph) * o.sway * dpr) * dt;
      if (s.life <= 0 || s.y < -30) spawn(s);
      const f = s.life / s.max, t = s.t0 * (0.25 + 0.75 * f);
      const fade = Math.min(1, f * 6, (s.max - s.life) * (o.rise ? 8 : 2)) * (t > 0.33 ? 1 : t / 0.33) * (0.55 + 0.45 * t);
      const c = colour(t), gc = cooler(t);
      if (s.z < 0.2) {                                                             // sharp: a short streak with a glow one step cooler
        const len = Math.max(1.5 * dpr, s.v * o.streak), w = 1.3 * dpr, ex = s.x - (s.vx / s.v) * len;
        g.strokeStyle = `rgba(${gc},${0.22 * fade})`; g.lineWidth = w * 6; g.lineCap = 'round';
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(ex, s.y + len); g.stroke();
        g.strokeStyle = `rgba(${c},${fade})`; g.lineWidth = w;
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(ex, s.y + len); g.stroke();
      } else {                                                                     // soft: a disc, its light spread over its size
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
};

// the header: few, very slow (owner's call), born where they glow
const hero = document.querySelector('.hero');
if (hero) sparks(hero, { bg: '.hero-bg', count: 16, base: 4, sharp: 0.7, v: [4, 7], life: [7, 8], sway: 2.5, streak: 0.12, rise: false });
// the Buy part: pitch 6's sparks, rising out of the fire and dying on the way up
const buy = document.querySelector('.end');
if (buy) sparks(buy, { bg: '.end-bg', count: 34, base: 6, sharp: 0.62, fire: 0.02, life: [6, 5], sway: 3, streak: 0.12, rise: true });   // as fast as the fire (owner's call)
}
