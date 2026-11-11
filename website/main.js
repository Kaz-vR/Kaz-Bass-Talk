// RUIN-1 website: the section photos, the phone menu and the demo video's play button.

// A section's photo (data-photo) is used once the file is there; until then the solid colour shows, with no broken requests.
for (const el of document.querySelectorAll('[data-photo]')) {
  const img = new Image();
  img.onload = () => el.style.setProperty('--photo', `url('${el.dataset.photo}')`);
  img.onerror = () => {};
  img.src = el.dataset.photo;
}
const menu = document.querySelector('.menu');
const links = document.querySelector('.links');
menu?.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(open));
});
links?.addEventListener('click', (e) => {
  if (e.target.closest('a')) { links.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); }
});

const box = document.querySelector('.video');
const video = box?.querySelector('video');
const play = () => {
  if (!video) return;
  box.classList.add('playing');
  video.controls = true;
  video.play().catch(() => { /* no video file yet: the poster stays */ box.classList.remove('playing'); video.controls = false; });
};
box?.querySelector('.play')?.addEventListener('click', play);
document.querySelector('[data-play]')?.addEventListener('click', (e) => {
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  e.preventDefault();
  play();
});

// Every page, moving: the filmstrip. The current clip sits in the middle and plays; the others wait (paused).
const strip = document.querySelector('.pages .strip');
if (strip) {
  const track = strip.querySelector('.track'), slides = [...track.children];
  const n = document.querySelector('.cap-n'), title = document.querySelector('.cap-title'), text = document.querySelector('.cap-text');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cur = 0;
  // a loop with no ends (owner's call): every page sits at its circular distance from the current one, so on the
  // first page the last one is already on the left; a page that wraps round does so while it is out of sight
  const where = (j) => { const n = slides.length; let d = (j - cur) % n; if (d > n / 2) d -= n; if (d < -n / 2) d += n; return d; };
  let was = slides.map(where);
  const show = (i) => {
    cur = (i + slides.length) % slides.length;
    const s = slides[cur], step = s.offsetWidth + (innerWidth < 720 ? 14 : 30);
    slides.forEach((x, j) => {
      const d = where(j);
      x.classList.toggle('jump', Math.abs(d - was[j]) > 1);
      x.classList.toggle('far', Math.abs(d) > 1);
      x.classList.toggle('on', d === 0);
      x.style.transform = `translateX(${d * step}px) scale(${d === 0 ? 1 : 0.94})`;
      was[j] = d;
      const v = x.querySelector('video');
      if (d === 0 && !still) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause();
    });
    n.textContent = String(cur + 1).padStart(2, '0');
    title.textContent = s.dataset.title;
    text.textContent = s.dataset.text;
  };
  document.querySelector('.strip-cap .prev').addEventListener('click', () => show(cur - 1));
  document.querySelector('.strip-cap .next').addEventListener('click', () => show(cur + 1));
  slides.forEach((s, j) => s.addEventListener('click', () => { if (j !== cur) show(j); }));
  // swipe on touch screens and drag with a mouse
  let x0 = null;
  strip.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  strip.addEventListener('pointerup', (e) => { if (x0 !== null && Math.abs(e.clientX - x0) > 40) show(cur + (e.clientX < x0 ? 1 : -1)); x0 = null; });
  strip.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') show(cur + 1); if (e.key === 'ArrowLeft') show(cur - 1); });
  strip.tabIndex = 0;
  // the clips only play while the strip is on screen
  new IntersectionObserver(([en]) => { const v = slides[cur].querySelector('video'); if (en.isIntersecting && !still) v.play().catch(() => {}); else v.pause(); }).observe(strip);
  addEventListener('resize', () => show(cur));
  show(0);
}

// The menu: shrinks into a dark bar once the page scrolls, and lights the link of the section you are in.
const nav = document.querySelector('.nav');
if (nav) {
  const navLinks = [...nav.querySelectorAll('.links a')];
  const ids = ['sound', 'pages', 'requirements', 'buy'];
  const onScroll = () => {
    nav.classList.toggle('small', scrollY > 60);
    let cur = 'top';
    for (const id of ids) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < innerHeight * 0.4) cur = id; }
    navLinks.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${cur}`));
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Sections ease up into view as they reach the screen (not with reduced motion).
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const els = document.querySelectorAll('.demo-copy, .video, .pages > .wrap:first-child > *, .pages .strip, .strip-cap, .req-copy, .os, .cta-col > *');
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });
  els.forEach((el) => { el.classList.add('rv'); io.observe(el); });
}
