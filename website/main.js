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
