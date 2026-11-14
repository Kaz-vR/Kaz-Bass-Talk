// DEV ONLY: a small GPU smoke simulation for the trailer shots (tools/trailer/shots.js). Stable fluids (Stam), the
// standard real-time smoke method: velocity advected by itself, vorticity confinement for the curls, a pressure
// solve so the flow stays incompressible, and a density (dye) carried along. Smoke is fed in by a few soft emitters
// and lifted by buoyancy; a slow, large-scale turbulence keeps it from repeating. Deterministic: the same frame
// always gives the same smoke, so a shot renders the same every time.
import * as THREE from '/website/vendor/three.module.min.js';

export const makeFluid = (r, { simW = 256, simH = 144, dyeW = 1024, dyeH = 576 } = {}) => {
  const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false };
  const pair = (w, h) => { const a = new THREE.WebGLRenderTarget(w, h, opt), b = new THREE.WebGLRenderTarget(w, h, opt); return { read: a, write: b, swap() { const t = this.read; this.read = this.write; this.write = t; } }; };
  const vel = pair(simW, simH), prs = pair(simW, simH), dye = pair(dyeW, dyeH);
  const div = new THREE.WebGLRenderTarget(simW, simH, opt), crl = new THREE.WebGLRenderTarget(simW, simH, opt);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), qs = new THREE.Scene(), oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); qs.add(quad);
  const V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
  const M = (fs, u) => new THREE.ShaderMaterial({ vertexShader: V, fragmentShader: 'precision highp float; varying vec2 vUv;\n' + fs, uniforms: u, depthTest: false, depthWrite: false });
  const run = (m, t) => { quad.material = m; r.setRenderTarget(t); r.render(qs, oc); };
  const tx = new THREE.Vector2(1 / simW, 1 / simH);

  const obs = { value: new THREE.Vector4(-1, -1, -1, -1) };                  // the solid panel: nothing flows into or through it
  const advect = M(`uniform sampler2D vel, src; uniform vec2 tx; uniform float dt, keep, fade; uniform vec4 obs; float inObs(vec2 p){ return step(obs.x, p.x) * step(p.x, obs.z) * step(obs.y, p.y) * step(p.y, obs.w); }

    void main(){ vec2 p = vUv - dt * texture2D(vel, vUv).xy * tx;
      float b = smoothstep(0., .03, vUv.x) * smoothstep(1., .97, vUv.x) * smoothstep(0., .03, vUv.y) * smoothstep(1., .97, vUv.y);   // nothing piles up at the edges
      gl_FragColor = keep * texture2D(src, p) * (1. - inObs(vUv)) * mix(1., b, step(.5, fade)); }`,
    { vel: { value: null }, src: { value: null }, tx: { value: tx }, dt: { value: 0 }, keep: { value: 1 }, obs, fade: { value: 0 } });
  const curl = M(`uniform sampler2D vel; uniform vec2 tx;
    void main(){ float L = texture2D(vel, vUv - vec2(tx.x, 0.)).y, R = texture2D(vel, vUv + vec2(tx.x, 0.)).y;
      float B = texture2D(vel, vUv - vec2(0., tx.y)).x, T = texture2D(vel, vUv + vec2(0., tx.y)).x; gl_FragColor = vec4(.5 * (R - L - T + B), 0., 0., 1.); }`,
    { vel: { value: null }, tx: { value: tx } });
  const vort = M(`uniform sampler2D vel, crl; uniform vec2 tx; uniform float dt, eps;
    void main(){ float L = texture2D(crl, vUv - vec2(tx.x, 0.)).x, R = texture2D(crl, vUv + vec2(tx.x, 0.)).x;
      float B = texture2D(crl, vUv - vec2(0., tx.y)).x, T = texture2D(crl, vUv + vec2(0., tx.y)).x, C = texture2D(crl, vUv).x;
      vec2 f = .5 * vec2(abs(T) - abs(B), abs(R) - abs(L)); f /= length(f) + 1e-4; f *= eps * C * vec2(1., -1.);
      vec2 v = texture2D(vel, vUv).xy + f * dt; gl_FragColor = vec4(v, 0., 1.); }`,
    { vel: { value: null }, crl: { value: null }, tx: { value: tx }, dt: { value: 0 }, eps: { value: 0 } });
  const diverge = M(`uniform sampler2D vel; uniform vec2 tx;
    void main(){ float L = texture2D(vel, vUv - vec2(tx.x, 0.)).x, R = texture2D(vel, vUv + vec2(tx.x, 0.)).x;
      float B = texture2D(vel, vUv - vec2(0., tx.y)).y, T = texture2D(vel, vUv + vec2(0., tx.y)).y; gl_FragColor = vec4(.5 * (R - L + T - B), 0., 0., 1.); }`,
    { vel: { value: null }, tx: { value: tx } });
  const jacobi = M(`uniform sampler2D prs, dv; uniform vec2 tx; uniform vec4 obs; float inObs(vec2 p){ return step(obs.x, p.x) * step(p.x, obs.z) * step(obs.y, p.y) * step(p.y, obs.w); }

    void main(){ float C = texture2D(prs, vUv).x;
      // walls: a neighbour inside the panel takes this cell's pressure, so no flow goes into it
      float L = mix(texture2D(prs, vUv - vec2(tx.x, 0.)).x, C, inObs(vUv - vec2(tx.x, 0.))), R = mix(texture2D(prs, vUv + vec2(tx.x, 0.)).x, C, inObs(vUv + vec2(tx.x, 0.)));
      float B = mix(texture2D(prs, vUv - vec2(0., tx.y)).x, C, inObs(vUv - vec2(0., tx.y))), T = mix(texture2D(prs, vUv + vec2(0., tx.y)).x, C, inObs(vUv + vec2(0., tx.y)));
      gl_FragColor = vec4((L + R + B + T - texture2D(dv, vUv).x) * .25, 0., 0., 1.); }`,
    { prs: { value: null }, dv: { value: div.texture }, tx: { value: tx }, obs });
  const subtract = M(`uniform sampler2D prs, vel; uniform vec2 tx; uniform vec4 obs; float inObs(vec2 p){ return step(obs.x, p.x) * step(p.x, obs.z) * step(obs.y, p.y) * step(p.y, obs.w); }

    void main(){ float L = texture2D(prs, vUv - vec2(tx.x, 0.)).x, R = texture2D(prs, vUv + vec2(tx.x, 0.)).x;
      float B = texture2D(prs, vUv - vec2(0., tx.y)).x, T = texture2D(prs, vUv + vec2(0., tx.y)).x;
      gl_FragColor = vec4((texture2D(vel, vUv).xy - .5 * vec2(R - L, T - B)) * (1. - inObs(vUv)), 0., 1.); }`,
    { prs: { value: null }, vel: { value: null }, tx: { value: tx }, obs });
  const scale = M(`uniform sampler2D src; uniform float k; void main(){ gl_FragColor = k * texture2D(src, vUv); }`, { src: { value: null }, k: { value: .8 } });
  // forces: emitters (velocity + density), buoyancy and a slow large-scale turbulence
  const force = M(`uniform sampler2D vel, dye; uniform float dt, time, buoy, turb, spread; uniform vec4 spr; uniform vec4 em[4]; uniform vec2 dir[4]; uniform float aspect;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main(){ vec2 v = texture2D(vel, vUv).xy;
      for (int k = 0; k < 4; k++) { vec2 d = (vUv - em[k].xy) * vec2(aspect, 1.); float g = exp(-dot(d, d) / (em[k].z * em[k].z)); v += dir[k] * g * em[k].w * dt; }
      v.y += buoy * texture2D(dye, vUv).x * dt;
      // over the panel (spr: its rectangle): smoke near the surface is pushed outward along it, as off a table top
      vec2 sc = (spr.xy + spr.zw) * .5, sh = (spr.zw - spr.xy) * .5, rel = (vUv - sc) / max(sh, vec2(1e-4));
      float ins = step(abs(rel.x), 1.) * step(abs(rel.y), 1.);
      v += spread * dt * ins * normalize(rel + 1e-4) * smoothstep(0., .6, length(rel));
      vec2 q = vUv * vec2(aspect, 1.) * 2.5 + vec2(0., -time * .04);   // slow turbulence: shapes change over seconds
      v += turb * dt * vec2(n(q + vec2(time * .02, 3.1)) - .5, n(q + vec2(7.3, time * .017)) - .5);
      gl_FragColor = vec4(v, 0., 1.); }`,
    { vel: { value: null }, dye: { value: null }, dt: { value: 0 }, time: { value: 0 }, buoy: { value: 0 }, turb: { value: 0 },
      em: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, spread: { value: 0 }, spr: { value: new THREE.Vector4(-1, -1, -1, -1) }, dir: { value: [0, 1, 2, 3].map(() => new THREE.Vector2()) }, aspect: { value: simW / simH } });
  const inject = M(`uniform sampler2D dye; uniform float dt; uniform vec4 em[4]; uniform float rate[4]; uniform float aspect;
    void main(){ float d = texture2D(dye, vUv).x;
      for (int k = 0; k < 4; k++) { vec2 e = (vUv - em[k].xy) * vec2(aspect, 1.); d += rate[k] * exp(-dot(e, e) / (em[k].z * em[k].z * .12)) * dt; }
      gl_FragColor = vec4(d, 0., 0., 1.); }`,
    { dye: { value: null }, dt: { value: 0 }, em: { value: force.uniforms.em.value }, rate: { value: [0, 0, 0, 0] }, aspect: { value: simW / simH } });

  const S = { t: -1, time: 0, emitters: [] };
  const clear = () => { for (const t of [vel.read, vel.write, prs.read, prs.write, dye.read, dye.write, div, crl]) { r.setRenderTarget(t); r.setClearColor(0x000000, 0); r.clear(); } };
  // emitters: [x, y, radius, strength, dirX, dirY, densityRate], positions in 0..1 of the smoke sheet
  // obstacle / spreadRect: [u0, v0, u1, v1] in the sheet, or null
  const setup = (emitters, { buoy = 6, turb = 40, eps = 14, keepVel = .995, keepDye = .992, obstacle = null, spreadRect = null, spread = 0, speed = 1 } = {}) => {
    clear(); S.t = -1; S.time = 0; S.emitters = emitters; Object.assign(S, { buoy, turb, eps, keepVel, keepDye, speed });
    obs.value.set(...(obstacle ?? [-1, -1, -1, -1])); force.uniforms.spr.value.set(...(spreadRect ?? [-1, -1, -1, -1])); force.uniforms.spread.value = spread;
  };
  const step = () => {
    const dt = (S.t + 1 < S.warm ? 1 : S.speed) / 25; S.t++; S.time += dt;   // one step per video frame: the warm-up at full speed, the shot at S.speed
    S.emitters.forEach((e, k) => {
      // each emitter breathes and wanders a little: no two moments the same
      const w = Math.sin(S.time * (.25 + k * .08) + k * 1.7), w2 = Math.sin(S.time * (.5 + k * .11) + k);
      force.uniforms.em.value[k].set(e[0] + .004 * w, e[1] + .006 * w2, e[2], e[3] * (.9 + .1 * w2));
      const a = Math.atan2(e[5], e[4]) + .22 * Math.sin(S.time * (.35 + k * .13) + k * 2.3);
      force.uniforms.dir.value[k].set(Math.cos(a), Math.sin(a));
      inject.uniforms.rate.value[k] = e[6] * (.85 + .15 * Math.sin(S.time * (1.3 + k * .4) + k * 3));
    });
    for (let k = S.emitters.length; k < 4; k++) { force.uniforms.em.value[k].set(-1, -1, .01, 0); inject.uniforms.rate.value[k] = 0; }
    Object.assign(force.uniforms, {}); force.uniforms.vel.value = vel.read.texture; force.uniforms.dye.value = dye.read.texture;
    force.uniforms.dt.value = dt; force.uniforms.time.value = S.time; force.uniforms.buoy.value = S.buoy; force.uniforms.turb.value = S.turb;
    run(force, vel.write); vel.swap();
    curl.uniforms.vel.value = vel.read.texture; run(curl, crl);
    Object.assign(vort.uniforms.vel, { value: vel.read.texture }); vort.uniforms.crl.value = crl.texture; vort.uniforms.dt.value = dt; vort.uniforms.eps.value = S.eps;
    run(vort, vel.write); vel.swap();
    diverge.uniforms.vel.value = vel.read.texture; run(diverge, div);
    scale.uniforms.src.value = prs.read.texture; scale.uniforms.k.value = .8; run(scale, prs.write); prs.swap();
    for (let k = 0; k < 24; k++) { jacobi.uniforms.prs.value = prs.read.texture; run(jacobi, prs.write); prs.swap(); }
    subtract.uniforms.prs.value = prs.read.texture; subtract.uniforms.vel.value = vel.read.texture; run(subtract, vel.write); vel.swap();
    advect.uniforms.vel.value = vel.read.texture; advect.uniforms.src.value = vel.read.texture; advect.uniforms.dt.value = dt; advect.uniforms.keep.value = S.keepVel; advect.uniforms.fade.value = 0;
    advect.uniforms.tx.value = tx; run(advect, vel.write); vel.swap();
    inject.uniforms.dye.value = dye.read.texture; inject.uniforms.dt.value = dt; run(inject, dye.write); dye.swap();
    advect.uniforms.vel.value = vel.read.texture; advect.uniforms.src.value = dye.read.texture; advect.uniforms.keep.value = S.keepDye; advect.uniforms.fade.value = 1;
    run(advect, dye.write); dye.swap();
  };
  // run the simulation up to video frame i (two steps per frame), with pre-roll so the smoke is already there
  const to = (i, preroll = 400) => { S.warm = preroll; while (S.t < i + preroll) step(); };   // a long warm-up: the smoke already hangs in the air
  return { setup, to, get texture() { return dye.read.texture; }, _dye: () => dye.read, _vel: () => vel.read };
};
