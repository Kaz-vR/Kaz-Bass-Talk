// RUIN-1 website: the synth in the header as a 3D object you can turn (owner's pick: option 2, the box with the synth's
// picture on its face, and no lighting at all, so every surface shows the picture's own colours exactly).
// At rest it faces you straight on, tipped back 3 degrees, turning round its own middle. It follows the mouse a little;
// drag it to turn it all the way, let go and it springs back. The picture <img> stays underneath as the fallback
// (no WebGL, reduced motion, or before the first frame is drawn). three.js is self-hosted in vendor/ (MIT).
import * as THREE from './vendor/three.module.min.js';

const fig = document.querySelector('.hero .synth'), img = fig?.querySelector('img');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PERSP = 1600, TILT = 3;                       // the eye 1600 css px in front of the synth; its resting tilt back
// the synth picture's layout in its own css px (tools/site-shots.mjs shoots it at 2x): the wooden cheeks and the body
const PIC = { W: 1358, H: 750, woodL: [0, 67], woodR: [1291, 67] };

const start = async () => {
  if (!fig || !img || still) return;
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // colours pass straight through, blended the way the browser blends the picture: the face looks exactly like the <img>
  r.outputColorSpace = THREE.LinearSRGBColorSpace; r.toneMapping = THREE.NoToneMapping; r.setClearColor(0x000000, 0);
  const cv = r.domElement; cv.className = 'synth3d'; cv.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 1, 20000);
  const tex = await new THREE.TextureLoader().loadAsync(img.currentSrc || img.src);
  tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = r.capabilities.getMaxAnisotropy(); tex.minFilter = THREE.LinearMipmapLinearFilter;
  const crop = (x, w) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(w / PIC.W, 1); t.offset.set(x / PIC.W, 0); return t; };
  const flat = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
  const dark = (v) => flat({ color: new THREE.Color().setRGB(v / 255, v / 255, v / 255, THREE.LinearSRGBColorSpace) });
  const pivot = new THREE.Group(); pivot.rotation.order = 'YXZ'; scene.add(pivot);
  let built = 0;
  // the synth, sized in css px to the picture's width on the page; the pivot is its exact middle
  const build = (w) => {
    if (w === built) return; built = w; pivot.clear();
    const s = w / PIC.W, H = PIC.H * s, D = 79 * s;                          // body depth: about 1.1 cheek widths
    const X = (px) => (px - PIC.W / 2) * s, bx = PIC.woodL[0] + PIC.woodL[1], bw = PIC.woodR[0] - bx;
    // the body runs from wood to wood: the black between the cheeks and the boxes is solid surface
    const body = new THREE.Mesh(new THREE.BoxGeometry(bw * s, H, D), [dark(13), dark(13), dark(13), dark(13), flat({ map: crop(bx, bw) }), dark(8)]);
    body.position.set(X(bx + bw / 2), 0, -D / 2); pivot.add(body);
    for (const [x, ww] of [PIC.woodL, PIC.woodR]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(ww * s, H, D * 1.33), flat({ map: crop(x, ww) }));
      c.position.set(X(x + ww / 2), 0, -D * 1.33 / 2); pivot.add(c);
    }
  };
  // the canvas is larger than the picture so the turning synth never gets cut off; the synth is drawn at the picture's size
  const size = () => {
    const w = fig.getBoundingClientRect().width, cw = Math.round(w * 1.5), ch = Math.round(w * PIC.H / PIC.W * 1.5);
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); r.setSize(cw, ch, false);
    cv.style.width = `${cw}px`; cv.style.height = `${ch}px`;
    cam.aspect = cw / ch; cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(ch / 2 / PERSP)); cam.position.set(0, 0, PERSP); cam.updateProjectionMatrix();
    build(w); draw();
  };
  // pose: where it is, where it is heading; the mouse sets a small target, a drag sets the angle directly
  const pose = { yaw: 0, tilt: TILT }, aim = { yaw: 0, tilt: TILT };
  const draw = () => { pivot.rotation.set(THREE.MathUtils.degToRad(-pose.tilt), THREE.MathUtils.degToRad(pose.yaw), 0); r.render(scene, cam); };
  let running = false, dragging = false, lastX = 0;
  const tick = () => {
    if (!dragging) { pose.yaw += (aim.yaw - pose.yaw) * 0.08; pose.tilt += (aim.tilt - pose.tilt) * 0.08; }
    draw();
    if (dragging || Math.abs(aim.yaw - pose.yaw) > 0.02 || Math.abs(aim.tilt - pose.tilt) > 0.02) requestAnimationFrame(tick); else running = false;
  };
  const go = () => { if (!running) { running = true; requestAnimationFrame(tick); } };
  addEventListener('pointermove', (e) => {
    if (dragging) { pose.yaw += (e.clientX - lastX) * 0.45; lastX = e.clientX; go(); return; }
    if (e.pointerType !== 'mouse') return;
    const b = fig.getBoundingClientRect(), nx = (e.clientX - (b.left + b.width / 2)) / innerWidth, ny = (e.clientY - (b.top + b.height / 2)) / innerHeight;
    aim.yaw = Math.max(-14, Math.min(14, nx * 26)); aim.tilt = TILT + Math.max(-4, Math.min(4, -ny * 8)); go();
  }, { passive: true });
  cv.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; cv.setPointerCapture(e.pointerId); cv.classList.add('grab'); go(); });
  const release = () => { if (!dragging) return; dragging = false; cv.classList.remove('grab');
    pose.yaw = ((pose.yaw + 180) % 360 + 360) % 360 - 180;                 // spring back the short way round
    aim.yaw = 0; aim.tilt = TILT; go(); };
  cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
  fig.addEventListener('mouseleave', () => { if (!dragging) { aim.yaw = 0; aim.tilt = TILT; go(); } });
  // sized from the figure (always there), not the picture (another script may hide it)
  fig.append(cv); new ResizeObserver(size).observe(fig); size();
  fig.classList.add('live');                                                // the picture steps back once the 3D is drawn
};
if (img?.complete && img.naturalWidth) start(); else img?.addEventListener('load', start, { once: true });
