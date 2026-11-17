// DEV ONLY: trailer test shots of RUIN-1 in 3D (references/trailers/RULES.md is the brief). Loaded by render.html,
// driven frame by frame by tools/trailer-render.mjs: window.setup(shot) then window.frame(i) for i = 0..frames-1.
// The synth is the real UI (tools/trailer-capture.mjs, 4x) on a thin slab with its wooden cheeks, in a dark space.
// Post: depth of field from the depth buffer (thin lens), glow, colour fringes at the edges, vignette, grade, grain.
// Two looks: 'ruin' (default: pure black, neutral shadows, siren glow, red halation) and 'artistry' (the references').
import * as THREE from '/website/vendor/three.module.min.js';
import { makeFluid } from './fluid.js';

const W = Number(new URLSearchParams(location.search).get('w') ?? 1920), H = Math.round(W * 9 / 16), FPS = 25, K = W / 1920;
// a page that hosts the engine (the website's live fire, website/fire.html) can set window.TRAILER: where its files are,
// live = draw into the page (cover-fitted) instead of a fixed-size frame, noSynth = no synth picture to load (bg shots)
const CFG = window.TRAILER ?? {};
const CAP = CFG.cap ?? '/renders/trailer/capture';
const meta = await (await fetch(`${CAP}/meta.json`)).json();
// raw(): a hex colour passed through untouched (this pipeline outputs its values as they are, like the website's picture)
const raw = (x) => new THREE.Color().setRGB(...[1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16) / 255), THREE.LinearSRGBColorSpace);
// the website's siren colours (website/DESIGN.md), the only light in RUIN-1's dark
// the house colours (owner's pick): orange #f25d07, red-orange #f23005, red #f20000; light falls off by transparency
const HOUSE = { orange: '#f25d07', redorange: '#f23005', red: '#f20000' };
const SIREN = { red: HOUSE.redorange, hot: HOUSE.orange, deep: HOUSE.red, core: HOUSE.orange, head: '#f3eee8' };
const C = { red: '#ea1f1f', orange: '#e83911', green: '#129b82', blue: '#5f64c8', purple: '#6c3a9c', sand: '#c09b6d', phaser: '#aa418e' };
const col = (h) => new THREE.Color(h);

const r = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
r.setPixelRatio(1); r.setSize(W, H, false); r.domElement.style.cssText = CFG.live ? 'display:block;width:100%;height:100%;object-fit:cover' : `width:${W}px;height:${H}px`;
r.outputColorSpace = THREE.LinearSRGBColorSpace; r.toneMapping = THREE.NoToneMapping;
document.body.append(r.domElement);

// ---------- the synth: a slab with the UI on its face, wooden cheeks either side ----------
const img = CFG.noSynth ? Object.assign(document.createElement('canvas'), { width: 8, height: 8 }) : await new THREE.ImageLoader().loadAsync(`${CAP}/base.png`);
const face = document.createElement('canvas'); face.width = img.width; face.height = img.height;
const fg = face.getContext('2d'); fg.drawImage(img, 0, 0);
const tex = new THREE.CanvasTexture(face);
tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = r.capabilities.getMaxAnisotropy(); tex.minFilter = THREE.LinearMipmapLinearFilter;
const knobs = [];
const loadKnob = async (i) => knobs[i] ??= await new THREE.ImageLoader().loadAsync(`${CAP}/knob/${String(i).padStart(3, '0')}.png`);
const PW = meta.W, PH = meta.H, S = meta.dsf;                          // css px of the instrument; the capture's scale
const crop = (x, w) => { const t = tex.clone(); t.repeat.set(w / PW, 1); t.offset.set(x / PW, 0); t.needsUpdate = true; return t; };
const flat = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
// the synth's face as a lit object (owner's call, away from the references' evenly self-lit screen): one hard light
// pool falling across the panel, the rest in shadow, and a faint sheen on the glossy face; the UI's own glowing parts
// (bright, coloured lines and values) keep their light. real = 0 is the old even look, 1 the full lit look.
const LIT = { real: { value: 0 }, lightAt: { value: new THREE.Vector3() }, lightR: { value: 260 },
  spL: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) } };          // sparks close to the face: x, y, height, brightness
const lit = (map) => new THREE.ShaderMaterial({ uniforms: { map: { value: map }, ...LIT },
  vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform sampler2D map; uniform float real, lightR; uniform vec3 lightAt; uniform vec4 spL[8]; varying vec2 vUv; varying vec3 vW;
    void main(){ vec3 c = texture2D(map, vUv).rgb;
      float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
      float glow = clamp(smoothstep(.45, .75, mx) + smoothstep(.35, .7, mx - mn), 0., 1.);    // what emits light itself
      vec2 d = (vW.xy - lightAt.xy) / lightR; d.x *= .8;
      float pool = smoothstep(1.15, .35, length(d));                                       // the light pool, a soft-edged hard light
      float lightF = .18 + .95 * pool;
      float sheen = smoothstep(.09, 0., abs(dot(vW.xy - lightAt.xy, normalize(vec2(.8, -.6))) / lightR - .55)) * pool * .05;
      vec3 litc = c * mix(lightF, 1., glow) + sheen;
      // a spark passing close to the face lights a small warm patch under it (wider and fainter the higher it is),
      // on the glossy face also a faint sheen of its own colour
      float sl = 0.;
      for (int k = 0; k < 8; k++) { vec4 q = spL[k]; float rad = 4. + q.z * 1.6; vec2 dd = vW.xy - q.xy;
        sl += q.w * exp(-dot(dd, dd) / (rad * rad)) / (1. + q.z * q.z / 40.); }
      litc += (c * 2.2 + .045) * vec3(.949, .365, .027) * sl;
      gl_FragColor = vec4(mix(c, litc, real), 1.); }` });
const scene = new THREE.Scene();
scene.background = col('#020203');
const synth = new THREE.Group(); scene.add(synth);
{
  const D = 34, bx = meta.woodL[1], bw = meta.woodR[0] - bx, X = (px) => px - PW / 2;
  const edge = flat({ color: col('#0b0b0c') }), back = flat({ color: col('#050505') });
  const body = new THREE.Mesh(new THREE.BoxGeometry(bw, PH, D), [edge, edge, edge, edge, lit(crop(bx, bw)), back]);
  body.position.set(X(bx + bw / 2), 0, -D / 2); synth.add(body);
  for (const [x, w] of [meta.woodL, meta.woodR]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, PH, D * 1.4), lit(crop(x, w)));
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
  m.position.set(x, y, z); m.userData.a = a; scene.add(m); return m;
};
// two looks: 'artistry' (the references' violet haze) and 'ruin' (the siren glow, fading to pure black)
const HAZE = {
  artistry: [haze(C.purple, -700, -300, -900, 2600, 0.55), haze(C.red, 900, 350, -1100, 2200, 0.35), haze(C.blue, 200, -700, -700, 1600, 0.25)],
  ruin: [haze(SIREN.deep, -600, -450, -900, 2800, 0.4), haze(SIREN.red, 800, -500, -1100, 2000, 0.32), haze(SIREN.hot, 300, -800, -800, 900, 0.22)],
};
const setLook = (look, keep = 1) => { for (const [k, ms] of Object.entries(HAZE)) for (const m of ms) { m.visible = k === look && keep > 0; m.material.opacity = m.userData.a * keep; } fin.uniforms.ruin.value = look === 'ruin' ? 1 : 0; };

// ---------- post ----------
const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
const rtScene = new THREE.WebGLRenderTarget(W, H, { ...rtOpts, depthTexture: new THREE.DepthTexture(W, H, THREE.FloatType) });
const rtDof = new THREE.WebGLRenderTarget(W, H, rtOpts), rtDof2 = new THREE.WebGLRenderTarget(W, H, rtOpts), rtSpark = new THREE.WebGLRenderTarget(W, H, rtOpts);
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
    // 112 samples on a golden-angle spiral, turned by a different angle for every pixel (fixed patterns showed as
    // doubled copies of each letter); the leftover grain is smoothed by the next pass
    const int N = 112; float ga = 2.39996323;
    float rot = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
    for (int i = 1; i < N; i++) {
      float rr = sqrt((float(i) + .5) / float(N)) * maxR; float a = float(i) * ga + rot;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * rr * px;
      float zs = -viewZ(uv), cs = cocZ(zs);
      // a sample counts if its blur reaches this pixel; one behind us may not blur more than we do
      float w = smoothstep(rr - 1., rr + 1., zs > z0 ? min(cs, c0) : cs);
      acc += texture2D(tCol, uv).rgb * w; wsum += w;
    }
    gl_FragColor = vec4(acc / wsum, 1.);
  }`, { tCol: { value: rtScene.texture }, tDep: { value: rtScene.depthTexture }, near: { value: 1 }, far: { value: 1 }, focus: { value: 500 }, aperture: { value: 30 }, maxR: { value: 26 * K }, px: { value: new THREE.Vector2(1 / W, 1 / H) } });
// smoothing after the depth of field: each pixel averages a small ring scaled by its own blur (sharp pixels untouched)
const dofSmooth = sh(`
  varying vec2 vUv; uniform sampler2D tCol, tDep; uniform float near, far, focus, aperture, maxR; uniform vec2 px;
  float viewZ(vec2 uv){ float d = texture2D(tDep, uv).x; return (near * far) / ((far - near) * d - far); }
  void main(){ float z = -viewZ(vUv), c = clamp(aperture * abs(z - focus) / z, 0., maxR);
    vec3 s = texture2D(tCol, vUv).rgb; float r = c * .22;
    if (r > .6) { vec3 a = s * 2.; float w = 2.;
      for (int i = 0; i < 12; i++) { float an = float(i) * .5235988; a += texture2D(tCol, vUv + vec2(cos(an), sin(an)) * r * px).rgb; w += 1.;
        a += texture2D(tCol, vUv + vec2(cos(an + .26), sin(an + .26)) * r * .5 * px).rgb; w += 1.; }
      s = a / w; }
    gl_FragColor = vec4(s, 1.); }`, { tCol: { value: rtDof2.texture }, tDep: { value: rtScene.depthTexture }, near: { value: 1 }, far: { value: 1 }, focus: { value: 500 }, aperture: { value: 30 }, maxR: { value: 26 * K }, px: { value: new THREE.Vector2(1 / W, 1 / H) } });
const bright = sh(`varying vec2 vUv; uniform sampler2D t; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = dot(c, vec3(.2126,.7152,.0722));
  gl_FragColor = vec4(c * smoothstep(.35, .9, l), 1.); }`, { t: { value: rtDof.texture } });
const blur = sh(`varying vec2 vUv; uniform sampler2D t; uniform vec2 d; void main(){ vec3 s = vec3(0.); float ws = 0.;
  for (int i = -8; i <= 8; i++) { float w = exp(-float(i*i) / 24.); s += texture2D(t, vUv + d * float(i)).rgb * w; ws += w; } gl_FragColor = vec4(s / ws, 1.); }`,
  { t: { value: null }, d: { value: new THREE.Vector2() } });
const fin = sh(`
  varying vec2 vUv; uniform sampler2D t, tGlow, tSmoke, tSmokeImg, tSpark, tFlA, tFlB, tLight; uniform float time, glow, ca, grain, vig, ruin, fire, dark, burn, film, flare, halo, og, smoke, tint, fineSp, fluid, clearTxt, clearY, subjOn; uniform vec2 subj;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 37.0) * 43758.5453); }
  float h2(vec2 p){ return fract(sin(dot(p, vec2(41.31, 289.13))) * 43758.5453); }
  float sn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
  float sfbm(vec2 p){ float s = 0., m = .5; for (int i = 0; i < 5; i++) { s += sn(p) * m; p = p * 2.02 + vec2(1.3, 7.1); m *= .5; } return s; }
  void main(){
    vec2 c = vUv - .5; float rr = length(c * vec2(1.7778, 1.));
    vec2 off = c * ca * rr * rr;                                           // colour fringes, growing towards the edges
    vec3 col = vec3(texture2D(t, vUv + off).r, texture2D(t, vUv).g, texture2D(t, vUv - off).b);
    col += texture2D(tGlow, vUv).rgb * glow;
    col *= mix(1., smoothstep(1.25, .25, rr), vig);                        // vignette
    vec3 g = texture2D(tGlow, vUv).rgb;
    if (ruin < .5) {
      // the references' grade: cool violet shadows, warm highlights, blacks lifted to ~10/255
      float l = dot(col, vec3(.2126,.7152,.0722));
      col += vec3(.012, .004, .03) * (1. - smoothstep(0., .25, l));
      col *= mix(vec3(1.), vec3(1.04, 1.0, .94), smoothstep(.35, 1., l));
      col = .04 + col * 1.08;
    } else {
      // RUIN-1: pure black, neutral shadows (the module colours untouched), highlights bloom warm with a red halation
      col += vec3(1., .198, .021) * dot(g, vec3(.2126,.7152,.0722)) * .55 * halo;   // red bleed round bright lines (film halation), #f23005
      col = max(col * 1.1 - .006, 0.);                                     // the floor is black, not grey
      if (fire > 0.) {
        // firelight: a warm, flickering spill rising from below the frame, highlights pushed to hot orange; black stays black
        float fl = .86 + .08 * sin(time * 9.1) + .06 * sin(time * 5.3 + 1.7) * sin(time * 13.7);
        float spill = smoothstep(1.05, -.1, vUv.y) * fl, l2 = dot(col, vec3(.2126,.7152,.0722));
        col *= mix(vec3(1.), mix(vec3(1.), vec3(1., .384, .029), .32) * 1.18, fire * (.45 + .55 * spill));   // a warm cast towards #f25d07
        col += vec3(1., .198, .021) * fire * spill * (.035 * smoothstep(.0, .08, l2) + .02);                   // the spill: #f23005
        col = mix(col, col * mix(vec3(1.), vec3(1., .384, .029), .4) * 1.08, fire * smoothstep(.45, 1., l2) * .6);   // highlights towards #f25d07
      }
    }
    float lum = dot(col, vec3(.2126,.7152,.0722));
    if (dark > 0.) {
      // the frame mostly black: a deep vignette and crushed shadows (everything dim sinks to black)
      col *= mix(1., smoothstep(1.0, .12, rr), dark * .9);
      col *= mix(1., smoothstep(.03, .22, lum), dark * .85);
    }
    vec3 ORANGE = vec3(1., .384, .029);                                    // #f25d07
    if (flare > 0.) col = col + ORANGE * flare * (.7 + .5 * smoothstep(1.2, 0., rr)) + vec3(1., .75, .55) * flare * flare * .6;   // an overexposed flare on the cut
    if (burn > 0.) {
      // blown out: highlights burn into house orange and clip, with a big orange bloom
      col += g * vec3(1., .5, .16) * burn * 1.1;
      float hl = smoothstep(.45, 1., dot(col, vec3(.2126,.7152,.0722)));
      col = mix(col, ORANGE * 1.7, hl * .38 * burn) * (1. + .22 * burn);
      col = min(col, 1.);
    } else col = col / (1. + max(col - .86, 0.) * 1.6);                    // soft knee: nothing clips
    if (film > 0.) {
      // burnt film: dust (dark and pale specks, a new handful each frame) and the odd scratch that lingers a few frames
      float fr = floor(time * 25.), fr6 = floor(time * 25. / 5.);
      vec2 cell = floor(vUv * vec2(640., 360.));
      // round, soft-edged flecks of random size (a cell holds at most one, placed and sized at random)
      vec2 g1 = vUv * vec2(320., 180.), c1 = floor(g1), g2 = vUv * vec2(110., 62.), c2 = floor(g2);
      float r1 = .12 + .3 * h2(c1 + fr * 1.9), r2 = .1 + .32 * h2(c2 + fr * 2.3);
      float sp1 = smoothstep(r1, r1 * .45, length(fract(g1) - .5 - (vec2(h2(c1 + 3.1 + fr), h2(c1 + 5.7 + fr)) - .5) * .4));
      float sp2 = smoothstep(r2, r2 * .5, length(fract(g2) - .5 - (vec2(h2(c2 + 1.3 + fr), h2(c2 + 8.2 + fr)) - .5) * .3));
      float dk = sp1 * step(.9975, h2(c1 + fr * 7.13)), dl = sp1 * step(.9988, h2(c1 * 1.7 + fr * 3.71));
      float blob = sp2 * step(.9965, h2(c2 + fr * 1.37));                    // bigger flecks
      col *= 1. - (dk + blob) * .85 * film; col += vec3(.75, .72, .68) * dl * .5 * film;
      float sx = h2(vec2(fr6, 4.2)), on = step(.45, h2(vec2(fr6, 9.1)));
      float scr = on * smoothstep(.0009, 0., abs(vUv.x - sx - .002 * sin(vUv.y * 30. + fr6)));
      col = mix(col, vec3(.8, .78, .74), scr * .35 * film * smoothstep(0., .2, h2(vec2(floor(vUv.y * 60.), fr6))));
    }
    if (smoke > 0.) {
      // the owner's own painted smoke (lifted from their Photoshop), drifting up and curling slowly so it lives
      vec2 q = vUv + vec2(0., -time * .006);
      vec2 wv = vec2(sn(q * 3. + vec2(time * .25, 0.)) - .5, sn(q * 3. + vec2(5.2, time * .2)) - .5) * .012;
      float sk = texture2D(tSmokeImg, vec2(q.x, 1. - q.y) + wv).r;
      col += vec3(.56, .54, .52) * sk * .27 * smoke;
    }
    if (fluid > 0.) {
      // simulated smoke: two layers between the lens and the synth (near, soft; mid, sharper), lit faintly warm
      float a1 = texture2D(tFlA, vUv).r;
      if (abs(fluid - 3.) < .001) { vec4 q = texture2D(tFlA, vUv); gl_FragColor = vec4(q.r * 3., q.g / max(q.r, 1e-5) * .5, 0., 1.); return; }
      if (abs(fluid - 2.) < .001) { gl_FragColor = vec4(a1 * 3., 0., 0., 1.); return; }   // fluid=2 exactly: show the raw smoke (any other amount is the lit smoke)
      // lit by the scene: smoke glows with the light around it (the UI, the sparks), is nearly invisible in the dark,
      // and dims what is behind it a little where it is thick; its own faint colour leans to #f25d07
      vec3 Lt = texture2D(tLight, vUv).rgb;
      float sa = clamp(a1 * 3.5, 0., 1.);
      // the smoke never covers the subject (trailer shots): it thins to almost nothing in a soft oval round the spot in
      // focus, a little larger than the sharp area, and stays as it was elsewhere
      if (subjOn > 0.) { vec2 e = (vUv - subj) * vec2(1920., 1080.) / 300.; sa *= 1. - .92 * smoothstep(1.3, .45, length(e)); }
      if (clearTxt > 0.) { vec2 e = (vUv - vec2(.5, clearY)) / vec2(.2, .19); sa *= 1. - clearTxt * .88 * smoothstep(1.25, .35, length(e)); }   // dark round the logo and text
      vec3 amb = mix(vec3(.09, .085, .08), vec3(.949, .365, .027) * .1, .4);
      col = col * (1. - .2 * sa * fluid) + (Lt * 7. + amb) * sa * fluid;
    }
    if (og > 0.) {
      // the owner's grade, fitted to their Photoshop of the slide: lift, gain and gamma per channel, then saturation
      vec3 o = vec3(0.0245, 0.0129, 0.0066) + vec3(1.2652, 1.2913, 1.3680) * pow(clamp(col, 0., 1.), vec3(1.3340, 1.3419, 1.3694));
      float lo = dot(o, vec3(.2126,.7152,.0722)); o = lo + (o - lo) * 0.8728;
      col = mix(col, o, og);
    }
    if (fineSp > 0.) {
      // fine sparks, laid in after the grade in exactly #f25d07: a solid core, and a faint glow of the same colour
      // colour follows temperature, in the house colours only: hot #f25d07, cooling #f23005, cool #f20000 fading out;
      // the glow round a spark is one step cooler than its core (as a glowing thing looks through a lens)
      vec4 sp = texture2D(tSpark, vUv); float I = sp.r, Tc = sp.g / max(sp.r, 1e-4), Gr = 0., Gg = 0.;
      for (int k = 0; k < 12; k++) { float an = float(k) * .5236;
        vec4 a1 = texture2D(tSpark, vUv + vec2(cos(an), sin(an)) * vec2(4.5 / 1920., 4.5 / 1080.)), a2 = texture2D(tSpark, vUv + vec2(cos(an + .26), sin(an + .26)) * vec2(9. / 1920., 9. / 1080.));
        Gr += a1.r + a2.r * .6; Gg += a1.g + a2.g * .6; }
      float Tg = Gg / max(Gr, 1e-4) - .34;
      vec3 HOT = vec3(.949, .365, .027), MID = vec3(.949, .188, .02), RED = vec3(.949, 0., 0.);
      vec3 cc = Tc > .66 ? HOT : Tc > .33 ? MID : RED, gc = Tg > .66 ? HOT : Tg > .33 ? MID : RED;
      float core = clamp(I * 3., 0., 1.) * (Tc > .33 ? 1. : max(Tc, 0.) / .33);   // the coolest fade into the dark, never darker colours
      col += gc * clamp(Gr / 19., 0., 1.) * .55 * (1. - core);
      col = mix(col, cc, core);
    }
    if (tint > 0.) { float lt = dot(col, vec3(.2126,.7152,.0722)); vec3 T = vec3(.949, .365, .027) / dot(vec3(.949, .365, .027), vec3(.2126,.7152,.0722));
      col = mix(col, lt * T, tint * smoothstep(.0, .25, lt)); }                  // a wash of #f25d07 over the image
    col += (hash(vUv * 1000.) - .5) * grain;
    gl_FragColor = vec4(col, 1.);
  }`, { t: { value: rtDof.texture }, tGlow: { value: rtA.texture }, time: { value: 0 }, glow: { value: 0.9 }, ca: { value: 0.006 }, grain: { value: 0.012 }, vig: { value: 0.55 }, ruin: { value: 1 }, fire: { value: 0 }, dark: { value: 0 }, burn: { value: 0 }, film: { value: 0 }, flare: { value: 0 }, halo: { value: 1 }, og: { value: 0 }, tint: { value: 0 }, fineSp: { value: 0 }, fluid: { value: 0 }, clearTxt: { value: 0 }, clearY: { value: .17 }, subjOn: { value: 0 }, subj: { value: new THREE.Vector2(.5, .5) }, tFlA: { value: null }, tFlB: { value: null }, tSpark: { value: rtSpark.texture }, smoke: { value: 0 }, tSmoke: { value: null }, tSmokeImg: { value: null } });

// the glow: two rounds of a 17-tap blur in 1-texel steps at quarter size (coarser steps showed as stripes)
const glowBlur = () => { for (let k = 0; k < 2; k++) {
  blur.uniforms.t.value = rtA.texture; blur.uniforms.d.value.set(1 / (W / 4), 0); pass(blur, rtB);
  blur.uniforms.t.value = rtB.texture; blur.uniforms.d.value.set(0, 1 / (H / 4)); pass(blur, rtA); } };
const cam = new THREE.PerspectiveCamera(24, W / H, 20, 20000);
// ---------- smoke: thousands of tiny particles traced through a slowly turning flow field, each leaving a faint trail;
// together they make fine, flowing, hair-like fibres (owner's paint-over). Drawn at half size, then softened.
const SMW = Math.round(W / 2), SMH = Math.round(H / 2);
const smk = document.createElement('canvas'); smk.width = SMW; smk.height = SMH; const sg = smk.getContext('2d');
const smTex = new THREE.CanvasTexture(smk); smTex.colorSpace = THREE.NoColorSpace; smTex.minFilter = THREE.LinearFilter; smTex.generateMipmaps = false;
fin.uniforms.tSmoke.value = smTex;
{ const st = await new THREE.TextureLoader().loadAsync(CFG.smoke ?? '/tools/trailer/smoke-owner.png'); st.colorSpace = THREE.NoColorSpace; st.flipY = false; fin.uniforms.tSmokeImg.value = st; }
const vh = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
const vnoise = (x, y, z) => { const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t, c = (i, j, k) => vh(xi + i, yi + j, zi + k);
  return L(L(L(c(0,0,0), c(1,0,0), u), L(c(0,1,0), c(1,1,0), u), v), L(L(c(0,0,1), c(1,0,1), u), L(c(0,1,1), c(1,1,1), u), v), w); };
const pot = (x, y, t) => vnoise(x * 2.2, y * 2.2, t) + .5 * vnoise(x * 4.7 + 3, y * 4.7 + 1, t * 1.3) + .25 * vnoise(x * 9.1 + 7, y * 9.1 + 5, t * 1.7);
const drawSmoke = (time) => {
  sg.globalCompositeOperation = 'source-over'; sg.fillStyle = '#000'; sg.fillRect(0, 0, SMW, SMH);
  sg.globalCompositeOperation = 'lighter'; sg.lineWidth = 0.75;
  let a = 4242; const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  const e = 0.004, t = time * .12;
  // two narrow sources at the left edge feed one or two ribbons that wander and curl; each trail fades as it goes
  const SRC = [[.0, .26, .05], [.02, .52, .035]];
  for (let n = 0; n < 2400; n++) {
    const [sx, sy, sw] = SRC[n % 5 < 3 ? 0 : 1];
    let x = sx + rnd() * .03, y = sy + (rnd() + rnd() - 1) * sw * 1.3, op = .006 + rnd() * .012;
    for (let k = 0; k < 160; k++) {
      const dpx = (pot(x + e, y, t) - pot(x - e, y, t)) / (2 * e), dpy = (pot(x, y + e, t) - pot(x, y - e, t)) / (2 * e);
      const nx = x + dpy * .0024 + .0017 + (rnd() - .5) * .0002, ny = y - dpx * .0024 - .0003 + (rnd() - .5) * .0003;   // a little scatter: the fibres fan out
      sg.strokeStyle = `rgba(140,134,128,${(op * (1 - k / 160)).toFixed(4)})`;
      sg.beginPath(); sg.moveTo(x * SMW, y * SMH); sg.lineTo(nx * SMW, ny * SMH); sg.stroke();
      x = nx; y = ny; if (x > .62 || y < -.05 || y > 1.05) break;
    }
  }
  // fade the smoke out towards the right and soften it a touch
  sg.globalCompositeOperation = 'destination-in'; const gr = sg.createLinearGradient(0, 0, SMW * .62, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(.55, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  sg.fillStyle = gr; sg.fillRect(0, 0, SMW, SMH); sg.globalCompositeOperation = 'source-over';
  smTex.needsUpdate = true; };

// ---------- sparks: real 3D particles drifting up through the shot ----------
// Drawn after the depth of field as discs sized by their own blur (the same thin-lens formula), so sparks near the
// lens become soft bokeh and sparks in the focus plane stay pinpoint (the website's single-pixel embers). They are
// always born and kept in front of the panel's face, so nothing needs hiding. Each spark is drawn at 4 moments inside the frame: a little motion blur.
const NSP = 45, NASH = 90, SUB = 22, NSPW = 1110, NCH = 160;   // (+ NCH: the small sparks a crackling spark splits into)                      // sparks, ash flakes, sparks in the world volume (sparks=0.65: 720)
const spGeo = new THREE.BufferGeometry();
spGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NSPW + NCH + NASH) * SUB * 3), 3));
spGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((NSPW + NCH + NASH) * SUB * 3), 3));
const spMat = new THREE.ShaderMaterial({
  uniforms: { world: { value: 0 }, szk: { value: 5.5 }, fine: { value: 0 }, tDep: { value: rtScene.depthTexture }, res: { value: new THREE.Vector2(W, H) }, near: { value: 1 }, far: { value: 1 }, focus: { value: 500 }, aperture: { value: 30 }, maxR: { value: 26 * K } },
  vertexShader: `attribute vec3 color; uniform float focus, aperture, maxR, fine, world, szk; varying vec3 vCol; varying float vZ, vR, vS;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); float z = -mv.z;
      float c = clamp(aperture * abs(z - focus) / z, 0., maxR * 1.3); vR = max(1.7, c); vZ = z;
      // fine sparks: in the focus band a 1.3 px core in an 11 px glow; away from it the same light spread over its blur,
      // exactly as the synth blurs there (same thin-lens formula)
      // world=1 (trailer shots): a spark has a real size, so it is bigger the closer it is (5.5 px at the slide shot's 418)
      vS = world > .5 ? szk / z : 5.5;
      if (fine > .5) vR = max(vS, c * 1.25);
      vCol = color * (fine > .5 ? (world > .5 ? .85 : .55) * min(1., (world > .5 ? vS * vS : 30.) / (vR * vR)) : vR < 2.5 ? 3.2 : max(.11, 2.4 / (vR * vR)));      // in focus: a hot pinpoint; out of focus: the same light spread thin
      gl_PointSize = vR * 2. + 2.; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform sampler2D tDep; uniform vec2 res; uniform float near, far, fine, world; varying vec3 vCol; varying float vZ, vR, vS;
    void main(){ float d = texture2D(tDep, gl_FragCoord.xy / res).x; float sz = -(near * far) / ((far - near) * d - far);
      if (world > .5 && vZ > sz + 3.) discard;                                            // hidden behind the synth
      float r = length(gl_PointCoord * 2. - 1.);
      float e = fine > .5 ? (vR < vS * 1.18 ? (world > .5 ? exp(-r * r * 42.) + .2 * exp(-r * r * 4.) : exp(-r * r * 30.) + .16 * exp(-r * r * 3.)) : smoothstep(1., .55, r) * .9)   // sharp streak, or a soft disc          // fine: hot core and its glow
        : vR > 2.5 ? smoothstep(1., .7, r) * (.55 + .3 * smoothstep(.5, .92, r)) : exp(-r * r * 4.);   // bokeh: a disc with a brighter rim
      gl_FragColor = vec4(vCol * e, 1.); }`,
  blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true });
const spScene = new THREE.Scene(), spPts = new THREE.Points(spGeo, spMat); spPts.frustumCulled = false; spScene.add(spPts);   // never culled (its bounds move with every shot)
const SPC = [[.949, .365, .027], [.949, .188, .02], [.949, 0, 0], [.52, 0, 0]].map((c) => c.map((v) => v * 3.2));  // #f25d07, #f23005, #f20000, #f20000 fading (×brightness)
const ASH = [.62, .6, .57];                                                         // grey-white flakes, lit, not glowing
const sparks0 = { on: false, ash: false, t: 0, list: [], focus: 400, rnd: Math.random };
// sparks are born inside the camera's view: most near the focus plane (sharp pinpoints), a few close to the lens (bokeh)
const sparks = Object.assign(sparks0, {});
const spSpawn = (s, anywhere) => { const R = sparks.rnd, f = sparks.focus;
  const v = new THREE.Vector3((R() * 2 - 1) * 1.15, anywhere ? R() * 2.3 - 1.15 : s.ash ? 1.15 + R() * .1 : -1.15 - R() * .1, .5).unproject(cam).sub(cam.position).normalize();
  const u = R(); let dist = f * (u < .6 ? .975 + .04 * R() : u < .85 ? .62 + .3 * R() : .22 + .3 * R());   // 60 % sharp, 25 % soft, 15 % big bokeh
  if (v.z < 0) dist = Math.min(dist, (cam.position.z - 2) / -v.z * (.8 + .18 * R()));       // always in front of the panel (its face is z = 0)
  s.x = cam.position.x + v.x * dist; s.y = cam.position.y + v.y * dist; s.z = cam.position.z + v.z * dist; s.prev = null;
  const sp = f * (.04 + R() * .1);                                         // floating embers: half the earlier speed
  s.vx = (R() - .3) * sp * .25; s.vy = sp; s.vz = 0; s.ph = R() * 6.28; s.b = .35 + Math.pow(R(), 2) * 1.2; s.max = 2.6 + R() * 3;
  s.t0 = .5 + .5 * Math.pow(R(), .7); s.vy *= .6 + .6 * s.t0; s.vx *= .6 + .6 * s.t0;   // how hot it is born: hotter sparks fly faster
  if (!s.ash && spMat.uniforms.fine.value > .5) { s.vx = sp * (.5 + R() * .6) * (R() < .3 ? -1 : 1); }   // fine sparks fly on a diagonal
  if (s.ash) { s.vy = -f * (.025 + R() * .05); s.vx = (R() - .5) * f * .03; s.b = .45 + R() * .7; s.max = 6 + R() * 6; }   // ash: slow, falling, drifting
  s.life = anywhere ? R() * s.max : s.max; return s; };
// world=1 (every trailer shot): the sparks live in one fixed volume round the synth instead of in the camera's view,
// with real speeds and sizes (tuned so the slide shot, 418 units away, looks as before), so a close shot sees fewer,
// bigger, faster sparks, as a lens would. Denser near the face; some behind its plane, past its edges (hidden by the
// synth). A spark that reaches the face glances off it, slowed, and cools fast; one that meets the body's edge from
// beside or below bounces off it and dies.
const REF = 418, SPB = { x0: -PW / 2 - 250, x1: PW / 2 + 250, y0: -PH / 2 - 300, y1: PH / 2 + 300, zb: -120, z1: 420 };
const inPanel = (x, y) => Math.abs(x) < PW / 2 && Math.abs(y) < PH / 2;
const spSpawnW = (s, anywhere) => { const R = sparks.rnd, B = SPB;
  s.x = lerp(B.x0, B.x1, R()); s.y = lerp(B.y0, B.y1, R());
  if (R() < .15) { s.z = B.zb * R(); if (inPanel(s.x, s.y)) s.z = -s.z; }
  else s.z = -130 * Math.log(1 - R() * (1 - Math.exp(-B.z1 / 130)));            // denser close to the face
  s.prev = null; const sp = REF * (.04 + R() * .1);
  s.vy = sp; s.vz = (R() - .62) * REF * .035; s.ph = R() * 6.28; s.b = .35 + Math.pow(R(), 2) * 1.2; s.max = 2.6 + R() * 3;
  s.t0 = .5 + .5 * Math.pow(R(), .7); s.vy *= .6 + .6 * s.t0;
  s.vx = sp * (.5 + R() * .6) * (R() < .3 ? -1 : 1);   // on a diagonal, as before
  s.kind = 0; s.flare = 0; s.fr = 16 + R() * 14;                                   // flicker rate (Hz)
  if (R() < .12) {                                                                   // a real spark: thrown fast on a slight arc, a long streak, short-lived
    const a = (R() - .5) * 1.8, v = REF * (.45 + R() * .5); s.kind = 1;
    s.vx = Math.sin(a) * v; s.vy = Math.cos(a) * v; s.vz = (R() - .6) * v * .3; s.max = .6 + R() * 1; s.t0 = .85 + R() * .15; s.b = .8 + R() * .8; }
  s.life = anywhere ? R() * s.max : s.max; s.born = anywhere ? 1 : 0; return s; };
// crackle: a hot spark now and then splits into two or three small ones with a short flare
const spSplit = (s) => { const R = sparks.rnd; let n = 2 + (R() < .4 ? 1 : 0); s.flare = 1;
  for (const c of sparks.list) { if (c.kind !== 2 || c.life > 0) continue;
    const a = R() * 6.28, b = (R() - .3) * 2, v = REF * (.25 + R() * .35);
    Object.assign(c, { x: s.x, y: s.y, z: Math.max(1, s.z), prev: null, vx: s.vx * .5 + Math.cos(a) * v, vy: s.vy * .5 + Math.abs(Math.sin(a)) * v * .8, vz: b * v * .3,
      max: .25 + R() * .45, t0: 1, b: s.b * .65, born: 1, flare: 0, ph: R() * 6.28, fr: 22 + R() * 14 }); c.life = c.max;
    if (--n === 0) break; } };
// the smoke's own currents, read back from its simulation once a frame (above the synth): sparks are carried by them
const flow = { on: false, data: new Float32Array(64 * 36 * 4), c: new THREE.Vector3(), w: 1, h: 1, k: 0 };
const flowAt = (x, y) => { const u = (x - flow.c.x) / flow.w + .5, v = (y - flow.c.y) / flow.h + .5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return [0, 0];
  const i = (Math.min(35, Math.floor(v * 36)) * 64 + Math.min(63, Math.floor(u * 64))) * 4; return [flow.data[i] * flow.k * flow.w, flow.data[i + 1] * flow.k * flow.h]; };
const sparksStepW = (s, dt) => {
  if (s.kind === 2 && s.life <= 0) return;                                           // an unused crackle spark
  if (s.kind === 1) { const d = Math.exp(-dt * 1.1); s.vx *= d; s.vz *= d; s.vy = s.vy * d + REF * .06 * dt; }   // drag, and the heat still lifts it
  else if (s.kind === 2) { const d = Math.exp(-dt * 2); s.vx *= d; s.vy *= d; s.vz *= d; }
  else s.vx += Math.sin(sparks.t * .07 + s.ph) * REF * .006;
  s.born = Math.min(1, s.born + dt / .3); s.flare = Math.max(0, s.flare - dt / .12);
  if (flow.on) { const [fx, fy] = flowAt(s.x, s.y); s.x += fx * dt; s.y += fy * dt; }
  if (s.kind === 0 && s.t0 > .7 && sparks.rnd() < .06 * dt) spSplit(s);
  const was = inPanel(s.x, s.y);
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += (s.vz + Math.sin(sparks.t * .07 + s.ph * 2) * REF * .02) * dt; s.life -= dt;
  if (inPanel(s.x, s.y)) {
    if (s.z < .8 && was && s.z > -6) { s.z = .8; s.vz = Math.abs(s.vz) * .35 + 3; s.vx *= .7; s.vy *= .55; s.life = Math.min(s.life, .25 * s.max); }   // glances off the face
    else if (s.z < 0) { s.x = s.prev[0]; s.y = s.prev[1]; s.vy *= -.25; s.vx *= -.4; s.life = Math.min(s.life, .5); }                                   // the body's edge
  }
  const B = SPB; if (s.kind === 2) { if (s.life <= 0 || s.y > B.y1) s.life = 0; return; }
  if (s.life <= 0 || s.y > B.y1 || s.x < B.x0 || s.x > B.x1 || s.z > B.z1 + 60 || s.z < B.zb - 30) spSpawnW(s); };
const sparksReset = () => {
  let a = 987654; sparks.rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  sparks.t = -1; sparks.list = [];
};
const sparksStep = () => { sparks.t++; const dt = 1 / FPS, q = new THREE.Vector3();
  if (sparks.world) {
    if (!sparks.list.length) sparks.list = [...Array.from({ length: Math.round(NSPW * sparks.on) }, () => spSpawnW({}, true)),
      ...Array.from({ length: NCH }, () => ({ kind: 2, life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, b: 0, t0: 1, born: 1, flare: 0, ph: 0, fr: 20 }))];
    for (const s of sparks.list) { s.prev = [s.x, s.y, s.z]; sparksStepW(s, dt); } return; }
  if (!sparks.list.length) sparks.list = [...Array.from({ length: Math.round(NSP * sparks.on) }, () => spSpawn({}, true)), ...Array.from({ length: Math.round(NASH * sparks.ash) }, () => spSpawn({ ash: true }, true))];   // sparks=0.5: half as many
  for (const s of sparks.list) { s.prev = [s.x, s.y, s.z];
    s.vx += Math.sin(sparks.t * (s.ash ? .04 : .07) + s.ph) * sparks.focus * (s.ash ? .004 : .006); s.x += s.vx * dt; s.y += s.vy * dt; s.z = Math.max(1, s.z + Math.sin(sparks.t * .07 + s.ph * 2) * sparks.focus * .02 * dt); s.life -= dt;   // never behind the panel's face (z = 0)
    q.set(s.x, s.y, s.z).project(cam);
    if (s.life <= 0 || q.y > 1.3 || q.y < -1.3 || Math.abs(q.x) > 1.4 || q.z > 1) spSpawn(s); } };
const sparksDraw = (focusDist, apert) => {
  const P_ = spGeo.attributes.position.array, C_ = spGeo.attributes.color.array; let k = 0;
  const vm = cam.matrixWorldInverse, v = new THREE.Vector3();
  for (const s of sparks.list) {
    // a spark that will be a big soft disc gets no motion-blur copies (they showed as a stack of discs)
    const z = -v.set(s.x, s.y, s.z).applyMatrix4(vm).z, blurred = apert * K * Math.abs(z - focusDist) / z > 3;
    if (blurred && spMat.uniforms.fine.value < .5) s.prev = [s.x, s.y, s.z];   // (fine sparks always keep their streak)
    const fineS = spMat.uniforms.fine.value > .5;
    const f = s.life / s.max, T = s.t0 * (.25 + .75 * f), c = s.ash ? ASH : fineS ? [1, T, 0] :   // fine sparks: red = light, green = light x temperature (coloured after the grade)
       f > .7 ? SPC[0] : f > .45 ? SPC[1] : f > .18 ? SPC[2] : SPC[3];
    // ash glints as it tumbles and fades in and out; sparks fade as they die
    const fade = (s.ash ? Math.min(1, f * 4, (1 - f) * 8) * (.45 + .55 * Math.abs(Math.sin(sparks.t * .09 + s.ph))) : Math.min(1, f * 6) * (fineS ? .55 + .45 * T : 1)) / SUB * 1.6 * s.b * (sparks.world ? s.born : 1);   // cooler sparks are dimmer
    const sh = spMat.uniforms.fine.value > .5 && !s.ash ? (sparks.world ? [.55, 1, .8][s.kind] : .55) : 1;   // fine sparks: a long shutter, a streak (real sparks the longest)
    const W_ = sparks.world && fineS && s.life > 0;
    for (let j = 0; j < SUB; j++) { const u = 1 - (1 - j / SUB) * sh, pr = s.prev ?? [s.x, s.y, s.z];
      P_[k] = pr[0] + (s.x - pr[0]) * u; P_[k + 1] = pr[1] + (s.y - pr[1]) * u; P_[k + 2] = pr[2] + (s.z - pr[2]) * u;
      if (W_) {
        // a spark, not a particle: the head hot, the tail cooler; it flickers fast as it burns (beads along a streak);
        // a short flare when it crackles
        const h = j / (SUB - 1), tt = (sparks.t - 1 + h * sh) / FPS;
        const fl = .35 + .65 * (.5 + .5 * Math.sin(tt * s.fr * 6.283 + s.ph * 5)) * (.6 + .4 * Math.sin(tt * s.fr * 3.9 + s.ph * 11));
        const L_ = fade * (.4 + .6 * h) * fl * (1 + 2 * s.flare);
        C_[k] = L_; C_[k + 1] = L_ * T * (.5 + .5 * h); C_[k + 2] = 0;
      } else if (sparks.world && s.life <= 0) { C_[k] = C_[k + 1] = C_[k + 2] = 0; }
      else { C_[k] = c[0] * fade; C_[k + 1] = c[1] * fade; C_[k + 2] = c[2] * fade; }
      k += 3; } }
  // the sparks closest to the face light it
  const L = LIT.spL.value; L.forEach((l) => l.set(0, 0, 0, 0));
  if (sparks.world) sparks.list.filter((s) => s.life > 0 && s.z > 0 && s.z < 40 && inPanel(s.x, s.y)).sort((a, b) => a.z - b.z).slice(0, 8)
    .forEach((s, n) => { const f = s.life / s.max; L[n].set(s.x, s.y, s.z, .5 * s.b * Math.min(1, f * 6) * s.born * (.55 + .45 * s.t0 * (.25 + .75 * f))); });
  spMat.uniforms.world.value = sparks.world ? 1 : 0; spMat.uniforms.szk.value = 5.5 * K * REF * Math.tan(13 * Math.PI / 180) / Math.tan(cam.fov * Math.PI / 360);
  spGeo.setDrawRange(0, sparks.list.length * SUB); spGeo.attributes.position.needsUpdate = true; spGeo.attributes.color.needsUpdate = true;
  Object.assign(spMat.uniforms.near, { value: cam.near }); spMat.uniforms.far.value = cam.far; spMat.uniforms.focus.value = focusDist; spMat.uniforms.aperture.value = apert * K;
  if (spMat.uniforms.fine.value > .5 && !sparks.ash) { r.setRenderTarget(rtSpark); r.setClearColor(0x000000, 1); r.clear(); r.render(spScene, cam); }   // their own layer, coloured after the grade
  else { r.setRenderTarget(rtDof); r.autoClear = false; r.render(spScene, cam); r.autoClear = true; }
};

// ---------- simulated smoke (tools/trailer/fluid.js), in the scene: a stack of thin layers parallel to the synth's face,
// hovering above it at rising heights and reaching past its edges, so the smoke follows the synth's angle, has depth
// and parallax, and wraps over and around it. Each layer samples the same simulation a little shifted and scaled, so
// the stack reads as one volume. The layers write their smoke and its distance; one gather pass then blurs every
// spot by its own distance with the same thin-lens rule as the synth (sharp in the focus band, soft elsewhere).
const FL = makeFluid(r), FL2 = makeFluid(r);                                 // FL: the smoke above the synth; FL2: low and behind it
const rtFl = [0, 1].map(() => new THREE.WebGLRenderTarget(W, H, rtOpts));
fin.uniforms.tFlA.value = rtFl[1].texture; fin.uniforms.tFlB.value = rtFl[1].texture;
// layers: two behind the synth's face (hidden by it, showing past its edges), five above it; [height, which simulation]
const LAYER_Z = [[-70, 1], [-28, 1], [14, 1], [36, 0], [60, 0], [84, 0], [108, 0]]   // kept close to the synth: no smoke racing past the lens, SW = PW * 1.7, SH = PH * 1.9;
const layerMat = (k) => new THREE.ShaderMaterial({ uniforms: { dye: { value: null }, k: { value: k }, time: { value: 0 } },
  transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vUv; varying float vZ; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform sampler2D dye; uniform float k, time; varying vec2 vUv; varying float vZ;
    void main(){
      // each layer shifted, scaled and drifting at its own speed: parts of the smoke move differently
      vec2 u = (vUv - .5) * (1. - k * .045) + .5 + vec2(sin(k * 2.1) * .02 + time * (.002 + .0015 * sin(k * 1.7)), -k * .008 + time * .001 * cos(k * 2.9));
      float d = texture2D(dye, u).r * (k > 1.5 && k < 2.5 ? .5 : 1.); d = d == d ? clamp(d, 0., 20.) : 0.;                               // thinnest right on the face
      float edge = smoothstep(.02, .16, vUv.x) * smoothstep(.98, .84, vUv.x) * smoothstep(.02, .14, vUv.y) * smoothstep(.98, .86, vUv.y);
      float a = (1. - exp(-d * 1.1)) * edge * .22;
      gl_FragColor = vec4(a, a * vZ / 1000., 0., 1.); }` });                                          // smoke, and smoke x distance
const layers = LAYER_Z.map(([z, sim], k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), layerMat(k)); m.userData.sim = sim; m.userData.z = z; return m; });
const flScene = new THREE.Scene(); layers.forEach((m) => flScene.add(m));
// the synth's body, invisible, writing only depth: smoke behind it is hidden, smoke past its edges shows
const occ = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, 48), new THREE.MeshBasicMaterial({ colorWrite: false })); occ.position.set(0, 0, -24); occ.renderOrder = -1; flScene.add(occ);
const smokeDof = sh(`
  varying vec2 vUv; uniform sampler2D t; uniform float focus, aperture, maxR, fill; uniform vec2 px;
  float coc(vec2 s){ float z = s.y / max(s.x, 1e-5) * 1000.; return s.x < 1e-4 ? 0. : clamp(aperture * abs(z - focus) / z, 0., maxR); }
  // scatter-as-gather: every nearby sample whose own blur disc reaches this pixel adds its smoke spread over that disc
  void main(){ float acc = 0.; const int N = 64; float ga = 2.39996323;
    float rot = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
    if (fill < .5) {
    for (int i = 0; i < N; i++) { float rr = sqrt((float(i) + .5) / float(N)) * maxR, an = float(i) * ga + rot;
      vec2 s = texture2D(t, vUv + vec2(cos(an), sin(an)) * rr * px).xy; if (s.x != s.x || s.y != s.y || s.x < 0.) s = vec2(0.); float c = max(coc(s), 1.5);
      acc += s.x * smoothstep(rr - 1., rr + 1., c) / (c * c); }
    gl_FragColor = vec4(acc * maxR * maxR / float(N), 0., 0., 1.); return; }
    // fill=1 (trailer shots): the spiral above leaves a gap round the pixel (radius R0); smoke nearly in focus has a
    // blur smaller than that gap and got no samples at all: the black cracks along the line where the smoke crosses
    // the focus distance. So the outer spiral covers R0..maxR only, and a dense inner spiral covers 0..R0; every
    // sample weighs the area it stands for
    float R0 = maxR * .2, A = (maxR * maxR - R0 * R0) / float(N), acc2 = 0.; const int NI = 24;
    for (int i = 0; i < N; i++) { float rr = sqrt(R0 * R0 + (float(i) + .5) / float(N) * (maxR * maxR - R0 * R0)), an = float(i) * ga + rot;
      vec2 s = texture2D(t, vUv + vec2(cos(an), sin(an)) * rr * px).xy; if (s.x != s.x || s.y != s.y || s.x < 0.) s = vec2(0.); float c = max(coc(s), 1.5);
      acc2 += s.x * smoothstep(rr - 1., rr + 1., c) / (c * c) * A; }
    for (int i = 0; i < NI; i++) { float rr = sqrt((float(i) + .5) / float(NI)) * R0, an = float(i) * ga + rot * 1.7;
      vec2 s = texture2D(t, vUv + vec2(cos(an), sin(an)) * rr * px).xy; if (s.x != s.x || s.y != s.y || s.x < 0.) s = vec2(0.); float c = max(coc(s), 1.5);
      acc2 += s.x * smoothstep(rr - 1., rr + 1., c) / (c * c) * R0 * R0 / float(NI); }
    gl_FragColor = vec4(acc2, 0., 0., 1.); }`,
  { fill: { value: 0 }, t: { value: rtFl[0].texture }, focus: { value: 500 }, aperture: { value: 30 }, maxR: { value: 30 * K }, px: { value: new THREE.Vector2(1 / W, 1 / H) } });
const flu = { on: 0, ready: false };
// the smoke's velocity, shrunk to 64 x 36 and read back (cells a sim second -> share of the sheet a second)
const rtFlow = new THREE.WebGLRenderTarget(64, 36, { type: THREE.FloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
const flowCopy = sh(`varying vec2 vUv; uniform sampler2D t; void main(){ vec2 v = texture2D(t, vUv).xy; v = v == v ? clamp(v, -400., 400.) : vec2(0.); gl_FragColor = vec4(v / vec2(256., 144.), 0., 1.); }`, { t: { value: null } });
// the light the smoke sits in: the scene itself (the UI's glow) and the sparks, spread wide at quarter size
const rtLight = [0, 1].map(() => new THREE.WebGLRenderTarget(W / 4, H / 4, rtOpts));
const lightSrc = sh(`varying vec2 vUv; uniform sampler2D t, sp; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c * smoothstep(.04, .5, l) + vec3(.949, .365, .027) * texture2D(sp, vUv).r * 2.5, 1.); }`, { t: { value: rtDof.texture }, sp: { value: rtSpark.texture } });
fin.uniforms.tLight = { value: rtLight[0].texture };
// the smoke area for a shot, set on its first frame (the old fixed 900 x 620 sheet only suited the slide shot)
const smokeSetup = (focusDist) => {
  // the slide shot (focus 418 units away, a frame 343 units wide) was tuned with a 900 x 620 sheet and layers up to
  // 108 high: every shot gets the same proportions to its own frame, centred where its camera looks
  const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
  const c = cam.position.clone().addScaledVector(fwd, focusDist), sc = focusDist / 418;
  const SWs = 900 * sc, SHs = 620 * sc;
  layers.forEach((m) => { m.position.set(c.x, c.y, m.userData.z * (m.userData.z > 0 ? sc : 1)); m.scale.set(SWs, SHs, 1); });
  if (flu.bot) {                                                                // the Buy part's fire: from just under the frame's bottom
    const B = .29, k = flu.bot;
    if (k === 1) {        // ember haze: a few lazy columns of smoke
      FL.setup([[.3, B, .05, 45, .2, 1, 1.4], [.48, B - .01, .05, 40, 0, 1, 1.3], [.62, B, .05, 45, -.15, 1, 1.4], [.74, B - .01, .045, 40, -.3, 1, 1.2]], { buoy: 1.1, turb: 1.4, eps: 4, keepDye: .9995, speed: .08 });
      FL2.setup([[.38, B - .02, .06, 40, .3, 1, 1.2], [.66, B - .02, .06, 40, -.2, 1, 1.2]], { buoy: 1, turb: 1.6, eps: 5, keepDye: .9994, speed: .08 });
    } else if (k === 2) { // smoulder: a dense low bank that barely rises
      FL.setup([[.3, B + .01, .07, 25, .4, .5, 1.1], [.45, B, .07, 25, -.2, .5, 1.1], [.58, B + .01, .07, 25, .3, .5, 1.1], [.72, B, .07, 25, -.4, .5, 1.1]], { buoy: .45, turb: 1.8, eps: 5, keepDye: .993, speed: .07 });
      FL2.setup([[.36, B, .08, 25, .5, .4, .9], [.52, B - .01, .08, 25, 0, .4, .9], [.68, B, .08, 25, -.5, .4, .9]], { buoy: .4, turb: 2, eps: 6, keepDye: .993, speed: .07 });
    } else if (k === 3) { // rising heat: tongues licking up, short-lived at the top
      FL.setup([[.3, B, .04, 80, .1, 1, 2.2], [.44, B, .04, 85, -.05, 1, 2.4], [.57, B, .04, 80, .08, 1, 2.2], [.71, B, .04, 80, -.1, 1, 2.2]], { buoy: 2.6, turb: 2.2, eps: 9, keepDye: .9965, speed: .12 });
      FL2.setup([[.37, B - .01, .05, 70, .2, 1, 1.8], [.51, B - .01, .05, 70, -.1, 1, 1.8], [.64, B - .01, .05, 70, .1, 1, 1.8]], { buoy: 2.2, turb: 2.4, eps: 8, keepDye: .997, speed: .12 });
    } else if (k === 5) { // flames: rising heat with more fuel and lift
      FL.setup([[.3, B, .04, 95, .1, 1, 2.6], [.42, B, .04, 100, -.05, 1, 2.8], [.54, B, .04, 100, .08, 1, 2.8], [.66, B, .04, 95, -.1, 1, 2.6]], { buoy: 3, turb: 2.4, eps: 9, keepDye: .996, speed: .13 });
      FL2.setup([[.36, B - .01, .05, 85, .2, 1, 2.2], [.48, B - .01, .05, 85, -.1, 1, 2.2], [.6, B - .01, .05, 85, .1, 1, 2.2], [.72, B - .01, .05, 80, -.15, 1, 2]], { buoy: 2.6, turb: 2.6, eps: 8, keepDye: .9965, speed: .13 });
    } else {              // fire wall: the whole bottom burning
      FL.setup([[.29, B, .05, 110, .05, 1, 2], [.42, B, .05, 115, -.05, 1, 2.2], [.56, B, .05, 115, .05, 1, 2.2], [.7, B, .05, 110, -.05, 1, 2]], { buoy: 3.4, turb: 2.6, eps: 10, keepDye: .992, speed: .14 });
      FL2.setup([[.35, B - .01, .06, 100, .15, 1, 1.7], [.49, B - .01, .06, 100, -.1, 1, 1.7], [.63, B - .01, .06, 100, .1, 1, 1.7], [.76, B - .01, .05, 90, -.15, 1, 1.5]], { buoy: 3, turb: 2.8, eps: 9, keepDye: .992, speed: .14 });
    }
    flu.ready = true; return;
  }
  if (flu.beams) {                                                              // the header: smoke rising from below, drifting across
    FL.setup([[.18, .08, .06, 60, .3, 1, 1.8], [.45, .06, .06, 55, .05, 1, 1.6], [.72, .08, .06, 55, -.2, 1, 1.6], [.9, .2, .05, 45, -.4, 1, 1.3]], { buoy: 1.2, turb: 1.4, eps: 4, keepDye: .9996, speed: .08 });
    FL2.setup([[.3, .15, .07, 50, .4, 1, 1.4], [.65, .12, .07, 50, -.3, 1, 1.4], [.08, .4, .05, 40, .8, .4, 1.1]], { buoy: 1, turb: 1.6, eps: 5, keepDye: .9995, speed: .08 });
    flu.ready = true; return;
  }
  const U = (x) => (x - c.x) / SWs + .5, Vv = (y) => (y - c.y) / SHs + .5;
  const PANEL = [U(-PW / 2), Vv(-PH / 2), U(PW / 2), Vv(PH / 2)];
  const px = (u, v) => [Math.min(.92, Math.max(.08, u)), Math.min(.92, Math.max(.08, v))];
  // above the synth: rising from low in the view, fanning out along its face
  FL.setup([[...px(.3, .14), .05, 60, .25, 1, 1.6], [...px(.62, .1), .05, 55, -.1, 1, 1.4], [...px(.85, .3), .045, 50, -.3, 1, 1.3], [...px(.15, .45), .045, 45, .4, 1, 1.2]],
    { buoy: 1, turb: 1.2, eps: 4, keepDye: .9996, speed: .08 });   // (the surface spread pushed smoke into the area's edges: off)   // measured: about 2 % of the frame width a second
  // behind the synth: where one of its edges is in or near the view, rising along it and spilling round it (the panel
  // is a wall to this smoke); otherwise a low, lazy smoke behind the near layers
  const edge = PANEL[0] > .02 ? PANEL[0] - .05 : PANEL[2] < .98 ? PANEL[2] + .05 : null;
  if (edge !== null) {
    const tv = PANEL[3] + .04;
    FL2.setup([[...px(edge, .15), .05, 60, .1, 1, 2.2], [...px(edge, .45), .045, 50, .3, 1, 1.6], [...px(.5, Math.min(.9, tv)), .045, 45, .8, .3, 1.3]],
      { buoy: 1.4, turb: 1.5, eps: 5, keepDye: .9995, obstacle: PANEL, speed: .08 });
  } else FL2.setup([[...px(.4, .1), .05, 55, .2, 1, 1.4], [...px(.75, .12), .05, 50, -.2, 1, 1.3]], { buoy: 1.2, turb: 1.4, eps: 5, keepDye: .9995, speed: .08 });
  flu.ready = true;
};
const beamCv = document.createElement('canvas'); beamCv.width = W / 4; beamCv.height = H / 4;
const beamTex = new THREE.CanvasTexture(beamCv); beamTex.colorSpace = THREE.NoColorSpace; beamTex.minFilter = THREE.LinearFilter; beamTex.generateMipmaps = false;
const copyTex = sh(`varying vec2 vUv; uniform sampler2D t; uniform float k; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb * k, 1.); }`, { t: { value: beamTex }, k: { value: 1 } });
const drawBeams = (mode, time) => {
  const g = beamCv.getContext('2d'), w = beamCv.width, h = beamCv.height;
  g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const sway = Math.sin(time * .25) * .035;                                    // the warning light turns very slowly
  if (mode === 1 || mode === 4) {
    g.filter = `blur(${Math.round(w * .012)}px)`;
    const cg = g.createConicGradient((200 - 90) * Math.PI / 180 + sway, w * .902, -h * .076);
    const st = [[0, 'rgba(242,48,5,0)'], [8, 'rgba(242,48,5,0)'], [18, 'rgba(242,48,5,.30)'], [26, 'rgba(242,93,7,.16)'], [40, 'rgba(0,0,0,0)'],
      [150, 'rgba(0,0,0,0)'], [165, 'rgba(242,48,5,.16)'], [185, 'rgba(0,0,0,0)'], [360, 'rgba(0,0,0,0)']];
    st.forEach(([d, c]) => cg.addColorStop(d / 360, c));
    g.fillStyle = cg; g.fillRect(0, 0, w, h);
  }
  if (mode >= 5) {
    g.filter = `blur(${Math.round(w * .01)}px)`;
    if (mode === 5) { const rg = g.createRadialGradient(w * .5, h * 1.05, 0, w * .5, h * 1.05, w * .55);
      rg.addColorStop(0, 'rgba(242,93,7,1)'); rg.addColorStop(.35, 'rgba(242,48,5,.66)'); rg.addColorStop(.7, 'rgba(242,0,0,.27)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; }
    else { const lg = g.createLinearGradient(0, h, 0, 0);   // (alpha .045 = exactly #f25d07 on the densest smoke)
      lg.addColorStop(0, 'rgba(242,93,7,1)'); lg.addColorStop(.18, 'rgba(242,48,5,.71)'); lg.addColorStop(.4, 'rgba(242,0,0,.36)'); lg.addColorStop(.6, 'rgba(0,0,0,0)'); g.fillStyle = lg; }
    g.fillRect(0, 0, w, h); g.filter = 'none';
    beamTex.needsUpdate = true; return;
  }
  // the lamp, top right
  g.filter = `blur(${Math.round(w * .004)}px)`;
  const lx = mode === 3 ? w * .5 : w * (1 - .14) - w * .076, ly = mode === 3 ? h * .2 : h * .1 + h * .135, lr = mode === 2 || mode === 3 ? w * .55 : mode === 4 ? w * .38 : w * .14;
  const rg = g.createRadialGradient(lx, ly, 0, lx, ly, lr);
  rg.addColorStop(0, `rgba(242,93,7,${mode >= 2 ? .7 : .55})`); rg.addColorStop(.4, `rgba(242,48,5,${mode >= 2 ? .3 : .25})`); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
  beamTex.needsUpdate = true;
};
const fluidDraw = (i, focusDist, apert) => {
  if (!flu.ready) smokeSetup(focusDist);
  FL.to(i); FL2.to(i);
  if (sparks.world && sparks.on && !flu.beams && !flu.bot) {                    // the smoke's currents, for the sparks
    flowCopy.uniforms.t.value = FL._vel().texture; pass(flowCopy, rtFlow); r.readRenderTargetPixels(rtFlow, 0, 0, 64, 36, flow.data);
    const L0 = layers[3]; flow.c.copy(L0.position); flow.w = L0.scale.x; flow.h = L0.scale.y; flow.on = true;
    flow.k = .08 * 4;                                                               // sim speed in the shot, then amplified so the swirl reads
  }
  layers.forEach((m) => { const u = m.material.uniforms; u.dye.value = (m.userData.sim ? FL2 : FL).texture; u.time.value = i / FPS; });
  r.setRenderTarget(rtFl[0]); r.setClearColor(0x000000, 1); r.clear(); r.render(flScene, cam);
  smokeDof.uniforms.focus.value = focusDist; smokeDof.uniforms.aperture.value = apert * K;
  pass(smokeDof, rtFl[1]); fin.uniforms.tFlA.value = flu.on === 3 ? rtFl[0].texture : rtFl[1].texture;   // fluid=3: the smoke before its focus blur (red) and its distance (green)
  if (flu.beams) { drawBeams(flu.beams, i / FPS); copyTex.uniforms.k.value = flu.beams >= 5 ? 3.2 * .045 * (flu.beams === 7 ? 1.2 : 1) : 3.2;
    pass(copyTex, rtLight[0]); return; }   // the header's light, not the scene's (light from below: drawn at full strength, scaled here; .045 = the densest smoke exactly #f25d07)
  pass(lightSrc, rtLight[0]);
  for (let n = 0; n < 4; n++) {
    blur.uniforms.t.value = rtLight[0].texture; blur.uniforms.d.value.set(2.2 / (W / 4), 0); pass(blur, rtLight[1]);
    blur.uniforms.t.value = rtLight[1].texture; blur.uniforms.d.value.set(0, 2.2 / (H / 4)); pass(blur, rtLight[0]);
  }
};
const draw = (i, focusDist, apert = 30) => {
  r.setRenderTarget(rtScene); r.render(scene, cam);
  Object.assign(dof.uniforms, {}); dof.uniforms.near.value = cam.near; dof.uniforms.far.value = cam.far; dof.uniforms.focus.value = focusDist; dof.uniforms.aperture.value = apert * K;
  pass(dof, rtDof2);
  for (const k of ['near', 'far', 'focus', 'aperture']) dofSmooth.uniforms[k].value = dof.uniforms[k].value;
  pass(dofSmooth, rtDof);
  if (sparks.on || sparks.ash) { sparks.focus = focusDist; while (sparks.t < i + 60) sparksStep(); sparksDraw(focusDist, apert); }     // 60 frames of pre-roll: the air is already full
  pass(bright, rtA);
  glowBlur();
  if (flu.on) fluidDraw(i, focusDist, apert);
  { const fw = new THREE.Vector3(); cam.getWorldDirection(fw); const q = cam.position.clone().addScaledVector(fw, focusDist).project(cam);   // the spot in focus, on screen
    fin.uniforms.subj.value.set(q.x * .5 + .5, q.y * .5 + .5); }
  fin.uniforms.time.value = i / FPS; pass(fin, null);
};

// ---------- shots ----------
const P = (px, py) => new THREE.Vector3(px - PW / 2, PH / 2 - py, 0);          // a point on the UI, from its css px
const lerp = (a, b, t) => a + (b - a) * t, ss = (t) => t * t * (3 - 2 * t);
const look = (pos, target, roll) => { cam.position.copy(pos); cam.up.set(Math.sin(roll), Math.cos(roll), 0); cam.lookAt(target); };

// the turning knob's box: its own layer just above the face, so only a small picture changes per frame
const knobLayer = (() => {
  const p = meta.patch, t = new THREE.Texture(); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), lit(t));
  m.position.copy(P(p.x + p.w / 2, p.y + p.h / 2)).setZ(0.05); m.visible = false; synth.add(m); return m;
})();
let pull = 0, stillCam = 0;
const SHOTS = {
  // the website header's background: no synth, smoke rising through the header's light (10 s loop material)
  bg: { frames: 250, run(i) {
    knobLayer.visible = false; synth.visible = false; occ.visible = false;
    cam.fov = 30; cam.updateProjectionMatrix();
    look(new THREE.Vector3(0, 0, 1000), new THREE.Vector3(0, 0, 0), 0);
    draw(i, 1000, 30);
  } },
  // 1: a slow slide along the oscillator row at a steep angle; the focus band holds on the knobs (3 s)
  slide: { frames: 75, run(i) {
    knobLayer.visible = false;
    const t = stillCam ? 0 : i / 74;
    const target = P(lerp(215, 255, t), 256); LIT.lightAt.value.copy(P(330, 150));                                 // a slow drift along OSC A's knobs (~3 % of the frame a second)
    const pos = target.clone().add(new THREE.Vector3(-210, -260, 250));
    cam.fov = 26; cam.updateProjectionMatrix();
    look(pos, target, THREE.MathUtils.degToRad(4));
    draw(i, pos.distanceTo(target), 105);
  } },
  // 3: the amp envelope: a low, grazing slide from the right along its glowing curve, from the tail up towards the
  // attack peak, the focus held on the curve (3.2 s)
  env: { frames: 80, run(i) {
    knobLayer.visible = false;
    const t = stillCam ? 0 : i / 79;
    const target = P(lerp(870, 805, t), lerp(200, 178, t)); LIT.lightAt.value.copy(P(760, 120));
    const pos = target.clone().add(new THREE.Vector3(150, -125, 105));
    cam.fov = 25; cam.updateProjectionMatrix();
    look(pos, target, THREE.MathUtils.degToRad(-10));
    draw(i, pos.distanceTo(target), 105);
  } },
  // 2: push in on the filter cutoff while it turns; the focus pulls from the filter curve to the knob (4 s)
  knob: { frames: 100, async run(i) {
    knobLayer.visible = true;
    const t = stillCam ? 0 : i / 99, k = await loadKnob(i), p = meta.patch;
    knobLayer.material.uniforms.map.value.image = k; knobLayer.material.uniforms.map.value.needsUpdate = true;
    const knob = P(p.cx, p.cy), curve = P(p.cx - 30, p.cy - 90); LIT.lightAt.value.copy(P(p.cx + 70, p.cy - 60));
    const dolly = lerp(1, 0.86, t);
    const pos = knob.clone().add(new THREE.Vector3(150, -150, 175).multiplyScalar(dolly));
    cam.fov = 24; cam.updateProjectionMatrix();
    look(pos, knob, THREE.MathUtils.degToRad(12));
    const f = ss(Math.min(1, Math.max(0, (t - 0.08) / 0.35)));                 // focus pull over 1.4 s, early in the shot
    draw(i, pull ? lerp(pos.distanceTo(curve), pos.distanceTo(knob), f) : pos.distanceTo(knob), 115);   // fixed focus unless pull=1
  } },
};
// ---------- text cards: five plates in the website's siren colours (always fading to pure black), Manrope, typed in ----------
// A siren glow rising from below, with pixel sparks · B ink in deep red with a hot core · C black film: dust, scratches,
// a red light leak · D the website's pixel fire, taller, with sparks · E real flames, heat shimmer and sparks
const NOISE = `
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0., m = .5; for (int i = 0; i < 6; i++) { s += n(p) * m; p = p * 2.03 + vec2(1.7, 9.2); m *= .5; } return s; }`;
const plateSh = (body) => sh(`varying vec2 vUv; uniform float time; uniform vec3 deep, red, hot, core; ${NOISE}
  void main(){ vec2 A = vec2(1.7778, 1.); vec3 c = vec3(0.); ${body} gl_FragColor = vec4(c, 1.); }`,
  { time: { value: 0 }, deep: { value: raw(SIREN.deep) }, red: { value: raw(SIREN.red) }, hot: { value: raw(SIREN.hot) }, core: { value: raw(SIREN.core) } });
// the siren glow: layered radial light rising from below the frame, breathing slowly (as the website's Buy part)
const SIREN_GLOW = `
    vec2 sp = (vUv - vec2(.5, -.1)) * A; float sr = length(sp * vec2(.7, 1.));
    float br = .86 + .1 * sin(time * 1.2) + .1 * (n(vec2(time * .6, 1.)) - .5);
    c += (deep * exp(-sr*sr*1.6) * .6 + red * exp(-sr*sr*5.) * .42 + hot * exp(-sr*sr*16.) * .45 + core * exp(-sr*sr*55.) * .2) * br;`;
const PLATES = {
  A: plateSh(SIREN_GLOW),
  B: plateSh(`
    vec2 p = (vUv - .5) * A * 2.2;
    vec2 q = vec2(fbm(p + time * .05), fbm(p + vec2(5.2, 1.3) - time * .04));
    float s = fbm(p + 2.4 * q + vec2(0., time * .06));
    float ink = smoothstep(.45, .95, s);
    c = deep * ink * 1.1 + red * pow(ink, 2.2) * .7 + hot * pow(ink, 5.) * .9;
    c *= smoothstep(1.15, .2, length(vUv - .5) * 1.6);`),
  C: plateSh(`
    float t = floor(time * 25.);
    vec2 lc = vec2(-.08 + .07 * sin(time * .4), .3 + .12 * sin(time * .27));
    float lk = smoothstep(.8, 0., length((vUv - lc) * vec2(1.1, 1.5))) * (.75 + .25 * n(vec2(time * 3., 2.)));
    c += (deep * lk * 1.2 + red * lk * lk * .8 + hot * pow(lk, 4.) * .7);
    float d = step(.9988, h(floor(vUv * vec2(640., 360.)) + t * 13.1));
    c += vec3(.62, .55, .5) * d * .55;
    float sx = h(vec2(t * .37, 3.));
    c += vec3(.5, .46, .42) * step(.55, h(vec2(t, 7.))) * smoothstep(.0007, 0., abs(vUv.x - sx)) * .1;
    c *= .9 + .1 * h(vec2(t, 1.));`),
  D: plateSh(SIREN_GLOW.replace('* br;', '* br * .55;')),
  E: plateSh(`
    float y = vUv.y;
    float n1 = fbm(vec2(vUv.x * A.x * 2.6, y * 1.9 - time * 1.25));
    float n2 = fbm(vec2(vUv.x * A.x * 6.5 + 3., y * 3.6 - time * 2.3));
    float heat = clamp(.95 - y * 3.1 + (n1 - .5) * 1.2 + (n2 - .5) * .5, 0., 1.);
    c = mix(c, deep, smoothstep(.0, .3, heat)); c = mix(c, red, smoothstep(.3, .55, heat));
    c = mix(c, hot, smoothstep(.55, .85, heat)) * .9;
    c *= smoothstep(0., .14, heat);
    c += deep * exp(-y * 3.5) * .3 * (.9 + .1 * sin(time * 2.));`),
};
// the website's pixel embers (website/main.js embers()): the classic fire spread on a grid of blocks, sparks cooling as they rise
const hexRGB = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
const CELL = Math.max(3, Math.round(6 * K)), GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL);
const ember = document.createElement('canvas'); ember.width = GW; ember.height = GH; const eg = ember.getContext('2d'); const eimg = eg.createImageData(GW, GH);
const STOPS = ['#000000', '#200301', '#5a0703', '#8a0a04', '#c8160b', '#ff2a14', '#ff6a1a'].map(hexRGB);
const HOT = hexRGB('#ffb070'), ORANGE = hexRGB('#ff6a1a'), RED = hexRGB('#ff2a14'), DEEP = hexRGB('#8a0a04');
const sim = { t: -1 };
const simReset = (opts) => {
  let a = 1234567; const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  const MAX = opts.max ?? 24, FH = opts.fh ?? 0;
  const PAL = Array.from({ length: MAX + 1 }, (_, i) => { const t = i / MAX * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k; return STOPS[k].map((v, j) => Math.round(v + (STOPS[k + 1][j] - v) * f)); });
  Object.assign(sim, { t: -1, rnd, MAX, FH, PAL, heat: new Float32Array(GW * Math.max(1, FH)), sparks: [], opts });
  const spawn = (s, anywhere) => { s.x = rnd() * GW; s.v = 0.25 + rnd() * 0.5; s.p = rnd() * 6;
    s.y = FH ? GH - 8 - rnd() * 8 : GH * (anywhere ? rnd() : 0.55 + rnd() * 0.45); s.life = FH ? 0.6 + rnd() * 0.4 : 0.35 + rnd() * 0.65; return s; };
  sim.spawn = spawn;
  sim.sparks = Array.from({ length: Math.round((opts.count ?? 0) * GW / 240) }, () => spawn({}, true));
  for (let i = 0; i < FH * 2; i++) burn();
};
const burn = () => {
  const { heat, MAX, FH, rnd } = sim; if (!FH) return;
  for (let x = 0; x < GW; x++) heat[(FH - 1) * GW + x] = MAX * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(x * 0.07 + sim.t * 0.03) * Math.sin(x * 0.023 - sim.t * 0.017)));
  for (let y = 1; y < FH; y++) for (let x = 0; x < GW; x++) {
    const rr = rnd() * 3 | 0, dx = Math.max(0, Math.min(GW - 1, x - rr + 1));
    heat[(y - 1) * GW + dx] = Math.max(0, heat[y * GW + x] - (rnd() < 0.72 ? 1.05 : 0));
  }
};
const simStep = () => {
  sim.t++; burn();
  for (const s of sim.sparks) { s.y -= s.v; s.x += Math.sin(sim.t * 0.05 + s.p) * 0.35; s.life -= 0.006; if (s.y < 0 || s.life <= 0) sim.spawn(s); }
};
const simDraw = () => {
  const d = eimg.data; d.fill(0); const { heat, FH, PAL, MAX } = sim;
  for (let y = 0; y < FH; y++) for (let x = 0; x < GW; x++) {
    const v = heat[y * GW + x]; if (v < 0.5) continue;
    const c = PAL[Math.min(MAX, Math.round(v))], i = ((GH - FH + y) * GW + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = Math.min(255, v * 40);
  }
  for (const s of sim.sparks) {
    const xi = Math.round(s.x), yi = Math.round(s.y); if (xi < 0 || xi >= GW || yi < 0 || yi >= GH) continue;
    const c = s.life > 0.6 ? HOT : s.life > 0.35 ? ORANGE : s.life > 0.12 ? RED : DEEP, i = (yi * GW + xi) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  eg.putImageData(eimg, 0, 0);
};
const tc = document.createElement('canvas'); tc.width = W; tc.height = H; const tg = tc.getContext('2d');
const ttex = new THREE.CanvasTexture(tc); ttex.colorSpace = THREE.NoColorSpace; ttex.premultiplyAlpha = true; ttex.generateMipmaps = false; ttex.minFilter = THREE.LinearFilter;
// the card layer over the plate; 'shimmer' bends it in the heat above real flames
const over = sh(`varying vec2 vUv; uniform sampler2D a, b; uniform float time, shimmer;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  void main(){
    vec2 w = vec2(n(vec2(vUv.x * 9., vUv.y * 14. - time * 3.)) - .5, n(vec2(vUv.x * 11. + 5., vUv.y * 9. - time * 2.4)) - .5) * shimmer * (1.2 - vUv.y);
    vec4 t = texture2D(b, vUv + w); gl_FragColor = vec4(texture2D(a, vUv + w * .6).rgb * (1. - t.a) + t.rgb, 1.); }`,
  { a: { value: rtScene.texture }, b: { value: ttex }, time: { value: 0 }, shimmer: { value: 0 } });
const font = new FontFace('Manrope', `url(${CFG.font ?? '/design/fonts/manrope-latin-var.woff2'})`, { weight: '200 800' }); await font.load(); document.fonts.add(font);
const card = (plate, emb, shimmer = 0) => ({ frames: 80,
  reset() { simReset(emb); },
  run(i) {
    while (sim.t < i) simStep();
    plate.uniforms.time.value = 3 + i / FPS; pass(plate, rtScene);
    const L1 = 'A DARK CINEMATIC', L2 = 'SYNTHESIZER', typed = Math.max(0, Math.floor((i - 8) / 2));      // a letter every 2 frames
    tg.clearRect(0, 0, W, H);
    if (emb.count || emb.fh) { simDraw(); tg.imageSmoothingEnabled = false; tg.drawImage(ember, 0, 0, GW * CELL, GH * CELL); }
    const cap = H * 0.055, sizePx = cap / 0.72;                                  // cap height 5.5 % of the frame (Manrope caps ~0.72 em)
    tg.font = `500 ${sizePx}px Manrope`; tg.textBaseline = 'alphabetic'; tg.letterSpacing = `${sizePx * 0.16}px`;
    const lines = [[L1, SIREN.head, 0.25, H * 0.5], [L2, SIREN.red, 0.6, H * 0.5 + cap * 1.75]];             // the accent word glows like neon
    let left = typed;
    for (const [txt, fill, glowA, y] of lines) {
      const shown = txt.slice(0, Math.max(0, left)); left -= txt.length;
      const w = tg.measureText(txt).width - sizePx * 0.16;
      tg.fillStyle = fill;
      tg.globalAlpha = glowA; tg.shadowColor = fill; tg.shadowBlur = cap * 0.5; tg.fillText(shown, W / 2 - w / 2, y);
      tg.globalAlpha = 1; tg.shadowBlur = 0; tg.fillText(shown, W / 2 - w / 2, y);
    }
    ttex.needsUpdate = true;
    over.uniforms.time.value = i / FPS; over.uniforms.shimmer.value = shimmer * K;
    pass(over, rtDof);
    pass(bright, rtA);
    glowBlur();
    fin.uniforms.time.value = i / FPS; pass(fin, null);
  } });
SHOTS.cardA = card(PLATES.A, { count: 60 });
SHOTS.cardB = card(PLATES.B, {});
SHOTS.cardC = card(PLATES.C, {});
SHOTS.cardD = card(PLATES.D, { count: 50, fh: 70, max: 44 });
SHOTS.cardE = card(PLATES.E, { count: 70 }, 0.006);
SHOTS.card = SHOTS.cardA;

let shot;
// a shot name may carry a look: 'knob@artistry'; the default is the RUIN-1 look
// options after a colon: 'knob@ruin:sparks,fire=0.6'
window.setup = (name) => {
  const [n, rest = 'ruin'] = name.split('@'), [look, opt = ''] = rest.split(':');
  const o = Object.fromEntries(opt.split(',').filter(Boolean).map((x) => { const [k, v] = x.split('='); return [k, v === undefined ? 1 : Number(v)]; }));
  const real = o.real ?? 0; LIT.real.value = real; LIT.lightR.value = o.lightr ?? 260;   // lightr=100000: light everywhere (to compare)
  synth.visible = true; occ.visible = true; flu.beams = o.beams ?? 0; flu.bot = o.bot ?? 0; fin.uniforms.clearTxt.value = o.clear ?? 0; fin.uniforms.clearY.value = o.cleary ?? .17;
  shot = SHOTS[n]; setLook(look, 1 - real); fin.uniforms.fire.value = o.fire ?? 0;
  spMat.uniforms.fine.value = o.fine ?? 0; fin.uniforms.fineSp.value = (o.fine && o.sparks && !o.hidesp) ? 1 : 0;   
  // (hidesp=1: the sparks run, they share the random numbers with the smoke so the smoke stays the same, but are left out of the picture)
  fin.uniforms.og.value = o.og ?? 0; fin.uniforms.tint.value = o.tint ?? 0; pull = o.pull ?? 0; stillCam = o.still ?? 0; fin.uniforms.smoke.value = o.smoke ?? 0;
  sparks.world = n !== 'bg'; flow.on = false; smokeDof.uniforms.fill.value = n !== 'bg' ? 1 : 0; fin.uniforms.subjOn.value = n !== 'bg' ? 1 : 0;   // trailer shots: sparks in the world, smoke blur without holes (the website's bg keeps its look)
  sparks.on = Math.min(1, o.sparks ?? 0); sparks.ash = Math.min(1, o.ash ?? 0); if (sparks.on || sparks.ash) sparksReset();
  for (const k of ['dark', 'burn', 'film', 'flare']) fin.uniforms[k].value = o[k] ?? 0;
  fin.uniforms.glow.value = (o.burn ? 1.6 : 0.9) * (1 - real); fin.uniforms.halo.value = 1 - real; fin.uniforms.ca.value = 0.006 * (1 - real);
  flu.on = o.fluid ?? 0; fin.uniforms.fluid.value = flu.on; flu.ready = false;


  shot.reset?.(); return shot.frames; };
window.frame = async (i) => { await shot.run(i); if (!CFG.live) r.getContext().finish(); return true; };   // live: never wait on the GPU (it would stall the page's scrolling)
window.ready = true;
