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
  const show = (i) => {
    cur = (i + slides.length) % slides.length;
    const s = slides[cur];
    track.style.transform = `translateX(${strip.clientWidth / 2 - (s.offsetLeft + s.offsetWidth / 2)}px)`;
    slides.forEach((x, j) => {
      x.classList.toggle('on', j === cur);
      const v = x.querySelector('video');
      if (j === cur && !still) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause();
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
