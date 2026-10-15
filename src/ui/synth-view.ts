// The new synth page (from the owner's mockup): the sources with their own filter slots, the
// main filter with its routing, the two envelopes and the play bar. It edits the same patch as
// the full parameter view under it (opened with the gear), so both always show the same values.
import { Biquad } from '../engine/core/dsp';
import { fromNormalized, getParam, toNormalized, type ParamValue, type Patch } from '../schema';
import { formatValue } from './params-panel';

type OnChange = (id: string, value: ParamValue) => void;

const DESIGN_WIDTH = 1240;
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

const BW = [0.5412, 1.3066];
/** Stages of a source slot's filter type (oscillator or sub / texture naming). */
function slotStages(type: string, fc: number): [Kind, number, number][] {
  if (type === 'off') return [];
  if (type === 'band') return [['bp', fc, 1]];
  const kind: Kind = type.startsWith('high') ? 'hp' : 'lp';
  return type.endsWith('24') ? [[kind, fc, BW[0]], [kind, fc, BW[1]]] : [[kind, fc, Math.SQRT1_2]];
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
        const H = 64, W = 14;
        g.clearRect(0, 0, W, H);
        g.fillStyle = '#0b0d0f';
        g.fillRect(0, 0, W, H);
        const db = 20 * Math.log10(level + 1e-6);
        const t = Math.max(0, Math.min(1, (db + 48) / 48));
        const grd = g.createLinearGradient(0, H, 0, 0);
        grd.addColorStop(0, '#3fbf6a');
        grd.addColorStop(0.75, '#d9c843');
        grd.addColorStop(1, '#e5534b');
        g.fillStyle = grd;
        g.fillRect(2, H - t * H, W - 4, t * H);
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
      const r = px / 2, cx = r, cy = r;
      g.clearRect(0, 0, px, px);
      const a0 = 0.75 * Math.PI, a1 = 2.25 * Math.PI;
      // track
      g.lineWidth = Math.max(2.5, px * 0.07);
      g.lineCap = 'round';
      g.strokeStyle = '#0a0b0d';
      g.beginPath();
      g.arc(cx, cy, r - g.lineWidth, a0, a1);
      g.stroke();
      // value arc
      const zero = bipolar ? a0 + (a1 - a0) * toNormalized(p, 0) : a0;
      const av = a0 + (a1 - a0) * n;
      g.strokeStyle = off ? '#4a5058' : getComputedStyle(el).getPropertyValue('--knob-accent').trim() || '#7cf29a';
      g.beginPath();
      g.arc(cx, cy, r - g.lineWidth, Math.min(zero, av), Math.max(zero, av) + 1e-3);
      g.stroke();
      // body
      const br = r - g.lineWidth * 2.2;
      const body = g.createRadialGradient(cx - br * 0.35, cy - br * 0.45, br * 0.1, cx, cy, br);
      body.addColorStop(0, '#6d747d');
      body.addColorStop(0.45, '#3a3f46');
      body.addColorStop(1, '#16191d');
      g.fillStyle = body;
      g.beginPath();
      g.arc(cx, cy, br, 0, 2 * Math.PI);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, br - 0.5, 1.1 * Math.PI, 1.9 * Math.PI);
      g.stroke();
      // pointer
      g.strokeStyle = off ? '#777' : '#f2f4f6';
      g.lineWidth = Math.max(1.5, px * 0.045);
      g.beginPath();
      g.moveTo(cx + Math.cos(av) * br * 0.3, cy + Math.sin(av) * br * 0.3);
      g.lineTo(cx + Math.cos(av) * br * 0.9, cy + Math.sin(av) * br * 0.9);
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
    const b = h('button', `led ${cls}`, h('span', 'dot'), label);
    b.title = `${p.label}: ${p.describes}`;
    b.onclick = () => this.set(id, !this.get(id));
    this.watch([id], () => b.classList.toggle('on', !!this.get(id)));
    return b;
  }

  /** Power LED in a card header that mutes a layer by its level (remembering the level). */
  private levelPower(levelId: string): HTMLElement {
    const b = h('button', 'power');
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
    const b = h('button', 'power');
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

  private card(title: string, group: 'src' | 'flt', ...head: HTMLElement[]): [HTMLElement, HTMLElement] {
    const body = h('div', 'c-body');
    const hd = h('div', 'c-head', ...head, h('span', 'c-title', title));
    const el = h('div', `c c-${group}`, hd, body);
    return [el, body];
  }

  // ------------------------------------------------------------------ displays

  private waveView(n: 1 | 2): HTMLElement {
    const W = 256, H = 92;
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
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#0b0d0f';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(0, H / 2);
      g.lineTo(W, H / 2);
      g.stroke();
      const wave = String(this.get(`osc${n}.wave`));
      const pw = this.num(`osc${n}.pulse_width`), wt = this.num(`osc${n}.wt_pos`);
      const lvl = this.num(`osc${n}.level`);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) {
        const x = ((i / W) * 1.5) % 1;
        pts.push([i, H / 2 - shape(wave, x, pw, wt) * (H / 2 - 8)]);
      }
      g.fillStyle = lvl > 0 ? 'rgba(229,140,60,0.16)' : 'rgba(255,255,255,0.04)';
      g.beginPath();
      g.moveTo(0, H / 2);
      for (const [x, y] of pts) g.lineTo(x, y);
      g.lineTo(W, H / 2);
      g.fill();
      g.strokeStyle = lvl > 0 ? '#f0a24a' : '#555b63';
      g.lineWidth = 2;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    };
    this.watch(ids, draw);
    return cv;
  }

  /** Frequency response display: `stages` gives the filter for the current values. */
  private curveView(ids: string[], stages: () => [Kind, number, number][] | 'comb' | 'formant', active: () => boolean, W = 144, H = 66, color = '#f0a24a'): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    const draw = () => {
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#0b0d0f';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      for (const f of [100, 1000, 10000]) {
        const x = (Math.log(f / 20) / Math.log(1000)) * W;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
      }
      const st = stages();
      const on = active();
      const top = 18, bottom = -42;
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
      g.fillStyle = on ? hexA(color, 0.18) : 'rgba(255,255,255,0.04)';
      g.beginPath();
      g.moveTo(0, H);
      ys.forEach((y, i) => g.lineTo(i, y));
      g.lineTo(W, H);
      g.fill();
      g.strokeStyle = on ? color : '#4a5058';
      g.lineWidth = 2;
      g.beginPath();
      ys.forEach((y, i) => (i ? g.lineTo(i, y) : g.moveTo(i, y)));
      g.stroke();
    };
    this.watch(ids, draw);
    return cv;
  }

  /** ADSR display. */
  private envView(prefix: string, color: string, W = 370, H = 112): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    const ids = ['attack', 'decay', 'sustain', 'release'].map((s) => `${prefix}.${s}`);
    const draw = () => {
      const a = this.num(ids[0]), d = this.num(ids[1]), s = this.num(ids[2]), r = this.num(ids[3]);
      const hold = Math.max(250, 0.25 * (a + d));
      const total = a + d + hold + r;
      const span = total <= 1000 ? 1000 : total <= 4000 ? Math.ceil(total / 1000) * 1000 : total;
      const X = (t: number) => 6 + (t / span) * (W - 12);
      const Y = (v: number) => H - 6 - v * (H - 16);
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#0b0d0f';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#5b626c';
      g.font = '10px system-ui';
      g.strokeStyle = 'rgba(255,255,255,0.06)';
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
      g.fillStyle = hexA(color, 0.18);
      g.beginPath();
      g.moveTo(X(0), Y(0));
      for (const [x, y] of pts) g.lineTo(x, y);
      g.lineTo(pts[pts.length - 1][0], Y(0));
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
      g.fillStyle = '#e8eaed';
      for (const t of [a, a + d, a + d + hold]) {
        const v = t === a ? 1 : s;
        g.beginPath();
        g.arc(X(t), Y(v), 3, 0, 2 * Math.PI);
        g.fill();
      }
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
    const pwKnob = this.knob(`${o}.pulse_width`, 'SHAPE', 'mid', { disabled: () => !['pulse', 'pwm_saw'].includes(String(this.get(`${o}.wave`))), deps: [`${o}.wave`] });
    const wtKnob = this.knob(`${o}.wt_pos`, 'SHAPE', 'mid');
    shapeWrap.append(pwKnob, wtKnob);
    this.watch([`${o}.wave`], () => {
      const wt = shapeId() === `${o}.wt_pos`;
      wtKnob.style.display = wt ? '' : 'none';
      pwKnob.style.display = wt ? 'none' : '';
    });
    const uniOff = () => this.num(`${o}.unison_voices`) <= 1;
    const knobs = h('div', 'knob-row',
      this.stepper('UNISON', () => this.num(`${o}.unison_voices`), (v) => this.set(`${o}.unison_voices`, v), 1, 7, [`${o}.unison_voices`], 'Unison voices (stacked detuned copies)'),
      this.knob(`${o}.unison_detune`, 'DETUNE', 'mid', { disabled: uniOff, deps: [`${o}.unison_voices`] }),
      shapeWrap,
      this.knob(`${o}.unison_spread`, 'SPREAD', 'mid', { disabled: uniOff, deps: [`${o}.unison_voices`] }),
      this.knob(`${o}.level`, 'LEVEL', 'mid'),
    );
    body.append(top, this.waveView(n), knobs);
    if (n === 2) body.append(h('div', 'sync-row', this.toggle('osc2.sync', 'SYNC')));
    return el;
  }

  /** A source's own filter slot. */
  private slotCard(title: string, src: 'osc1' | 'osc2' | 'sub' | 'texture'): HTMLElement {
    const typeId = `${src}.filter_type`;
    const cutId = src.startsWith('osc') ? `${src}.highpass` : `${src}.filter_cutoff`;
    const keyId = `${src}.filter_key`;
    const active = () => {
      const t = String(this.get(typeId)), fc = this.num(cutId);
      return t === 'off' ? false : t.startsWith('high') ? fc > 21 : t.startsWith('low') ? fc < 19000 : true;
    };
    const pw = h('button', 'power');
    pw.title = 'On / off (opens the filter all the way, or brings back the last cutoff)';
    pw.onclick = () => {
      const t = String(this.get(typeId));
      if (active()) {
        this.remembered.set(cutId, this.get(cutId));
        this.set(cutId, t.startsWith('low') ? 20000 : t === 'off' ? this.num(cutId) : 20);
      } else {
        if (t === 'off') this.set(typeId, 'low 12');
        const back = this.remembered.get(cutId);
        this.set(cutId, back ?? (String(this.get(typeId)).startsWith('high') ? 130 : 1200));
      }
    };
    this.watch([typeId, cutId], () => pw.classList.toggle('on', active()));
    const [el, body] = this.card(`FILTER · ${title}`, 'src', pw);
    el.classList.add('slot');
    // Switching between high- and low-pass starts the cutoff where the new type does nothing yet.
    const sel = this.selector(typeId, {
      onPick: (from, to) => {
        const fam = (t: string) => (t.startsWith('high') ? 'h' : t.startsWith('low') ? 'l' : t);
        if (fam(from) !== fam(to)) this.set(cutId, to.startsWith('high') ? 20 : to.startsWith('low') ? 20000 : to === 'band' ? 1000 : this.num(cutId));
      },
    });
    const curve = this.curveView([typeId, cutId], () => slotStages(String(this.get(typeId)), this.num(cutId)), active);
    const knobCol = h('div', 'slot-knob', this.knob(cutId, 'CUTOFF', 'mid'), this.toggle(keyId, 'KEY', 'small'));
    body.append(h('div', 'slot-main', h('div', 'slot-left', sel, curve), knobCol));
    return el;
  }

  private noiseCard(): HTMLElement {
    const [el, body] = this.card('NOISE', 'src', this.levelPower('texture.level'));
    el.classList.add('noise');
    const head = h('div', 'card-top', this.selector('texture.type'), this.toggle('texture.direct', 'DIRECT OUT', 'small'));
    const knobs = h('div', 'knob-grid',
      this.knob('texture.tone', 'TONE', 'small'),
      this.knob('texture.tail', 'TAIL', 'small'),
      this.knob('texture.pan', 'PAN', 'small'),
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
    const row = h('div', 'knob-row',
      this.stepper('OCTAVE', () => this.num('sub.octave'), (v) => this.set('sub.octave', v), -2, -1, ['sub.octave'], 'Sub octave'),
      this.knob('sub.level', 'LEVEL', 'small'),
      this.knob('sub.clip', 'CLIP', 'small'),
    );
    body.append(head, row);
    return el;
  }

  private envCard(prefix: 'amp_env' | 'mod_env', title: string, group: 'src' | 'flt', color: string, W = 370, H = 112): HTMLElement {
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
    body.append(this.envView(prefix, color, W, H), row);
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
    const curve = this.curveView(['filter.type', 'filter.cutoff', 'filter.resonance', 'filter.vowel', 'filter.on'], stages, () => !!this.get('filter.on'), 278, 120, '#5fd08a');
    const routes = h('div', 'routes-col',
      this.toggle('filter.route_a', 'A', 'route'),
      this.toggle('filter.route_b', 'B', 'route'),
      this.toggle('filter.route_n', 'N', 'route'),
      this.toggle('filter.route_s', 'S', 'route'),
    );
    const driveKnob = this.knob('drive.amount', 'DRIVE', 'mid', { disabled: () => !this.get('drive.on'), deps: ['drive.on'] });
    // Turning the drive up switches the drive stage on.
    driveKnob.addEventListener('pointerdown', () => { if (!this.get('drive.on')) this.set('drive.on', true); });
    const grid = h('div', 'flt-knobs',
      this.knob('filter.cutoff', 'CUTOFF', 'big'),
      this.knob('filter.resonance', 'RES', 'mid'),
      this.knob('filter.env_amount', 'ENV', 'mid'),
      driveKnob,
      this.knob('filter.fat', 'FAT', 'mid'),
      this.knob('filter.mix', 'MIX', 'mid'),
    );
    const key = this.knob('filter.keytrack', 'KEY', 'small');
    body.append(this.selector('filter.type'), curve, h('div', 'flt-main', h('div', 'routes-wrap', routes, key), grid));
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
    const glide = h('div', 'glide', h('span', 'glide-label', 'Glide time'), gval, track);
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
    const gear = h('button', 'gear', h('span', 'gear-icon', '⚙'), h('span', 'gear-label', 'OPEN ALL'));
    gear.title = 'Open every control (the full parameter view) under this page';
    gear.onclick = () => this.onGear();
    const [meter, mg] = canvas(14, 64, 'meter');
    this.meterG = mg;
    const master = h('div', 'master', this.knob('output.gain', 'MASTER', 'mid'), meter);
    return h('div', 'v2-bottom',
      h('div', 'seg-wrap', mono, poly),
      this.toggle('voice.legato', 'LEGATO'),
      glide,
      h('span', 'v2-badge', 'low end mono · limiter on'),
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
    const lower = h('div', 'lower-row', this.envCard('amp_env', 'AMP ENVELOPE', 'src', '#f0a24a', 358, 168), h('div', 'ns-col', this.noiseCard(), this.subCard()));
    const sources = h('div', 'col-sources', oscRow, lower);
    const slots = h('div', 'col-slots',
      this.slotCard('OSC A', 'osc1'),
      this.slotCard('OSC B', 'osc2'),
      this.slotCard('NOISE', 'texture'),
      this.slotCard('SUB', 'sub'),
    );
    const filter = h('div', 'col-filter', this.mainFilterCard(), this.envCard('mod_env', 'FILTER ENVELOPE', 'flt', '#5fd08a', 278, 112));
    const zoneSrc = h('div', 'zone zone-src', sources, slots);
    const zoneFlt = h('div', 'zone zone-flt', filter);
    this.page.append(h('div', 'v2-top', tabs), h('div', 'v2-main', zoneSrc, zoneFlt), this.bottomBar());
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

