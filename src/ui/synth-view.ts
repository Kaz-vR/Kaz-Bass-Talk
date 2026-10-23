// The synth page (the owner's darkroom layout): the sources as channel strips on the left, a live
// oscilloscope above the amp envelope, the filter with its envelope, the dirt chain and the mod
// wheel, and the play bar. Three knob sizes carry the weight (big for what matters most). It edits
// the same patch as the full parameter view under it (opened with "All controls"), so both always
// show the same values.
import { Biquad } from '../engine/core/dsp';
import { fromNormalized, getParam, toNormalized, type ParamValue, type Patch } from '../schema';
import { formatValue } from './params-panel';

type OnChange = (id: string, value: ParamValue) => void;

/** What the preset selector shows: the shelves, their presets, and how to load one. */
export interface PresetItem {
  index: number;
  name: string;
  /** Dark bass template letter and name ('' when the preset has none). */
  tpl: string;
  tplName: string;
  description: string;
  tags: string[];
  /** Measured character (normalized 0..1). */
  features: Record<string, number>;
}
/** A rolled sound (Randomizer) or a starred one (User). */
export interface RollItem {
  id: number;
  name: string;
  hint: string;
  starred: boolean;
}
export interface RollState {
  rolls: RollItem[];
  user: RollItem[];
  rolling: boolean;
  weirdness: number;
  basedOn: string;
  basedOptions: [string, string][];
}
export interface PresetSource {
  shelves: () => { id: string; name: string; secondary?: boolean; items: PresetItem[] }[];
  current: () => { shelf: string; index: number; roll: number };
  rollState: () => RollState;
  roll: () => void;
  setWeirdness: (v: number) => void;
  setBasedOn: (id: string) => void;
  clearRolls: () => void;
  pickRoll: (id: number) => void;
  starRoll: (id: number) => void;
  removeRoll: (id: number, from: 'rolls' | 'user') => void;
  pick: (shelf: string, index: number) => void;
  step: (dir: number) => void;
}

type Sort = 'bank' | 'name' | 'template' | 'hard' | 'bright' | 'moving';
const SORTS: [Sort, string][] = [['bank', 'BANK ORDER'], ['name', 'NAME'], ['template', 'TEMPLATE'], ['hard', 'SOFT → HARD'], ['bright', 'DARK → BRIGHT'], ['moving', 'STILL → MOVING']];
const fval = (it: PresetItem, k: string) => Math.max(0, Math.min(1, Number(it.features[k] ?? 0.5)));
type Size = 'big' | 'mid' | 'small';
type Zone = 'src' | 'flt' | 'dirt' | 'mat';

const DESIGN_WIDTH = 1200;
const ZOOMS = [1, 1.25, 1.5];
const ZOOM_KEY = 'lowtalk.zoom';
const FS = 48000;
// One dial size everywhere (the owner's call: same size, big enough to read at a glance).
const PX: Record<Size, number> = { big: 40, mid: 40, small: 40 };

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

// ------------------------------------------------------------------ darkroom drawing
// Every display is a small photo print: a silver line on grainy dark paper (the cream border
// comes from the CSS).
const INK = '#e8e2d8';
const FAINT = '#2a0b07';
const PEN = '#ff5a40';

let grainTile: HTMLCanvasElement | null = null;
/** A small tile of film grain, made once and reused by every display. */
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
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
  grainTile = c;
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

/** A grease-pencil handle on a print (something you can drag). */
function handle(g: CanvasRenderingContext2D, x: number, y: number, hot = false): void {
  g.fillStyle = hexA(PEN, hot ? 0.45 : 0.22);
  g.strokeStyle = PEN;
  g.lineWidth = 1.8;
  g.beginPath();
  g.arc(x, y, hot ? 6.5 : 5.5, 0, 2 * Math.PI);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffe3d9';
  g.beginPath();
  g.arc(x, y, 2, 0, 2 * Math.PI);
  g.fill();
}

/** A round glowing lamp (the darkroom's safelight) used for every on/off light. */
/** Scroll a list so `el` sits in its middle, without moving the window (scrollIntoView would). */
function centerIn(list: Element | null, el: HTMLElement): void {
  if (!list) return;
  const l = list as HTMLElement;
  l.scrollTop = el.offsetTop - l.offsetTop - (l.clientHeight - el.offsetHeight) / 2;
}

function lamp(): HTMLElement {
  return h('span', 'lamp');
}

/** Basic wave shapes for the oscillator and sub prints. */
function waveShape(wave: string, x: number, pw: number, wt: number): number {
  const tri = x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4;
  const saw = 1 - 2 * x;
  switch (wave) {
    case 'sine': return Math.sin(2 * Math.PI * x);
    case 'triangle': return tri;
    case 'saw': return saw;
    case 'square': return x < 0.5 ? 0.8 : -0.8;
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
}

const MOD_SLOTS = 12;
const MOD_IDS = Array.from({ length: MOD_SLOTS }, (_, i) => [`mod${i + 1}.source`, `mod${i + 1}.dest`, `mod${i + 1}.amount`]).flat();
const LFO_SHAPE: Record<string, string> = { sine: 'SINE', triangle: 'TRIANGLE', saw_up: 'SAW UP', saw_down: 'SAW DOWN', square: 'SQUARE', sample_hold: 'S & H', wander: 'WANDER' };
const SRC_LABEL: Record<string, string> = {
  none: '—', lfo1: 'LFO 1', lfo2: 'LFO 2', lfo3: 'LFO 3', lfo4: 'LFO 4', mod_env: 'Filter env', amp_env: 'Amp env', env2: 'Env 2', velocity: 'Velocity',
  keytrack: 'Keytrack', modwheel: 'Mod wheel', random: 'Random', drift: 'Drift', drift_slow: 'Slow drift', lfo_product: 'LFO 1×2',
};
const DEST_LABEL: Record<string, string> = {
  none: '—', pitch: 'Pitch', osc1_pitch: 'A pitch', osc2_pitch: 'B pitch', osc1_wt_pos: 'A wt pos', osc2_wt_pos: 'B wt pos', osc1_pw: 'A shape', osc2_pw: 'B shape',
  osc1_level: 'A level', osc2_level: 'B level', unison_detune: 'Detune', fm_amount: 'FM', fm2_amount: 'FM 2', sub_level: 'Sub', noise_level: 'Noise', drive: 'Drive',
  filter_cutoff: 'Cutoff', filter_resonance: 'Res', filter_vowel: 'Vowel', dist_drive: 'Dist drive', dist_mix: 'Dist mix', dist_tone: 'Dist tone', amp: 'Amp',
  lfo1_rate: 'LFO 1 rate', lfo2_rate: 'LFO 2 rate', lfo3_rate: 'LFO 3 rate', lfo4_rate: 'LFO 4 rate', crush_mix: 'Crush', chorus_depth: 'Chorus', phaser_mix: 'Phaser',
  delay_time: 'Delay time', delay_mix: 'Delay', reverb_mix: 'Reverb', width: 'Width', tape_wow: 'Tape wow', texture_level: 'Texture', vibrato_depth: 'Vibrato', breath_level: 'Breath',
};
/** Beats in a note value like 1/4, 1/8D or 1/16T. */
function syncBeats(v: string): number {
  const m = /^(\d+)\/(\d+)([DT]?)$/.exec(v);
  if (!m) return 1;
  const b = (4 * Number(m[1])) / Number(m[2]);
  return m[3] === 'D' ? b * 1.5 : m[3] === 'T' ? (b * 2) / 3 : b;
}
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
const db = (v: number) => {
  if (v <= 0.0005) return '-inf dB';
  const d = 20 * Math.log10(v);
  return `${d.toFixed(Math.abs(d) >= 10 ? 0 : 1)} dB`;
};

export class SynthView {
  readonly root: HTMLElement;
  private readonly page: HTMLElement;
  private values: Record<string, ParamValue> = {};
  private readonly watchers = new Map<string, (() => void)[]>();
  private readonly allViews: (() => void)[] = [];
  private readonly remembered = new Map<string, ParamValue>();
  private readonly titleEl = h('span', 'v2-name');
  private readonly subEl = h('span', 'v2-sub');
  private readonly zoomBtn = h('button', 'zoom');
  private zoom = 1;
  private meterG: CanvasRenderingContext2D | null = null;
  private scopeG: CanvasRenderingContext2D | null = null;
  private scopeSize: [number, number] = [0, 0];
  private readonly wheelViews: (() => void)[] = [];
  readonly keysEl = h('div', 'kb-keys');
  private readonly octaveVal = h('span', 'chip-val');
  private readonly velFill = h('span', 'kb-vel-fill');
  private wheel = 0;
  onGear: () => void = () => {};
  onWheel: (v: number) => void = () => {};
  onPitch: (v: number) => void = () => {};
  onOctave: (dir: number) => void = () => {};
  presets: PresetSource | null = null;
  private readonly menu = h('div', 'pre-menu');
  private menuShelf = '';
  private oscPage: HTMLElement | null = null;
  private modPage: HTMLElement | null = null;
  private fxPage: HTMLElement | null = null;
  /** The synth page's height: every tab keeps it, so nothing jumps. */
  private pageHeight = 0;
  private readonly presetPage = h('div', 'v2-main preset-page');
  private readonly tabBtns = new Map<string, HTMLButtonElement>();
  private pageShelf = '';
  private sort: Sort = 'bank';

  constructor(root: HTMLElement, private readonly onChange: OnChange) {
    this.root = root;
    this.page = h('div', 'v2');
    root.append(this.page);
    try {
      const z = Number(localStorage.getItem(ZOOM_KEY));
      if (ZOOMS.includes(z)) this.zoom = z;
    } catch {
      // no storage: stay at 100%
    }
    this.build();
    const fit = () => {
      // Fit the window like a plugin: never wider than it, never taller than it (the keyboard
      // under the page counts too), so the top can't slide out of view.
      const tall = window.innerHeight / Math.max(1, this.page.offsetHeight);
      const s = Math.max(0.4, Math.min(this.zoom, root.clientWidth / DESIGN_WIDTH, tall));
      this.page.style.transform = `scale(${s})`;
      this.page.style.marginLeft = `${Math.max(0, (root.clientWidth - DESIGN_WIDTH * s) / 2)}px`;
      root.style.height = `${this.page.offsetHeight * s}px`;
      this.zoomBtn.textContent = `${Math.round(s * 100)}%`;
    };
    this.zoomBtn.title = 'Size of this page: 100%, 125% or 150% (it never gets wider than the window)';
    this.zoomBtn.onclick = () => {
      this.zoom = ZOOMS[(ZOOMS.indexOf(this.zoom) + 1) % ZOOMS.length];
      try {
        localStorage.setItem(ZOOM_KEY, String(this.zoom));
      } catch {
        // ignore
      }
      fit();
    };
    new ResizeObserver(fit).observe(root);
    new ResizeObserver(fit).observe(this.page);
    window.addEventListener('resize', fit);
    requestAnimationFrame(fit);
  }

  // ------------------------------------------------------------------ state

  /** Show a whole patch (a preset was loaded). */
  show(patch: Patch): void {
    this.values = { ...(patch as unknown as Record<string, ParamValue>) };
    for (const v of this.allViews) v();
    if (this.presetPage.isConnected && this.presetPage.style.display !== 'none') this.markCurrent();
  }

  /** The rolls or starred sounds changed: redraw the PRESETS page if it's showing. */
  refreshPresets(): void {
    if (this.presetPage.style.display !== 'none' && this.presetPage.isConnected) this.renderPresetPage();
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

  /** The mod wheel moved elsewhere (hardware or the full view): show it. */
  setWheel(v: number): void {
    this.wheel = v;
    for (const f of this.wheelViews) f();
  }

  /** The keyboard moved an octave (base = its lowest C as a MIDI note). */
  setOctave(base: number): void {
    this.octaveVal.textContent = `C${base / 12 - 1}`;
  }

  /** How hard the last note was played (0..1). */
  setVelocity(v: number): void {
    this.velFill.style.width = `${Math.round(v * 100)}%`;
  }

  /** Live output: the oscilloscope and the level meter. */
  setAnalyser(a: AnalyserNode): void {
    const buf = new Float32Array(a.fftSize);
    let level = 0;
    const draw = () => {
      a.getFloatTimeDomainData(buf);
      let pk = 0;
      for (const x of buf) pk = Math.max(pk, Math.abs(x));
      level = Math.max(pk, level * 0.92);
      this.drawMeter(level);
      this.drawScope(buf);
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  private drawMeter(level: number): void {
    const g = this.meterG;
    if (!g) return;
    const H = 22, N = 14;
    g.clearRect(0, 0, N * 6, H);
    const d = 20 * Math.log10(level + 1e-6);
    const lit = Math.round(Math.max(0, Math.min(1, (d + 48) / 48)) * N);
    for (let i = 0; i < N; i++) {
      g.fillStyle = i < lit ? hexA(i > 11 ? '#ff4f6a' : '#ff8f75', 0.4 + i * 0.04) : FAINT;
      g.fillRect(i * 6, 0, 4, H);
    }
  }

  /** The oscilloscope: the output waveform on a phosphor screen, triggered for a steady picture. */
  private drawScope(buf: Float32Array): void {
    const g = this.scopeG;
    if (!g) return;
    const [W, H] = this.scopeSize;
    // phosphor persistence: the last frames fade instead of vanishing
    g.fillStyle = 'rgba(9,8,7,0.32)';
    g.fillRect(0, 0, W, H);
    let start = 0;
    for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { start = i; break; }
    const n = Math.min(1600, buf.length - start);
    let pk = 0;
    for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(buf[start + i]));
    const gain = pk > 0.02 ? Math.min(4, 0.8 / pk) : 1; // keep quiet sounds visible
    g.strokeStyle = 'rgba(244,240,232,0.92)';
    g.lineWidth = 1.6;
    g.shadowColor = 'rgba(240,235,225,0.85)';
    g.shadowBlur = 7;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const y = H / 2 - buf[start + i] * gain * (H * 0.4);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    g.shadowBlur = 0;
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

  /** A dial bound to a float/int parameter. Big = the controls that matter most, small = details. */
  private knob(id: string, label: string, size: Size = 'mid', opts: { fmt?: (v: number) => string; disabled?: () => boolean; deps?: string[]; showValue?: boolean } = {}): HTMLElement {
    const p = getParam(id)!;
    const px = PX[size];
    const [cv, g] = canvas(px, px, 'knob');
    const val = h('div', 'k-val');
    // The value stays hidden (the dial shows enough) and appears over the name on hover / drag.
    const el = h('div', `k k-${size}${opts.showValue ? '' : ' quiet'}`, cv, h('div', 'k-label', label), val);
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
      const zero = bipolar ? a0 + (a1 - a0) * toNormalized(p, 0) : a0;
      const av = a0 + (a1 - a0) * n;
      const accent = getComputedStyle(el).getPropertyValue('--knob-accent').trim() || '#ff8f75';
      // face
      g.fillStyle = '#140504';
      g.strokeStyle = '#3a120c';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(cx, cy, r - 1, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
      // track and value arc
      const tr = r - (size === 'big' ? 5 : 4), sw = size === 'big' ? 3.5 : size === 'mid' ? 3 : 2.5;
      g.lineCap = 'round';
      g.lineWidth = sw;
      g.strokeStyle = FAINT;
      g.beginPath();
      g.arc(cx, cy, tr, a0, a1);
      g.stroke();
      if (Math.abs(av - zero) > 0.02) {
        g.strokeStyle = off ? '#5a3a32' : accent;
        if (size === 'big' && !off) {
          g.shadowColor = accent;
          g.shadowBlur = 5;
        }
        g.beginPath();
        g.arc(cx, cy, tr, Math.min(zero, av), Math.max(zero, av));
        g.stroke();
        g.shadowBlur = 0;
      }
      // body
      const br = r * (size === 'big' ? 0.56 : 0.5);
      const body = g.createRadialGradient(cx - br * 0.2, cy - br * 0.3, br * 0.05, cx, cy, br);
      body.addColorStop(0, '#4a1a12');
      body.addColorStop(1, '#1a0605');
      g.fillStyle = body;
      g.beginPath();
      g.arc(cx, cy, br, 0, 2 * Math.PI);
      g.fill();
      // pointer
      g.strokeStyle = off ? '#7a5a52' : '#ffe3d9';
      g.lineWidth = size === 'big' ? 2.6 : 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(av) * br * 0.15, cy + Math.sin(av) * br * 0.15);
      g.lineTo(cx + Math.cos(av) * br * 0.92, cy + Math.sin(av) * br * 0.92);
      g.stroke();
    };
    const setN = (n: number) => {
      let v = fromNormalized(p, Math.max(0, Math.min(1, n)));
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

  /** A dropdown for an enum parameter (‹ › step through it, the name opens the list). */
  private selector(id: string, opts: { label?: (o: string) => string; deps?: string[] } = {}): HTMLElement {
    const p = getParam(id)!;
    const sel = h('select', 'sel-name');
    const name = (o: string) => (opts.label ?? ((x: string) => x.replace(/_/g, ' ')))(o).toUpperCase();
    for (const o of p.options!) sel.append(new Option(name(o), o));
    const pick = (to: string) => {
      if (String(this.get(id)) !== to) this.set(id, to);
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
    this.watch([id, ...(opts.deps ?? [])], () => {
      p.options!.forEach((o, i) => { sel.options[i].text = name(o); });
      sel.value = String(this.get(id));
    });
    return el;
  }

  /** A lamp switch for a bool parameter. */
  private toggle(id: string, label: string, cls = ''): HTMLElement {
    const p = getParam(id)!;
    const b = h('button', `led ${cls}`, lamp(), label);
    b.title = `${p.label}: ${p.describes}`;
    b.onclick = () => this.set(id, !this.get(id));
    this.watch([id], () => b.classList.toggle('on', !!this.get(id)));
    return b;
  }

  /** The power lamp of a part that is switched on and off by its level (remembering the level). */
  private levelPower(levelId: string, card: HTMLElement, fallback?: number): HTMLElement {
    const b = h('button', 'power', lamp());
    b.title = 'On / off';
    b.onclick = () => {
      const v = this.num(levelId);
      if (v > 0) {
        this.remembered.set(levelId, v);
        this.set(levelId, 0);
      } else this.set(levelId, this.remembered.get(levelId) ?? fallback ?? ((getParam(levelId)!.default as number) || 0.5));
    };
    this.watch([levelId], () => {
      const on = this.num(levelId) > 0;
      b.classList.toggle('on', on);
      card.classList.toggle('is-off', !on);
    });
    return b;
  }

  /** The power lamp of a part with its own on/off switch. */
  private boolPower(id: string, card: HTMLElement): HTMLElement {
    const b = h('button', 'power', lamp());
    b.title = getParam(id)?.describes ?? '';
    b.onclick = () => this.set(id, !this.get(id));
    this.watch([id], () => {
      b.classList.toggle('on', !!this.get(id));
      card.classList.toggle('is-off', !this.get(id));
    });
    return b;
  }

  /** A small number box you drag up/down (or scroll). */
  private chip(label: string, get: () => number, set: (v: number) => void, min: number, max: number, ids: string[], title = ''): HTMLElement {
    const v = h('span', 'chip-val');
    const el = h('div', 'chip', h('span', 'chip-label', label), v);
    el.title = `${title} (drag up/down)`;
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
    this.watch(ids, () => { v.textContent = String(Math.round(get())); });
    return el;
  }

  /** A box with its power lamp and title. */
  private card(title: string, zone: Zone, cls = ''): [HTMLElement, HTMLElement, HTMLElement] {
    const head = h('div', 'c-head', h('span', 'c-title', title));
    const body = h('div', 'c-body');
    const el = h('div', `c c-${zone} ${cls}`, head, body);
    return [el, head, body];
  }

  // ------------------------------------------------------------------ displays

  /** The oscillator's wave as a small print. */
  private wavePrint(n: 1 | 2): HTMLElement {
    const W = 60, H = 36;
    const [cv, g] = canvas(W, H, 'disp');
    const o = `osc${n}`;
    this.watch([`${o}.wave`, `${o}.pulse_width`, `${o}.wt_pos`, `${o}.level`], () => {
      paper(g, W, H);
      const wave = String(this.get(`${o}.wave`)), pw = this.num(`${o}.pulse_width`), wt = this.num(`${o}.wt_pos`);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) pts.push([i, H / 2 - waveShape(wave, ((i / W) * 1.5) % 1, pw, wt) * (H / 2 - 7)]);
      silver(g, pts, this.num(`${o}.level`) > 0);
      vignette(g, W, H);
    });
    return cv;
  }

  private subPrint(): HTMLElement {
    const W = 60, H = 36;
    const [cv, g] = canvas(W, H, 'disp');
    this.watch(['sub.wave', 'sub.level'], () => {
      paper(g, W, H);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) pts.push([i, H / 2 - waveShape(String(this.get('sub.wave')), ((i / W) * 1.5) % 1, 0.5, 0) * (H / 2 - 7)]);
      silver(g, pts, this.num('sub.level') > 0);
      vignette(g, W, H);
    });
    return cv;
  }

  /** Frequency response of the main filter. */
  private filterPrint(W: number, H: number): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
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
    this.watch(['filter.type', 'filter.cutoff', 'filter.resonance', 'filter.vowel', 'filter.on'], () => {
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
      const on = !!this.get('filter.on');
      const top = 24, bottom = -48;
      const ys: number[] = [];
      for (let i = 0; i <= W; i++) {
        const f = 20 * Math.pow(1000, i / W);
        let m: number;
        if (st === 'comb') {
          const fc = this.num('filter.cutoff');
          m = 0.35 / Math.max(0.15, Math.abs(1 - 0.85 * Math.cos((2 * Math.PI * f) / fc)) + 0.15);
        } else if (st === 'formant') {
          const k = this.num('filter.cutoff') / 2000;
          const v = this.num('filter.vowel') * 4;
          const vowels = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
          const i0 = Math.min(3, Math.floor(v)), fr = v - i0;
          m = 0;
          for (let j = 0; j < 3; j++) m += response([['bp', (vowels[i0][j] * (1 - fr) + vowels[i0 + 1][j] * fr) * k, 6]], f) * [1, 0.5, 0.25][j];
        } else m = on ? response(st, f) : 1;
        const d = 20 * Math.log10(m + 1e-9);
        ys.push(H - ((Math.max(bottom, Math.min(top, d)) - bottom) / (top - bottom)) * H);
      }
      silver(g, ys.map((y, i) => [i, y] as [number, number]), on);
      // the cutoff as a handle on the curve
      if (on && st !== 'formant') {
        const fc = this.num('filter.cutoff');
        const x = Math.max(4, Math.min(W - 4, (Math.log(fc / 20) / Math.log(1000)) * W));
        handle(g, x, ys[Math.round(x)] ?? H / 2);
      }
      vignette(g, W, H);
    });
    // drag on the print: left/right = cutoff, up/down = resonance
    const cut = getParam('filter.cutoff')!, res = getParam('filter.resonance')!;
    let x0 = 0, y0 = 0, c0 = 0, r0 = 0;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      x0 = e.clientX;
      y0 = e.clientY;
      c0 = toNormalized(cut, this.num('filter.cutoff'));
      r0 = toNormalized(res, this.num('filter.resonance'));
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cv.hasPointerCapture(e.pointerId)) return;
      const r = cv.getBoundingClientRect();
      this.set('filter.cutoff', Math.round(fromNormalized(cut, Math.max(0, Math.min(1, c0 + (e.clientX - x0) / r.width)))));
      this.set('filter.resonance', Math.round(fromNormalized(res, Math.max(0, Math.min(1, r0 + (y0 - e.clientY) / r.height))) * 1000) / 1000);
    });
    cv.addEventListener('pointerup', (e) => cv.releasePointerCapture(e.pointerId));
    cv.title = 'Drag: left/right = cutoff, up/down = resonance';
    cv.classList.add('draggable');
    return cv;
  }

  /** The distortion's transfer curve. */
  private distPrint(W: number, H: number): HTMLElement {
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
    this.watch(['dist.on', 'dist.type', 'dist.drive', 'dist.mix'], () => {
      const on = !!this.get('dist.on');
      const type = String(this.get('dist.type')), d = this.num('dist.drive'), mix = this.num('dist.mix');
      paper(g, W, H);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) {
        const x = (i / W) * 2 - 1;
        const y = Math.max(-1.1, Math.min(1.1, mix * shape(type, x, d) + (1 - mix) * x));
        pts.push([i, H / 2 - y * (H / 2 - 6)]);
      }
      silver(g, pts, on);
      vignette(g, W, H);
    });
    return cv;
  }

  /** An ADSR print with handles you drag: A sideways, D sideways and S up/down, R sideways. */
  private envPrint(prefix: string, W: number, H: number): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    const ids = ['attack', 'decay', 'sustain', 'release'].map((s) => `${prefix}.${s}`);
    let span = 1000;
    let hot = -1;
    const geo = () => {
      const a = this.num(ids[0]), d = this.num(ids[1]), s = this.num(ids[2]), r = this.num(ids[3]);
      const hold = Math.max(250, 0.25 * (a + d));
      const X = (t: number) => 8 + (t / span) * (W - 16);
      const Y = (v: number) => H - 10 - v * (H - 26);
      return { a, d, s, r, hold, X, Y };
    };
    const reSpan = () => {
      const { a, d, r, hold } = geo();
      const total = a + d + hold + r;
      span = total <= 1000 ? 1000 : total <= 4000 ? Math.ceil(total / 1000) * 1000 : total;
    };
    const points = () => {
      const { a, d, s, r, hold, X, Y } = geo();
      return [[X(a), Y(1)], [X(a + d), Y(s)], [X(a + d + hold), Y(s)], [X(a + d + hold + r), Y(0)]] as [number, number][];
    };
    const draw = () => {
      const { a, d, s, r, hold, X, Y } = geo();
      paper(g, W, H);
      g.fillStyle = 'rgba(232,226,216,0.28)';
      g.font = '10px Inter, system-ui, sans-serif';
      g.strokeStyle = 'rgba(232,226,216,0.04)';
      const stepMs = span <= 1000 ? 250 : span <= 5000 ? 1000 : Math.ceil(span / 5000) * 1000;
      for (let t = stepMs; t < span; t += stepMs) {
        g.beginPath();
        g.moveTo(X(t), 0);
        g.lineTo(X(t), H);
        g.stroke();
        if (t % 1000 === 0) g.fillText(`${t / 1000} s`, X(t) + 3, 12);
      }
      const pts: [number, number][] = [[X(0), Y(0)]];
      const N = 40;
      for (let i = 0; i <= N; i++) pts.push([X((a * i) / N), Y(1 - Math.pow(1 - i / N, 2))]);
      for (let i = 1; i <= N; i++) pts.push([X(a + (d * i) / N), Y(s + (1 - s) * Math.exp((-5 * i) / N))]);
      pts.push([X(a + d + hold), Y(s)]);
      for (let i = 1; i <= N; i++) pts.push([X(a + d + hold + (r * i) / N), Y(s * Math.exp((-5 * i) / N))]);
      silver(g, pts);
      vignette(g, W, H);
      points().forEach(([x, y], i) => handle(g, x, y, i === hot));
    };
    this.watch(ids, () => {
      if (hot < 0) reSpan();
      draw();
    });
    // dragging the handles
    const P = ids.map((id) => getParam(id)!);
    let start: { x: number; y: number; v: number[] } | null = null;
    const local = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
    };
    cv.addEventListener('pointerdown', (e) => {
      const [x, y] = local(e);
      let best = -1, bd = 18 * 18;
      points().forEach(([px, py], i) => {
        const dd = (px - x) ** 2 + (py - y) ** 2;
        if (dd < bd) { bd = dd; best = i; }
      });
      if (best < 0) return;
      hot = best;
      cv.setPointerCapture(e.pointerId);
      start = { x, y, v: ids.map((id) => this.num(id)) };
      draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!start || !cv.hasPointerCapture(e.pointerId)) {
        const [x, y] = local(e);
        cv.style.cursor = points().some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < 18 * 18) ? 'grab' : '';
        return;
      }
      const [x, y] = local(e);
      const msPerPx = span / (W - 16);
      const dt = (x - start.x) * msPerPx;
      const clampP = (i: number, v: number) => Math.max(P[i].min!, Math.min(P[i].max!, v));
      if (hot === 0) this.set(ids[0], Math.round(clampP(0, start.v[0] + dt) * 10) / 10);
      if (hot === 1) this.set(ids[1], Math.round(clampP(1, start.v[1] + dt)));
      if (hot === 1 || hot === 2) this.set(ids[2], Math.round(clampP(2, start.v[2] - (y - start.y) / (H - 26)) * 1000) / 1000);
      if (hot === 3) this.set(ids[3], Math.round(clampP(3, start.v[3] + dt)));
    });
    cv.addEventListener('pointerup', (e) => {
      if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
      start = null;
      hot = -1;
      reSpan();
      draw();
    });
    cv.title = 'Drag the points: attack, decay and sustain, release';
    return cv;
  }

  // ------------------------------------------------------------------ the source strips

  /**
   * One source as a channel strip, in fixed columns so every strip lines up: the name with its
   * selector under it | the pitch boxes | the wave print | the dials in small groups.
   */
  private strip(title: string, cls: string, o: { power: HTMLElement | ((el: HTMLElement) => HTMLElement); head?: HTMLElement[]; under: HTMLElement; chips?: HTMLElement[]; print?: HTMLElement; groups: HTMLElement[][] }): HTMLElement {
    const head = h('div', 'st-head', h('span', 'c-title', title), ...(o.head ?? []));
    const groups = h('div', 'st-knobs', ...o.groups.map((g) => h('div', 'st-group', ...g)));
    const el = h('div', `c c-src strip ${cls}`,
      h('div', 'st-left', head, o.under),
      h('div', 'st-chips', ...(o.chips ?? [])),
      h('div', 'st-print', ...(o.print ? [o.print] : [])),
      groups);
    head.prepend(typeof o.power === 'function' ? o.power(el) : o.power);
    return el;
  }

  private oscStrip(n: 1 | 2): HTMLElement {
    const o = `osc${n}`;
    const semiP = getParam(`${o}.semi`)!;
    const oct = () => Math.trunc(this.num(`${o}.semi`) / 12);
    const sem = () => this.num(`${o}.semi`) - 12 * oct();
    const setSemi = (v: number) => this.set(`${o}.semi`, Math.max(semiP.min!, Math.min(semiP.max!, v)));
    // Shape = pulse width on pulse / pwm saw, position on the wavetable, dimmed otherwise.
    const pw = this.knob(`${o}.pulse_width`, 'Shape', 'small', { disabled: () => !['pulse', 'pwm_saw'].includes(String(this.get(`${o}.wave`))), deps: [`${o}.wave`] });
    const wt = this.knob(`${o}.wt_pos`, 'Shape', 'small');
    this.watch([`${o}.wave`], () => {
      const isWt = String(this.get(`${o}.wave`)) === 'wavetable';
      wt.style.display = isWt ? '' : 'none';
      pw.style.display = isWt ? 'none' : '';
    });
    const uniOff = () => this.num(`${o}.unison_voices`) <= 1;
    return this.strip(n === 1 ? 'OSC A' : 'OSC B', 'osc', {
      power: (el) => this.levelPower(`${o}.level`, el),
      head: n === 2 ? [this.toggle('osc2.sync', 'Sync', 'small')] : [],
      under: this.selector(`${o}.wave`),
      chips: [
        this.chip('OCT', oct, (v) => setSemi(12 * v + sem()), -2, 2, [`${o}.semi`], 'Octave'),
        this.chip('SEM', sem, (v) => setSemi(12 * oct() + v), -11, 11, [`${o}.semi`], 'Semitones'),
        this.chip('FIN', () => this.num(`${o}.fine`), (v) => this.set(`${o}.fine`, v), -100, 100, [`${o}.fine`], 'Fine tune (cents)'),
      ],
      print: this.wavePrint(n),
      groups: [
        [this.chip('UNI', () => this.num(`${o}.unison_voices`), (v) => this.set(`${o}.unison_voices`, v), 1, 7, [`${o}.unison_voices`], 'Unison voices (stacked detuned copies)'),
          this.knob(`${o}.unison_detune`, 'Detune', 'small', { disabled: uniOff, deps: [`${o}.unison_voices`] })],
        [pw, wt, this.knob(`${o}.unison_spread`, 'Spread', 'small', { disabled: uniOff, deps: [`${o}.unison_voices`] })],
        [this.lowCut(`${o}.highpass`, `${o}.filter_type`), this.knob(`${o}.level`, 'Level', 'small')],
      ],
    });
  }

  /**
   * LO CUT: a source's high-pass as one knob (fully left = off). On the oscillators it is their
   * filter slot's cutoff (dimmed if that slot was set to another type in the full view); on the
   * noise bed, turning it up switches the bed's own filter to a 24 dB high-pass.
   */
  private lowCut(cutId: string, typeId: string): HTMLElement {
    const isOsc = cutId.startsWith('osc');
    const p = getParam(cutId)!;
    const OFF = 21;
    const fmt = (v: number) => {
      if (!String(this.get(typeId)).startsWith('high') || v <= OFF) return 'off';
      return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
    };
    const el = this.knob(cutId, 'Lo cut', 'small', { fmt, deps: [typeId], disabled: () => (isOsc ? !String(this.get(typeId)).startsWith('high') : false) });
    el.title = `Low cut: ${isOsc ? 'cuts this oscillator below this frequency before the drive, so it stays out of the sub\'s space' : 'cuts the noise bed below this frequency so it stays out of the body of the sound'}. Fully left = off. ${p.label}.`;
    if (!isOsc) {
      el.addEventListener('pointerdown', () => {
        if (!String(this.get(typeId)).startsWith('high')) {
          this.set(cutId, 20);
          this.set(typeId, 'high 24');
        }
      }, true);
    }
    return el;
  }

  private subStrip(): HTMLElement {
    return this.strip('SUB', 'sub', {
      power: (el) => this.levelPower('sub.level', el),
      head: [this.toggle('sub.direct', 'Direct', 'small')],
      under: this.selector('sub.wave'),
      chips: [this.chip('OCT', () => this.num('sub.octave'), (v) => this.set('sub.octave', v), -2, -1, ['sub.octave'], 'Sub octave')],
      print: this.subPrint(),
      groups: [[], [], [this.knob('sub.clip', 'Clip', 'small'), this.knob('sub.level', 'Level', 'small')]],
    });
  }

  /**
   * Noise: a texture bed (crackle, dust, rumble, air) or breath (per-note breath noise, its
   * chiff and a sustained level). The dials follow the type: tone, tail, lo cut and level for a
   * bed; chiff, decay, tone and level for breath.
   */
  private noiseStrip(): HTMLElement {
    const isBreath = () => this.get('texture.type') === 'breath';
    const bed = [this.knob('texture.tone', 'Tone', 'small'), this.knob('texture.tail', 'Tail', 'small'),
      this.lowCut('texture.filter_cutoff', 'texture.filter_type'), this.knob('texture.level', 'Level', 'small')];
    const breath = [this.knob('breath.chiff', 'Chiff', 'small'), this.knob('breath.decay', 'Decay', 'small'),
      this.knob('breath.tone', 'Tone', 'small'), this.knob('breath.level', 'Level', 'small')];
    const direct = this.toggle('texture.direct', 'Direct', 'small');
    const power = (el: HTMLElement) => {
      const b = h('button', 'power', lamp());
      b.title = 'On / off';
      const ids = () => (isBreath() ? ['breath.level', 'breath.chiff'] : ['texture.level']);
      const on = () => ids().some((id) => this.num(id) > 0);
      b.onclick = () => {
        if (on()) {
          for (const id of ids()) {
            this.remembered.set(id, this.num(id));
            this.set(id, 0);
          }
        } else {
          const id = ids()[0];
          this.set(id, this.remembered.get(id) ?? (isBreath() ? 0.3 : 0.5));
          if (isBreath() && this.remembered.has('breath.chiff')) this.set('breath.chiff', this.remembered.get('breath.chiff')!);
        }
      };
      this.watch(['texture.type', 'texture.level', 'breath.level', 'breath.chiff'], () => {
        b.classList.toggle('on', on());
        el.classList.toggle('is-off', !on());
      });
      return b;
    };
    this.watch(['texture.type'], () => {
      const br = isBreath();
      for (const k of bed) k.style.display = br ? 'none' : '';
      for (const k of breath) k.style.display = br ? '' : 'none';
      direct.style.visibility = br ? 'hidden' : '';
    });
    return this.strip('NOISE', 'noise', {
      power,
      head: [direct],
      under: this.selector('texture.type'),
      groups: [[], [bed[0], bed[1], breath[0], breath[1]], [bed[2], bed[3], breath[2], breath[3]]],
    });
  }

  // ------------------------------------------------------------------ the middle: scope + amp envelope

  private scopeBox(): HTMLElement {
    const W = 188, H = 150;
    const [cv, g] = canvas(W, H, 'scope-screen');
    this.scopeG = g;
    this.scopeSize = [W, H];
    g.fillStyle = '#090807';
    g.fillRect(0, 0, W, H);
    const el = h('div', 'scope', h('div', 'scope-glass', cv));
    el.title = 'Oscilloscope: the sound coming out, as a waveform';
    return el;
  }

  private envCard(prefix: 'amp_env' | 'mod_env', title: string, zone: Zone, W: number, H: number, size: Size): HTMLElement {
    const [el, head, body] = this.card(title, zone, 'env');
    if (size !== 'small') head.append(h('span', 'c-note', 'drag the points'));
    body.append(this.envPrint(prefix, W, H), h('div', 'knob-row',
      this.knob(`${prefix}.attack`, 'Attack', size, { fmt: ms, showValue: true }),
      this.knob(`${prefix}.decay`, 'Decay', size, { fmt: ms, showValue: true }),
      this.knob(`${prefix}.sustain`, 'Sustain', size, { fmt: db, showValue: true }),
      this.knob(`${prefix}.release`, 'Release', size, { fmt: ms, showValue: true }),
    ));
    return el;
  }

  // ------------------------------------------------------------------ filter

  private filterCard(): HTMLElement {
    const [el, head, body] = this.card('FILTER', 'flt', 'main-filter');
    head.prepend(this.boolPower('filter.on', el));
    // What goes into the filter, top to bottom in the same order as the sources on the left.
    const routes = h('div', 'routes', h('span', 'routes-label', 'In'),
      this.toggle('filter.route_a', 'A', 'route'),
      this.toggle('filter.route_b', 'B', 'route'),
      this.toggle('filter.route_s', 'S', 'route'),
      this.toggle('filter.route_n', 'N', 'route'),
    );
    routes.title = 'What goes through the filter, in the order of the sources: oscillator A, oscillator B, sub, noise (a texture bed or breath)';
    const drive = this.knob('drive.amount', 'Drive', 'mid', { disabled: () => !this.get('drive.on'), deps: ['drive.on'] });
    // Turning the drive up switches the drive stage on.
    drive.addEventListener('pointerdown', () => { if (!this.get('drive.on')) this.set('drive.on', true); }, true);
    const grid = h('div', 'flt-grid',
      this.knob('filter.cutoff', 'Cutoff', 'big'), this.knob('filter.resonance', 'Res', 'big'),
      this.knob('filter.env_amount', 'Env', 'big'), drive);
    body.append(this.selector('filter.type'), this.filterPrint(170, 84), h('div', 'flt-main', routes, grid),
      h('div', 'knob-row flt-small', this.knob('filter.keytrack', 'Key', 'small'), this.knob('filter.fat', 'Fat', 'small'), this.knob('filter.mix', 'Mix', 'small')));
    return el;
  }

  // ------------------------------------------------------------------ dirt

  private distCard(): HTMLElement {
    const [el, head, body] = this.card('DISTORTION', 'dirt');
    head.prepend(this.boolPower('dist.on', el));
    const low = this.knob('dist.clean_below', 'Low', 'small', { fmt: (v) => (v <= 21 ? 'off' : `${Math.round(v)} Hz`) });
    low.title = 'Keeps everything below this frequency clean (the distortion only works on the part above it). Fully left = off.';
    body.append(h('div', 'dist-top', this.selector('dist.type'), this.distPrint(64, 36)),
      h('div', 'knob-row', this.knob('dist.drive', 'Drive', 'big'), this.knob('dist.mix', 'Mix', 'small'), this.knob('dist.post_tone', 'Tone', 'small'), low));
    return el;
  }

  private tapeCard(): HTMLElement {
    const [el, head, body] = this.card('TAPE', 'dirt');
    head.prepend(this.boolPower('tape.on', el));
    const drift = this.knob('voice.analog', 'Drift', 'small');
    drift.title = 'Analog drift: the oscillators drift slightly in pitch and the filter varies a touch per note, like an old analog synth. 0 is perfectly steady.';
    body.append(h('div', 'knob-row', this.knob('tape.age', 'Age', 'big'), this.knob('tape.wow', 'Wow', 'small'), this.knob('tape.drive', 'Drive', 'small'), drift));
    return el;
  }

  // ------------------------------------------------------------------ bottom bar

  /** A label and value you drag up/down (or scroll) to change, like the master level. */
  private readout(id: string, label: string): HTMLElement {
    const p = getParam(id)!;
    const val = h('span', 'ro-val');
    const el = h('div', 'readout', h('span', 'ro-label', label), val);
    el.title = `${p.label}: ${p.describes} (drag up/down)`;
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
    const glide = h('div', 'glide', h('span', 'glide-label', 'Glide'), track, gval);
    glide.title = `${glideP.label}: ${glideP.describes}`;
    const setFromX = (x: number) => {
      const r = track.getBoundingClientRect();
      this.set('voice.glide', Math.round(fromNormalized(glideP, Math.max(0, Math.min(1, (x - r.left) / r.width))) * 10) / 10);
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
    const safe = h('div', 'safelight', h('span', 'lamp lamp-safe'), h('span', 'safe-text', 'Low end mono · limiter on'));
    safe.title = 'The low end is always mono and phase-stable; a transparent output limiter is always on.';
    const gear = h('button', 'gear', h('span', 'gear-icon'), h('span', 'gear-label', 'All controls'));
    gear.title = 'Open every control (the full parameter view) under this page';
    gear.onclick = () => this.onGear();
    const [meter, mg] = canvas(84, 22, 'meter');
    this.meterG = mg;
    return h('div', 'v2-bottom',
      h('div', 'seg-wrap', mono, poly),
      this.toggle('voice.legato', 'Legato'),
      glide,
      safe,
      gear,
      h('div', 'master', this.readout('output.gain', 'Master'), meter),
    );
  }

  // ------------------------------------------------------------------ the preset selector

  /** ‹ name ▾ › in the top middle: arrows step through the shelf, the name opens the list. */
  private presetSelector(): HTMLElement {
    const prev = h('button', 'pre-step', '‹');
    const next = h('button', 'pre-step', '›');
    prev.title = 'Previous preset on this shelf';
    next.title = 'Next preset on this shelf';
    prev.onclick = () => this.presets?.step(-1);
    next.onclick = () => this.presets?.step(1);
    const name = h('button', 'pre-name', this.titleEl, h('span', 'pre-caret', '▾'));
    name.title = 'Choose a preset';
    name.onclick = (e) => {
      e.stopPropagation();
      if (this.menu.classList.contains('open')) this.closeMenu();
      else this.openMenu();
    };
    this.menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.closeMenu());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeMenu(); });
    return h('div', 'pre-sel', h('div', 'pre-row', prev, name, next), this.subEl, this.menu);
  }

  private openMenu(): void {
    if (!this.presets) return;
    this.menuShelf = this.presets.current().shelf;
    this.renderMenu();
    this.menu.classList.add('open');
  }

  private closeMenu(): void {
    this.menu.classList.remove('open');
  }

  /** The dropdown: the shelves on the left, the presets on the chosen shelf on the right. */
  private renderMenu(): void {
    const src = this.presets!;
    const shelves = src.shelves();
    const cur = src.current();
    const left = h('div', 'pre-shelves');
    for (const s of shelves) {
      const b = h('button', 'pre-shelf' + (s.id === this.menuShelf ? ' on' : ''), lamp(), h('span', 'pre-shelf-name', s.name), h('span', 'pre-count', String(s.items.length)));
      b.onclick = () => {
        this.menuShelf = s.id;
        this.renderMenu();
      };
      left.append(b);
    }
    const shelf = shelves.find((s) => s.id === this.menuShelf) ?? shelves[0];
    const right = h('div', 'pre-list');
    for (const it of shelf?.items ?? []) {
      const on = shelf.id === cur.shelf && it.index === cur.index;
      const b = h('button', 'pre-item' + (on ? ' on' : ''), h('span', 'pre-item-name', it.name), h('span', 'pre-tpl', it.tpl));
      b.onclick = () => {
        src.pick(shelf.id, it.index);
        this.closeMenu();
      };
      right.append(b);
    }
    this.menu.replaceChildren(left, right);
    const on = right.querySelector<HTMLElement>('.on');
    if (on) centerIn(right, on);
  }

  // ------------------------------------------------------------------ the MOD page

  /** Slots of the mod matrix that a source feeds, as "→ cutoff +14%, drive +8%". */
  private routesOf(src: string): string {
    const out: string[] = [];
    for (let n = 1; n <= MOD_SLOTS; n++) {
      const amt = this.num(`mod${n}.amount`), dest = String(this.get(`mod${n}.dest`));
      if (String(this.get(`mod${n}.source`)) !== src || dest === 'none' || amt === 0 || !this.get('mod.on')) continue;
      const pct = Math.abs(amt) < 0.01 ? (amt * 100).toFixed(1) : String(Math.round(amt * 100));
      out.push(`${(DEST_LABEL[dest] ?? dest).toLowerCase()} ${amt > 0 ? '+' : ''}${pct}%`);
    }
    return out.length ? `→ ${out.join(', ')}` : '';
  }

  /** A line that always shows where a source goes. */
  private routeNote(src: string, cls = 'c-note route-note', empty = 'not routed'): HTMLElement {
    const el = h('span', cls);
    this.watch([...MOD_IDS, 'mod.on'], () => {
      const t = this.routesOf(src);
      el.textContent = t || empty;
      el.classList.toggle('none', !t);
    });
    return el;
  }

  /** Small segmented buttons for an enum (e.g. the pump rate). */
  private segs(id: string, label: (o: string) => string = (o) => o): HTMLElement {
    const p = getParam(id)!;
    const wrap = h('div', 'mseg-wrap');
    wrap.title = `${p.label}: ${p.describes}`;
    const bs = p.options!.map((o) => {
      const b = h('button', 'mseg', label(o));
      b.onclick = () => this.set(id, o);
      wrap.append(b);
      return [o, b] as const;
    });
    this.watch([id], () => bs.forEach(([o, b]) => b.classList.toggle('on', String(this.get(id)) === o)));
    return wrap;
  }

  /** An LFO's print: two cycles of its shape, with its fade-in. */
  private lfoPrint(n: number, W: number, H: number): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    const L = `lfo${n}`;
    this.watch([`${L}.shape`, `${L}.fade`, `${L}.rate`, `${L}.sync`, `${L}.on`], () => {
      paper(g, W, H);
      const shape = String(this.get(`${L}.shape`));
      const sync = String(this.get(`${L}.sync`));
      // Seconds per cycle (synced rates at 120 BPM), to place the fade on the same time axis.
      const beats = sync === 'free' ? 0 : syncBeats(sync);
      const period = beats ? beats * 0.5 : 1 / Math.max(0.01, this.num(`${L}.rate`));
      const span = 2 * period, fade = this.num(`${L}.fade`) / 1000;
      let seed = 11 + n;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      const steps = Array.from({ length: 10 }, rnd);
      const f = (ph: number) => {
        const p = ph % 1, c = Math.floor(ph);
        switch (shape) {
          case 'sine': return Math.sin(2 * Math.PI * ph);
          case 'triangle': return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
          case 'saw_up': return 2 * p - 1;
          case 'saw_down': return 1 - 2 * p;
          case 'square': return p < 0.5 ? 0.85 : -0.85;
          case 'sample_hold': return steps[Math.floor(ph * 4) % 10] * 0.85;
          default: { const x = ph * 2, i = Math.floor(x), t = x - i, s = t * t * (3 - 2 * t); return (steps[i % 10] + (steps[(i + 1) % 10] - steps[i % 10]) * s) * 0.85 + 0 * c; }
        }
      };
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) {
        const t = (i / W) * span;
        const a = fade > 0 ? Math.min(1, t / fade) : 1;
        pts.push([i, H / 2 - f(t / period) * a * (H / 2 - 7)]);
      }
      silver(g, pts, !!this.get(`${L}.on`));
      vignette(g, W, H);
    });
    return cv;
  }

  /** Hz | Sync: free-running rate or locked to the tempo (the rate dial or the note value shows). */
  private lfoCard(n: number): HTMLElement {
    const L = `lfo${n}`;
    const [el, head, body] = this.card(`LFO ${n}`, 'src', 'lfo');
    head.prepend(this.boolPower(`${L}.on`, el));
    head.append(this.routeNote(`lfo${n}`));
    const id = `${L}.sync`;
    const hz = h('button', 'mseg', 'Hz'), sy = h('button', 'mseg', 'Sync');
    hz.onclick = () => {
      if (this.get(id) !== 'free') {
        this.remembered.set(id, this.get(id));
        this.set(id, 'free');
      }
    };
    sy.onclick = () => { if (this.get(id) === 'free') this.set(id, this.remembered.get(id) ?? '1/4'); };
    const rate = this.knob(`${L}.rate`, 'Rate', 'mid');
    const note = this.selector(id, { label: (o) => o });
    note.classList.add('lfo-sync');
    this.watch([id], () => {
      const free = this.get(id) === 'free';
      hz.classList.toggle('on', free);
      sy.classList.toggle('on', !free);
      rate.style.display = free ? '' : 'none';
      note.style.display = free ? 'none' : '';
    });
    body.append(
      h('div', 'lfo-top', this.selector(`${L}.shape`, { label: (o) => LFO_SHAPE[o] ?? o }), h('div', 'mseg-wrap', hz, sy), this.toggle(`${L}.retrigger`, 'Retrig', 'small')),
      h('div', 'lfo-bottom', this.lfoPrint(n, 196, 40), h('div', 'lfo-rate', rate, note), this.knob(`${L}.fade`, 'Fade', 'mid', { fmt: ms })),
    );
    return el;
  }

  private env2Card(): HTMLElement {
    const [el, head, body] = this.card('ENV 2', 'flt', 'env');
    head.append(this.routeNote('env2'));
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    body.append(this.envPrint('env2', 208, 118), h('div', 'knob-row',
      this.knob('env2.attack', 'Attack', 'mid', { fmt: ms, showValue: true }),
      this.knob('env2.decay', 'Decay', 'mid', { fmt: ms, showValue: true }),
      this.knob('env2.sustain', 'Sustain', 'mid', { fmt: pct, showValue: true }),
      this.knob('env2.release', 'Release', 'mid', { fmt: ms, showValue: true })));
    return el;
  }

  /** The pitch envelope: a drop (or rise) on every note. On when its amount isn't 0. */
  private pitchEnvCard(): HTMLElement {
    const [el, head, body] = this.card('PITCH ENV', 'flt');
    const power = h('button', 'power', lamp());
    power.title = 'On / off (the amount)';
    power.onclick = () => {
      const v = this.num('pitch_env.amount');
      if (v !== 0) {
        this.remembered.set('pitch_env.amount', v);
        this.set('pitch_env.amount', 0);
      } else this.set('pitch_env.amount', this.remembered.get('pitch_env.amount') ?? -12);
    };
    head.prepend(power);
    head.append(h('span', 'c-note', 'on every note'));
    const W = 74, H = 40;
    const [cv, g] = canvas(W, H, 'disp');
    this.watch(['pitch_env.amount', 'pitch_env.decay'], () => {
      const amt = this.num('pitch_env.amount'), dec = this.num('pitch_env.decay');
      power.classList.toggle('on', amt !== 0);
      el.classList.toggle('is-off', amt === 0);
      paper(g, W, H);
      const span = Math.max(200, dec * 3);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) pts.push([i, H / 2 - (amt / 48) * Math.exp((-4.6 * (i / W) * span) / dec) * (H / 2 - 5)]);
      silver(g, pts, amt !== 0);
      vignette(g, W, H);
    });
    body.append(h('div', 'pe-row', cv, this.knob('pitch_env.amount', 'Amount', 'mid', { fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} st` }), this.knob('pitch_env.decay', 'Decay', 'mid', { fmt: ms })));
    return el;
  }

  private vibratoCard(): HTMLElement {
    const [el, head, body] = this.card('VIBRATO', 'dirt');
    head.prepend(this.boolPower('vibrato.on', el));
    head.append(h('span', 'c-note', 'arrives late'));
    body.append(h('div', 'knob-row', this.knob('vibrato.depth', 'Depth'), this.knob('vibrato.rate', 'Rate'), this.knob('vibrato.delay', 'Delay', 'mid', { fmt: ms }), this.knob('vibrato.fade', 'Fade', 'mid', { fmt: ms })));
    return el;
  }

  private wobbleCard(): HTMLElement {
    const [el, head, body] = this.card('WOBBLE', 'dirt');
    head.prepend(this.boolPower('wobble.on', el));
    head.append(h('span', 'c-note', 'on the bar'));
    const target = this.selector('wobble.target', { label: (o) => ({ filter: 'FILTER', 'filter + drive': 'FILTER+DRIVE', 'filter + drive + texture': 'FLT+DRV+TEX' })[o] ?? o });
    target.classList.add('wob-target');
    const rate = this.selector('wobble.rate', { label: (o) => o });
    rate.classList.add('wob-rate');
    const shape = this.selector('wobble.shape');
    shape.classList.add('wob-shape');
    body.append(h('div', 'wob-top', rate, target), h('div', 'wob-bottom', shape, this.knob('wobble.depth', 'Depth'), this.knob('wobble.life', 'Life')));
    return el;
  }

  /** Sources without settings of their own, and where each goes; plus how much velocity matters. */
  private otherSourcesCard(): HTMLElement {
    const [el, , body] = this.card('OTHER SOURCES', 'mat');
    for (const [src, name] of [['drift', 'Drift'], ['drift_slow', 'Slow drift'], ['random', 'Random'], ['velocity', 'Velocity'], ['modwheel', 'Mod wheel'], ['keytrack', 'Keytrack']]) {
      body.append(h('div', 'os-row', h('span', 'os-name', name), this.routeNote(src, 'os-route', '—')));
    }
    const touch = this.knob('voice.velocity', 'Touch');
    touch.title = 'How much playing harder makes it louder and brighter';
    body.append(h('div', 'knob-row os-touch', touch));
    return el;
  }

  /** A bipolar amount you drag sideways (double-click = 0). */
  private amountBar(id: string): HTMLElement {
    const p = getParam(id)!;
    const W = 50, H = 14;
    const [cv, g] = canvas(W, H, 'amt');
    const val = h('span', 'amt-val');
    this.watch([id], () => {
      const v = this.num(id), mid = W / 2;
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#0d0302';
      g.fillRect(0, 4, W, 6);
      g.strokeStyle = '#3a120c';
      g.strokeRect(0.5, 4.5, W - 1, 5);
      g.fillStyle = v >= 0 ? '#ff8f75' : '#ffb36b';
      g.fillRect(Math.min(mid, mid + v * mid), 5, Math.abs(v * mid), 4);
      g.fillStyle = '#5a3a32';
      g.fillRect(mid - 0.5, 2, 1, 10);
      val.textContent = v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.abs(v) < 0.01 ? (v * 100).toFixed(1) : Math.round(v * 100)}%`;
      val.classList.toggle('zero', v === 0);
    });
    let x0 = 0, v0 = 0;
    const set = (v: number) => this.set(id, Math.round(Math.max(p.min!, Math.min(p.max!, v)) * 1000) / 1000);
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); x0 = e.clientX; v0 = this.num(id); });
    cv.addEventListener('pointermove', (e) => { if (cv.hasPointerCapture(e.pointerId)) set(v0 + ((e.clientX - x0) / (e.shiftKey ? 400 : 80))); });
    cv.addEventListener('pointerup', (e) => cv.releasePointerCapture(e.pointerId));
    cv.addEventListener('dblclick', () => set(0));
    cv.addEventListener('wheel', (e) => { e.preventDefault(); set(this.num(id) - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.01)); }, { passive: false });
    const el = h('div', 'amt-wrap', cv, val);
    el.title = `${p.label}: drag sideways, double-click for 0`;
    return el;
  }

  private matrixCard(): HTMLElement {
    const [el, head, body] = this.card('MOD MATRIX', 'mat', 'matrix');
    head.prepend(this.boolPower('mod.on', el));
    head.append(h('span', 'c-note', '12 slots'));
    for (let n = 1; n <= MOD_SLOTS; n++) {
      const src = this.selector(`mod${n}.source`, { label: (o) => SRC_LABEL[o] ?? o });
      const dst = this.selector(`mod${n}.dest`, { label: (o) => DEST_LABEL[o] ?? o });
      src.classList.add('mx-src');
      dst.classList.add('mx-dst');
      body.append(h('div', 'mx-row', h('span', 'mx-n', String(n).padStart(2, '0')), src, h('span', 'mx-arrow', '→'), dst, this.amountBar(`mod${n}.amount`)));
    }
    return el;
  }

  private buildModPage(): HTMLElement {
    const cap = (n: string, name: string, note: string, zone: string) =>
      h('div', `zone-cap cap-${zone}`, h('span', 'cap-name', `${n}  ${name}`), h('span', 'cap-note', note), h('span', 'cap-line'));
    return h('div', 'v2-main mod-page',
      h('div', 'col col-lfos', cap('1', 'LFOS', 'slow, unrelated rates', 'src'), this.lfoCard(1), this.lfoCard(2), this.lfoCard(3), this.lfoCard(4)),
      h('div', 'col col-envs', cap('2', 'ENVELOPES', 'once per note', 'flt'), this.env2Card(), this.pitchEnvCard()),
      h('div', 'col col-play', cap('3', 'PLAYING', 'how a player moves it', 'dirt'), this.vibratoCard(), this.wobbleCard(), this.otherSourcesCard()),
      h('div', 'col col-matrix', cap('4', 'MATRIX', 'who moves what', 'mat'), this.matrixCard()));
  }

  // ------------------------------------------------------------------ the FX page

  /** A print redrawn whenever one of `ids` changes. */
  private fxPrint(W: number, H: number, ids: string[], on: () => boolean, curve: (x: number) => number | [number, number][]): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    this.watch(ids, () => {
      paper(g, W, H);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) {
        const y = curve(i / W);
        if (typeof y === 'number') pts.push([i, H / 2 - y * (H / 2 - 7)]);
      }
      silver(g, pts, on());
      vignette(g, W, H);
    });
    return cv;
  }

  /** Bars (OTT bands, delay repeats, the reverb tail) instead of a line. */
  private barPrint(W: number, H: number, ids: string[], on: () => boolean, bars: () => [number, number, number][]): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    this.watch(ids, () => {
      paper(g, W, H);
      const lit = on();
      for (const [x, w, a] of bars()) {
        const hh = Math.max(1, a * (H - 14));
        g.fillStyle = hexA(lit ? INK : '#5a524a', 0.2 + 0.65 * Math.min(1, a));
        g.fillRect(x * W, (H - hh) / 2, Math.max(1, w * W), hh);
      }
      vignette(g, W, H);
    });
    return cv;
  }

  private fxCard(title: string, zone: Zone, power: string | null, print: HTMLElement, controls: HTMLElement[], knobs: HTMLElement[], note = ''): HTMLElement {
    const [el, head, body] = this.card(title, zone, 'fx');
    if (power) head.prepend(this.boolPower(power, el));
    if (note) head.append(h('span', 'c-note', note));
    body.append(print, ...controls, h('div', 'knob-row fx-knobs', ...knobs));
    return el;
  }

  private buildFxPage(): HTMLElement {
    const W = 178, H = 40;
    const onOf = (...ids: string[]) => () => ids.every((id) => (typeof this.get(id) === 'boolean' ? !!this.get(id) : this.num(id) > 0));
    let seed = 5;
    const noise = Array.from({ length: 400 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));

    const crush = this.fxCard('CRUSH', 'src', 'crush.on',
      this.fxPrint(W, H, ['crush.bits', 'crush.rate', 'crush.mix', 'crush.on'], onOf('crush.on', 'crush.mix'), (x) => {
        const hold = Math.max(1, this.num('crush.rate')) / 400, q = Math.pow(2, Math.min(5, this.num('crush.bits') - 1));
        const xs = Math.floor(x / hold) * hold, s = Math.sin(xs * 2 * Math.PI * 1.5) * 0.85;
        const c = Math.round(s * q) / q, m = this.num('crush.mix');
        return Math.sin(x * 2 * Math.PI * 1.5) * 0.85 * (1 - m) + c * m;
      }), [], [this.knob('crush.mix', 'Mix'), this.knob('crush.bits', 'Bits'), this.knob('crush.rate', 'Rate')], 'in each voice');

    const pumpBeats: Record<string, number> = { '1/1': 4, '1/2': 2, '1/4': 1, '1/8': 0.5 };
    const comp = this.fxCard('COMP + PUMP', 'src', 'dynamics.on',
      this.fxPrint(W, H, ['comp.pump', 'comp.pump_rate', 'comp.amount', 'dynamics.on'], onOf('dynamics.on'), (x) => {
        const per = pumpBeats[String(this.get('comp.pump_rate'))] ?? 1, ph = ((x * 4) / per) % 1, p = this.num('comp.pump');
        return 0.8 - 1.6 * p * Math.exp(-ph * 6) * Math.min(1, ph / 0.03);
      }), [this.segs('comp.pump_rate')], [this.knob('comp.amount', 'Amount'), this.knob('comp.speed', 'Speed'), this.knob('comp.pump', 'Pump')]);

    const ott = this.fxCard('OTT', 'src', null,
      this.barPrint(W, H, ['ott.amount', 'dynamics.on'], onOf('dynamics.on', 'ott.amount'), () => {
        const a = this.num('ott.amount');
        return [0.55, 0.8, 0.45].map((v, i) => [0.06 + i * 0.31, 0.26, 0.25 + v * a * 0.75] as [number, number, number]);
      }), [], [this.knob('ott.amount', 'Amount')], 'three bands');

    const chorus = this.fxCard('CHORUS', 'flt', 'chorus.on',
      this.fxPrint(W, H, ['chorus.depth', 'chorus.mix', 'chorus.mode', 'chorus.on'], onOf('chorus.on', 'chorus.mix'), (x) => {
        const d = this.num('chorus.depth'), voices = this.get('chorus.mode') === 'ensemble' ? 3 : 2;
        let s = 0;
        for (let v = 0; v < voices; v++) s += Math.sin(x * 9 + v * (0.4 + 1.2 * d));
        return (0.85 * s) / voices;
      }), [this.selector('chorus.mode')], [this.knob('chorus.mix', 'Mix'), this.knob('chorus.depth', 'Depth')]);

    const flanger = this.fxCard('FLANGER', 'flt', 'flanger.on',
      this.fxPrint(W, H, ['flanger.rate', 'flanger.feedback', 'flanger.mix', 'flanger.on'], onOf('flanger.on', 'flanger.mix'), (x) => {
        const fb = this.num('flanger.feedback'), c = Math.abs(Math.cos(x * Math.PI * 7));
        return 0.8 - 1.6 * Math.pow(1 - c, 1 + 6 * fb);
      }), [], [this.knob('flanger.mix', 'Mix'), this.knob('flanger.rate', 'Rate'), this.knob('flanger.feedback', 'Feedbk')]);

    const phaser = this.fxCard('PHASER', 'flt', 'phaser.on',
      this.fxPrint(W, H, ['phaser.rate', 'phaser.mix', 'phaser.on'], onOf('phaser.on', 'phaser.mix'), (x) => {
        const m = this.num('phaser.mix');
        return 0.7 - 1.5 * m * (Math.exp(-(((x - 0.32) / 0.05) ** 2)) + Math.exp(-(((x - 0.64) / 0.05) ** 2)));
      }), [], [this.knob('phaser.mix', 'Mix'), this.knob('phaser.rate', 'Rate')]);

    const delayTime = this.selector('delay.time', { label: (o) => o });
    delayTime.classList.add('fx-time');
    const delay = this.fxCard('DELAY', 'mat', 'delay.on',
      this.barPrint(W, H, ['delay.time', 'delay.feedback', 'delay.mix', 'delay.tone', 'delay.on'], onOf('delay.on', 'delay.mix'), () => {
        const step = syncBeats(String(this.get('delay.time'))) / 4, fb = this.num('delay.feedback');
        const out: [number, number, number][] = [];
        for (let i = 0, a = 1; i < 24 && 0.04 + i * step < 0.98; i++, a *= Math.max(0.05, fb)) out.push([0.04 + i * step, 0.012, a]);
        return out;
      }), [delayTime], [this.knob('delay.mix', 'Mix'), this.knob('delay.feedback', 'Feedbk'), this.knob('delay.tone', 'Tone')], 'smeared');

    const reverb = this.fxCard('REVERB', 'mat', 'reverb.on',
      this.barPrint(W, H, ['reverb.size', 'reverb.mix', 'reverb.tone', 'reverb.on'], onOf('reverb.on', 'reverb.mix'), () => {
        const len = 0.15 + 0.85 * this.num('reverb.size');
        const out: [number, number, number][] = [];
        for (let i = 0; i < 200; i++) {
          const x = 0.03 + (i / 200) * 0.94;
          out.push([x, 0.005, Math.exp((-3.5 * x) / len) * (0.35 + 0.65 * noise[i])]);
        }
        return out;
      }), [], [this.knob('reverb.mix', 'Mix'), this.knob('reverb.size', 'Size'), this.knob('reverb.tone', 'Tone')], 'dark');

    // The EQ's real response (the engine's shelves, peak and high cut).
    const eqBands = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
    const eqIds = ['eq.low_gain', 'eq.mid_gain', 'eq.mid_freq', 'eq.high_gain', 'eq.highcut', 'eq.on'];
    const eq = this.fxCard('EQ', 'dirt', 'eq.on',
      this.fxPrint(W + 52, H, eqIds, onOf('eq.on'), (x) => {
        if (x === 0) {
          eqBands[0].setLowShelf(100, this.num('eq.low_gain'), FS);
          eqBands[1].setPeak(this.num('eq.mid_freq'), this.num('eq.mid_gain'), 0.9, FS);
          eqBands[2].setHighShelf(5000, this.num('eq.high_gain'), FS);
          eqBands[3].setLowpass(Math.min(this.num('eq.highcut'), FS * 0.45), Math.SQRT1_2, FS);
        }
        const f = 20 * Math.pow(1000, x);
        const dB = 20 * Math.log10(eqBands.reduce((m, b) => m * biquadMag(b, f), 1));
        return Math.max(-1, Math.min(1, dB / 18));
      }), [], [this.knob('eq.low_gain', 'Low'), this.knob('eq.mid_gain', 'Mid'), this.knob('eq.mid_freq', 'Freq'), this.knob('eq.high_gain', 'High'), this.knob('eq.highcut', 'Hi cut')]);
    eq.classList.add('fx-wide');

    const safe = h('span', 'lamp lamp-safe');
    const out = this.fxCard('OUTPUT', 'dirt', null,
      this.fxPrint(W, H, ['output.gain'], () => true, (x) => {
        const g = Math.pow(10, this.num('output.gain') / 20), v = (x * 2 - 1) * 1.4 * g;
        return Math.max(-0.89, Math.min(0.89, Math.tanh(v * 1.2) * 0.89));
      }), [], [this.knob('output.gain', 'Master'), this.knob('output.crossover', 'Mono <')]);
    out.querySelector('.c-body')!.append(h('div', 'out-safe', safe, h('span', 'c-note', 'low end mono · limiter on')));

    const dist = this.distCard(), tape = this.tapeCard();
    dist.classList.add('fx');
    tape.classList.add('fx');
    const arrow = () => h('div', 'fx-arrow', '→');
    const row = (...cards: HTMLElement[]) => h('div', 'fx-row', ...cards.flatMap((c, i) => (i ? [arrow(), c] : [c])));
    const capEl = h('div', 'zone-cap cap-src', h('span', 'cap-name', 'SIGNAL CHAIN'), h('span', 'cap-note', 'left to right, top then bottom: a fixed order'), h('span', 'cap-line'));
    const lowcut = this.knob('fx.lowcut', 'FX low cut');
    lowcut.title = 'Chorus, flanger, phaser, delay and reverb only work above this frequency: the low end stays clean and mono.';
    return h('div', 'v2-main fx-page', capEl,
      row(dist, crush, tape, comp, ott),
      h('div', 'fx-between', h('span', 'cap-note', '↳ from here on only above the FX low cut'), lowcut),
      row(chorus, flanger, phaser, delay, reverb),
      row(eq, out));
  }


  // ------------------------------------------------------------------ the PRESETS page

  /** Switch between the synth page (OSC) and the preset browser (PRESETS). */
  private showTab(t: string): void {
    for (const [name, b] of this.tabBtns) b.classList.toggle('on', name === t);
    if (this.oscPage!.style.display !== 'none') this.pageHeight = this.oscPage!.offsetHeight || this.pageHeight;
    const pages: [string, HTMLElement][] = [['OSC', this.oscPage!], ['MOD', this.modPage!], ['FX', this.fxPage!], ['PRESETS', this.presetPage]];
    if (t === 'PRESETS') {
      this.pageShelf = this.presets?.current().shelf || this.pageShelf || (this.presets?.shelves()[0]?.id ?? '');
      this.renderPresetPage();
    }
    for (const [name, el] of pages) {
      if (name !== 'OSC' && this.pageHeight) el.style.height = `${this.pageHeight}px`;
      el.style.display = name === t ? '' : 'none';
    }
  }

  /** Three columns: the shelves, the presets on the chosen shelf, the selected preset up close. */
  private renderPresetPage(): void {
    const src = this.presets;
    if (!src) return;
    const shelves = src.shelves();
    const rollPage = this.pageShelf === 'randomizer' || this.pageShelf === 'user';
    // the Randomizer's box locks (in "All controls") show while it is open
    document.body.classList.toggle('randomizing', this.pageShelf === 'randomizer');
    const shelf = shelves.find((s) => s.id === this.pageShelf) ?? shelves[0];
    if (!rollPage) this.pageShelf = shelf.id;
    // shelves
    const left = h('div', 'pp-col pp-shelves', h('div', 'pp-head', h('span', 'pp-title dim', 'SHELVES')));
    let divided = false;
    for (const s of shelves) {
      if (s.secondary && !divided) {
        left.append(h('div', 'pp-divider'));
        divided = true;
      }
      const b = h('button', 'pp-shelf' + (s.id === this.pageShelf ? ' on' : '') + (s.secondary ? ' secondary' : ''), lamp(), h('span', 'pp-shelf-name', s.name), h('span', 'pp-count', String(s.items.length)));
      b.onclick = () => {
        this.pageShelf = s.id;
        this.renderPresetPage();
      };
      left.append(b);
    }
    if (!divided) left.append(h('div', 'pp-divider'));
    const rs = src.rollState();
    for (const [id, name, count] of [['randomizer', 'Randomizer', ''], ['user', '★ User', String(rs.user.length)]] as const) {
      const b = h('button', 'pp-shelf secondary' + (this.pageShelf === id ? ' on' : ''), lamp(), h('span', 'pp-shelf-name', name), h('span', 'pp-count', count));
      b.onclick = () => {
        this.pageShelf = id;
        this.renderPresetPage();
      };
      left.append(b);
    }
    if (this.pageShelf === 'randomizer' || this.pageShelf === 'user') {
      this.presetPage.replaceChildren(left, this.rollList(this.pageShelf, rs), h('div', 'pp-col pp-detail'));
      this.markCurrent();
      return;
    }
    // the list
    const sortSel = h('select', 'sel-name');
    for (const [k, label] of SORTS) sortSel.append(new Option(`SORT: ${label}`, k));
    sortSel.value = this.sort;
    sortSel.onchange = () => {
      this.sort = sortSel.value as Sort;
      this.renderPresetPage();
    };
    const items = [...shelf.items];
    const by: Record<Sort, (a: PresetItem, b: PresetItem) => number> = {
      bank: () => 0,
      name: (a, b) => a.name.localeCompare(b.name),
      template: (a, b) => (a.tpl || 'Z').localeCompare(b.tpl || 'Z') || a.name.localeCompare(b.name),
      hard: (a, b) => fval(a, 'dirt') - fval(b, 'dirt'),
      bright: (a, b) => fval(a, 'brightness') - fval(b, 'brightness'),
      moving: (a, b) => fval(a, 'movement') - fval(b, 'movement'),
    };
    items.sort(by[this.sort]);
    const list = h('div', 'pp-list');
    for (const it of items) {
      const row = h('button', 'pp-row', h('span', 'pp-play'), h('span', 'pp-name', it.name));
      row.dataset.index = String(it.index);
      row.title = 'Click to hear it, double-click to open it in OSC';
      row.onclick = () => src.pick(shelf.id, it.index);
      row.ondblclick = () => this.showTab('OSC');
      list.append(row);
    }
    list.classList.add('pp-grid');
    list.style.gridTemplateRows = `repeat(${Math.max(1, Math.ceil(items.length / 2))}, auto)`;
    const mid = h('div', 'pp-col pp-presets',
      h('div', 'pp-head', h('span', 'pp-title', shelf.name.toUpperCase()), h('span', 'pp-sub', `${shelf.items.length} presets`), h('div', 'sel pp-sort', sortSel)),
      list);
    // the detail
    const right = h('div', 'pp-col pp-detail');
    this.presetPage.replaceChildren(left, mid, right);
    this.markCurrent();
  }

  /** Highlight the loaded preset in the list and show it up close. */
  private markCurrent(): void {
    const src = this.presets;
    if (!src) return;
    const cur = src.current();
    if (this.pageShelf === 'randomizer' || this.pageShelf === 'user') {
      this.markRoll(cur.roll);
      return;
    }
    const shelf = src.shelves().find((s) => s.id === this.pageShelf);
    let found = false;
    this.presetPage.querySelectorAll<HTMLElement>('.pp-row').forEach((r) => {
      const on = cur.shelf === this.pageShelf && Number(r.dataset.index) === cur.index;
      r.classList.toggle('on', on);
      if (on) {
        found = true;
        centerIn(r.parentElement, r);
      }
    });
    const right = this.presetPage.querySelector('.pp-detail');
    if (!right) return;
    const it = found ? shelf?.items.find((x) => x.index === cur.index) : undefined;
    if (!it) {
      right.replaceChildren(h('div', 'pp-empty', 'Click a preset to hear it.'));
      return;
    }
    const W = 360, H = 150;
    const [cv, g] = canvas(W, H, 'disp');
    paper(g, W, H);
    // the sound's "photo": a waveform shaped by its measured character
    const k = 2 + (it.index % 4) + fval(it, 'brightness') * 3, amp = 0.18 + fval(it, 'dirt') * 0.2, ph = it.index * 1.7;
    const pts: [number, number][] = [];
    for (let x = 0; x <= W; x += 2) {
      const u = x / W;
      pts.push([x, H * (0.5 - Math.sin(Math.PI * u) ** 1.2 * amp * (Math.sin((u * 6.283 * k) / 2 + ph) * 0.75 + 0.25 * Math.sin(u * 6.283 * k * 1.9 - ph)))]);
    }
    silver(g, pts);
    vignette(g, W, H);
    const bars = h('div', 'pp-bars');
    for (const [label, key] of [['Bright', 'brightness'], ['Dirt', 'dirt'], ['Moving', 'movement'], ['Attack', 'attack'], ['Length', 'decay'], ['Width', 'width']]) {
      const fill = h('span', 'pp-bar-fill');
      fill.style.width = `${Math.max(4, fval(it, key) * 100)}%`;
      bars.append(h('div', 'pp-bar', h('span', 'pp-bar-label', label), h('span', 'pp-bar-track', fill)));
    }
    const open = h('button', 'pp-btn', 'OPEN IN OSC  →');
    open.onclick = () => this.showTab('OSC');
    right.replaceChildren(
      h('div', 'pp-print', cv),
      h('div', 'pp-big-name', it.name),
      ...(it.tpl ? [h('span', 'pp-tpl', `${it.tpl} · ${it.tplName}`)] : []),
      h('p', 'pp-text', it.description),
      h('div', 'pp-tags', ...it.tags.slice(0, 4).map((t) => h('span', 'pp-tag', t))),
      h('div', 'pp-title dim', 'CHARACTER'),
      bars,
      h('div', 'pp-buttons', open),
    );
  }

  /** The Randomizer (roll controls + the rolls) or User (the starred sounds) in the middle column. */
  private rollList(which: 'randomizer' | 'user', rs: RollState): HTMLElement {
    const src = this.presets!;
    const items = which === 'randomizer' ? rs.rolls : rs.user;
    const head = h('div', 'pp-head', h('span', 'pp-title', which === 'randomizer' ? 'RANDOMIZER' : '★ USER'),
      h('span', 'pp-sub', which === 'randomizer' ? `${items.length} rolls` : `${items.length} starred sounds`));
    const col = h('div', 'pp-col pp-presets', head);
    if (which === 'randomizer') {
      const dice = h('button', 'pp-roll', rs.rolling ? 'ROLLING…' : '🎲  ROLL');
      dice.disabled = rs.rolling;
      dice.title = 'Roll a new sound (boxes locked in "All controls" stay as they are)';
      dice.onclick = () => src.roll();
      // The same kind of slider as Glide in the play bar.
      const fill = h('div', 'glide-fill');
      const weird = h('div', 'glide-track pp-weird', fill);
      const word = (v: number) => (v < 0.2 ? 'close cousins' : v < 0.5 ? 'a twist' : v < 0.8 ? 'strange' : 'wild');
      const wv = h('span', 'pp-weird-word', word(rs.weirdness));
      const show = (v: number) => {
        fill.style.width = `${v * 100}%`;
        wv.textContent = word(v);
      };
      const fromX = (x: number) => {
        const r = weird.getBoundingClientRect();
        const v = Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 100) / 100;
        src.setWeirdness(v);
        show(v);
      };
      weird.addEventListener('pointerdown', (e) => {
        weird.setPointerCapture(e.pointerId);
        fromX(e.clientX);
      });
      weird.addEventListener('pointermove', (e) => { if (weird.hasPointerCapture(e.pointerId)) fromX(e.clientX); });
      show(rs.weirdness);
      const wrap = h('div', 'pp-field', h('span', 'pp-field-label', 'Weirdness'), weird, wv);
      wrap.title = 'Low: close cousins of the presets. High: parts from other categories collide, wild ideas, far from anything in the bank.';
      const based = h('select', 'sel-name');
      for (const [id, name] of rs.basedOptions) based.append(new Option(name.toUpperCase(), id));
      based.value = rs.basedOn;
      based.onchange = () => src.setBasedOn(based.value);
      const basedWrap = h('label', 'pp-field', h('span', 'pp-field-label', 'Based on'), h('div', 'sel pp-based', based));
      basedWrap.title = "Which presets the roll is built from. 'Anything' draws from the whole bank.";
      const clear = h('button', 'pp-clear', 'Clear all');
      clear.disabled = !items.length;
      clear.title = 'Remove every roll (starred ones stay in User)';
      clear.onclick = () => src.clearRolls();
      col.append(h('div', 'pp-rollbar', dice, wrap, basedWrap, clear));
    }
    const list = h('div', 'pp-list');
    if (!items.length) {
      list.append(h('div', 'pp-empty', which === 'randomizer' ? 'Roll to make a new sound from the bank\'s own parts.' : 'Star a roll (☆) to keep it here.'));
    }
    for (const it of items) {
      const star = h('button', 'pp-icon' + (it.starred ? ' on' : ''), it.starred ? '★' : '☆');
      star.title = it.starred ? 'In User (click to take it out)' : 'Star: add this sound to User';
      star.onclick = (e) => {
        e.stopPropagation();
        src.starRoll(it.id);
      };
      const del = h('button', 'pp-icon', '✕');
      del.title = which === 'randomizer' ? 'Throw this roll away' : 'Delete this sound from User';
      del.onclick = (e) => {
        e.stopPropagation();
        src.removeRoll(it.id, which === 'randomizer' ? 'rolls' : 'user');
      };
      const row = h('button', 'pp-row', h('span', 'pp-play'), h('span', 'pp-name', it.name), h('span', 'pp-tools', star, del));
      row.dataset.roll = String(it.id);
      row.title = 'Click to hear it, double-click to open it in OSC';
      row.onclick = () => src.pickRoll(it.id);
      row.ondblclick = () => this.showTab('OSC');
      list.append(row);
    }
    col.append(list);
    return col;
  }

  /** Highlight the loaded roll and show it up close. */
  private markRoll(id: number): void {
    const src = this.presets!;
    const rs = src.rollState();
    const it = [...rs.rolls, ...rs.user].find((x) => x.id === id);
    let found = false;
    this.presetPage.querySelectorAll<HTMLElement>('.pp-row').forEach((r) => {
      const on = Number(r.dataset.roll) === id;
      r.classList.toggle('on', on);
      if (on) {
        found = true;
        centerIn(r.parentElement, r);
      }
    });
    const right = this.presetPage.querySelector('.pp-detail');
    if (!right) return;
    if (!it || !found) {
      right.replaceChildren(h('div', 'pp-empty', this.pageShelf === 'randomizer' ? 'Roll, then click a roll to hear it.' : 'Click a sound to hear it.'));
      return;
    }
    const W = 360, H = 150;
    const [cv, g] = canvas(W, H, 'disp');
    paper(g, W, H);
    const k = 2 + (id % 5) * 0.8, ph = id * 2.3;
    const pts: [number, number][] = [];
    for (let x = 0; x <= W; x += 2) {
      const u = x / W;
      pts.push([x, H * (0.5 - Math.sin(Math.PI * u) ** 1.2 * 0.3 * (Math.sin(u * 6.283 * k + ph) * 0.7 + 0.3 * Math.sin(u * 6.283 * k * 2.3 - ph)))]);
    }
    silver(g, pts);
    vignette(g, W, H);
    const star = h('button', 'pp-btn' + (it.starred ? ' starred' : ''), it.starred ? '★  IN USER' : '☆  STAR');
    star.onclick = () => src.starRoll(it.id);
    const open = h('button', 'pp-btn', 'OPEN IN OSC  →');
    open.onclick = () => this.showTab('OSC');
    right.replaceChildren(
      h('div', 'pp-print', cv),
      h('div', 'pp-big-name', it.name),
      h('span', 'pp-tpl', it.starred ? '★ User' : 'Rolled'),
      h('p', 'pp-text', it.hint),
      h('div', 'pp-buttons', star, open),
    );
  }

  // ------------------------------------------------------------------ the keyboard strip

  /** A hardware-style wheel: ridges, a bright handle; `center` = springs back to the middle (pitch). */
  private wheelCanvas(get: () => number, set: (v: number) => void, center: boolean): [HTMLCanvasElement, () => void] {
    const W = 34, H = 112;
    const [cv, g] = canvas(W, H, 'kb-wheel');
    const draw = () => {
      const v = get();
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#0b0201';
      g.strokeStyle = '#3a120c';
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(0.5, 0.5, W - 1, H - 1, 8);
      g.fill();
      g.stroke();
      g.strokeStyle = FAINT;
      g.lineWidth = 2;
      for (let i = 0; i < 16; i++) {
        const y = 8 + (i * (H - 16)) / 15;
        g.beginPath();
        g.moveTo(5, y);
        g.lineTo(W - 5, y);
        g.stroke();
      }
      const cy = 6 + (1 - v) * (H - 12);
      if (!center) {
        g.fillStyle = 'rgba(255,143,117,0.22)';
        g.beginPath();
        g.roundRect(3, cy, W - 6, H - 3 - cy, 5);
        g.fill();
      }
      g.fillStyle = '#ffe3d9';
      g.beginPath();
      g.roundRect(3, cy - 3, W - 6, 6, 3);
      g.fill();
    };
    const fromY = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      set(Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)));
      draw();
    };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      fromY(e);
    });
    cv.addEventListener('pointermove', (e) => { if (cv.hasPointerCapture(e.pointerId)) fromY(e); });
    cv.addEventListener('pointerup', (e) => {
      cv.releasePointerCapture(e.pointerId);
      if (center) {
        set(0.5);
        draw();
      }
    });
    cv.addEventListener('dblclick', () => {
      set(center ? 0.5 : 0);
      draw();
    });
    draw();
    return [cv, draw];
  }

  /** The keyboard under the page: pitch and mod wheels, octave, the wheel's move and velocity, then the keys. */
  private keyboardStrip(): HTMLElement {
    let bend = 0.5;
    const [pitch] = this.wheelCanvas(() => bend, (v) => {
      bend = v;
      this.onPitch(v * 2 - 1);
    }, true);
    pitch.title = 'Pitch bend (springs back when you let go)';
    const [mod, drawMod] = this.wheelCanvas(() => this.wheel, (v) => {
      this.wheel = v;
      for (const f of this.wheelViews) f();
      this.onWheel(v);
    }, false);
    mod.title = 'Mod wheel: plays the preset\'s move (follows your keyboard\'s wheel). Double-click to reset.';
    this.wheelViews.push(drawMod);
    const octave = h('div', 'chip kb-oct', this.octaveVal);
    octave.title = 'Octave of the keyboard (Z / X, or scroll here)';
    octave.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.onOctave(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    const down = h('button', 'kb-oct-btn', '‹');
    const up = h('button', 'kb-oct-btn', '›');
    down.onclick = () => this.onOctave(-1);
    up.onclick = () => this.onOctave(1);
    // The wheel's move: the preset's own, or another one picked here.
    const nice = (o: string) => o.charAt(0).toUpperCase() + o.slice(1);
    const move = h('select', 'kb-move');
    for (const o of getParam('wheel.move')!.options!) move.append(new Option(nice(o), o));
    move.onchange = () => this.set('wheel.move', move.value);
    move.title = getParam('wheel.move')!.describes;
    this.watch(['wheel.move', 'wheel.preset'], () => {
      move.options[0].text = nice(String(this.get('wheel.preset')));
      move.value = String(this.get('wheel.move'));
    });
    this.velFill.style.width = '75%';
    const side = h('div', 'kb-side',
      h('div', 'kb-wheels', h('div', 'kb-w', pitch, h('span', 'kb-w-label', 'Pitch')), h('div', 'kb-w', mod, h('span', 'kb-w-label', 'Mod'))),
      h('div', 'kb-info',
        h('span', 'kb-label', 'OCTAVE'), h('div', 'kb-oct-row', down, octave, up),
        h('span', 'kb-label', 'MOVE'), move,
        h('span', 'kb-label', 'VEL'), h('span', 'kb-vel', this.velFill)));
    return h('div', 'kb-strip', side, this.keysEl);
  }

  // ------------------------------------------------------------------ the page

  private build(): void {
    const tabs = h('div', 'v2-tabs');
    for (const [t, ready] of [['OSC', true], ['MOD', true], ['FX', true], ['PRESETS', true]] as const) {
      const b = h('button', 'tab' + (t === 'OSC' ? ' on' : ''), t);
      if (!ready) {
        b.disabled = true;
        b.title = 'Coming later (until then: "All controls" opens every control)';
      } else b.onclick = () => this.showTab(t);
      this.tabBtns.set(t, b);
      tabs.append(b);
    }
    const cap = (n: string, name: string, note: string, zone: Zone) =>
      h('div', `zone-cap cap-${zone}`, h('span', 'cap-name', `${n}  ${name}`), h('span', 'cap-note', note), h('span', 'cap-line'));
    const sources = h('div', 'col col-sources', cap('1', 'SOURCES', 'make the sound', 'src'),
      this.oscStrip(1), this.oscStrip(2), this.subStrip(), this.noiseStrip());
    const middle = h('div', 'col col-middle', h('div', 'zone-cap'), this.scopeBox(), this.envCard('amp_env', 'AMP ENVELOPE', 'src', 186, 262, 'small'));
    const filter = h('div', 'col col-filter', cap('2', 'FILTER', 'shape the tone', 'flt'), this.filterCard(), this.envCard('mod_env', 'FILTER ENVELOPE', 'flt', 170, 62, 'small'));
    this.oscPage = h('div', 'v2-main osc-page', sources, middle, filter);
    this.modPage = this.buildModPage();
    this.fxPage = this.buildFxPage();
    this.presetPage.style.display = 'none';
    this.modPage.style.display = 'none';
    this.fxPage.style.display = 'none';
    this.page.append(
      h('div', 'v2-top', h('div', 'v2-brand', 'Low Talk'), this.presetSelector(), h('div', 'v2-top-right', tabs, this.zoomBtn)),
      this.oscPage,
      this.modPage,
      this.fxPage,
      this.presetPage,
      this.bottomBar(),
      this.keyboardStrip(),
    );
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
