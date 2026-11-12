// DEV ONLY: trailer test shots of RUIN-1 in 3D (references/trailers/RULES.md is the brief). Loaded by render.html,
// driven frame by frame by tools/trailer-render.mjs: window.setup(shot) then window.frame(i) for i = 0..frames-1.
// The synth is the real UI (tools/trailer-capture.mjs, 4x) on a thin slab with its wooden cheeks, in a dark space.
// Post: depth of field from the depth buffer (thin lens), glow, colour fringes at the edges, vignette, grade, grain.
import * as THREE from '/website/vendor/three.module.min.js';

const W = Number(new URLSearchParams(location.search).get('w') ?? 1920), H = Math.round(W * 9 / 16), FPS = 25, K = W / 1920;
const CAP = '/renders/trailer/capture';
const meta = await (await fetch(`${CAP}/meta.json`)).json();
const C = { red: '#ea1f1f', orange: '#e83911', green: '#129b82', blue: '#5f64c8', purple: '#6c3a9c', sand: '#c09b6d', phaser: '#aa418e' };
const col = (h) => new THREE.Color(h);

const r = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
r.setPixelRatio(1); r.setSize(W, H, false); r.domElement.style.cssText = `width:${W}px;height:${H}px`;
r.outputColorSpace = THREE.LinearSRGBColorSpace; r.toneMapping = THREE.NoToneMapping;
document.body.append(r.domElement);

// ---------- the synth: a slab with the UI on its face, wooden cheeks either side ----------
const img = await new THREE.ImageLoader().loadAsync(`${CAP}/base.png`);
const face = document.createElement('canvas'); face.width = img.width; face.height = img.height;
const fg = face.getContext('2d'); fg.drawImage(img, 0, 0);
const tex = new THREE.CanvasTexture(face);
tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = r.capabilities.getMaxAnisotropy(); tex.minFilter = THREE.LinearMipmapLinearFilter;
const knobs = [];
const loadKnob = async (i) => knobs[i] ??= await new THREE.ImageLoader().loadAsync(`${CAP}/knob/${String(i).padStart(3, '0')}.png`);
const PW = meta.W, PH = meta.H, S = meta.dsf;                          // css px of the instrument; the capture's scale
const crop = (x, w) => { const t = tex.clone(); t.repeat.set(w / PW, 1); t.offset.set(x / PW, 0); t.needsUpdate = true; return t; };
const flat = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
const scene = new THREE.Scene();
scene.background = col('#020203');
const synth = new THREE.Group(); scene.add(synth);
{
  const D = 34, bx = meta.woodL[1], bw = meta.woodR[0] - bx, X = (px) => px - PW / 2;
  const edge = flat({ color: col('#0b0b0c') }), back = flat({ color: col('#050505') });
  const body = new THREE.Mesh(new THREE.BoxGeometry(bw, PH, D), [edge, edge, edge, edge, flat({ map: crop(bx, bw) }), back]);
  body.position.set(X(bx + bw / 2), 0, -D / 2); synth.add(body);
  for (const [x, w] of [meta.woodL, meta.woodR]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, PH, D * 1.4), flat({ map: crop(x, w) }));
    c.position.set(X(x + w / 2), 0, -D * 1.4 / 2); synth.add(c);
  }
  // a thin lit rim on the top and bottom edges (light only where something emits it)
  const rim = flat({ color: col('#2a2a2e') });
  for (const y of [PH / 2, -PH / 2]) { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 1.2, 1.2), rim); m.position.set(X(bx + bw / 2), y, 0.3); synth.add(m); }
}
// coloured haze behind the synth (the product colours blooming in the dark): soft radial cards
const haze = (hex, x, y, z, s, a) => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, hex); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), flat({ map: new THREE.CanvasTexture(c), transparent: true, opacity: a, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.position.set(x, y, z); scene.add(m); return m;
};
haze(C.purple, -700, -300, -900, 2600, 0.55);
haze(C.red, 900, 350, -1100, 2200, 0.35);
haze(C.blue, 200, -700, -700, 1600, 0.25);

// ---------- post ----------
const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
const rtScene = new THREE.WebGLRenderTarget(W, H, { ...rtOpts, depthTexture: new THREE.DepthTexture(W, H, THREE.FloatType) });
const rtDof = new THREE.WebGLRenderTarget(W, H, rtOpts);
const rtA = new THREE.WebGLRenderTarget(W / 4, H / 4, rtOpts), rtB = new THREE.WebGLRenderTarget(W / 4, H / 4, rtOpts);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), qs = new THREE.Scene(); qs.add(quad);
const pass = (mat, target) => { quad.material = mat; r.setRenderTarget(target); r.render(qs, oc); };
const V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const sh = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: V, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });

// depth of field: gather over a golden-angle disc; each sample counts if its own blur reaches this pixel
// (so sharp things never smear onto blurred ones and the background still blurs behind edges)
const dof = sh(`
  varying vec2 vUv; uniform sampler2D tCol, tDep; uniform float near, far, focus, aperture, maxR; uniform vec2 px;
  float viewZ(vec2 uv){ float d = texture2D(tDep, uv).x; return (near * far) / ((far - near) * d - far); }
  float cocZ(float z){ return clamp(aperture * abs(z - focus) / z, 0., maxR); }
  void main(){
    float z0 = -viewZ(vUv), c0 = cocZ(z0); vec3 acc = texture2D(tCol, vUv).rgb; float wsum = 1.;
    const int N = 48; float ga = 2.39996323;
    for (int i = 1; i < N; i++) {
      float rr = sqrt(float(i) / float(N)) * maxR; float a = float(i) * ga;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * rr * px;
      float zs = -viewZ(uv), cs = cocZ(zs);
      // a sample counts if its blur reaches this pixel; one behind us may not blur more than we do
      float w = smoothstep(rr - 1., rr + 1., zs > z0 ? min(cs, c0) : cs);
      acc += texture2D(tCol, uv).rgb * w; wsum += w;
    }
    gl_FragColor = vec4(acc / wsum, 1.);
  }`, { tCol: { value: rtScene.texture }, tDep: { value: rtScene.depthTexture }, near: { value: 1 }, far: { value: 1 }, focus: { value: 500 }, aperture: { value: 30 }, maxR: { value: 26 * K }, px: { value: new THREE.Vector2(1 / W, 1 / H) } });
const bright = sh(`varying vec2 vUv; uniform sampler2D t; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = dot(c, vec3(.2126,.7152,.0722));
  gl_FragColor = vec4(c * smoothstep(.35, .9, l), 1.); }`, { t: { value: rtDof.texture } });
const blur = sh(`varying vec2 vUv; uniform sampler2D t; uniform vec2 d; void main(){ vec3 s = vec3(0.); float ws = 0.;
  for (int i = -8; i <= 8; i++) { float w = exp(-float(i*i) / 24.); s += texture2D(t, vUv + d * float(i)).rgb * w; ws += w; } gl_FragColor = vec4(s / ws, 1.); }`,
  { t: { value: null }, d: { value: new THREE.Vector2() } });
const fin = sh(`
  varying vec2 vUv; uniform sampler2D t, tGlow; uniform float time, glow, ca, grain, vig;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 37.0) * 43758.5453); }
  void main(){
    vec2 c = vUv - .5; float rr = length(c * vec2(1.7778, 1.));
    vec2 off = c * ca * rr * rr;                                           // colour fringes, growing towards the edges
    vec3 col = vec3(texture2D(t, vUv + off).r, texture2D(t, vUv).g, texture2D(t, vUv - off).b);
    col += texture2D(tGlow, vUv).rgb * glow;
    col *= mix(1., smoothstep(1.25, .25, rr), vig);                        // vignette
    // grade: cool violet shadows, warm highlights, blacks lifted to ~10/255, highlights rolled off below 235/255
    float l = dot(col, vec3(.2126,.7152,.0722));
    col += vec3(.012, .004, .03) * (1. - smoothstep(0., .25, l));
    col *= mix(vec3(1.), vec3(1.04, 1.0, .94), smoothstep(.35, 1., l));
    col = .04 + col * 1.08;
    col = col / (1. + max(col - .78, 0.) * 1.4);                           // soft knee: nothing clips
    col += (hash(vUv * 1000.) - .5) * grain;
    gl_FragColor = vec4(col, 1.);
  }`, { t: { value: rtDof.texture }, tGlow: { value: rtA.texture }, time: { value: 0 }, glow: { value: 0.9 }, ca: { value: 0.006 }, grain: { value: 0.012 }, vig: { value: 0.55 } });

const cam = new THREE.PerspectiveCamera(24, W / H, 20, 20000);
const draw = (i, focusDist, apert = 30) => {
  r.setRenderTarget(rtScene); r.render(scene, cam);
  Object.assign(dof.uniforms, {}); dof.uniforms.near.value = cam.near; dof.uniforms.far.value = cam.far; dof.uniforms.focus.value = focusDist; dof.uniforms.aperture.value = apert * K;
  pass(dof, rtDof);
  pass(bright, rtA);
  blur.uniforms.t.value = rtA.texture; blur.uniforms.d.value.set(1.6 / (W / 4), 0); pass(blur, rtB);
  blur.uniforms.t.value = rtB.texture; blur.uniforms.d.value.set(0, 1.6 / (H / 4)); pass(blur, rtA);
  fin.uniforms.time.value = i / FPS; pass(fin, null);
};

// ---------- shots ----------
const P = (px, py) => new THREE.Vector3(px - PW / 2, PH / 2 - py, 0);          // a point on the UI, from its css px
const lerp = (a, b, t) => a + (b - a) * t, ss = (t) => t * t * (3 - 2 * t);
const look = (pos, target, roll) => { cam.position.copy(pos); cam.up.set(Math.sin(roll), Math.cos(roll), 0); cam.lookAt(target); };

// the turning knob's box: its own layer just above the face, so only a small picture changes per frame
const knobLayer = (() => {
  const p = meta.patch, t = new THREE.Texture(); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), flat({ map: t }));
  m.position.copy(P(p.x + p.w / 2, p.y + p.h / 2)).setZ(0.05); m.visible = false; synth.add(m); return m;
})();
const SHOTS = {
  // 1: a slow slide along the oscillator row at a steep angle; the focus band holds on the knobs (3 s)
  slide: { frames: 75, run(i) {
    knobLayer.visible = false;
    const t = i / 74;
    const target = P(lerp(215, 255, t), 256);                                 // a slow drift along OSC A's knobs (~3 % of the frame a second)
    const pos = target.clone().add(new THREE.Vector3(-210, -260, 250));
    cam.fov = 26; cam.updateProjectionMatrix();
    look(pos, target, THREE.MathUtils.degToRad(4));
    draw(i, pos.distanceTo(target), 105);
  } },
  // 2: push in on the filter cutoff while it turns; the focus pulls from the filter curve to the knob (4 s)
  knob: { frames: 100, async run(i) {
    knobLayer.visible = true;
    const t = i / 99, k = await loadKnob(i), p = meta.patch;
    knobLayer.material.map.image = k; knobLayer.material.map.needsUpdate = true;
    const knob = P(p.cx, p.cy), curve = P(p.cx - 30, p.cy - 90);
    const dolly = lerp(1, 0.86, t);
    const pos = knob.clone().add(new THREE.Vector3(150, -150, 175).multiplyScalar(dolly));
    cam.fov = 24; cam.updateProjectionMatrix();
    look(pos, knob, THREE.MathUtils.degToRad(12));
    const f = ss(Math.min(1, Math.max(0, (t - 0.08) / 0.35)));                 // focus pull over 1.4 s, early in the shot
    draw(i, lerp(pos.distanceTo(curve), pos.distanceTo(knob), f), 115);
  } },
};
// 3: a text card typed in over a dark moving plate (3.2 s)
const plate = sh(`
  varying vec2 vUv; uniform float time; uniform vec3 a, b;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0., m = .5; for (int i = 0; i < 6; i++) { s += n(p) * m; p = p * 2.03 + vec2(1.7, 9.2); m *= .5; } return s; }
  void main(){
    vec2 p = (vUv - .5) * vec2(1.7778, 1.) * 2.2;
    vec2 q = vec2(fbm(p + time * .05), fbm(p + vec2(5.2, 1.3) - time * .04));
    float s = fbm(p + 2.4 * q + vec2(0., time * .06));
    float ink = smoothstep(.45, .95, s) * .55 + pow(smoothstep(.6, 1., s), 3.) * .6;   // wisps of ink in liquid
    vec3 c = mix(vec3(.012, .01, .02), a * 1.1, ink) + b * pow(ink, 2.) * .9;
    gl_FragColor = vec4(c * smoothstep(1.1, .2, length(vUv - .5) * 1.6), 1.);
  }`, { time: { value: 0 }, a: { value: col(C.purple) }, b: { value: col(C.phaser) } });
const tc = document.createElement('canvas'); tc.width = W; tc.height = H; const tg = tc.getContext('2d');
const ttex = new THREE.CanvasTexture(tc); ttex.colorSpace = THREE.NoColorSpace; ttex.premultiplyAlpha = true; ttex.generateMipmaps = false; ttex.minFilter = THREE.LinearFilter;
const over = sh(`varying vec2 vUv; uniform sampler2D a, b; void main(){ vec4 t = texture2D(b, vUv); gl_FragColor = vec4(texture2D(a, vUv).rgb * (1. - t.a) + t.rgb, 1.); }`,
  { a: { value: rtScene.texture }, b: { value: ttex } });
const font = new FontFace('Space Grotesk', 'url(/src/ui/fonts/space-grotesk.woff2)'); await font.load(); document.fonts.add(font);
SHOTS.card = { frames: 80, run(i) {
  plate.uniforms.time.value = 3 + i / FPS; pass(plate, rtScene);
  const L1 = 'A DARK CINEMATIC', L2 = 'SYNTHESIZER', typed = Math.max(0, Math.floor((i - 8) / 2));      // a letter every 2 frames
  tg.clearRect(0, 0, W, H);
  const cap = H * 0.058, sizePx = cap / 0.7;                                   // cap height 5.8 % of the frame
  tg.font = `500 ${sizePx}px "Space Grotesk"`; tg.textBaseline = 'alphabetic'; tg.letterSpacing = `${sizePx * 0.16}px`;
  const lines = [[L1, '#ececf0', H * 0.505], [L2, C.red, H * 0.505 + cap * 1.75]];
  let left = typed;
  for (const [txt, fill, y] of lines) {
    const shown = txt.slice(0, Math.max(0, left)); left -= txt.length;
    const w = tg.measureText(txt).width - sizePx * 0.16;
    tg.fillStyle = fill;
    tg.globalAlpha = 0.45; tg.shadowColor = fill; tg.shadowBlur = cap * 0.45; tg.fillText(shown, W / 2 - w / 2, y);   // soft glow
    tg.globalAlpha = 1; tg.shadowBlur = 0; tg.fillText(shown, W / 2 - w / 2, y);                                      // crisp letters
  }
  ttex.needsUpdate = true;
  pass(over, rtDof);
  pass(bright, rtA);
  blur.uniforms.t.value = rtA.texture; blur.uniforms.d.value.set(1.6 / (W / 4), 0); pass(blur, rtB);
  blur.uniforms.t.value = rtB.texture; blur.uniforms.d.value.set(0, 1.6 / (H / 4)); pass(blur, rtA);
  fin.uniforms.time.value = i / FPS; pass(fin, null);
} };

let shot;
window.setup = (name) => { shot = SHOTS[name]; return shot.frames; };
window.frame = async (i) => { await shot.run(i); r.getContext().finish(); return true; };
window.ready = true;
