// RUIN-1 website: the features strip's pages as the same 3D synth as the header (hero3d.js, owner's call): a box with
// the page's picture on its face, unlit (the picture's own colours exactly), facing you straight on (no tilt, and it
// doesn't follow the mouse: owner's call). One renderer draws every slide into its own canvas. Going to the next or
// previous page gives the slides a small, springy swing (owner's pick, the first version): the arriving page turns in
// from the side it comes from, dipped 2 degrees, and settles; the leaving one turns away a little. The pictures are stills for now (tools/site-feature-shots.mjs);
// the <img> stays as the fallback (no WebGL, reduced motion). three.js is self-hosted in vendor/ (MIT).
import * as THREE from './vendor/three.module.min.js';

const strip = document.querySelector('.strip');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PERSP = 1600, TILT = 0;                                   // as the header: the eye 1600 css px away; straight on, no tilt (owner's call)
const PIC = { W: 1358, H: 750, woodL: [0, 67], woodR: [1291, 67] };   // the picture's layout in css px (shot at 2x)
const PADW = 1.22, PADH = 1.4;                                  // the canvas is larger than the slide, so a turn is never cut off

const start = async () => {
  if (!strip || still) return;
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.LinearSRGBColorSpace; r.toneMapping = THREE.NoToneMapping; r.setClearColor(0x000000, 0);
  const cam = new THREE.PerspectiveCamera(30, 1, 1, 20000);
  const flat = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
  const dark = (v) => flat({ color: new THREE.Color().setRGB(v / 255, v / 255, v / 255, THREE.LinearSRGBColorSpace) });
  const loader = new THREE.TextureLoader(), maxAniso = r.capabilities.getMaxAnisotropy();

  const slides = await Promise.all([...strip.querySelectorAll('.slide')].map(async (li) => {
    const img = li.querySelector('img');
    const tex = await loader.loadAsync(img.currentSrc || img.src);
    tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = maxAniso; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const scene = new THREE.Scene(), pivot = new THREE.Group(); pivot.rotation.order = 'YXZ'; scene.add(pivot);
    const cv = document.createElement('canvas'); cv.className = 'synth3d'; cv.setAttribute('aria-hidden', 'true'); li.append(cv);
    return { li, img, tex, scene, pivot, cv, g: cv.getContext('2d'), built: 0, pose: { yaw: 0, tilt: TILT, vy: 0, vt: 0 }, aim: { yaw: 0, tilt: TILT } };
  }));

  // the same box as the header: the body runs from wood to wood, the cheeks a little deeper; sized to the slide
  const build = (s, w) => {
    if (s.built === w) return; s.built = w; s.pivot.clear();
    const k = w / PIC.W, H = PIC.H * k, D = 79 * k, X = (px) => (px - PIC.W / 2) * k;
    const crop = (x, ww) => { const t = s.tex.clone(); t.needsUpdate = true; t.repeat.set(ww / PIC.W, 1); t.offset.set(x / PIC.W, 0); return t; };
    const bx = PIC.woodL[0] + PIC.woodL[1], bw = PIC.woodR[0] - bx;
    const body = new THREE.Mesh(new THREE.BoxGeometry(bw * k, H, D), [dark(13), dark(13), dark(13), dark(13), flat({ map: crop(bx, bw) }), dark(8)]);
    body.position.set(X(bx + bw / 2), 0, -D / 2); s.pivot.add(body);
    for (const [x, ww] of [PIC.woodL, PIC.woodR]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(ww * k, H, D * 1.33), flat({ map: crop(x, ww) }));
      c.position.set(X(x + ww / 2), 0, -D * 1.33 / 2); s.pivot.add(c);
    }
  };
  let cw = 0, ch = 0, synthW = 0, dpr = 1;
  const size = () => {
    const b = slides[0].li.getBoundingClientRect(); if (!b.width) return;
    const sw = b.width, sh = sw * 854 / 1600;                                    // the slide's box, as the old clips filled it
    synthW = Math.min(sw, sh * PIC.W / PIC.H) * 0.98;                            // the synth fitted inside it
    dpr = Math.min(devicePixelRatio || 1, 2); cw = Math.round(sw * PADW); ch = Math.round(sh * PADH);
    r.setPixelRatio(dpr); r.setSize(cw, ch, false);
    cam.aspect = cw / ch; cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(ch / 2 / PERSP)); cam.position.set(0, 0, PERSP); cam.updateProjectionMatrix();
    for (const s of slides) {
      s.cv.width = Math.round(cw * dpr); s.cv.height = Math.round(ch * dpr);
      Object.assign(s.cv.style, { width: `${cw}px`, height: `${ch}px` }); build(s, synthW);
    }
    for (const s of slides) draw(s);
  };
  const draw = (s) => {
    s.pivot.rotation.set(THREE.MathUtils.degToRad(-s.pose.tilt), THREE.MathUtils.degToRad(s.pose.yaw), 0);
    r.render(s.scene, cam); s.g.clearRect(0, 0, s.cv.width, s.cv.height); s.g.drawImage(r.domElement, 0, 0);
    s.li.classList.add('live');
  };
  // motion: a damped spring per slide toward its aim (a little overshoot, then it settles)
  const visible = (s) => !s.li.classList.contains('far');
  let running = false, last = 0;
  const tick = (ts) => {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts; let moving = false;
    for (const s of slides) {
      const p = s.pose, a = s.aim, K = 70, C = 11;                               // stiffness and damping: about 8 % overshoot
      p.vy += ((a.yaw - p.yaw) * K - p.vy * C) * dt; p.yaw += p.vy * dt;
      p.vt += ((a.tilt - p.tilt) * K - p.vt * C) * dt; p.tilt += p.vt * dt;
      const m = Math.abs(a.yaw - p.yaw) > 0.01 || Math.abs(p.vy) > 0.01 || Math.abs(a.tilt - p.tilt) > 0.01 || Math.abs(p.vt) > 0.01;
      if (m && visible(s)) draw(s); moving ||= m;
    }
    if (moving) requestAnimationFrame(tick); else running = false;
  };
  const go = () => { if (!running) { running = true; last = performance.now(); requestAnimationFrame(tick); } };
  // a page change: the arriving page swings in from the side it comes from, the leaving one turns away a little
  strip.addEventListener('slide', (e) => {
    const { from, to, dir } = e.detail;
    if (slides[to]) { slides[to].pose.yaw = dir * 11; slides[to].pose.tilt = TILT + 2; slides[to].pose.vy = 0; }
    if (slides[from]) { slides[from].pose.vy += -dir * 60; slides[from].aim.yaw = 0; slides[from].aim.tilt = TILT; }
    go();
  });
  new ResizeObserver(size).observe(slides[0].li); size();
};
start();
