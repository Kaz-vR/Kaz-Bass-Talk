// RUIN-1 website: the menu, the demo video, the features strip and the reveals.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// The menu: shrinks into a black bar once the page scrolls, and lights the link of the part you are in.
const nav = document.querySelector('.nav');
if (nav) {
  const links = [...nav.querySelectorAll('.links a')];
  const onScroll = () => {
    nav.classList.toggle('small', scrollY > 40);
    let cur = '';
    for (const id of ['sound', 'features', 'setup']) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < innerHeight * 0.4) cur = id; }
    links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${cur}`));
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// The audio demo: the logo is the play button; until the video file is there, nothing happens.
const vid = document.querySelector('.vid');
const video = vid?.querySelector('video');
vid?.querySelector('.vid-play')?.addEventListener('click', () => {
  vid.classList.add('playing');
  video.controls = true;
  video.play().catch(() => { vid.classList.remove('playing'); video.controls = false; });
});

// The features strip: the current page in the middle, its neighbours at the sides, a loop with no ends
// (owner's call): every page sits at its circular distance from the current one, so the last page is already
// on the left of the first; a page that wraps round does so while it is out of sight.
const strip = document.querySelector('.strip');
if (strip) {
  const slides = [...strip.querySelectorAll('.slide')];
  const n = document.querySelector('.cap-n'), title = document.querySelector('.cap-title'), text = document.querySelector('.cap-text');
  let cur = 0;
  const where = (j) => { const c = slides.length; let d = (j - cur) % c; if (d > c / 2) d -= c; if (d < -c / 2) d += c; return d; };
  const was = slides.map(where);
  const show = (i) => {
    cur = (i + slides.length) % slides.length;
    const step = slides[cur].offsetWidth + (innerWidth < 600 ? 14 : 34);
    slides.forEach((s, j) => {
      const d = where(j);
      s.classList.toggle('jump', Math.abs(d - was[j]) > 1);
      s.classList.toggle('far', Math.abs(d) > 1);
      s.classList.toggle('on', d === 0);
      s.style.transform = `translateX(${d * step}px) scale(${d === 0 ? 1 : 0.94})`;
      was[j] = d;
      const v = s.querySelector('video');
      if (d === 0 && !still) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause();
    });
    n.textContent = `${String(cur + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
    title.textContent = slides[cur].dataset.title;
    text.textContent = slides[cur].dataset.text;
  };
  document.querySelector('.cap .prev').addEventListener('click', () => show(cur - 1));
  document.querySelector('.cap .next').addEventListener('click', () => show(cur + 1));
  slides.forEach((s, j) => s.addEventListener('click', () => { if (j !== cur) show(j); }));
  // swipe on touch screens (sideways gestures are the strip's, vertical scrolling stays the page's), drag with a mouse
  let x0 = null, y0 = null, x1 = null;
  const start = (x, y) => { x0 = x; y0 = y; x1 = x; };
  const end = () => { if (x0 !== null && Math.abs(x1 - x0) > 40) show(cur + (x1 < x0 ? 1 : -1)); x0 = y0 = x1 = null; };
  strip.addEventListener('touchstart', (e) => start(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  strip.addEventListener('touchmove', (e) => {
    if (x0 === null) return;
    x1 = e.touches[0].clientX;
    if (Math.abs(x1 - x0) > Math.abs(e.touches[0].clientY - y0) && e.cancelable) e.preventDefault();
  }, { passive: false });
  strip.addEventListener('touchend', end);
  strip.addEventListener('touchcancel', end);
  strip.addEventListener('mousedown', (e) => start(e.clientX, e.clientY));
  addEventListener('mousemove', (e) => { if (x0 !== null) x1 = e.clientX; });
  addEventListener('mouseup', () => { if (x0 !== null) end(); });
  strip.addEventListener('dragstart', (e) => e.preventDefault());
  strip.tabIndex = 0;
  strip.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') show(cur + 1); if (e.key === 'ArrowLeft') show(cur - 1); });
  // only the current clip plays, and only while the strip is on screen
  new IntersectionObserver(([en]) => { const v = slides[cur].querySelector('video'); if (en.isIntersecting && !still) v.play().catch(() => {}); else v.pause(); }).observe(strip);
  addEventListener('resize', () => show(cur));
  show(0);
}

// The logo beside the name: its top on the top of the letters of RUIN-1, its bottom on the bottom of the letters
// of SYNTHESIZER (owner's call). Measured from the font itself (at 1000 px: canvas rounds its metrics), so it
// holds at every size; placed until the row settles.
const ink = (el, txt) => {
  const cs = getComputedStyle(el), g = document.createElement('canvas').getContext('2d'), k = parseFloat(cs.fontSize) / 1000;
  g.font = `${cs.fontStyle} ${cs.fontWeight} 1000px ${cs.fontFamily}`;
  const m = g.measureText(txt.toUpperCase()), r = el.getBoundingClientRect();
  const lh = parseFloat(cs.lineHeight) || r.height, A = m.fontBoundingBoxAscent * k, D = m.fontBoundingBoxDescent * k;
  const base = r.top + (lh - (A + D)) / 2 + A;
  return { top: base - m.actualBoundingBoxAscent * k, bottom: base + m.actualBoundingBoxDescent * k };
};
const alignMark = () => {
  const box = document.querySelector('.lockup'); if (!box) return;
  const mark = box.querySelector('.mark'), b = box.querySelector('.word b'), i = box.querySelector('.word i');
  for (let t = 0; t < 4; t++) {
    const top = ink(b, b.textContent).top, bottom = ink(i, i.textContent).bottom;
    mark.style.height = `${bottom - top}px`;
    mark.style.marginTop = `${(parseFloat(mark.style.marginTop) || 0) + top - mark.getBoundingClientRect().top}px`;
  }
};
alignMark();
document.fonts?.ready.then(alignMark);
addEventListener('resize', alignMark);

// The parts ease up into view as they reach the screen (not with reduced motion).
if (!still && 'IntersectionObserver' in window) {
  const els = document.querySelectorAll('.part > .k, .part > h2, .vid, .strip, .cap, .specs, .note, .end > *');
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });
  els.forEach((el) => { el.classList.add('rv'); io.observe(el); });
}

// Pixel embers (owner's pick, "Embers"): a low, smouldering pixel fire at the bottom of the Buy part with single-pixel
// sparks drifting up out of it and cooling as they rise, and the same sparks behind the header. Siren colours only.
// Plain canvas, no images: one cell is a 6 px block; it runs at 24 frames a second, only while on screen, and with
// reduced motion it shows one still frame (the header shows none).
const embers = (host, { flames, count }) => {
  const PX = 6, FH = 48;
  const cv = document.createElement('canvas'); cv.className = 'embers'; cv.setAttribute('aria-hidden', 'true');
  host.prepend(cv);
  const g = cv.getContext('2d');
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const STOPS = ['#000000', '#200301', '#5a0703', '#8a0a04', '#c8160b', '#ff2a14', '#ff6a1a'].map(hex), MAX = 24;
  const PAL = Array.from({ length: MAX + 1 }, (_, i) => { const t = i / MAX * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k; return STOPS[k].map((v, j) => Math.round(v + (STOPS[k + 1][j] - v) * f)); });
  const HOT = hex('#ffb070'), ORANGE = hex('#ff6a1a'), RED = hex('#ff2a14'), DEEP = hex('#8a0a04');
  let W = 0, H = 0, heat, img, t = 0, sparks = [];
  const spawn = (s, anywhere) => {
    s.x = Math.random() * W; s.v = 0.25 + Math.random() * 0.5; s.p = Math.random() * 6;
    s.y = flames ? H - 8 - Math.random() * 8 : H * (anywhere ? Math.random() : 0.55 + Math.random() * 0.45);
    s.life = flames ? 0.6 + Math.random() * 0.4 : 0.35 + Math.random() * 0.65;
    return s;
  };
  const size = () => {
    const r = host.getBoundingClientRect(), w = Math.ceil(r.width / PX), h = Math.ceil(r.height / PX);
    if (w === W && h === H) return;
    W = w; H = h; cv.width = W; cv.height = H; img = g.createImageData(W, H); heat = new Float32Array(W * FH);
    sparks = Array.from({ length: Math.round(count * W / 240) }, () => spawn({}, true));
    if (flames) for (let i = 0; i < FH * 2; i++) burn();
  };
  // the classic fire spread: each cell takes the heat of the one below it, a little cooler and shifted sideways
  const burn = () => {
    for (let x = 0; x < W; x++) heat[(FH - 1) * W + x] = MAX * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(x * 0.07 + t * 0.03) * Math.sin(x * 0.023 - t * 0.017)));
    for (let y = 1; y < FH; y++) for (let x = 0; x < W; x++) {
      const r = Math.random() * 3 | 0, dx = Math.max(0, Math.min(W - 1, x - r + 1));
      heat[(y - 1) * W + dx] = Math.max(0, heat[y * W + x] - (Math.random() < 0.72 ? 1.05 : 0));
    }
  };
  const draw = () => {
    t++; const d = img.data; d.fill(0);
    if (flames) {
      burn();
      for (let y = 0; y < FH; y++) for (let x = 0; x < W; x++) {
        const v = heat[y * W + x]; if (v < 0.5) continue;
        const c = PAL[Math.min(MAX, Math.round(v))], i = ((H - FH + y) * W + x) * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = Math.min(255, v * 40); // the cool edge fades into the glow
      }
    }
    for (const s of sparks) {
      s.y -= s.v; s.x += Math.sin(t * 0.05 + s.p) * 0.35; s.life -= 0.006;
      if (s.y < 0 || s.life <= 0) spawn(s);
      const xi = Math.round(s.x), yi = Math.round(s.y); if (xi < 0 || xi >= W || yi < 0 || yi >= H) continue;
      const c = s.life > 0.6 ? HOT : s.life > 0.35 ? ORANGE : s.life > 0.12 ? RED : DEEP, i = (yi * W + xi) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  };
  size();
  new ResizeObserver(size).observe(host);
  if (still) { if (flames) { sparks = []; draw(); } return; }
  let on = false, last = 0;
  const loop = (ts) => { if (!on) return; if (ts - last > 1000 / 24) { draw(); last = ts; } requestAnimationFrame(loop); };
  new IntersectionObserver(([e]) => { const was = on; on = e.isIntersecting; if (on && !was) requestAnimationFrame(loop); }).observe(host);
};
const buy = document.querySelector('.end'), hero = document.querySelector('.hero');
if (buy) embers(buy, { flames: true, count: 34 });
if (hero) embers(hero, { flames: false, count: 26 });
