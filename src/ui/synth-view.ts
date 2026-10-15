// The new synth page (from the owner's mockup): the sources with their own filter slots, the
// main filter with its routing, the two envelopes and the play bar. It edits the same patch as
// the full parameter view under it (opened with the gear), so both always show the same values.
import { Biquad } from '../engine/core/dsp';
import { fromNormalized, getParam, toNormalized, type ParamValue, type Patch } from '../schema';
import { formatValue } from './params-panel';

type OnChange = (id: string, value: ParamValue) => void;

const DESIGN_WIDTH = 1600;
const FS = 48000;

/** Tiny DOM helper. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.append(...kids);
  return el;
}

/** A crisp canvas of a given CSS size. */
function canvas(w: number, hgt: number, cls = ''): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = h('canvas', cls);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr);
  c.height = Math.round(hgt * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${hgt}px`;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  return [c, g];
}

/** |H| of a biquad at frequency f. */
function biquadMag(b: Biquad, f: number): number {
  const w = (2 * Math.PI * f) / FS;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b.b0 + b.b1 * c1 + b.b2 * c2, ni = -(b.b1 * s1 + b.b2 * s2);
  const dr = 1 + b.a1 * c1 + b.a2 * c2, di = -(b.a1 * s1 + b.a2 * s2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

type Kind = 'off' | 'hp' | 'lp' | 'bp' | 'notch';
/** Magnitude response of a filter made of biquads (each [kind, fc, q]). */
function response(stages: [Kind, number, number][], f: number): number {
  let m = 1;
  for (const [kind, fc, q] of stages) {
    if (kind === 'off') continue;
    const b = new Biquad();
    const fcc = Math.min(Math.max(fc, 10), FS * 0.45);
    if (kind === 'hp') b.setHighpass(fcc, q, FS);
    else if (kind === 'lp') b.setLowpass(fcc, q, FS);
    else if (kind === 'bp') b.setBandpass(fcc, q, FS);
    else {
      b.setBandpass(fcc, q, FS);
      m *= Math.abs(1 - biquadMag(b, f));
      continue;
    }
    m *= biquadMag(b, f);
  }
  return m;
}

// ------------------------------------------------------------------ darkroom look
// The page is a darkroom: deep red trays, red dials, round glowing lamps and every display a
// small photo print (silver line on grainy dark paper, cream border from the CSS).
const INK = '#e8e2d8';
const FAINT = '#4a160e';
const HI = '#ffd2c4';

let grainPattern: HTMLCanvasElement | null = null;
/** A small tile of film grain, made once and reused by every display. */
function grain(): HTMLCanvasElement {
  if (grainPattern) return grainPattern;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(128, 128);
  let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const v = 150 + (seed % 105);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = (seed >> 8) % 46;
  }
  g.putImageData(img, 0, 0);
  grainPattern = c;
  return c;
}

/** The dark photographic paper every display draws on. */
function paper(g: CanvasRenderingContext2D, W: number, H: number): void {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0e0d0c';
  g.fillRect(0, 0, W, H);
  g.fillStyle = g.createPattern(grain(), 'repeat')!;
  g.fillRect(0, 0, W, H);
}

/** Vignette on top of a print. */
function vignette(g: CanvasRenderingContext2D, W: number, H: number): void {
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.75)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

/** A silver line: a few faint ghost copies around a bright main line, like a long exposure. */
function silver(g: CanvasRenderingContext2D, pts: [number, number][], on = true): void {
  const col = on ? INK : '#5a524a';
  for (let k = -3; k <= 3; k++) {
    if (k === 0) continue;
    g.strokeStyle = hexA(col, 0.1);
    g.lineWidth = 0.8;
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const yy = y + k * 1.1 * Math.sin(x * 0.045 + k);
      if (i) g.lineTo(x, yy);
      else g.moveTo(x, yy);
    });
    g.stroke();
  }
  g.strokeStyle = hexA(col, 0.9);
  g.lineWidth = 1.5;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
}

/** A round glowing lamp (the darkroom's safelight) used for every on/off light. */
function lamp(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'lamp';
  return el;
}

export class SynthView {
  readonly root: HTMLElement;
  private readonly page: HTMLElement;
  private values: Record<string, ParamValue> = {};
  private readonly watchers = new Map<string, (() => void)[]>();
  private readonly allViews: (() => void)[] = [];
  private analyser: AnalyserNode | null = null;
  private meterG: CanvasRenderingContext2D | null = null;
  private readonly remembered = new Map<string, ParamValue>();
  onGear: () => void = () => {};
  private readonly titleEl = h('span', 'v2-name');
  private readonly subEl = h('span', 'v2-sub');

  constructor(root: HTMLElement, private readonly onChange: OnChange) {
    this.root = root;
    this.page = h('div', 'v2');
    root.append(this.page);
    this.build();
    const fit = () => {
      const s = Math.min(1, root.clientWidth / DESIGN_WIDTH);
      this.page.style.transform = `scale(${s})`;
      this.page.style.marginLeft = `${Math.max(0, (root.clientWidth - DESIGN_WIDTH * s) / 2)}px`;
      root.style.height = `${this.page.offsetHeight * s}px`;
    };
    new ResizeObserver(fit).observe(root);
    window.addEventListener('resize', fit);
    requestAnimationFrame(fit);
  }

  // ------------------------------------------------------------------ state

  /** Show a whole patch (a preset was loaded). */
  show(patch: Patch): void {
    this.values = { ...(patch as unknown as Record<string, ParamValue>) };
    for (const v of this.allViews) v();
  }

  /** The preset's name and where it lives (shelf · frame · template), shown like a print's caption. */
  setTitle(name: string, sub: string): void {
    this.titleEl.textContent = name;
    this.subEl.textContent = sub.toUpperCase();
  }

  /** One value changed elsewhere (the full parameter view). */
  setValue(id: string, v: ParamValue): void {
    this.values[id] = v;
    for (const f of this.watchers.get(id) ?? []) f();
  }

  setAnalyser(a: AnalyserNode): void {
    this.analyser = a;
    const buf = new Float32Array(a.fftSize);
    let level = 0;
    const draw = () => {
      a.getFloatTimeDomainData(buf);
      let pk = 0;
      for (const x of buf) pk = Math.max(pk, Math.abs(x));
      level = Math.max(pk, level * 0.92);
      const g = this.meterG;
      if (g) {
        const H = 26, N = 16;
        g.clearRect(0, 0, 96, H);
        const db = 20 * Math.log10(level + 1e-6);
        const lit = Math.round(Math.max(0, Math.min(1, (db + 48) / 48)) * N);
        for (let i = 0; i < N; i++) {
          g.fillStyle = i < lit ? hexA(i > 13 ? '#ff4f6a' : '#ff8f75', 0.35 + i * 0.04) : FAINT;
          g.fillRect(i * 6, 0, 4, H);
        }
      }
      requestAnimationFrame(draw);
    };
    if (this.analyser) requestAnimationFrame(draw);
  }

  private get(id: string): ParamValue {
    const v = this.values[id];
    return v === undefined ? (getParam(id)?.default as ParamValue) : v;
  }
  private num(id: string): number {
    return Number(this.get(id));
  }

  private set(id: string, v: ParamValue): void {
    if (this.values[id] === v) return;
    this.values[id] = v;
    this.onChange(id, v);
    for (const f of this.watchers.get(id) ?? []) f();
  }

  /** Run `view` now, whenever one of `ids` changes, and when a patch loads. */
  private watch(ids: string[], view: () => void): void {
    for (const id of ids) {
      if (!this.watchers.has(id)) this.watchers.set(id, []);
      this.watchers.get(id)!.push(view);
    }
    this.allViews.push(view);
  }

  // ------------------------------------------------------------------ controls

  /** A dark metallic knob bound to a float/int parameter. */
  private knob(id: string, label: string, size: 'big' | 'mid' | 'small' = 'mid', opts: { fmt?: (v: number) => string; disabled?: () => boolean; deps?: string[] } = {}): HTMLElement {
    const p = getParam(id)!;
    const px = size === 'big' ? 64 : size === 'mid' ? 48 : 36;
    const [cv, g] = canvas(px, px, 'knob');
    const lab = h('div', 'k-label', label);
    const val = h('div', 'k-val');
    const el = h('div', `k k-${size}`, cv, lab, val);
    el.title = `${p.label}: ${p.describes}`;
    const bipolar = (p.min ?? 0) < 0 && (p.max ?? 0) > 0;
    const fmt = (v: number) => (opts.fmt ? opts.fmt(v) : formatValue(p, v));
    const draw = () => {
      const v = this.num(id);
      const n = toNormalized(p, p.curve === 'log' ? Math.max(v, p.min!) : v);
      const off = opts.disabled?.() ?? false;
      el.classList.toggle('off', off);
      val.textContent = fmt(v);
      const r = px / 2 - 1, cx = px / 2, cy = px / 2;
      g.clearRect(0, 0, px, px);
      const a0 = 0.75 * Math.PI, a1 = 2.25 * Math.PI;
      const zero = bipolar ? a0 + (a1 - a0) * toNormalized(p, 0) : a0;
      const av = a0 + (a1 - a0) * n;
      const accent = getComputedStyle(el).getPropertyValue('--knob-accent').trim() || '#ff8f75';
      // dial face
      g.fillStyle = '#120403';
      g.strokeStyle = '#3a120c';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy, r - 0.5, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
      // ticks, lit up to the value
      const ticks = px > 44 ? 20 : 12;
      const lo = Math.min(zero, av) - 1e-6, hi = Math.max(zero, av) + 1e-6;
      g.lineWidth = 1.3;
      for (let i = 0; i <= ticks; i++) {
        const t = a0 + ((a1 - a0) * i) / ticks;
        const big = i % (ticks / 4) === 0;
        g.strokeStyle = !off && t >= lo && t <= hi ? accent : FAINT;
        g.beginPath();
        g.moveTo(cx + Math.cos(t) * (r - 7), cy + Math.sin(t) * (r - 7));
        g.lineTo(cx + Math.cos(t) * (r - (big ? 1.5 : 4)), cy + Math.sin(t) * (r - (big ? 1.5 : 4)));
        g.stroke();
      }
      // body
      const br = r * 0.62;
      const body = g.createRadialGradient(cx - br * 0.2, cy - br * 0.3, br * 0.05, cx, cy, br);
      body.addColorStop(0, '#4a1a12');
      body.addColorStop(1, '#1a0605');
      g.fillStyle = body;
      g.beginPath();
      g.arc(cx, cy, br, 0, 2 * Math.PI);
      g.fill();
      // pointer
      g.strokeStyle = off ? '#5a3a32' : HI;
      g.lineWidth = px > 44 ? 3 : 2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(av) * r * 0.56, cy + Math.sin(av) * r * 0.56);
      g.stroke();
    };
    const setN = (n: number) => {
      let v = fromNormalized(p, n);
      if (p.type === 'float') v = Math.round(v * 1e4) / 1e4;
      this.set(id, v);
    };
    let startY = 0, startN = 0;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startN = toNormalized(p, this.num(id));
      el.classList.add('drag');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cv.hasPointerCapture(e.pointerId)) return;
      const span = e.shiftKey ? 1000 : 200;
      setN(startN + (startY - e.clientY) / span);
    });
    cv.addEventListener('pointerup', (e) => {
      cv.releasePointerCapture(e.pointerId);
      el.classList.remove('drag');
    });
    cv.addEventListener('dblclick', () => this.set(id, p.default as ParamValue));
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      setN(toNormalized(p, this.num(id)) - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.02));
    }, { passive: false });
    this.watch([id, ...(opts.deps ?? [])], draw);
    return el;
  }

  /** A label and value you drag up/down (or scroll) to change, like the master level. */
  private readout(id: string, label: string): HTMLElement {
    const p = getParam(id)!;
    const val = h('span', 'ro-val');
    const el = h('div', 'readout', h('span', 'ro-label', label), val);
    el.title = `${p.label}: ${p.describes}`;
    let y0 = 0, n0 = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      y0 = e.clientY;
      n0 = toNormalized(p, this.num(id));
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      const v = fromNormalized(p, Math.max(0, Math.min(1, n0 + (y0 - e.clientY) / (e.shiftKey ? 1000 : 200))));
      this.set(id, Math.round(v * 10) / 10);
    });
    el.addEventListener('pointerup', (e) => el.releasePointerCapture(e.pointerId));
    el.addEventListener('dblclick', () => this.set(id, p.default as ParamValue));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const v = fromNormalized(p, Math.max(0, Math.min(1, toNormalized(p, this.num(id)) - Math.sign(e.deltaY) * 0.02)));
      this.set(id, Math.round(v * 10) / 10);
    }, { passive: false });
    this.watch([id], () => { val.textContent = formatValue(p, this.num(id)); });
    return el;
  }

  /** ‹ name › selector for an enum parameter (the name is a dropdown too). */
  private selector(id: string, opts: { onPick?: (from: string, to: string) => void; label?: (o: string) => string } = {}): HTMLElement {
    const p = getParam(id)!;
    const sel = h('select', 'sel-name');
    for (const o of p.options!) sel.append(new Option((opts.label ?? ((x: string) => x.replace(/_/g, ' ')))(o).toUpperCase(), o));
    const pick = (to: string) => {
      const from = String(this.get(id));
      if (from === to) return;
      opts.onPick?.(from, to);
      this.set(id, to);
    };
    sel.onchange = () => pick(sel.value);
    const step = (d: number) => {
      const i = p.options!.indexOf(String(this.get(id)));
      pick(p.options![(i + d + p.options!.length) % p.options!.length]);
    };
    const prev = h('button', 'sel-btn', '‹');
    const next = h('button', 'sel-btn', '›');
    prev.onclick = () => step(-1);
    next.onclick = () => step(1);
    const el = h('div', 'sel', sel, prev, next);
    el.title = `${p.label}: ${p.describes}`;
    this.watch([id], () => { sel.value = String(this.get(id)); });
    return el;
  }

  /** A small LED switch for a bool parameter. */
  private toggle(id: string, label: string, cls = ''): HTMLElement {
    const p = getParam(id)!;
    const b = h('button', `led ${cls}`, lamp(), label);
    b.title = `${p.label}: ${p.describes}`;
    b.onclick = () => this.set(id, !this.get(id));
    this.watch([id], () => b.classList.toggle('on', !!this.get(id)));
    return b;
  }

  /** Power LED in a card header that mutes a layer by its level (remembering the level). */
  private levelPower(levelId: string): HTMLElement {
    const b = h('button', 'power', lamp());
    b.title = 'On / off (sets the level to 0 and back)';
    b.onclick = () => {
      const v = this.num(levelId);
      if (v > 0) {
        this.remembered.set(levelId, v);
        this.set(levelId, 0);
      } else this.set(levelId, this.remembered.get(levelId) ?? (getParam(levelId)!.default as number) ?? 0.5);
    };
    this.watch([levelId], () => b.classList.toggle('on', this.num(levelId) > 0));
    return b;
  }

  /** Power LED for a bool parameter. */
  private boolPower(id: string): HTMLElement {
    const b = h('button', 'power', lamp());
    b.title = getParam(id)?.describes ?? '';
    b.onclick = () => this.set(id, !this.get(id));
    this.watch([id], () => b.classList.toggle('on', !!this.get(id)));
    return b;
  }

  /** A number field dragged up/down (ints), with optional custom get/set. */
  private stepper(label: string, get: () => number, set: (v: number) => void, min: number, max: number, ids: string[], title = ''): HTMLElement {
    const v = h('span', 'st-val');
    const el = h('div', 'stepper', h('span', 'st-label', label), v);
    el.title = title;
    let y0 = 0, v0 = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      y0 = e.clientY;
      v0 = get();
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      set(Math.max(min, Math.min(max, v0 + Math.round((y0 - e.clientY) / 12))));
    });
    el.addEventListener('pointerup', (e) => el.releasePointerCapture(e.pointerId));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      set(Math.max(min, Math.min(max, get() - Math.sign(e.deltaY))));
    }, { passive: false });
    this.watch(ids, () => {
      const n = get();
      v.textContent = Number.isInteger(n) ? String(n) : n.toFixed(0);
    });
    return el;
  }

  private card(title: string, group: 'src' | 'flt' | 'dirt', ...head: HTMLElement[]): [HTMLElement, HTMLElement] {
    const body = h('div', 'c-body');
    const hd = h('div', 'c-head', ...head, h('span', 'c-title', title));
    const el = h('div', `c c-${group}`, hd, body);
    return [el, body];
  }

  // ------------------------------------------------------------------ displays

  private waveView(n: 1 | 2): HTMLElement {
    const W = 260, H = 96;
    const [cv, g] = canvas(W, H, 'disp');
    const ids = [`osc${n}.wave`, `osc${n}.pulse_width`, `osc${n}.wt_pos`, `osc${n}.level`, `osc${n}.unison_voices`, `osc${n}.unison_detune`];
    const shape = (wave: string, x: number, pw: number, wt: number): number => {
      const tri = x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4;
      const saw = 1 - 2 * x;
      switch (wave) {
        case 'sine': return Math.sin(2 * Math.PI * x);
        case 'triangle': return tri;
        case 'saw': return saw;
        case 'pulse': return x < pw ? 0.8 : -0.8;
        case 'pwm_saw': return 0.5 * (saw + (1 - 2 * ((x + pw) % 1)));
        case 'wavetable': {
          const seg = wt * 4, i = Math.min(3, Math.floor(seg)), f = seg - i;
          const frames = [Math.sin(2 * Math.PI * x), tri, saw, x < 0.5 ? 0.8 : -0.8,
            Math.sin(2 * Math.PI * x) * 0.6 + Math.sin(6 * Math.PI * x) * 0.3 + Math.sin(10 * Math.PI * x) * 0.15];
          return frames[i] * (1 - f) + frames[i + 1] * f;
        }
        case 'string': return Math.exp(-3 * x) * Math.sin(2 * Math.PI * 3 * x) * (1 - 2 * ((x * 7) % 1) * 0.3);
        case 'shepard': return 0.5 * Math.sin(2 * Math.PI * x) + 0.3 * Math.sin(4 * Math.PI * x) + 0.2 * Math.sin(8 * Math.PI * x);
        default: return saw;
      }
    };
    const draw = () => {
      paper(g, W, H);
      const wave = String(this.get(`osc${n}.wave`));
      const pw = this.num(`osc${n}.pulse_width`), wt = this.num(`osc${n}.wt_pos`);
      const lvl = this.num(`osc${n}.level`);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) {
        const x = ((i / W) * 1.5) % 1;
        pts.push([i, H / 2 - shape(wave, x, pw, wt) * (H / 2 - 14)]);
      }
      silver(g, pts, lvl > 0);
      vignette(g, W, H);
    };
    this.watch(ids, draw);
    return cv;
  }

  /** Frequency response display: `stages` gives the filter for the current values. */
  private curveView(ids: string[], stages: () => [Kind, number, number][] | 'comb' | 'formant', active: () => boolean, W = 144, H = 66): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    const draw = () => {
      paper(g, W, H);
      g.strokeStyle = 'rgba(232,226,216,0.04)';
      for (const f of [100, 1000, 10000]) {
        const x = (Math.log(f / 20) / Math.log(1000)) * W;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
      }
      const st = stages();
      const on = active();
      const top = 24, bottom = -48;
      const ys: number[] = [];
      for (let i = 0; i <= W; i++) {
        const f = 20 * Math.pow(1000, i / W);
        let m: number;
        if (st === 'comb') {
          const fc = this.num('filter.cutoff');
          m = 1 / Math.max(0.15, Math.abs(1 - 0.85 * Math.cos((2 * Math.PI * f) / fc)) + 0.15);
          m *= 0.35;
        } else if (st === 'formant') {
          const k = this.num('filter.cutoff') / 2000;
          const v = this.num('filter.vowel') * 4;
          const vowels = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
          const i0 = Math.min(3, Math.floor(v)), fr = v - i0;
          m = 0;
          for (let j = 0; j < 3; j++) {
            const fj = (vowels[i0][j] * (1 - fr) + vowels[i0 + 1][j] * fr) * k;
            m += response([['bp', fj, 6]], f) * [1, 0.5, 0.25][j];
          }
        } else m = on ? response(st, f) : 1;
        const db = 20 * Math.log10(m + 1e-9);
        ys.push(H - ((Math.max(bottom, Math.min(top, db)) - bottom) / (top - bottom)) * H);
      }
      silver(g, ys.map((y, i) => [i, y] as [number, number]), on);
      vignette(g, W, H);
    };
    this.watch(ids, draw);
    return cv;
  }

  /** ADSR display. */
  private envView(prefix: string, W = 370, H = 112): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    const ids = ['attack', 'decay', 'sustain', 'release'].map((s) => `${prefix}.${s}`);
    const draw = () => {
      const a = this.num(ids[0]), d = this.num(ids[1]), s = this.num(ids[2]), r = this.num(ids[3]);
      const hold = Math.max(250, 0.25 * (a + d));
      const total = a + d + hold + r;
      const span = total <= 1000 ? 1000 : total <= 4000 ? Math.ceil(total / 1000) * 1000 : total;
      const X = (t: number) => 6 + (t / span) * (W - 12);
      const Y = (v: number) => H - 10 - v * (H - 28);
      paper(g, W, H);
      g.fillStyle = 'rgba(232,226,216,0.3)';
      g.font = '10px Inter, system-ui, sans-serif';
      g.strokeStyle = 'rgba(232,226,216,0.04)';
      const stepMs = span <= 1000 ? 250 : 1000;
      for (let t = stepMs; t < span; t += stepMs) {
        g.beginPath();
        g.moveTo(X(t), 0);
        g.lineTo(X(t), H);
        g.stroke();
        if (t % 1000 === 0) g.fillText(`${t / 1000} s`, X(t) + 3, H - 6);
      }
      const pts: [number, number][] = [];
      const N = 40;
      for (let i = 0; i <= N; i++) pts.push([X((a * i) / N), Y(1 - Math.pow(1 - i / N, 2))]);
      for (let i = 1; i <= N; i++) pts.push([X(a + (d * i) / N), Y(s + (1 - s) * Math.exp((-5 * i) / N))]);
      pts.push([X(a + d + hold), Y(s)]);
      for (let i = 1; i <= N; i++) pts.push([X(a + d + hold + (r * i) / N), Y(s * Math.exp((-5 * i) / N))]);
      silver(g, [[X(0), Y(0)], ...pts]);
      vignette(g, W, H);
    };
    this.watch(ids, draw);
    return cv;
  }

  // ------------------------------------------------------------------ cards

  private oscCard(n: 1 | 2): HTMLElement {
    const o = `osc${n}`;
    const [el, body] = this.card(n === 1 ? 'OSC A' : 'OSC B', 'src', this.levelPower(`${o}.level`));
    const semiP = getParam(`${o}.semi`)!;
    const oct = () => Math.trunc(this.num(`${o}.semi`) / 12);
    const sem = () => this.num(`${o}.semi`) - 12 * oct();
    const setSemi = (v: number) => this.set(`${o}.semi`, Math.max(semiP.min!, Math.min(semiP.max!, v)));
    const pitch = h('div', 'pitch-row',
      this.stepper('OCT', oct, (v) => setSemi(12 * v + sem()), -2, 2, [`${o}.semi`], 'Octave'),
      this.stepper('SEM', sem, (v) => setSemi(12 * oct() + v), -11, 11, [`${o}.semi`], 'Semitones'),
      this.stepper('FIN', () => Math.round(this.num(`${o}.fine`)), (v) => this.set(`${o}.fine`, v), -100, 100, [`${o}.fine`], 'Fine tune (cents)'),
    );
    const top = h('div', 'osc-top', this.selector(`${o}.wave`), pitch);
    const shapeId = () => (String(this.get(`${o}.wave`)) === 'wavetable' ? `${o}.wt_pos` : `${o}.pulse_width`);
    // Shape: pulse width on pulse / pwm saw, position on the wavetable, dimmed otherwise.
    const shapeWrap = h('div', 'shape-wrap');
    const pwKnob = this.knob(`${o}.pulse_width`, 'SHAPE', 'small', { disabled: () => !['pulse', 'pwm_saw'].includes(String(this.get(`${o}.wave`))), deps: [`${o}.wave`] });
    const wtKnob = this.knob(`${o}.wt_pos`, 'SHAPE', 'small');
    shapeWrap.append(pwKnob, wtKnob);
    this.watch([`${o}.wave`], () => {
      const wt = shapeId() === `${o}.wt_pos`;
      wtKnob.style.display = wt ? '' : 'none';
      pwKnob.style.display = wt ? 'none' : '';
    });
    const uniOff = () => this.num(`${o}.unison_voices`) <= 1;
    const knobs = h('div', 'knob-row',
      this.stepper('UNISON', () => this.num(`${o}.unison_voices`), (v) => this.set(`${o}.unison_voices`, v), 1, 7, [`${o}.unison_voices`], 'Unison voices (stacked detuned copies)'),
      this.knob(`${o}.unison_detune`, 'DETUNE', 'small', { disabled: uniOff, deps: [`${o}.unison_voices`] }),
      shapeWrap,
      this.knob(`${o}.unison_spread`, 'SPREAD', 'small', { disabled: uniOff, deps: [`${o}.unison_voices`] }),
      this.lowCut(`${o}.highpass`, `${o}.filter_type`),
      this.knob(`${o}.level`, 'LEVEL', 'small'),
    );
    body.append(top, this.waveView(n), knobs);
    if (n === 2) body.append(h('div', 'sync-row', this.toggle('osc2.sync', 'SYNC')));
    return el;
  }

  /**
   * LOW CUT: a source's high-pass as one knob (fully left = off). On the oscillators it is their
   * filter slot's cutoff (dimmed if that slot was set to another type in the full view); on the
   * noise bed, turning it up switches the bed's own filter to a 24 dB high-pass.
   */
  private lowCut(cutId: string, typeId: string): HTMLElement {
    const isOsc = cutId.startsWith('osc');
    const p = getParam(cutId)!;
    const OFF = 21;
    const fmt = (v: number) => {
      const t = String(this.get(typeId));
      if (!t.startsWith('high') || v <= OFF) return 'off';
      return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
    };
    const el = this.knob(cutId, 'LO CUT', 'small', {
      fmt,
      deps: [typeId],
      disabled: () => (isOsc ? !String(this.get(typeId)).startsWith('high') : false),
    });
    el.title = `Low cut: ${isOsc ? 'cuts this oscillator below this frequency before the drive, so it stays out of the sub\'s space' : 'cuts the noise bed below this frequency so it stays out of the body of the sound'}. Fully left = off. ${p.label}.`;
    if (!isOsc) {
      // The bed's filter is off by default: the knob shows "off" at its far left and switches it on when turned up.
      el.addEventListener('pointerdown', () => {
        if (!String(this.get(typeId)).startsWith('high')) {
          this.set(cutId, 20);
          this.set(typeId, 'high 24');
        }
      }, true);
    }
    return el;
  }

  private breathCard(): HTMLElement {
    const [el, body] = this.card('BREATH', 'src', this.levelPower('breath.level'));
    el.classList.add('layer');
    body.append(h('div', 'knob-row tight',
      this.knob('breath.chiff', 'CHIFF', 'small'),
      this.knob('breath.decay', 'DECAY', 'small'),
      this.knob('breath.tone', 'TONE', 'small'),
      this.knob('breath.level', 'LEVEL', 'small'),
    ));
    return el;
  }

  private clickCard(): HTMLElement {
    const [el, body] = this.card('CLICK', 'src', this.levelPower('click.level'));
    el.classList.add('layer');
    body.append(h('div', 'card-top', this.selector('click.type')), h('div', 'knob-row tight',
      this.knob('click.decay', 'DECAY', 'small'),
      this.knob('click.tone', 'TONE', 'small'),
      this.knob('click.level', 'LEVEL', 'small'),
    ));
    return el;
  }

  /** Distortion: type, a live transfer curve, drive, mix, tone and the clean low band. */
  private distCard(): HTMLElement {
    const [el, body] = this.card('DISTORTION', 'dirt', this.boolPower('dist.on'));
    const W = 300, H = 105;
    const [cv, g] = canvas(W, H, 'disp');
    const shape = (type: string, x: number, d: number): number => {
      const k = 1 + 14 * d;
      switch (type) {
        case 'hard': return Math.max(-1, Math.min(1, x * k));
        case 'fold': return Math.sin((x * k * Math.PI) / 2);
        case 'tube': {
          const b = 0.25;
          return (Math.tanh(x * k + b) - Math.tanh(b)) / (1 - Math.tanh(b) * 0.4);
        }
        default: return Math.tanh(x * k) / Math.tanh(Math.max(1, k * 0.6));
      }
    };
    const draw = () => {
      const on = !!this.get('dist.on');
      const type = String(this.get('dist.type')), d = this.num('dist.drive'), mix = this.num('dist.mix');
      paper(g, W, H);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) {
        const x = (i / W) * 2 - 1;
        const y = Math.max(-1.1, Math.min(1.1, mix * shape(type, x, d) + (1 - mix) * x));
        pts.push([i, H / 2 - y * (H / 2 - 12)]);
      }
      silver(g, pts, on);
      vignette(g, W, H);
    };
    this.watch(['dist.on', 'dist.type', 'dist.drive', 'dist.mix'], draw);
    const low = this.knob('dist.clean_below', 'LOW', 'small', { fmt: (v) => (v <= 21 ? 'off' : `${Math.round(v)} Hz`) });
    low.title = 'Keeps everything below this frequency clean (the distortion only works on the part above it). Fully left = off.';
    body.append(this.selector('dist.type'), cv, h('div', 'knob-row tight',
      this.knob('dist.drive', 'DRIVE', 'small'),
      this.knob('dist.mix', 'MIX', 'small'),
      this.knob('dist.post_tone', 'TONE', 'small'),
      low,
    ));
    return el;
  }

  private crushCard(): HTMLElement {
    const [el, body] = this.card('BITCRUSHER', 'dirt', this.boolPower('crush.on'));
    body.append(h('div', 'knob-row tight',
      this.knob('crush.mix', 'MIX', 'small'),
      this.knob('crush.bits', 'BITS', 'small', { fmt: (v) => `${Math.round(v)} bit` }),
      this.knob('crush.rate', 'RATE', 'small'),
    ));
    return el;
  }

  private tapeCard(): HTMLElement {
    const [el, body] = this.card('TAPE', 'dirt', this.boolPower('tape.on'));
    body.append(h('div', 'knob-row tight',
      this.knob('tape.drive', 'DRIVE', 'small'),
      this.knob('tape.wow', 'WOW', 'small'),
      this.knob('tape.age', 'AGE', 'small'),
    ));
    return el;
  }

  private midClipCard(): HTMLElement {
    const [el, body] = this.card('MID CLIP', 'dirt', this.levelPower('clip.mid'));
    body.append(h('div', 'knob-row tight',
      this.knob('clip.mid', 'CLIP', 'small'),
      h('div', 'clip-led', this.toggle('clip.low_cut', 'CLEAN LOWS', 'small')),
    ));
    return el;
  }

  private noiseCard(): HTMLElement {
    const [el, body] = this.card('NOISE', 'src', this.levelPower('texture.level'));
    el.classList.add('noise');
    const head = h('div', 'card-top', this.selector('texture.type'), this.toggle('texture.direct', 'DIRECT OUT', 'small'));
    const knobs = h('div', 'knob-row tight',
      this.knob('texture.tone', 'TONE', 'small'),
      this.knob('texture.tail', 'TAIL', 'small'),
      this.knob('texture.pan', 'PAN', 'small'),
      this.lowCut('texture.filter_cutoff', 'texture.filter_type'),
      this.knob('texture.level', 'LEVEL', 'small'),
    );
    body.append(head, knobs);
    return el;
  }

  private subCard(): HTMLElement {
    const [el, body] = this.card('SUB', 'src', this.levelPower('sub.level'));
    el.classList.add('sub');
    const waves = h('div', 'wave-btns');
    const icons: Record<string, string> = { sine: '∿', triangle: '⋀', square: '⊓' };
    for (const w of getParam('sub.wave')!.options!) {
      const b = h('button', 'wave-btn', icons[w] ?? w);
      b.title = w;
      b.onclick = () => this.set('sub.wave', w);
      this.watch(['sub.wave'], () => b.classList.toggle('on', this.get('sub.wave') === w));
      waves.append(b);
    }
    const head = h('div', 'card-top', waves, this.toggle('sub.direct', 'DIRECT OUT', 'small'));
    const W = 206, H = 58;
    const [cv, g] = canvas(W, H, 'disp');
    this.watch(['sub.wave', 'sub.level'], () => {
      paper(g, W, H);
      const w = String(this.get('sub.wave'));
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) {
        const x = ((i / W) * 1.5) % 1;
        const y = w === 'square' ? (x < 0.5 ? 0.8 : -0.8) : w === 'triangle' ? (x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4) : Math.sin(2 * Math.PI * x);
        pts.push([i, H / 2 - y * (H / 2 - 10)]);
      }
      silver(g, pts, this.num('sub.level') > 0);
      vignette(g, W, H);
    });
    const row = h('div', 'knob-row',
      this.stepper('OCTAVE', () => this.num('sub.octave'), (v) => this.set('sub.octave', v), -2, -1, ['sub.octave'], 'Sub octave'),
      this.knob('sub.level', 'LEVEL', 'small'),
      this.knob('sub.clip', 'CLIP', 'small'),
    );
    body.append(head, cv, row);
    return el;
  }

  private envCard(prefix: 'amp_env' | 'mod_env', title: string, group: 'src' | 'flt', W = 370, H = 112): HTMLElement {
    const [el, body] = this.card(title, group);
    el.classList.add('env');
    const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
    const sus = (v: number) => (v <= 0.0005 ? '-inf dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`);
    const row = h('div', 'env-knobs',
      this.knob(`${prefix}.attack`, 'ATTACK', 'mid', { fmt: ms }),
      this.knob(`${prefix}.decay`, 'DECAY', 'mid', { fmt: ms }),
      this.knob(`${prefix}.sustain`, 'SUSTAIN', 'mid', { fmt: sus }),
      this.knob(`${prefix}.release`, 'RELEASE', 'mid', { fmt: ms }),
    );
    body.append(this.envView(prefix, W, H), row);
    return el;
  }

  private mainFilterCard(): HTMLElement {
    const [el, body] = this.card('FILTER', 'flt', this.boolPower('filter.on'));
    el.classList.add('main-filter');
    const type = () => String(this.get('filter.type'));
    const stages = (): [Kind, number, number][] | 'comb' | 'formant' => {
      const fc = this.num('filter.cutoff'), res = this.num('filter.resonance');
      switch (type()) {
        case 'lowpass': return [['lp', fc, 0.54 + res * 5], ['lp', fc, 1.31]];
        case 'diode': return [['lp', fc, 0.6 + res * 4], ['lp', fc * 1.6, 0.6]];
        case 'lpg': return [['lp', fc, 0.7 + res * 2]];
        case 'bandpass': return [['bp', fc, 1 + res * 6], ['bp', fc, 1 + res * 6]];
        case 'notch': return [['notch', fc, 0.7 + res * 4]];
        case 'comb': return 'comb';
        default: return 'formant';
      }
    };
    const curve = this.curveView(['filter.type', 'filter.cutoff', 'filter.resonance', 'filter.vowel', 'filter.on'], stages, () => !!this.get('filter.on'), 290, 130);
    const routes = h('div', 'routes-col',
      this.toggle('filter.route_a', 'A', 'route'),
      this.toggle('filter.route_b', 'B', 'route'),
      this.toggle('filter.route_n', 'N', 'route'),
      this.toggle('filter.route_s', 'S', 'route'),
    );
    const driveKnob = this.knob('drive.amount', 'DRIVE', 'small', { disabled: () => !this.get('drive.on'), deps: ['drive.on'] });
    // Turning the drive up switches the drive stage on.
    driveKnob.addEventListener('pointerdown', () => { if (!this.get('drive.on')) this.set('drive.on', true); });
    const grid = h('div', 'flt-knobs',
      this.knob('filter.cutoff', 'CUTOFF', 'mid'),
      this.knob('filter.resonance', 'RES', 'mid'),
      this.knob('filter.env_amount', 'ENV', 'mid'),
    );
    const row2 = h('div', 'knob-row tight flt-row2',
      this.knob('filter.keytrack', 'KEY', 'small'),
      driveKnob,
      this.knob('filter.fat', 'FAT', 'small'),
      this.knob('filter.mix', 'MIX', 'small'),
    );
    body.append(this.selector('filter.type'), curve, h('div', 'flt-main', h('div', 'routes-wrap', routes), grid), row2);
    return el;
  }

  private bottomBar(): HTMLElement {
    const mono = h('button', 'seg', 'MONO');
    const poly = h('button', 'seg', 'POLY');
    mono.onclick = () => {
      const v = this.num('voice.polyphony');
      if (v > 1) this.remembered.set('voice.polyphony', v);
      this.set('voice.polyphony', 1);
    };
    poly.onclick = () => this.set('voice.polyphony', Number(this.remembered.get('voice.polyphony') ?? 6));
    this.watch(['voice.polyphony'], () => {
      const m = this.num('voice.polyphony') <= 1;
      mono.classList.toggle('on', m);
      poly.classList.toggle('on', !m);
    });
    const glideP = getParam('voice.glide')!;
    const track = h('div', 'glide-track', h('div', 'glide-fill'));
    const gval = h('span', 'glide-val');
    const glide = h('div', 'glide', h('span', 'glide-label', 'GLIDE'), track, gval);
    glide.title = `${glideP.label}: ${glideP.describes}`;
    const setFromX = (x: number) => {
      const r = track.getBoundingClientRect();
      this.set('voice.glide', Math.round(fromNormalized(glideP, (x - r.left) / r.width) * 10) / 10);
    };
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      setFromX(e.clientX);
    });
    track.addEventListener('pointermove', (e) => { if (track.hasPointerCapture(e.pointerId)) setFromX(e.clientX); });
    track.addEventListener('dblclick', () => this.set('voice.glide', 0));
    this.watch(['voice.glide'], () => {
      const v = this.num('voice.glide');
      (track.firstChild as HTMLElement).style.width = `${toNormalized(glideP, v) * 100}%`;
      gval.textContent = formatValue(glideP, v);
    });
    const gear = h('button', 'gear', h('span', 'gear-icon'), h('span', 'gear-label', 'OPEN ALL'));
    gear.title = 'Open every control (the full parameter view) under this page';
    gear.onclick = () => this.onGear();
    const [meter, mg] = canvas(96, 26, 'meter');
    this.meterG = mg;
    const master = h('div', 'master', this.readout('output.gain', 'MASTER'), meter);
    const safelight = h('div', 'safelight', lamp(), h('div', 'safe-text', h('span', 'safe-label', 'SAFELIGHT'), h('span', 'safe-val', 'LOW END MONO · LIMITER ON')));
    safelight.title = 'The low end is always mono and phase-stable; a transparent output limiter is always on.';
    return h('div', 'v2-bottom',
      h('div', 'seg-wrap', mono, poly),
      this.toggle('voice.legato', 'LEGATO'),
      glide,
      safelight,
      gear,
      master,
    );
  }

  private build(): void {
    const tabs = h('div', 'v2-tabs');
    for (const [t, on] of [['OSC', true], ['LFO', false], ['FX', false]] as const) {
      const b = h('button', 'tab' + (on ? ' on' : ''), t);
      if (!on) {
        b.disabled = true;
        b.title = 'Coming later (until then: the gear opens every control)';
      }
      tabs.append(b);
    }
    const oscRow = h('div', 'osc-row', this.oscCard(1), this.oscCard(2));
    const sources = h('div', 'col-sources', oscRow, this.envCard('amp_env', 'AMP ENVELOPE', 'src', 556, 270));
    const layers = h('div', 'col-layers', this.noiseCard(), this.breathCard(), this.clickCard(), this.subCard());
    const filter = h('div', 'col-filter', this.mainFilterCard(), this.envCard('mod_env', 'FILTER ENVELOPE', 'flt', 290, 125));
    const dirt = h('div', 'col-dirt', this.distCard(), this.crushCard(), this.tapeCard(), this.midClipCard());
    const zone = (cls: string, cap: string, ...kids: HTMLElement[]) => h('div', `zone ${cls}`, h('div', 'zone-cap', cap), h('div', 'zone-body', ...kids));
    const zoneSrc = zone('zone-src', 'SOURCES', sources, layers);
    const zoneFlt = zone('zone-flt', 'FILTER', filter);
    const zoneDirt = zone('zone-dirt', 'DIRT', dirt);
    this.page.append(h('div', 'v2-top', h('div', 'v2-title', this.titleEl, this.subEl), tabs), h('div', 'v2-main', zoneSrc, zoneFlt, zoneDirt), this.bottomBar());
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

