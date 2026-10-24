// The synth page (the owner's darkroom layout): the sources as channel strips on the left, a live
// oscilloscope above the amp envelope, the filter with its envelope, the dirt chain and the mod
// wheel, and the play bar. Three knob sizes carry the weight (big for what matters most). It edits
// the same patch as the full parameter view under it (opened with "All controls"), so both always
// show the same values.
import { Biquad } from '../engine/core/dsp';
import { fromNormalized, getParam, toNormalized, type ParamValue, type Patch } from '../schema';
import { formatValue } from './params-panel';
import { keyGrime, lightGrain, panelTexture } from './texture';

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
type Size = 'big' | 'mid' | 'small' | 'lg';
type Zone = 'src' | 'flt' | 'dirt' | 'mat';

const DESIGN_WIDTH = 1200;
const ZOOMS = [1, 1.25, 1.5];
const ZOOM_KEY = 'lowtalk.zoom';
const FS = 48000;
// One dial size everywhere (the owner's call: same size, big enough to read at a glance).
const PX: Record<Size, number> = { big: 40, mid: 40, small: 40, lg: 46 };

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

/** Displays draw straight onto their box: nothing behind the line. */
function paper(g: CanvasRenderingContext2D, W: number, H: number): void {
  g.clearRect(0, 0, W, H);
}

/** (Kept for the call sites; the frameless look has no vignette.) */
function vignette(_g: CanvasRenderingContext2D, _W: number, _H: number): void {}

/** The colour of the box a display sits in (its --knob-accent). */
function accentOf(el: Element): string {
  return (el.isConnected && getComputedStyle(el).getPropertyValue('--knob-accent').trim()) || INK;
}

/** Mix a hex colour towards white (t = 0..1). */
function toWhite(hex: string, t: number): string {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const m = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`;
}

/**
 * A neon line in the box's colour, as in the owner's reference: a wide ambient glow, the
 * coloured tube, and a hot core that runs towards white. (The glow also spills onto the box
 * around the display: see .disp in the stylesheet.)
 */
function silver(g: CanvasRenderingContext2D, pts: [number, number][], on = true, color?: string): void {
  const col = on ? color ?? accentOf(g.canvas) : '#4a4a50';
  // A tiny fixed tremor per point, so the trace reads as photographed light rather than a vector.
  const path = () => {
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const j = on ? Math.sin(x * 12.9898 + y * 78.233) * 0.25 : 0;
      return i ? g.lineTo(x, y + j) : g.moveTo(x, y + j);
    });
  };
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const layers: [string, number, number, number][] = on
    ? [[col, 10, 0.03, 16], [col, 4, 0.32, 6], [col, 2, 1, 3], [toWhite(col, 0.62), 1, 1, 1]]
    : [[col, 2, 0.6, 0]];
  for (const [c, w, a, b] of layers) {
    g.strokeStyle = c;
    g.globalAlpha = a;
    g.lineWidth = w;
    g.shadowColor = col;
    g.shadowBlur = b;
    path();
    g.stroke();
  }
  // Specks of stray light around the trace (fixed per point), like grain on a photographed screen.
  if (on) {
    g.shadowBlur = 0;
    g.fillStyle = col;
    for (let i = 0; i < pts.length; i += 3) {
      const [x, y] = pts[i], hsh = Math.abs(Math.sin(x * 91.17 + y * 13.7) * 43758.5) % 1;
      if (hsh > 0.45) continue;
      g.globalAlpha = 0.15 + hsh * 0.8;
      g.fillRect(x + (hsh - 0.22) * 6, y + (((hsh * 7.3) % 1) - 0.5) * 7, 0.8, 0.8);
    }
  }
  g.restore();
}

/** A soft wash of the line's colour under a curve (envelopes, filter response). */
function fillUnder(g: CanvasRenderingContext2D, pts: [number, number][], bottom: number, color: string, top0 = 0.16, bot0 = 0): void {
  if (pts.length < 2) return;
  const top = Math.min(...pts.map((p) => p[1]));
  const f = g.createLinearGradient(0, top, 0, bottom);
  const c = color.startsWith('#') ? color : INK;
  f.addColorStop(0, hexA(c, top0));
  f.addColorStop(0.6, hexA(c, Math.max(bot0, top0 * 0.3)));
  f.addColorStop(1, hexA(c, bot0));
  g.fillStyle = f;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.lineTo(pts[pts.length - 1][0], bottom);
  g.lineTo(pts[0][0], bottom);
  g.closePath();
  g.fill();
}

/** A glowing point on a display (something you can drag). */
function handle(g: CanvasRenderingContext2D, x: number, y: number, hot = false): void {
  const col = accentOf(g.canvas);
  g.save();
  g.shadowColor = col;
  g.shadowBlur = hot ? 16 : 12;
  g.fillStyle = col;
  g.beginPath();
  g.arc(x, y, hot ? 5.5 : 4.5, 0, 2 * Math.PI);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.arc(x, y, hot ? 3 : 2.6, 0, 2 * Math.PI);
  g.fill();
  g.restore();
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

/**
 * Dial looks to choose from (owner's review): 'ref' (the reference's knurled cap with a tick
 * above), 'photo' (lit like a real object), 'silver' (brushed aluminium), 'flat' (minimal) and
 * 'glass' (a dark glass dome), 'scale' (a printed tick scale around a machined cap). Same geometry: the
 * value shows outside the cap.
 */
function drawKnobVariant(g: CanvasRenderingContext2D, style: string, k: { cx: number; cy: number; r: number; n: number; av: number; zero: number; a0: number; a1: number; accent: string; off: boolean }): void {
  const { cx, cy, r, av, zero, a0, a1, accent, off } = k;
  const col = off ? '#55555b' : accent;
  const kr = r - 5;
  const circle = (rad: number, fill: string | CanvasGradient) => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(cx, cy, rad, 0, 2 * Math.PI);
    g.fill();
  };
  const arc = (rad: number, w: number, glow: boolean) => {
    g.save();
    g.lineCap = 'round';
    g.lineWidth = w;
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.beginPath();
    g.arc(cx, cy, rad, a0, a1);
    g.stroke();
    if (Math.abs(av - zero) > 0.02) {
      g.strokeStyle = col;
      if (glow && !off) {
        g.shadowColor = col;
        g.shadowBlur = 5;
      }
      g.beginPath();
      g.arc(cx, cy, rad, Math.min(zero, av), Math.max(zero, av));
      g.stroke();
    }
    g.restore();
  };
  const pointer = (r0: number, r1: number, w: number, color: string, glow: boolean) => {
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = color;
    g.lineWidth = w;
    if (glow && !off) {
      g.shadowColor = color;
      g.shadowBlur = 5;
    }
    g.beginPath();
    g.moveTo(cx + Math.cos(av) * r0, cy + Math.sin(av) * r0);
    g.lineTo(cx + Math.cos(av) * r1, cy + Math.sin(av) * r1);
    g.stroke();
    g.restore();
  };
  const shadow = (blur: number, dy: number) => {
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.95)';
    g.shadowBlur = blur;
    g.shadowOffsetY = dy;
    circle(kr, '#050506');
    g.restore();
  };
  const lin = (stops: [number, string][], rad: number) => {
    const gr = g.createLinearGradient(cx, cy - rad, cx, cy + rad);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    return gr;
  };
  switch (style) {
    case 'ref': {
      arc(r - 1.5, 1.4, true);
      shadow(7, 2.5);
      circle(kr, lin([[0, '#55555c'], [0.25, '#1c1c1f'], [1, '#0a0a0b']], kr));
      // knurled grip
      g.save();
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * 2 * Math.PI, lit = 0.35 + 0.65 * Math.max(0, -Math.sin(a));
        g.strokeStyle = `rgba(${Math.round(150 * lit)},${Math.round(150 * lit)},${Math.round(158 * lit)},0.45)`;
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * kr * 0.84, cy + Math.sin(a) * kr * 0.84);
        g.lineTo(cx + Math.cos(a) * kr * 0.98, cy + Math.sin(a) * kr * 0.98);
        g.stroke();
      }
      g.restore();
      const fr = kr * 0.8;
      circle(fr, (() => { const gr = g.createRadialGradient(cx - fr * 0.3, cy - fr * 0.55, fr * 0.05, cx, cy, fr); gr.addColorStop(0, '#2c2c31'); gr.addColorStop(0.6, '#151517'); gr.addColorStop(1, '#0b0b0c'); return gr; })());
      pointer(fr * 0.15, fr * 0.92, 1.8, col, true);
      break;
    }
    case 'photo': {
      arc(r - 1.5, 1.6, true);
      shadow(10, 4);
      const cg = g.createConicGradient(-Math.PI / 2, cx, cy);
      [[0, '#8a8a92'], [0.12, '#3a3a40'], [0.3, '#1a1a1d'], [0.5, '#121214'], [0.7, '#1a1a1d'], [0.88, '#3a3a40'], [1, '#8a8a92']].forEach(([o, c]) => cg.addColorStop(o as number, c as string));
      circle(kr, cg);
      const fr = kr * 0.82;
      circle(fr + 0.8, lin([[0, '#000'], [1, '#3a3a3f']], fr));
      circle(fr, (() => { const gr = g.createRadialGradient(cx, cy + fr * 0.4, fr * 0.1, cx, cy, fr); gr.addColorStop(0, '#1d1d20'); gr.addColorStop(1, '#0d0d0f'); return gr; })());
      // specular highlight
      g.save();
      const hl = g.createLinearGradient(cx, cy - fr, cx, cy);
      hl.addColorStop(0, 'rgba(255,255,255,0.16)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hl;
      g.beginPath();
      g.ellipse(cx, cy - fr * 0.45, fr * 0.7, fr * 0.42, 0, 0, 2 * Math.PI);
      g.fill();
      g.restore();
      pointer(fr * 0.3, fr * 0.92, 2, col, true);
      break;
    }
    case 'silver': {
      arc(r - 1.5, 1.6, true);
      shadow(8, 3);
      circle(kr, lin([[0, '#2a2a2e'], [1, '#08080a']], kr));
      const fr = kr * 0.84;
      const cg = g.createConicGradient(0, cx, cy);
      [[0, '#6e6e76'], [0.12, '#c4c4cc'], [0.25, '#5e5e66'], [0.38, '#a8a8b0'], [0.5, '#56565e'], [0.62, '#b8b8c0'], [0.75, '#5e5e66'], [0.88, '#b0b0b8'], [1, '#6e6e76']].forEach(([o, c]) => cg.addColorStop(o as number, c as string));
      circle(fr, cg);
      circle(fr, (() => { const gr = g.createRadialGradient(cx, cy - fr * 0.6, 0, cx, cy, fr); gr.addColorStop(0, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)'); return gr; })());
      pointer(fr * 0.25, fr * 0.95, 2, '#0a0a0b', false);
      break;
    }
    case 'flat': {
      arc(r - 1.5, 1.7, false);
      circle(kr, '#141416');
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.10)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, kr - 0.5, 0, 2 * Math.PI);
      g.stroke();
      g.restore();
      pointer(kr * 0.2, kr * 0.85, 2, col, false);
      break;
    }
    case 'scale': {
      // Real hardware: a printed tick scale on the panel around a machined, knurled cap with a
      // printed white line. The value shows as the brighter ticks up to the pointer.
      const N = 11;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1), a = a0 + (a1 - a0) * t, on = a <= av + 1e-6 && a >= Math.min(zero, av) - 1e-6;
        g.save();
        g.strokeStyle = on && !off ? col : 'rgba(225,220,205,0.38)';
        g.lineWidth = i % 5 === 0 ? 1.2 : 0.9;
        if (on && !off) {
          g.shadowColor = col;
          g.shadowBlur = 3;
        }
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * (r - 4.2), cy + Math.sin(a) * (r - 4.2));
        g.lineTo(cx + Math.cos(a) * (r - 0.6), cy + Math.sin(a) * (r - 0.6));
        g.stroke();
        g.restore();
      }
      const cr = r - 7;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.95)';
      g.shadowBlur = 6;
      g.shadowOffsetY = 2.5;
      circle(cr, '#0b0b0c');
      g.restore();
      circle(cr, lin([[0, '#4a4a50'], [0.3, '#202023'], [1, '#0c0c0d']], cr));
      g.save();
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * 2 * Math.PI, lit = 0.3 + 0.7 * Math.max(0, -Math.sin(a));
        g.strokeStyle = `rgba(${Math.round(160 * lit)},${Math.round(160 * lit)},${Math.round(168 * lit)},0.5)`;
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * cr * 0.86, cy + Math.sin(a) * cr * 0.86);
        g.lineTo(cx + Math.cos(a) * cr * 0.99, cy + Math.sin(a) * cr * 0.99);
        g.stroke();
      }
      g.restore();
      const fr = cr * 0.8;
      circle(fr, (() => { const gr = g.createRadialGradient(cx - fr * 0.3, cy - fr * 0.55, fr * 0.05, cx, cy, fr); gr.addColorStop(0, '#2e2e33'); gr.addColorStop(0.6, '#161618'); gr.addColorStop(1, '#0b0b0c'); return gr; })());
      pointer(fr * 0.1, fr * 0.95, 1.5, '#ece8dc', false);
      break;
    }
    default: { // 'glass'
      arc(r - 1.5, 1.4, true);
      shadow(9, 3);
      circle(kr, (() => { const gr = g.createRadialGradient(cx, cy + kr * 0.3, kr * 0.1, cx, cy, kr); gr.addColorStop(0, '#16161a'); gr.addColorStop(1, '#040405'); return gr; })());
      pointer(kr * 0.15, kr * 0.8, 2.6, col, true);
      pointer(kr * 0.15, kr * 0.8, 0.9, '#ffffff', false);
      g.save();
      const hl = g.createLinearGradient(cx, cy - kr, cx, cy);
      hl.addColorStop(0, 'rgba(255,255,255,0.22)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hl;
      g.beginPath();
      g.ellipse(cx, cy - kr * 0.42, kr * 0.72, kr * 0.45, 0, 0, 2 * Math.PI);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.arc(cx, cy, kr, 0, 2 * Math.PI);
      g.stroke();
      g.restore();
    }
  }
}


/** A moving average over the y values: a darker tone draws a rounder line. */
function smoothY(pts: [number, number][], win: number): [number, number][] {
  const n = Math.max(0, Math.round(win));
  if (!n) return pts;
  return pts.map(([x], i) => {
    let sum = 0, c = 0;
    for (let k = Math.max(0, i - n); k <= Math.min(pts.length - 1, i + n); k++) {
      sum += pts[k][1];
      c++;
    }
    return [x, sum / c];
  });
}

/**
 * A low cut shown on a print: a thin frequency strip along the bottom (20 Hz – 20 kHz, log),
 * dark below the cut, lit above it, with a glowing tick where it cuts. Off (≤ 21 Hz) = nothing.
 */
function loCutStrip(g: CanvasRenderingContext2D, W: number, H: number, hz: number, on: boolean, color: string): void {
  if (!(hz > 21)) return;
  const x = Math.max(1, Math.min(W - 1, (Math.log(hz / 20) / Math.log(1000)) * W));
  g.save();
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(0, H - 3, x, 2);
  g.fillStyle = on ? hexA(color.startsWith('#') ? color : INK, 0.35) : 'rgba(120,120,125,0.3)';
  g.fillRect(x, H - 3, W - x, 2);
  g.fillStyle = on ? color : '#77777d';
  if (on) {
    g.shadowColor = color;
    g.shadowBlur = 6;
  }
  g.fillRect(x - 0.75, H - 9, 1.5, 8);
  g.restore();
}

/** The dot that travels along a print while a note sounds: where in its shape the sound is now. */
function liveDot(g: CanvasRenderingContext2D, pts: [number, number][], frac: number, color: string): void {
  const i = Math.max(0, Math.min(pts.length - 1, Math.round(frac * (pts.length - 1))));
  const [x, y] = pts[i];
  g.save();
  g.fillStyle = '#fff';
  g.shadowColor = color;
  g.shadowBlur = 10;
  g.beginPath();
  g.arc(x, y, 3, 0, 2 * Math.PI);
  g.fill();
  g.restore();
}

/** A few faint copies of a line (unison voices), drawn under the main one. */
function ghosts(g: CanvasRenderingContext2D, sets: [number, number][][], color: string, on: boolean): void {
  g.save();
  g.lineWidth = 1.2;
  g.strokeStyle = on ? hexA(color.startsWith('#') ? color : INK, 0.35) : 'rgba(120,120,125,0.3)';
  if (on) {
    g.shadowColor = color;
    g.shadowBlur = 4;
  }
  for (const pts of sets) {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
  g.restore();
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
/** OSC page prints: one height for all; widths follow the box (beside a side column, the amp box, the wide box). */
/** The shelves' colours on the PRESETS page, in shelf order. */
const SHELF_COLOURS = ['#ff3d2e', '#ff8a2a', '#e8b46a', '#3fe3b6', '#9a7cff', '#5f9bff', '#a9dcff', '#ff6fae', '#d4d4da'];
const PRINT_W = 247;
const PRINT_H = 84;
/** MOD page boxes (a third of a column high): a short print over the dials. */
const MB_PRINT_W = 266;
const MB_PRINT_H = 36;
/** A modulation ring on a dial: the amount parameter, its colour, and how far it moves the dial (normalized). */
interface KnobMod {
  id: string;
  color: string;
  span: (amount: number) => number;
  fmt: (amount: number) => string;
  /** The modulated value right now, if the engine reports it (null when nothing sounds). */
  live?: () => number | null;
}
/** The filter envelope → cutoff: ±1 is ±6 octaves on a 20 Hz – 20 kHz log dial. */
const FENV_MOD: KnobMod = {
  id: 'filter.env_amount',
  color: '#bfe6ff',
  span: (a) => (a * 6) / Math.log2(1000),
  fmt: (a) => (Math.abs(a) < 1e-4 ? 'off' : `${a > 0 ? '+' : '−'}${(Math.abs(a) * 6).toFixed(1)} oct`),
};
/** Typed times: "150", "150 ms", "1.5 s". */
const parseMs = (t: string): number | null => {
  const m = /^\s*(-?[\d.]+)\s*(ms|s)?\s*$/i.exec(t);
  return m ? Number(m[1]) * (m[2]?.toLowerCase() === 's' ? 1000 : 1) : null;
};
/** Typed levels in dB ("-6", "-6 dB", "0"); "-inf" or "off" is silence. */
const parseDb = (t: string): number | null => {
  if (/inf|off/i.test(t)) return 0;
  const m = /^\s*(-?[\d.]+)\s*(db)?\s*$/i.exec(t);
  return m ? Math.min(1, Math.pow(10, Number(m[1]) / 20)) : null;
};
/** Typed percentages ("75", "75 %"). */
const parsePct = (t: string): number | null => {
  const m = /^\s*(-?[\d.]+)\s*%?\s*$/.exec(t);
  return m ? Number(m[1]) / 100 : null;
};
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
  /** The last note's velocity, as a tick on the Touch slider. */
  private readonly velTick = h('span', 'kb-vel-tick');
  private wheel = 0;
  onGear: () => void = () => {};
  onWheel: (v: number) => void = () => {};
  onPitch: (v: number) => void = () => {};
  onOctave: (dir: number) => void = () => {};
  presets: PresetSource | null = null;
  private readonly menu = h('div', 'pre-menu');
  private menuShelf = '';
  private oscPage: HTMLElement | null = null;
  // The envelope balls: when the newest note started and was released (ms), notes held, redraws.
  private noteT0 = -1;
  private relT0 = -1;
  private held = 0;
  private dotRaf = 0;
  private readonly dotDraws: (() => void)[] = [];
  /**
   * The MOD page's prints that move while a note sounds (dots along the LFOs, the pitch
   * envelope and vibrato; the matrix's amount bars), and the clock they read: seconds since the note started and since it
   * was released (-1 while held), and the amp envelope's level right now.
   */
  private readonly animDraws: { el: HTMLElement; f: () => void }[] = [];
  private readonly anim = { on: false, t: 0, rel: -1, amp: 0 };
  private lastVel = 0.8;
  private animFrame = 0;
  /** The engine's live filter (what the print shows while notes sound), and the prints that draw it. */
  private liveFilter: { cutoff: number; res: number } | null = null;
  private readonly liveDraws: (() => void)[] = [];
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

  /** A note started (keyboard, MIDI or the host): the envelope balls start running. */
  noteOn(): void {
    const legato = this.held > 0 && this.num('voice.polyphony') <= 1 && !!this.get('voice.legato');
    this.held++;
    if (!legato) {
      this.noteT0 = performance.now();
      this.relT0 = -1;
    }
    this.runDots();
  }

  /** A note ended: with none left held, the balls run down the release. */
  noteOff(): void {
    this.held = Math.max(0, this.held - 1);
    if (this.held === 0 && this.noteT0 >= 0 && this.relT0 < 0) this.relT0 = performance.now();
  }

  allNotesOff(): void {
    this.held = 0;
    if (this.noteT0 >= 0 && this.relT0 < 0) this.relT0 = performance.now();
  }

  private runDots(): void {
    if (this.dotRaf) return;
    const step = () => {
      for (const f of this.dotDraws) f();
      const now = performance.now();
      // The envelopes' balls and the MOD page's moving prints run until the longest release.
      const longest = Math.max(this.num('amp_env.release'), this.num('mod_env.release'), this.num('env2.release'));
      const live = this.noteT0 >= 0 && (this.relT0 < 0 || now - this.relT0 < longest + 50);
      if (live) {
        this.anim.on = true;
        this.anim.t = (now - this.noteT0) / 1000;
        this.anim.rel = this.relT0 < 0 ? -1 : (now - this.relT0) / 1000;
        this.anim.amp = this.ampLevel(now);
        // Every other frame (30 fps), and only what is on screen.
        if (this.animFrame++ % 2 === 0) for (const a of this.animDraws) if (a.el.offsetParent !== null) a.f();
      } else {
        this.noteT0 = -1;
        this.anim.on = false;
        for (const f of this.dotDraws) f();
        for (const a of this.animDraws) a.f();
      }
      this.dotRaf = live ? requestAnimationFrame(step) : 0;
    };
    this.dotRaf = requestAnimationFrame(step);
  }

  /** The amp envelope's level (0..1) right now, from its settings and when the note started / ended. */
  private ampLevel(now: number): number {
    const a = this.num('amp_env.attack'), d = this.num('amp_env.decay'), sus = this.num('amp_env.sustain'), r = this.num('amp_env.release');
    const heldAt = (t: number) => (t < a ? t / Math.max(a, 1) : sus + (1 - sus) * Math.exp((-5 * (t - a)) / Math.max(d, 1)));
    if (this.relT0 < 0) return heldAt(now - this.noteT0);
    return heldAt(this.relT0 - this.noteT0) * Math.exp((-5 * (now - this.relT0)) / Math.max(r, 1));
  }

  /**
   * Roughly what a mod source is doing right now (LFOs -1..1 at their rate and shape's sign,
   * Env 2 along its envelope, drift wandering, velocity / wheel as they are), for the matrix's
   * amount bars to move with while a note sounds.
   */
  private sourceNow(src: string): number {
    const now = performance.now() / 1000, t = this.anim.t;
    const m = /^lfo(\d)$/.exec(src);
    if (m) {
      const L = `lfo${m[1]}`, sync = String(this.get(`${L}.sync`));
      const period = sync === 'free' ? 1 / Math.max(0.01, this.num(`${L}.rate`)) : syncBeats(sync) * 0.5;
      const tt = this.get(`${L}.retrigger`) ? t : now;
      const fade = this.num(`${L}.fade`) / 1000;
      return Math.sin((2 * Math.PI * tt) / period) * (fade > 0 ? Math.min(1, t / fade) : 1);
    }
    switch (src) {
      case 'env2': {
        const a = this.num('env2.attack') / 1000, d = this.num('env2.decay') / 1000, sus = this.num('env2.sustain'), r = this.num('env2.release') / 1000;
        const held = (x: number) => (x < a ? x / Math.max(a, 1e-3) : sus + (1 - sus) * Math.exp((-5 * (x - a)) / Math.max(d, 1e-3)));
        return this.anim.rel < 0 ? held(t) : held(t - this.anim.rel) * Math.exp((-5 * this.anim.rel) / Math.max(r, 1e-3));
      }
      case 'mod_env': return this.anim.amp;
      case 'velocity': return this.lastVel;
      case 'modwheel': return this.wheel;
      case 'drift': return Math.sin(now * 1.3) * 0.6 + Math.sin(now * 2.9 + 1) * 0.4;
      case 'drift_slow': return Math.sin(now * 0.31) * 0.7 + Math.sin(now * 0.57 + 2) * 0.3;
      case 'random': return Math.sin(this.noteT0 * 12.9898) * 0.5 + 0.5;
      default: return 1;
    }
  }

  /** Follow the engine's real cutoff and resonance (envelope, LFOs, wobble, keytracking…) on the filter print. */
  setLiveFilter(read: () => { cutoff: number; res: number } | null): void {
    const step = () => {
      const v = read();
      const was = this.liveFilter;
      const moved = !v !== !was || (v && was && (Math.abs(v.cutoff / was.cutoff - 1) > 0.002 || Math.abs(v.res - was.res) > 0.002));
      if (moved) {
        this.liveFilter = v;
        for (const f of this.liveDraws) f();
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
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
    this.lastVel = v;
    this.velTick.style.left = `${Math.round(v * 100)}%`;
    this.velTick.classList.add('hit');
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
      g.fillStyle = i < lit ? `rgba(236,236,240,${0.45 + i * 0.04})` : 'rgba(255,255,255,0.07)';
      g.fillRect(i * 6, 0, 3, H);
    }
  }

  /** The oscilloscope: the output waveform on a phosphor screen, triggered for a steady picture. */
  private drawScope(buf: Float32Array): void {
    const g = this.scopeG;
    if (!g) return;
    const [W, H] = this.scopeSize;
    // phosphor persistence: the last frames fade instead of vanishing; a faint graticule
    g.fillStyle = 'rgba(9,9,9,0.24)';
    g.fillRect(0, 0, W, H);
    let start = 0;
    for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { start = i; break; }
    const n = Math.min(1600, buf.length - start);
    let pk = 0;
    for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(buf[start + i]));
    const gain = pk > 0.02 ? Math.min(4, 0.8 / pk) : 1; // keep quiet sounds visible
    g.strokeStyle = 'rgba(246,246,246,1)';
    g.lineWidth = 2;
    g.shadowColor = 'rgba(255,255,255,0.7)';
    g.shadowBlur = 6;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const y = H / 2 - buf[start + i] * gain * (H * 0.45);
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
  private knob(id: string, label: string, size: Size = 'mid', opts: { fmt?: (v: number) => string; parse?: (text: string) => number | null; disabled?: () => boolean; deps?: string[]; showValue?: boolean; mod?: KnobMod } = {}): HTMLElement {
    const p = getParam(id)!;
    const mod = opts.mod;
    const px = PX[size];
    const [cv, g] = canvas(px, px, 'knob');
    const val = h('div', 'k-val');
    // The value stays hidden (the dial shows enough) and appears over the name on hover / drag.
    const el = h('div', `k k-${size}${opts.showValue ? '' : ' quiet'}`, cv, h('div', 'k-label', label), val);
    el.title = `${p.label}: ${p.describes}`;
    const bipolar = (p.min ?? 0) < 0 && (p.max ?? 0) > 0;
    const fmt = (v: number) => (opts.fmt ? opts.fmt(v) : formatValue(p, v));
    let modDrag = false;
    const draw = () => {
      const v = this.num(id);
      const n = toNormalized(p, p.curve === 'log' ? Math.max(v, p.min!) : v);
      const off = opts.disabled?.() ?? false;
      el.classList.toggle('off', off);
      val.textContent = modDrag && mod ? mod.fmt(this.num(mod.id)) : fmt(v);
      const r = px / 2, cx = r, cy = r;
      g.clearRect(0, 0, px, px);
      const a0 = 0.75 * Math.PI, a1 = 2.25 * Math.PI;
      const zero = bipolar ? a0 + (a1 - a0) * toNormalized(p, 0) : a0;
      const av = a0 + (a1 - a0) * n;
      const cs = getComputedStyle(el);
      const accent = cs.getPropertyValue('--knob-accent').trim() || '#ff8f75';
      const kr = r - 3;
      // Alternative dial looks (picked by the page's --knob-style), else the default below.
      const style = cs.getPropertyValue('--knob-style').trim();
      if (style && style !== 'ring') drawKnobVariant(g, style, { cx, cy, r, n, av, zero, a0, a1, accent, off });
      else {
      // shadow under the knob
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.9)';
      g.shadowBlur = 6;
      g.shadowOffsetY = 2;
      g.fillStyle = '#060607';
      g.beginPath();
      g.arc(cx, cy, kr, 0, 2 * Math.PI);
      g.fill();
      g.restore();
      // rim, lit from above
      const rim = g.createLinearGradient(cx, cy - kr, cx, cy + kr);
      rim.addColorStop(0, '#7a7a80');
      rim.addColorStop(0.2, '#2c2c30');
      rim.addColorStop(0.6, '#121214');
      rim.addColorStop(1, '#2a2a2d');
      g.fillStyle = rim;
      g.beginPath();
      g.arc(cx, cy, kr, 0, 2 * Math.PI);
      g.fill();
      // value arc on the rim
      g.lineCap = 'round';
      g.lineWidth = 2.2;
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.arc(cx, cy, kr - 1.6, a0, a1);
      g.stroke();
      if (Math.abs(av - zero) > 0.02) {
        g.save();
        g.strokeStyle = off ? '#4a4a50' : accent;
        if (!off) {
          g.shadowColor = accent;
          g.shadowBlur = 5;
        }
        g.beginPath();
        g.arc(cx, cy, kr - 1.6, Math.min(zero, av), Math.max(zero, av));
        g.stroke();
        g.restore();
      }
      // matte face
      const fr = kr * 0.74;
      const edge = g.createLinearGradient(cx, cy - fr, cx, cy + fr);
      edge.addColorStop(0, '#000');
      edge.addColorStop(1, '#2b2b2e');
      g.fillStyle = edge;
      g.beginPath();
      g.arc(cx, cy, fr + 1, 0, 2 * Math.PI);
      g.fill();
      const face = g.createRadialGradient(cx - fr * 0.25, cy - fr * 0.5, fr * 0.05, cx, cy, fr);
      face.addColorStop(0, '#26262a');
      face.addColorStop(0.55, '#141416');
      face.addColorStop(1, '#0a0a0b');
      g.fillStyle = face;
      g.beginPath();
      g.arc(cx, cy, fr, 0, 2 * Math.PI);
      g.fill();
      // glowing pointer
      g.save();
      g.lineCap = 'round';
      g.strokeStyle = off ? '#6a6a70' : accent;
      g.lineWidth = 2;
      if (!off) {
        g.shadowColor = accent;
        g.shadowBlur = 5;
      }
      g.beginPath();
      g.moveTo(cx + Math.cos(av) * fr * 0.35, cy + Math.sin(av) * fr * 0.35);
      g.lineTo(cx + Math.cos(av) * fr * 0.95, cy + Math.sin(av) * fr * 0.95);
      g.stroke();
      g.restore();
      }
      // Serum-style modulation ring: how far the modulator moves this dial, from where the dial sits.
      if (mod) {
        const amt = this.num(mod.id);
        const m = Math.max(0, Math.min(1, n + mod.span(amt)));
        const am = a0 + (a1 - a0) * m;
        if (Math.abs(am - av) > 0.01) {
          g.save();
          g.lineCap = 'round';
          g.lineWidth = 1.8;
          g.strokeStyle = mod.color;
          g.shadowColor = mod.color;
          g.shadowBlur = 4;
          g.beginPath();
          g.arc(cx, cy, r - 0.9, Math.min(av, am), Math.max(av, am));
          g.stroke();
          g.restore();
        }
        // Where the engine has it right now (while a note sounds), as a dot on the ring.
        const live = mod.live?.();
        if (live !== undefined && live !== null) {
          const al = a0 + (a1 - a0) * Math.max(0, Math.min(1, toNormalized(p, Math.max(p.min!, Math.min(p.max!, live)))));
          g.save();
          g.fillStyle = '#fff';
          g.shadowColor = mod.color;
          g.shadowBlur = 6;
          g.beginPath();
          g.arc(cx + Math.cos(al) * (r - 0.9), cy + Math.sin(al) * (r - 0.9), 1.9, 0, 2 * Math.PI);
          g.fill();
          g.restore();
        }
      }
    };
    const setN = (n: number) => {
      let v = fromNormalized(p, Math.max(0, Math.min(1, n)));
      if (p.type === 'float') v = Math.round(v * 1e4) / 1e4;
      this.set(id, v);
    };
    let startY = 0, startN = 0, startMod = 0;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startN = toNormalized(p, this.num(id));
      // With a modulation ring: Alt-drag sets the amount instead.
      if (mod) {
        modDrag = e.altKey;
        startMod = this.num(mod.id);
        if (modDrag) draw();
      }
      el.classList.add('drag');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cv.hasPointerCapture(e.pointerId)) return;
      const span = e.shiftKey ? 1000 : 200;
      if (modDrag && mod) {
        const mp = getParam(mod.id)!;
        const v = Math.max(mp.min!, Math.min(mp.max!, startMod + ((startY - e.clientY) / span) * (mp.max! - mp.min!) / 2));
        this.set(mod.id, Math.round(v * 1e4) / 1e4);
      } else setN(startN + (startY - e.clientY) / span);
    });
    cv.addEventListener('pointerup', (e) => {
      cv.releasePointerCapture(e.pointerId);
      el.classList.remove('drag');
      if (modDrag) {
        modDrag = false;
        draw();
      }
    });
    if (opts.parse) {
      // Double-click: type a value (Enter sets it, Escape cancels).
      const parse = opts.parse;
      cv.addEventListener('dblclick', () => {
        const input = h('input', 'k-input');
        input.type = 'text';
        input.value = fmt(this.num(id));
        el.append(input);
        input.focus();
        input.select();
        let done = false;
        const close = (commit: boolean) => {
          if (done) return;
          done = true;
          if (commit) {
            const v = parse(input.value);
            if (v !== null && Number.isFinite(v)) this.set(id, Math.round(Math.max(p.min!, Math.min(p.max!, v)) * 1000) / 1000);
          }
          input.remove();
        };
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') close(true);
          if (e.key === 'Escape') close(false);
        });
        input.addEventListener('blur', () => close(true));
      });
    } else {
      // Alt-double-click clears the modulation ring; a plain double-click resets the dial.
      cv.addEventListener('dblclick', (e) => (mod && e.altKey ? this.set(mod.id, 0) : this.set(id, p.default as ParamValue)));
    }
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      setN(toNormalized(p, this.num(id)) - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.02));
    }, { passive: false });
    this.watch([id, ...(mod ? [mod.id] : []), ...(opts.deps ?? [])], draw);
    if (mod?.live) this.liveDraws.push(draw);
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

  // ------------------------------------------------------------------ displays

  /** The oscillator's wave as a small print. */
  private wavePrint(n: 1 | 2, W: number, H: number): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    const o = `osc${n}`;
    // Pitch (OCT / SEM / FIN) sets how many cycles show, level the height, unison draws its
    // detuned copies (spread pulls them apart), the lo cut shows on a strip along the bottom.
    const redraw = () => {
      paper(g, W, H);
      const wave = String(this.get(`${o}.wave`)), pw = this.num(`${o}.pulse_width`), wt = this.num(`${o}.wt_pos`);
      const lvl = this.num(`${o}.level`), on = lvl > 0;
      const cycles = Math.max(1.2, Math.min(9, (W / 70) * Math.pow(2, (this.num(`${o}.semi`) + this.num(`${o}.fine`) / 100) / 12)));
      const amp = (H / 2 - 9) * (0.3 + 0.7 * lvl);
      const line = (shift: number, dy: number): [number, number][] => {
        const pts: [number, number][] = [];
        for (let i = 0; i <= W; i++) pts.push([i, H / 2 + dy - waveShape(wave, ((((i / W) * cycles + shift) % 1) + 1) % 1, pw, wt) * amp]);
        return pts;
      };
      const voices = Math.round(this.num(`${o}.unison_voices`)), det = this.num(`${o}.unison_detune`) / 100, spread = this.num(`${o}.unison_spread`);
      if (voices > 1) {
        const copies: [number, number][][] = [];
        for (let v = 1; v < Math.min(voices, 5); v++) {
          const side = v % 2 ? 1 : -1, k = Math.ceil(v / 2);
          copies.push(line(side * k * det * 0.09, side * k * spread * 3));
        }
        ghosts(g, copies, accentOf(cv), on);
      }
      silver(g, line(0, 0), on);
      if (String(this.get(`${o}.filter_type`)).startsWith('high')) loCutStrip(g, W, H, this.num(`${o}.highpass`), on, accentOf(cv));
      vignette(g, W, H);
    };
    this.watch([`${o}.wave`, `${o}.pulse_width`, `${o}.wt_pos`, `${o}.level`, `${o}.semi`, `${o}.fine`, `${o}.unison_voices`, `${o}.unison_detune`, `${o}.unison_spread`, `${o}.highpass`, `${o}.filter_type`], redraw);
    return cv;
  }

  private subPrint(W: number, H: number): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    // The octave sets how many cycles show, level the height, the clip flattens the tops.
    const redraw = () => {
      paper(g, W, H);
      const cycles = (W / 90) * (this.num('sub.octave') <= -2 ? 0.5 : 1), lvl = this.num('sub.level');
      const k = 1 + this.num('sub.clip') / 3, clip = (v: number) => (k > 1.01 ? Math.tanh(v * k) / Math.tanh(k) : v);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) pts.push([i, H / 2 - clip(waveShape(String(this.get('sub.wave')), ((i / W) * cycles) % 1, 0.5, 0)) * (H / 2 - 9) * (0.3 + 0.6 * lvl)]);
      silver(g, pts, lvl > 0);
      vignette(g, W, H);
    };
    this.watch(['sub.wave', 'sub.level', 'sub.octave', 'sub.clip'], redraw);
    return cv;
  }

  /** The noise layer as a short trace: its grain follows the type, its height the level. */
  private noisePrint(W: number, H: number): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp noise-disp');
    // Tone smooths the grain (dark = rounder), tail fades the end, lo cut shows on the strip.
    const redraw = () => {
      paper(g, W, H);
      const type = String(this.get('texture.type'));
      const breath = type === 'breath';
      const lvl = breath ? Math.max(this.num('breath.level'), this.num('breath.chiff')) : this.num('texture.level');
      const tone = this.num(breath ? 'breath.tone' : 'texture.tone');
      const tail = breath ? 0 : Math.min(1, this.num('texture.tail') / 3000);
      let seed = 3 + type.length;
      const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i += 1.5) {
        const pop = type === 'crackle' && Math.abs(r()) > 0.46 ? 3 : 1;
        const env = type === 'breath' ? Math.sin((i / W) * Math.PI) : type === 'rumble' ? 0.6 : 1;
        const fade = breath ? 1 : Math.min(1, Math.max(0, (1 - i / W) / Math.max(0.05, 0.25 + 0.75 * tail)) * 1.6);
        pts.push([i, H / 2 + r() * (H - 10) * (0.25 + 0.75 * lvl) * pop * env * fade * (type === 'air' ? 0.6 : 1)]);
      }
      silver(g, smoothY(pts, (1 - tone) * 4), lvl > 0);
      if (!breath && String(this.get('texture.filter_type')).startsWith('high')) loCutStrip(g, W, H, this.num('texture.filter_cutoff'), lvl > 0, accentOf(cv));
    };
    this.watch(['texture.type', 'texture.level', 'breath.level', 'breath.chiff', 'texture.tone', 'texture.tail', 'breath.tone', 'breath.decay', 'texture.filter_cutoff', 'texture.filter_type'], redraw);
    return cv;
  }

  /** Frequency response of the main filter. */
  private filterPrint(W: number, H: number): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    const type = () => String(this.get('filter.type'));
    // While notes sound, the print follows the engine's live cutoff and resonance (as in Serum).
    const fcNow = () => this.liveFilter?.cutoff ?? this.num('filter.cutoff');
    const stages = (): [Kind, number, number][] | 'comb' | 'formant' => {
      const fc = fcNow(), res = this.liveFilter?.res ?? this.num('filter.resonance');
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
    const redraw = () => {
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
      const lift = on && this.get('drive.on') ? this.num('drive.amount') * 14 : 0;
      const ys: number[] = [];
      for (let i = 0; i <= W; i++) {
        const f = 20 * Math.pow(1000, i / W);
        let m: number;
        if (st === 'comb') {
          const fc = fcNow();
          m = 0.35 / Math.max(0.15, Math.abs(1 - 0.85 * Math.cos((2 * Math.PI * f) / fc)) + 0.15);
        } else if (st === 'formant') {
          const k = fcNow() / 2000;
          const v = this.num('filter.vowel') * 4;
          const vowels = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
          const i0 = Math.min(3, Math.floor(v)), fr = v - i0;
          m = 0;
          for (let j = 0; j < 3; j++) m += response([['bp', (vowels[i0][j] * (1 - fr) + vowels[i0 + 1][j] * fr) * k, 6]], f) * [1, 0.5, 0.25][j];
        } else m = on ? response(st, f) : 1;
        // Drive (as in Serum): the whole curve rises, and the top saturates so the peak flattens.
        let d = 20 * Math.log10(m + 1e-9) + lift;
        if (d > 6) d = 6 + 12 * Math.tanh((d - 6) / 12);
        ys.push(H - ((Math.max(bottom, Math.min(top, d)) - bottom) / (top - bottom)) * H);
      }
      const curve = ys.map((y, i) => [i, y] as [number, number]);
      if (on) fillUnder(g, curve, H, accentOf(cv), 0.3, 0.1);
      silver(g, curve, on, toWhite(accentOf(cv), 0.55));
      // the cutoff as a handle on the curve
      if (on && st !== 'formant') {
        const fc = fcNow();
        const x = Math.max(4, Math.min(W - 4, (Math.log(fc / 20) / Math.log(1000)) * W));
        // Key tracking: how far the cutoff follows the keyboard (two octaves of notes either way).
        const kt = this.num('filter.keytrack');
        if (kt > 0) {
          const span = (2 * kt * Math.log(2)) / Math.log(1000) * W;
          g.save();
          g.strokeStyle = hexA(accentOf(cv).startsWith('#') ? accentOf(cv) : INK, 0.55);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x - span, H - 4);
          g.lineTo(x + span, H - 4);
          g.moveTo(x - span, H - 7);
          g.lineTo(x - span, H - 1);
          g.moveTo(x + span, H - 7);
          g.lineTo(x + span, H - 1);
          g.stroke();
          g.restore();
        }
        handle(g, x, ys[Math.round(x)] ?? H / 2);
      }
      vignette(g, W, H);
    };
    this.watch(['filter.type', 'filter.cutoff', 'filter.resonance', 'filter.vowel', 'filter.on', 'drive.on', 'drive.amount', 'filter.keytrack'], redraw);
    this.liveDraws.push(redraw);
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
      const pts: [number, number][] = [[X(0), Y(0)]];
      const N = 40;
      for (let i = 0; i <= N; i++) pts.push([X((a * i) / N), Y(1 - Math.pow(1 - i / N, 2))]);
      for (let i = 1; i <= N; i++) pts.push([X(a + (d * i) / N), Y(s + (1 - s) * Math.exp((-5 * i) / N))]);
      pts.push([X(a + d + hold), Y(s)]);
      for (let i = 1; i <= N; i++) pts.push([X(a + d + hold + (r * i) / N), Y(s * Math.exp((-5 * i) / N))]);
      fillUnder(g, pts, H, accentOf(cv));
      silver(g, pts);
      vignette(g, W, H);
      points().forEach(([x, y], i) => handle(g, x, y, i === hot));
      // Where the playing note is in the envelope: a ball that runs along it (as in Serum).
      const at = playhead();
      if (at) {
        const col = accentOf(cv);
        g.save();
        g.shadowColor = col;
        g.shadowBlur = 16;
        g.fillStyle = col;
        g.beginPath();
        g.arc(at[0], at[1], 5, 0, 2 * Math.PI);
        g.fill();
        g.shadowBlur = 6;
        g.shadowColor = '#fff';
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(at[0], at[1], 2.6, 0, 2 * Math.PI);
        g.fill();
        g.restore();
      }
    };
    /** The playhead on this envelope: held = along attack, decay and sustain; released = down the release. */
    const playhead = (): [number, number] | null => {
      if (this.noteT0 < 0) return null;
      const { a, d, s, r, hold, X, Y } = geo();
      const heldAt = (t: number): [number, number] => {
        if (t < a) return [t, 1 - Math.pow(1 - t / Math.max(a, 1e-3), 2)];
        if (t < a + d) return [t, s + (1 - s) * Math.exp((-5 * (t - a)) / Math.max(d, 1e-3))];
        return [a + d + Math.min(t - a - d, hold), s];
      };
      const now = performance.now();
      if (this.relT0 < 0) {
        const [t, v] = heldAt(now - this.noteT0);
        return [X(t), Y(v)];
      }
      const tr = now - this.relT0;
      if (tr > r) return null;
      const v0 = heldAt(this.relT0 - this.noteT0)[1];
      return [X(a + d + hold + tr), Y(v0 * Math.exp((-5 * tr) / Math.max(r, 1e-3)))];
    };
    this.dotDraws.push(draw);
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
  /**
   * A box on the OSC page (all 4:3, all the same size). Three rows at the same heights in every
   * box: the title with its selector and value boxes to its right (power lamp at the end), the
   * print full width in the middle (with switches like Sync / Direct / Key in its top corner),
   * and the dials, one size, centred with equal spacing.
   */
  private obox(title: string | HTMLElement, cls: string, o: { power?: HTMLElement | ((el: HTMLElement) => HTMLElement); head?: HTMLElement[]; corner?: HTMLElement[]; print?: HTMLElement; dials?: HTMLElement[] }): HTMLElement {
    const head = h('div', 'ob-head', typeof title === 'string' ? h('span', 'c-title', title) : title, ...(o.head ?? []));
    const mid = h('div', 'ob-print', ...(o.print ? [o.print] : []), ...(o.corner?.length ? [h('div', 'ob-corner', ...o.corner)] : []));
    const el = h('div', `c ob ${cls}`, head, mid, h('div', 'ob-dials', ...(o.dials ?? [])));
    // The on/off is a thin glowing bar before the title (boxes without one get a bar that stays lit).
    if (title) head.prepend(o.power ? (typeof o.power === 'function' ? o.power(el) : o.power) : h('span', 'ob-bar'));
    return el;
  }

  private oscStrip(n: 1 | 2): HTMLElement {
    const o = `osc${n}`;
    const semiP = getParam(`${o}.semi`)!;
    const oct = () => Math.trunc(this.num(`${o}.semi`) / 12);
    const sem = () => this.num(`${o}.semi`) - 12 * oct();
    const setSemi = (v: number) => this.set(`${o}.semi`, Math.max(semiP.min!, Math.min(semiP.max!, v)));
    // Shape = pulse width on pulse / pwm saw, position on the wavetable, dimmed otherwise.
    const pw = this.knob(`${o}.pulse_width`, 'Shape', 'lg', { disabled: () => !['pulse', 'pwm_saw'].includes(String(this.get(`${o}.wave`))), deps: [`${o}.wave`] });
    const wt = this.knob(`${o}.wt_pos`, 'Shape', 'lg');
    this.watch([`${o}.wave`], () => {
      const isWt = String(this.get(`${o}.wave`)) === 'wavetable';
      wt.style.display = isWt ? '' : 'none';
      pw.style.display = isWt ? 'none' : '';
    });
    const uniOff = () => this.num(`${o}.unison_voices`) <= 1;
    return this.obox(n === 1 ? 'OSC A' : 'OSC B', `c-src osc box-osc${n === 1 ? 'a' : 'b'}`, {
      power: (el) => this.levelPower(`${o}.level`, el),
      corner: n === 2 ? [this.toggle('osc2.sync', 'Sync', 'small')] : [],
      head: [this.selector(`${o}.wave`), h('div', 'ob-chips',
        this.chip('OCT', oct, (v) => setSemi(12 * v + sem()), -2, 2, [`${o}.semi`], 'Octave'),
        this.chip('SEM', sem, (v) => setSemi(12 * oct() + v), -11, 11, [`${o}.semi`], 'Semitones'),
        this.chip('FIN', () => this.num(`${o}.fine`), (v) => this.set(`${o}.fine`, v), -100, 100, [`${o}.fine`], 'Fine tune (cents)'),
        this.chip('UNI', () => this.num(`${o}.unison_voices`), (v) => this.set(`${o}.unison_voices`, v), 1, 7, [`${o}.unison_voices`], 'Unison voices (stacked detuned copies)'),
      )],
      print: this.wavePrint(n, PRINT_W, PRINT_H),
      dials: [
        this.knob(`${o}.unison_detune`, 'Detune', 'lg', { disabled: uniOff, deps: [`${o}.unison_voices`] }),
        pw, wt, this.knob(`${o}.unison_spread`, 'Spread', 'lg', { disabled: uniOff, deps: [`${o}.unison_voices`] }),
        this.lowCut(`${o}.highpass`, `${o}.filter_type`), this.knob(`${o}.level`, 'Level', 'lg'),
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
    const el = this.knob(cutId, 'Lo cut', 'lg', { fmt, deps: [typeId], disabled: () => (isOsc ? !String(this.get(typeId)).startsWith('high') : false) });
    el.title = `Low cut: ${isOsc ? 'cuts this oscillator below this frequency before the drive, so it stays out of the sub\'s space' : 'cuts the noise bed below this frequency so it stays out of the body of the sound'}. Fully left = off. ${p.label}.`;
    if (!isOsc) {
      const toHighpass = () => {
        if (!String(this.get(typeId)).startsWith('high')) {
          this.set(cutId, 20);
          this.set(typeId, 'high 24');
        }
      };
      el.addEventListener('pointerdown', toHighpass, true);
      el.addEventListener('wheel', toHighpass, true);
    }
    return el;
  }

  private subStrip(): HTMLElement {
    return this.obox('SUB', 'c-src sub box-sub', {
      power: (el) => this.levelPower('sub.level', el),
      head: [this.selector('sub.wave'), h('div', 'ob-chips',
        this.chip('OCT', () => this.num('sub.octave'), (v) => this.set('sub.octave', v), -2, -1, ['sub.octave'], 'Sub octave')),
        this.toggle('sub.direct', 'Direct out', 'small direct-out')],
      print: this.subPrint(PRINT_W, PRINT_H),
      dials: [this.knob('sub.clip', 'Clip', 'lg'), this.knob('sub.level', 'Level', 'lg')],
    });
  }

  /**
   * Noise: a texture bed (crackle, dust, rumble, air) or breath (per-note breath noise, its
   * chiff and a sustained level). The dials follow the type: tone, tail, lo cut and level for a
   * bed; chiff, decay, tone and level for breath.
   */
  private noiseStrip(): HTMLElement {
    const isBreath = () => this.get('texture.type') === 'breath';
    const bed = [this.knob('texture.tone', 'Tone', 'lg'), this.knob('texture.tail', 'Tail', 'lg'),
      this.lowCut('texture.filter_cutoff', 'texture.filter_type'), this.knob('texture.level', 'Level', 'lg')];
    const breath = [this.knob('breath.chiff', 'Chiff', 'lg'), this.knob('breath.decay', 'Decay', 'lg'),
      this.knob('breath.tone', 'Tone', 'lg'), this.knob('breath.level', 'Level', 'lg')];
    const direct = this.toggle('texture.direct', 'Direct out', 'small direct-out');
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
    return this.obox('NOISE', 'c-src noise box-noise', {
      power,
      head: [this.selector('texture.type'), direct],
      print: this.noisePrint(PRINT_W, PRINT_H),
      dials: [bed[0], bed[1], breath[0], breath[1], bed[2], bed[3], breath[2], breath[3]],
    });
  }

  // ------------------------------------------------------------------ the middle: scope + amp envelope

  /** The oscilloscope fills its box; the box's own dark edge shows around the screen. */
  private scopeBox(): HTMLElement {
    const W = 279, H = 205;
    const [cv, g] = canvas(W, H, 'scope-screen');
    this.scopeG = g;
    this.scopeSize = [W, H];
    g.fillStyle = '#0b0b0b';
    g.fillRect(0, 0, W, H);
    const el = h('div', 'c ob box-scope', h('div', 'scope-glass', cv));
    el.title = 'Oscilloscope: the sound coming out, as a waveform';
    return el;
  }

  /** "→ CUTOFF +2.4 oct": where a modulator goes and how much; drag up/down to change it, double-click clears it. */
  private modReadout(mod: KnobMod, target: string): HTMLElement {
    const mp = getParam(mod.id)!;
    const amt = h('span', 'mr-amt');
    const el = h('span', 'mod-readout', h('span', 'mr-to', `→ ${target}`), amt);
    el.title = 'How far this envelope sweeps the filter cutoff (the ring around Cutoff). Drag up/down to change it; double-click to clear it.';
    let startY = 0, start = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      startY = e.clientY;
      start = this.num(mod.id);
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      const span = e.shiftKey ? 1000 : 200;
      const v = Math.max(mp.min!, Math.min(mp.max!, start + ((startY - e.clientY) / span) * (mp.max! - mp.min!) / 2));
      this.set(mod.id, Math.round(v * 1e4) / 1e4);
    });
    el.addEventListener('pointerup', (e) => el.releasePointerCapture(e.pointerId));
    el.addEventListener('dblclick', () => this.set(mod.id, 0));
    this.watch([mod.id], () => {
      const v = this.num(mod.id);
      amt.textContent = mod.fmt(v);
      el.classList.toggle('zero', Math.abs(v) < 1e-4);
    });
    return el;
  }

  private envBox(prefix: 'amp_env' | 'mod_env', title: string, cls: string): HTMLElement {
    // The filter envelope's "→ CUTOFF" amount sits in the print's top-right corner.
    return this.obox(title, `env ${cls}`, {
      corner: prefix === 'mod_env' ? [this.modReadout(FENV_MOD, 'CUTOFF')] : [],
      print: this.envPrint(prefix, PRINT_W, PRINT_H),
      dials: [
        this.knob(`${prefix}.attack`, 'A', 'lg', { fmt: ms, parse: parseMs }),
        this.knob(`${prefix}.decay`, 'D', 'lg', { fmt: ms, parse: parseMs }),
        this.knob(`${prefix}.sustain`, 'S', 'lg', { fmt: db, parse: parseDb }),
        this.knob(`${prefix}.release`, 'R', 'lg', { fmt: ms, parse: parseMs }),
      ],
    });
  }

  // ------------------------------------------------------------------ filter

  private filterBox(): HTMLElement {
    // What goes into the filter, in the order of the sources: A, B, S, N.
    const routes = h('div', 'ob-routes', h('span', 'ob-routes-label', 'IN'),
      this.toggle('filter.route_a', 'A', 'route route-a'),
      this.toggle('filter.route_b', 'B', 'route route-b'),
      this.toggle('filter.route_s', 'S', 'route route-s'),
      this.toggle('filter.route_n', 'N', 'route route-n'),
    );
    routes.title = 'What goes through the filter, in the order of the sources: oscillator A, oscillator B, sub, noise (a texture bed or breath)';
    const drive = this.knob('drive.amount', 'Drive', 'lg', { disabled: () => !this.get('drive.on'), deps: ['drive.on'] });
    // Turning the drive up switches the drive stage on.
    drive.addEventListener('pointerdown', () => { if (!this.get('drive.on')) this.set('drive.on', true); }, true);
    // The filter envelope's amount is the ring around Cutoff (as in Serum): Alt-drag the dial.
    const cutoff = this.knob('filter.cutoff', 'Cutoff', 'lg', { mod: { ...FENV_MOD, live: () => this.liveFilter?.cutoff ?? null } });
    cutoff.title += ' The outer ring is how far the filter envelope sweeps it: Alt-drag to set it, Alt-double-click to clear it.';
    return this.obox('FILTER', 'c-flt main-filter box-flt', {
      power: (el) => this.boolPower('filter.on', el),
      head: [this.selector('filter.type'), this.keyTrack()],
      print: this.filterPrint(PRINT_W, PRINT_H),
      dials: [routes, cutoff, this.knob('filter.resonance', 'Res', 'lg'), drive],
    });
  }

  /** Key tracking as an on/off lamp: off = 0, on = the amount the preset had (0.5 if it had none). */
  private keyTrack(): HTMLElement {
    const id = 'filter.keytrack';
    const b = h('button', 'led key-led', lamp(), 'KEY');
    b.title = 'Key tracking: on, the cutoff follows the played note so the tone stays even across the keyboard; off, high notes get darker.';
    b.onclick = () => {
      const v = this.num(id);
      if (v > 0) {
        this.remembered.set(id, v);
        this.set(id, 0);
      } else this.set(id, this.remembered.get(id) ?? 0.5);
    };
    this.watch([id], () => b.classList.toggle('on', this.num(id) > 0));
    return b;
  }

  // ------------------------------------------------------------------ dirt

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
    const gear = h('button', 'gear', h('span', 'gear-icon'), h('span', 'gear-label', 'All controls'));
    gear.title = 'Open every control (the full parameter view) under this page';
    gear.onclick = () => this.onGear();
    const [meter, mg] = canvas(84, 22, 'meter');
    this.meterG = mg;
    return h('div', 'v2-bottom',
      h('div', 'seg-wrap', mono, poly),
      this.toggle('voice.legato', 'Legato'),
      glide,
      gear,
      h('div', 'master', this.readout('output.gain', 'Master'), meter),
    );
  }

  // ------------------------------------------------------------------ the preset selector

  /** ‹ name ▾ › in the top middle: arrows step through the shelf, the name opens the list. */
  private presetSelector(): HTMLElement {
    const prev = h('button', 'pre-step', '<');
    const next = h('button', 'pre-step', '>');
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

  /** A source's routings as a short line ("→ cutoff +14%"), for a print's corner. */
  private routeTag(src: string): HTMLElement {
    const el = h('span', 'route-tag');
    this.watch([...MOD_IDS, 'mod.on'], () => {
      const t = this.routesOf(src);
      el.textContent = t || 'not routed';
      el.classList.toggle('none', !t);
      el.title = t;
    });
    return el;
  }

  /** Plain-text switch between two states (HZ / SYNC), the chosen one lit. */
  private textSwitch(labels: [string, string], isFirst: () => boolean, pick: (first: boolean) => void, ids: string[]): HTMLElement {
    const a = h('button', 'fx-kind', labels[0]), b = h('button', 'fx-kind', labels[1]);
    a.onclick = () => pick(true);
    b.onclick = () => pick(false);
    this.watch(ids, () => {
      a.classList.toggle('on', isFirst());
      b.classList.toggle('on', !isFirst());
    });
    return h('span', 'fx-kinds sw-small', a, h('span', 'fx-kind-sep', '/'), b);
  }

  /** An LFO's print: two cycles of its shape, with its fade-in. */
  private lfoPrint(n: number, W: number, H: number): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    const L = `lfo${n}`;
    const redraw = () => {
      paper(g, W, H);
      const shape = String(this.get(`${L}.shape`));
      const sync = String(this.get(`${L}.sync`));
      // Seconds per cycle (synced rates at 120 BPM), to place the fade on the same time axis.
      const beats = sync === 'free' ? 0 : syncBeats(sync);
      const period = beats ? beats * 0.5 : 1 / Math.max(0.01, this.num(`${L}.rate`));
      // A fixed 2-second window (at 120 BPM): a faster rate shows more cycles.
      const span = 2, fade = this.num(`${L}.fade`) / 1000;
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
      // Retrig: every note starts the shape from the top (a tick at the start).
      if (this.get(`${L}.retrigger`)) {
        g.save();
        g.fillStyle = accentOf(cv);
        g.shadowColor = accentOf(cv);
        g.shadowBlur = 6;
        g.fillRect(1, 2, 1.5, H - 4);
        g.restore();
      }
      // While playing: a dot at where the LFO is now (from the note's start when it retriggers).
      if (this.anim.on && this.get(`${L}.on`)) {
        const t = this.get(`${L}.retrigger`) ? this.anim.t : performance.now() / 1000;
        liveDot(g, pts, (t % span) / span, accentOf(cv));
      }
    };
    this.watch([`${L}.shape`, `${L}.fade`, `${L}.rate`, `${L}.sync`, `${L}.on`, `${L}.retrigger`], redraw);
    this.animDraws.push({ el: cv, f: redraw });
    return cv;
  }

  private lfoBox(n: number): HTMLElement {
    const L = `lfo${n}`, id = `${L}.sync`;
    const sync = this.textSwitch(['HZ', 'SYNC'], () => this.get(id) === 'free', (free) => {
      if (free && this.get(id) !== 'free') {
        this.remembered.set(id, this.get(id));
        this.set(id, 'free');
      } else if (!free && this.get(id) === 'free') this.set(id, this.remembered.get(id) ?? '1/4');
    }, [id]);
    const rate = this.knob(`${L}.rate`, 'Rate', 'lg');
    // Synced: the note value sits where the rate dial was, with the same label.
    const note = h('div', 'k k-lg note-cell', this.selector(id, { label: (o) => o }), h('div', 'k-label', 'Rate'));
    this.watch([id], () => {
      const free = this.get(id) === 'free';
      rate.style.display = free ? '' : 'none';
      note.style.display = free ? 'none' : '';
    });
    return this.obox(`LFO ${n}`, `mb box-lfo${n}`, {
      power: (el) => this.boolPower(`${L}.on`, el),
      head: [this.selector(`${L}.shape`, { label: (o) => LFO_SHAPE[o] ?? o }), sync, this.toggle(`${L}.retrigger`, 'Retrig', 'small')],
      corner: [this.routeTag(L)],
      print: this.lfoPrint(n, MB_PRINT_W, MB_PRINT_H),
      dials: [rate, note, this.knob(`${L}.fade`, 'Fade', 'lg', { fmt: ms })],
    });
  }

  private env2Box(): HTMLElement {
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    return this.obox('ENV 2', 'mb box-env2', {
      corner: [this.routeTag('env2')],
      print: this.envPrint('env2', MB_PRINT_W, MB_PRINT_H),
      dials: [
        this.knob('env2.attack', 'A', 'lg', { fmt: ms, parse: parseMs }),
        this.knob('env2.decay', 'D', 'lg', { fmt: ms, parse: parseMs }),
        this.knob('env2.sustain', 'S', 'lg', { fmt: pct, parse: parsePct }),
        this.knob('env2.release', 'R', 'lg', { fmt: ms, parse: parseMs }),
      ],
    });
  }

  /**
   * Pitch envelope and vibrato share one box: the title's two words switch which one you see
   * (both keep working; a dot before each word glows while it is on). The bar switches the shown one.
   */
  private pitchVibBox(): HTMLElement {
    const W = MB_PRINT_W, H = MB_PRINT_H;
    let view: 'pitch' | 'vib' = 'pitch';
    const peOn = () => this.num('pitch_env.amount') !== 0;
    const vibOn = () => !!this.get('vibrato.on') && this.num('vibrato.depth') > 0;
    // pitch envelope: on when its amount isn't 0 (the bar remembers the amount)
    const togglePitch = () => {
      const v = this.num('pitch_env.amount');
      if (v !== 0) {
        this.remembered.set('pitch_env.amount', v);
        this.set('pitch_env.amount', 0);
      } else this.set('pitch_env.amount', this.remembered.get('pitch_env.amount') ?? -12);
    };
    const [pcv, pg] = canvas(W, H, 'disp');
    const drawPitch = () => {
      const amt = this.num('pitch_env.amount'), dec = this.num('pitch_env.decay');
      paper(pg, W, H);
      const span = Math.max(200, dec * 3), a = Math.sign(amt) * Math.min(1, 0.25 + Math.abs(amt) / 32);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) pts.push([i, H / 2 - a * Math.exp((-4.6 * (i / W) * span) / dec) * (H / 2 - 7)]);
      silver(pg, pts, amt !== 0);
      if (this.anim.on && amt !== 0) liveDot(pg, pts, Math.min(1, (this.anim.t * 1000) / span), accentOf(pcv));
    };
    this.watch(['pitch_env.amount', 'pitch_env.decay'], drawPitch);
    this.animDraws.push({ el: pcv, f: drawPitch });
    // vibrato: flat until the delay, then it fades in
    const [vcv, vg] = canvas(W, H, 'disp');
    const drawVib = () => {
      paper(vg, W, H);
      const span = 2000, d = this.num('vibrato.delay'), f = this.num('vibrato.fade'), dep = 0.3 + 0.7 * (this.num('vibrato.depth') / 100);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) {
        const t = (i / W) * span, a = t < d ? 0 : Math.min(1, (t - d) / Math.max(1, f));
        pts.push([i, H / 2 - Math.sin((t / 1000) * this.num('vibrato.rate') * 2 * Math.PI) * a * dep * (H / 2 - 7)]);
      }
      silver(vg, pts, vibOn());
      if (this.anim.on && vibOn()) liveDot(vg, pts, Math.min(1, (this.anim.t * 1000) / span), accentOf(vcv));
    };
    this.watch(['vibrato.on', 'vibrato.depth', 'vibrato.rate', 'vibrato.delay', 'vibrato.fade'], drawVib);
    this.animDraws.push({ el: vcv, f: drawVib });
    const peDials = [this.knob('pitch_env.amount', 'Amount', 'lg', { fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} st` }), this.knob('pitch_env.decay', 'Decay', 'lg', { fmt: ms })];
    const vibDials = [this.knob('vibrato.depth', 'Depth', 'lg'), this.knob('vibrato.rate', 'Rate', 'lg'), this.knob('vibrato.delay', 'Delay', 'lg', { fmt: ms }), this.knob('vibrato.fade', 'Fade', 'lg', { fmt: ms })];
    const word = (label: string, v: 'pitch' | 'vib') => {
      const b = h('button', 'fx-kind', h('span', 'kind-dot'), label);
      b.onclick = () => {
        view = v;
        show();
      };
      return b;
    };
    const pBtn = word('PITCH ENV', 'pitch'), vBtn = word('VIBRATO', 'vib');
    const power = h('button', 'power', lamp());
    power.title = 'On / off (the one shown)';
    power.onclick = () => (view === 'pitch' ? togglePitch() : this.set('vibrato.on', !this.get('vibrato.on')));
    const box = this.obox(h('span', 'fx-kinds', pBtn, h('span', 'fx-kind-sep', '/'), vBtn), 'mb box-pitch', {
      power,
      print: h('div', 'pv-prints', pcv, vcv),
      dials: [...peDials, ...vibDials],
    });
    const show = () => {
      const pe = view === 'pitch';
      pBtn.classList.toggle('on', pe);
      vBtn.classList.toggle('on', !pe);
      pBtn.classList.toggle('live', peOn());
      vBtn.classList.toggle('live', vibOn());
      pcv.style.display = pe ? '' : 'none';
      vcv.style.display = pe ? 'none' : '';
      for (const k of peDials) k.style.display = pe ? '' : 'none';
      for (const k of vibDials) k.style.display = pe ? 'none' : '';
      const on = pe ? peOn() : !!this.get('vibrato.on');
      power.classList.toggle('on', on);
      box.classList.toggle('is-off', !on);
    };
    this.watch(['pitch_env.amount', 'vibrato.on', 'vibrato.depth'], show);
    return box;
  }

  private wobbleBox(): HTMLElement {
    const W = PRINT_W, H = PRINT_H;
    const [cv, g] = canvas(W, H, 'disp');
    // Two bars of the wobble at its rate, each cycle a little different (life).
    const redraw = () => {
      paper(g, W, H);
      const target = String(this.get('wobble.target'));
      const cycles = Math.min(16, 8 / syncBeats(String(this.get('wobble.rate')))), shape = String(this.get('wobble.shape'));
      const dep = 0.3 + 0.7 * this.num('wobble.depth'), life = this.num('wobble.life');
      const f = (p: number) => (shape === 'triangle' ? (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) : shape === 'saw down' ? 1 - 2 * p : shape === 'square' ? (p < 0.5 ? 0.85 : -0.85) : Math.sin(2 * Math.PI * p));
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) {
        const x = (i / W) * cycles, c = Math.floor(x), vary = 1 - life * 0.45 * (0.5 + 0.5 * Math.sin(c * 2.7 + 1));
        let y = f(x - c) * dep * vary;
        if (target !== 'filter') y = Math.tanh(y * 2.2) / Math.tanh(2.2);
        if (target.endsWith('texture')) y += 0.08 * Math.sin(i * 1.7) * Math.sin(i * 0.37);
        pts.push([i, H / 2 - y * (H / 2 - 7)]);
      }
      silver(g, pts, !!this.get('wobble.on') && this.num('wobble.depth') > 0);
    };
    this.watch(['wobble.on', 'wobble.depth', 'wobble.rate', 'wobble.shape', 'wobble.life', 'wobble.target'], redraw);
    const target = this.selector('wobble.target', { label: (o) => ({ filter: 'FILTER', 'filter + drive': 'FLT + DRV', 'filter + drive + texture': 'FLT + DRV + TEX' })[o] ?? o });
    return this.obox('WOBBLE', 'box-wob', {
      power: (el) => this.boolPower('wobble.on', el),
      head: [this.selector('wobble.rate', { label: (o) => o }), this.selector('wobble.shape'), target],
      print: cv,
      dials: [this.knob('wobble.depth', 'Depth', 'lg'), this.knob('wobble.life', 'Life', 'lg')],
    });
  }

  private matrixBox(): HTMLElement {
    const rows: HTMLElement[] = [];
    for (let n = 1; n <= MOD_SLOTS; n++) {
      const src = this.selector(`mod${n}.source`, { label: (o) => SRC_LABEL[o] ?? o });
      const dst = this.selector(`mod${n}.dest`, { label: (o) => DEST_LABEL[o] ?? o });
      src.classList.add('mx-src');
      dst.classList.add('mx-dst');
      const on = h('button', 'mx-on', lamp());
      on.title = 'This modulation on / off (keeps its settings)';
      on.onclick = () => this.set(`mod${n}.on`, !this.get(`mod${n}.on`));
      const row = h('div', 'mx-row', on, h('span', 'mx-n', String(n).padStart(2, '0')), src, h('span', 'mx-arrow', '→'), dst);
      this.watch([`mod${n}.on`], () => {
        on.classList.toggle('on', !!this.get(`mod${n}.on`));
        row.classList.toggle('off', !this.get(`mod${n}.on`));
      });
      // The source's name and amount in its own box colour (LFO 1 red, Env 2 blue …); empty slots
      // fade. Registered before the amount bar, so the bar draws in the right colour.
      this.watch([`mod${n}.source`, `mod${n}.dest`, `mod${n}.amount`], () => {
        const s = String(this.get(`mod${n}.source`));
        row.dataset.src = s;
        row.classList.toggle('empty', s === 'none' || String(this.get(`mod${n}.dest`)) === 'none' || this.num(`mod${n}.amount`) === 0);
      });
      row.append(this.amountBar(`mod${n}.amount`, [`mod${n}.source`]));
      rows.push(row);
    }
    const el = h('div', 'c ob box-matrix', h('div', 'ob-head', h('span', 'c-title', 'MOD MATRIX'), h('span', 'mx-note', 'source → destination · amount')), h('div', 'mx-rows', ...rows));
    el.querySelector('.ob-head')!.prepend(this.boolPower('mod.on', el));
    return el;
  }

  /**
   * The MOD page: the sources on the left (LFO 1–4, then Env 2 and the pitch envelope, in two
   * columns of three) and the 12-slot matrix filling the right half.
   */
  private buildModPage(): HTMLElement {
    return h('div', 'v2-main mod-page2',
      this.lfoBox(1), this.lfoBox(2),
      this.lfoBox(3), this.lfoBox(4),
      this.env2Box(), this.pitchVibBox(),
      this.matrixBox());
  }

  /** A bipolar amount you drag sideways (double-click = 0): a neon line from the centre, in the box colour. */
  private amountBar(id: string, deps: string[] = []): HTMLElement {
    const p = getParam(id)!;
    const W = 92, H = 14;
    const [cv, g] = canvas(W, H, 'amt');
    const val = h('span', 'amt-val');
    const draw = () => {
      // While a note sounds the bar moves with its source (deps[0] is the slot's source).
      const v = this.num(id) * (this.anim.on && deps[0] ? this.sourceNow(String(this.get(deps[0]))) : 1), mid = W / 2, col = accentOf(cv);
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(0, H / 2 - 1, W, 2);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(mid - 0.5, 3, 1, H - 6);
      if (v !== 0) {
        g.save();
        g.fillStyle = col;
        g.shadowColor = col;
        g.shadowBlur = 6;
        g.fillRect(Math.min(mid, mid + v * mid), H / 2 - 1.5, Math.max(1, Math.abs(v * mid)), 3);
        g.restore();
      }
      const amt = this.num(id);
      val.textContent = amt === 0 ? '0' : `${amt > 0 ? '+' : ''}${Math.abs(amt) < 0.01 ? (amt * 100).toFixed(1) : Math.round(amt * 100)}%`;
      val.classList.toggle('zero', amt === 0);
    };
    this.watch([id, ...deps], draw);
    if (deps.length) this.animDraws.push({ el: cv, f: draw });
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

  // ------------------------------------------------------------------ the FX page

  /** A neon print on an FX box: a line (one value per x in 0..1, -1..1) in the box's colour. */
  private fxLine(ids: string[], on: () => boolean, curve: (x: number) => number, fill = false, o: { lowcut?: string | (() => string); smooth?: () => number } = {}): HTMLElement {
    const W = PRINT_W, H = PRINT_H;
    const [cv, g] = canvas(W, H, 'disp');
    const redraw = () => {
      paper(g, W, H);
      let pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) pts.push([i, H / 2 - Math.max(-1.05, Math.min(1.05, curve(i / W))) * (H / 2 - 8)]);
      if (o.smooth) pts = smoothY(pts, o.smooth());
      if (fill && on()) fillUnder(g, pts, H, accentOf(cv), 0.28, 0.06);
      silver(g, pts, on());
      if (o.lowcut) loCutStrip(g, W, H, this.num(typeof o.lowcut === 'string' ? o.lowcut : o.lowcut()), on(), accentOf(cv));
    };
    this.watch([...ids, ...(typeof o.lowcut === 'string' ? [o.lowcut] : [])], redraw);
    return cv;
  }

  /** Glowing spikes (delay repeats, the reverb tail): [x 0..1, height 0..1] from the bottom. */
  private fxSpikes(ids: string[], on: () => boolean, spikes: () => [number, number][], lowcut?: string): HTMLElement {
    const W = PRINT_W, H = PRINT_H;
    const [cv, g] = canvas(W, H, 'disp');
    const redraw = () => {
      paper(g, W, H);
      const lit = on(), col = lit ? accentOf(cv) : '#4a4a50';
      g.save();
      g.lineCap = 'round';
      for (const [x, a] of spikes()) {
        const px = 4 + x * (W - 8), top = H - 6 - Math.max(1, a * (H - 14));
        g.strokeStyle = col;
        g.globalAlpha = lit ? 0.35 + 0.65 * Math.min(1, a) : 0.6;
        g.lineWidth = 2;
        if (lit) {
          g.shadowColor = col;
          g.shadowBlur = 8;
        }
        g.beginPath();
        g.moveTo(px, H - 6);
        g.lineTo(px, top);
        g.stroke();
      }
      g.restore();
      if (lowcut) loCutStrip(g, W, H, this.num(lowcut), lit, col);
    };
    this.watch([...ids, ...(lowcut ? [lowcut] : [])], redraw);
    return cv;
  }

  /**
   * The FX page: eight 4:3 boxes like the OSC page, in signal order. The dirt (in each voice):
   * distortion, crush, tape; then the shared effects, each above its own low cut: chorus,
   * flanger or phaser (one at a time), delay, reverb; and the EQ last.
   */
  private buildFxPage(): HTMLElement {
    const lit = (power: string, mix?: string) => () => !!this.get(power) && (!mix || this.num(mix) > 0);
    const lg = (id: string, label: string, opts: Parameters<SynthView['knob']>[3] = {}) => this.knob(id, label, 'lg', opts);
    const lowCut = (fx: string) => {
      const k = lg(`${fx}.lowcut`, 'Lo cut');
      k.title = `Low cut: the ${fx} only works above this frequency, so the low end stays clean and centred.`;
      return k;
    };
    let seed = 5;
    const noise = Array.from({ length: 400 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));

    // Distortion: two cycles of a sine through the curve.
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
    const distLow = lg('dist.clean_below', 'Low', { fmt: (v) => (v <= 21 ? 'off' : `${Math.round(v)} Hz`) });
    distLow.title = 'Keeps everything below this frequency clean (the distortion only works on the part above it). Fully left = off.';
    const dist = this.obox('DISTORTION', 'fx-box box-dist', {
      power: (el) => this.boolPower('dist.on', el),
      head: [this.selector('dist.type')],
      print: this.fxLine(['dist.on', 'dist.type', 'dist.drive', 'dist.mix', 'dist.post_tone'], lit('dist.on', 'dist.mix'), (x) => {
        const s = Math.sin(x * 2 * 2 * Math.PI) * 0.9, m = this.num('dist.mix');
        return m * shape(String(this.get('dist.type')), s, this.num('dist.drive')) * 0.9 + (1 - m) * s;
      }, false, { lowcut: 'dist.clean_below', smooth: () => (1 - this.num('dist.post_tone')) * 7 }),
      dials: [lg('dist.drive', 'Drive'), lg('dist.mix', 'Mix'), lg('dist.post_tone', 'Tone'), distLow],
    });

    const crush = this.obox('CRUSH', 'fx-box box-crush', {
      power: (el) => this.boolPower('crush.on', el),
      print: this.fxLine(['crush.bits', 'crush.rate', 'crush.mix', 'crush.on'], lit('crush.on', 'crush.mix'), (x) => {
        // More bits = finer steps (spread so every bit shows), a higher rate = longer held steps.
        const hold = Math.max(1, this.num('crush.rate')) / 300, q = 1 + (this.num('crush.bits') - 1) * 1.6;
        const xs = Math.floor(x / hold) * hold, c = Math.round(Math.sin(xs * 2 * Math.PI * 2) * 0.9 * q) / q;
        const m = this.get('crush.on') && this.num('crush.mix') > 0 ? this.num('crush.mix') : 1;
        return Math.sin(x * 2 * Math.PI * 2) * 0.9 * (1 - m) + c * m;
      }),
      dials: [lg('crush.mix', 'Mix'), lg('crush.bits', 'Bits'), lg('crush.rate', 'Rate')],
    });

    // Tape: a sine that wobbles in pitch (wow, drift), loses its top (age) and saturates (drive).
    const drift = lg('voice.analog', 'Drift');
    drift.title = 'Analog drift: the oscillators drift slightly in pitch and the filter varies a touch per note, like an old analog synth. 0 is perfectly steady.';
    const tape = this.obox('TAPE', 'fx-box box-tape', {
      power: (el) => this.boolPower('tape.on', el),
      print: this.fxLine(['tape.on', 'tape.age', 'tape.wow', 'tape.drive', 'voice.analog'], lit('tape.on'), (x) => {
        const wow = this.num('tape.wow') + 0.5 * this.num('voice.analog'), age = this.num('tape.age'), d = this.num('tape.drive');
        const ph = x * 2.5 + wow * 0.12 * Math.sin(x * 2 * Math.PI * 1.3);
        const s = Math.sin(ph * 2 * Math.PI) + (1 - age) * 0.18 * Math.sin(ph * 6 * Math.PI);
        const k = 1 + 4 * d;
        return (Math.tanh(s * k) / Math.tanh(k)) * 0.85;
      }),
      dials: [lg('tape.age', 'Age'), lg('tape.wow', 'Wow'), lg('tape.drive', 'Drive'), drift],
    });

    const chorus = this.obox('CHORUS', 'fx-box box-chorus', {
      power: (el) => this.boolPower('chorus.on', el),
      head: [this.selector('chorus.mode')],
      print: this.fxLine(['chorus.depth', 'chorus.mix', 'chorus.mode', 'chorus.on'], lit('chorus.on', 'chorus.mix'), (x) => {
        const d = this.num('chorus.depth'), voices = this.get('chorus.mode') === 'ensemble' ? 3 : 2;
        let v = 0;
        for (let i = 0; i < voices; i++) v += Math.sin(x * 2 * Math.PI * 2.5 + i * (0.4 + 1.6 * d) + d * Math.sin(x * 6 + i));
        const m = this.num('chorus.mix');
        return 0.9 * ((1 - m) * Math.sin(x * 2 * Math.PI * 2.5) + (m * v) / voices);
      }, false, { lowcut: 'chorus.lowcut' }),
      dials: [lg('chorus.mix', 'Mix'), lg('chorus.depth', 'Depth'), lowCut('chorus')],
    });

    // Flanger or phaser: one box, one at a time (the switch in the title row).
    // Which one the box shows: the one that is actually heard (on with some mix); otherwise as before.
    const heard = (k: string) => !!this.get(`${k}.on`) && this.num(`${k}.mix`) > 0;
    let kind: 'flanger' | 'phaser' = heard('phaser') && !heard('flanger') ? 'phaser' : 'flanger';
    const kindBtn = (k: 'flanger' | 'phaser') => {
      const b = h('button', 'c-title fx-kind', k.toUpperCase());
      b.onclick = () => {
        if (kind === k) return;
        const wasOn = !!this.get(`${kind}.on`);
        this.set(`${kind}.on`, false);
        kind = k;
        // The box stays on or off as it was; only the effect inside changes.
        this.set(`${k}.on`, wasOn);
        showKind();
      };
      return b;
    };
    const fBtn = kindBtn('flanger'), pBtn = kindBtn('phaser');
    const titles = h('span', 'fx-kinds', fBtn, h('span', 'fx-kind-sep', '/'), pBtn);
    const flDials = [lg('flanger.mix', 'Mix'), lg('flanger.rate', 'Rate'), lg('flanger.feedback', 'Feedbk'), lowCut('flanger')];
    const phDials = [lg('phaser.mix', 'Mix'), lg('phaser.rate', 'Rate'), lowCut('phaser')];
    const mfxPower = h('button', 'power', lamp());
    mfxPower.title = 'On / off';
    mfxPower.onclick = () => this.set(`${kind}.on`, !this.get(`${kind}.on`));
    const mfxLit = () => !!this.get(`${kind}.on`) && this.num(`${kind}.mix`) > 0;
    const mfxPrint = this.fxLine(['flanger.on', 'phaser.on', 'flanger.mix', 'phaser.mix', 'flanger.feedback', 'flanger.rate', 'phaser.rate', 'flanger.lowcut', 'phaser.lowcut'], mfxLit, (x) => {
      if (kind === 'flanger') {
        // Feedback sharpens the teeth, rate sweeps their spacing across the print, mix their depth.
        const fb = this.num('flanger.feedback'), r = this.num('flanger.rate'), m = Math.min(1, 0.25 + this.num('flanger.mix'));
        const c = Math.abs(Math.cos(Math.PI * (x * 7 + 0.35 * r * Math.sin(2 * Math.PI * x))));
        return 0.8 - 1.6 * m * Math.pow(1 - c, 1 + 6 * fb);
      }
      // The notches drift further apart as the rate goes up; mix sets how deep they go.
      const m = this.num('phaser.mix'), sp = 0.06 * Math.log2(1 + this.num('phaser.rate'));
      const notch = (c: number) => Math.exp(-(((x - c) / 0.05) ** 2));
      return 0.75 - 1.6 * m * (notch(0.42 - sp) + notch(0.55 + sp * 0.3) + 0.6 * notch(0.7 + sp));
    }, false, { lowcut: () => `${kind}.lowcut` });
    const mfx = this.obox(titles, 'fx-box box-mfx', { power: mfxPower, print: mfxPrint, dials: [...flDials, ...phDials] });
    const showKind = () => {
      if (heard('phaser') && !heard('flanger')) kind = 'phaser';
      else if (heard('flanger') && !heard('phaser')) kind = 'flanger';
      fBtn.classList.toggle('on', kind === 'flanger');
      pBtn.classList.toggle('on', kind === 'phaser');
      for (const k of flDials) k.style.display = kind === 'flanger' ? '' : 'none';
      for (const k of phDials) k.style.display = kind === 'phaser' ? '' : 'none';
      const on = !!this.get(`${kind}.on`);
      mfxPower.classList.toggle('on', on);
      mfx.classList.toggle('is-off', !on);
    };
    this.watch(['flanger.on', 'phaser.on', 'flanger.mix', 'phaser.mix'], showKind);

    const delayTime = this.selector('delay.time', { label: (o) => o });
    const delay = this.obox('DELAY', 'fx-box box-delay', {
      power: (el) => this.boolPower('delay.on', el),
      head: [delayTime],
      print: this.fxSpikes(['delay.time', 'delay.feedback', 'delay.mix', 'delay.on', 'delay.tone'], lit('delay.on', 'delay.mix'), () => {
        const step = syncBeats(String(this.get('delay.time'))) / 4, fb = this.num('delay.feedback');
        const out: [number, number][] = [[0, 1]];
        const keep = Math.max(0.05, fb) * (0.55 + 0.45 * this.num('delay.tone'));
        for (let i = 1, a = 0.9 * Math.max(0.05, this.num('delay.mix') * 1.4); i < 32 && i * step < 1; i++, a *= keep) out.push([i * step, Math.min(1, a)]);
        return out;
      }, 'delay.lowcut'),
      dials: [lg('delay.mix', 'Mix'), lg('delay.feedback', 'Feedbk'), lg('delay.tone', 'Tone'), lowCut('delay')],
    });

    const reverb = this.obox('REVERB', 'fx-box box-reverb', {
      power: (el) => this.boolPower('reverb.on', el),
      print: this.fxSpikes(['reverb.size', 'reverb.mix', 'reverb.tone', 'reverb.on'], lit('reverb.on', 'reverb.mix'), () => {
        const len = 0.15 + 0.85 * this.num('reverb.size'), mix = 0.35 + 0.65 * Math.min(1, this.num('reverb.mix') * 2.5), grain = 0.2 + 0.8 * this.num('reverb.tone');
        const out: [number, number][] = [];
        for (let i = 0; i < 80; i++) {
          const x = i / 80;
          out.push([x, mix * Math.exp((-3.5 * x) / len) * (1 - grain * 0.7 + grain * 0.7 * noise[i])]);
        }
        return out;
      }, 'reverb.lowcut'),
      dials: [lg('reverb.mix', 'Mix'), lg('reverb.size', 'Size'), lg('reverb.tone', 'Tone'), lowCut('reverb')],
    });

    // The EQ's real response (the engine's shelves, peak and high cut).
    const eqBands = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
    const eq = this.obox('EQ', 'fx-box box-eq', {
      power: (el) => this.boolPower('eq.on', el),
      print: this.fxLine(['eq.low_gain', 'eq.mid_gain', 'eq.mid_freq', 'eq.high_gain', 'eq.highcut', 'eq.on'], lit('eq.on'), (x) => {
        if (x === 0) {
          eqBands[0].setLowShelf(100, this.num('eq.low_gain'), FS);
          eqBands[1].setPeak(this.num('eq.mid_freq'), this.num('eq.mid_gain'), 0.9, FS);
          eqBands[2].setHighShelf(5000, this.num('eq.high_gain'), FS);
          eqBands[3].setLowpass(Math.min(this.num('eq.highcut'), FS * 0.45), Math.SQRT1_2, FS);
        }
        const f = 20 * Math.pow(1000, x);
        const dB = 20 * Math.log10(eqBands.reduce((m, b) => m * biquadMag(b, f), 1));
        return 0.25 + dB / 24;
      }, true),
      dials: [lg('eq.low_gain', 'Low'), lg('eq.mid_gain', 'Mid'), lg('eq.mid_freq', 'Freq'), lg('eq.high_gain', 'High'), lg('eq.highcut', 'Hi cut')],
    });

    return h('div', 'v2-main osc-page fx-page2', dist, crush, tape, chorus, mfx, delay, reverb, eq);
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
      // The browser keeps the synth page's height; MOD and FX take what they need.
      if (name === 'PRESETS' && this.pageHeight) el.style.height = `${this.pageHeight}px`;
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
    // Each shelf has its own colour (the page takes the open shelf's colour).
    const colour = (i: number) => SHELF_COLOURS[i % SHELF_COLOURS.length];
    const openIdx = shelves.findIndex((s) => s.id === this.pageShelf);
    this.presetPage.style.setProperty('--knob-accent', rollPage ? '#d4d4da' : colour(Math.max(0, openIdx)));
    // shelves
    const left = h('div', 'pp-col pp-shelves', h('div', 'pp-head', h('span', 'ob-bar'), h('span', 'pp-title', 'SHELVES')));
    let divided = false;
    for (const [si, s] of shelves.entries()) {
      if (s.secondary && !divided) {
        left.append(h('div', 'pp-divider'));
        divided = true;
      }
      const b = h('button', 'pp-shelf' + (s.id === this.pageShelf ? ' on' : '') + (s.secondary ? ' secondary' : ''), lamp(), h('span', 'pp-shelf-name', s.name), h('span', 'pp-count', String(s.items.length)));
      b.style.setProperty('--shelf', colour(si));
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
      h('div', 'pp-head', h('span', 'ob-bar'), h('span', 'pp-title', shelf.name.toUpperCase()), h('span', 'pp-sub', `${shelf.items.length} presets`), h('div', 'sel pp-sort', sortSel)),
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
    const W = PRINT_W + 20, H = PRINT_H;
    const [cv, g] = canvas(W, H, 'disp');
    paper(g, W, H);
    // the sound's "photo": a waveform shaped by its measured character
    const k = 2 + (it.index % 4) + fval(it, 'brightness') * 3, amp = 0.18 + fval(it, 'dirt') * 0.2, ph = it.index * 1.7;
    const pts: [number, number][] = [];
    for (let x = 0; x <= W; x += 2) {
      const u = x / W;
      pts.push([x, H * (0.5 - Math.sin(Math.PI * u) ** 1.2 * amp * (Math.sin((u * 6.283 * k) / 2 + ph) * 0.75 + 0.25 * Math.sin(u * 6.283 * k * 1.9 - ph)))]);
    }
    silver(g, pts, true, accentOf(this.presetPage));
    // Character from its measured features: a glowing dot between two words.
    const bars = h('div', 'pp-bars');
    for (const [lo, hi, key] of [['dark', 'bright', 'brightness'], ['clean', 'dirty', 'dirt'], ['still', 'moving', 'movement'], ['snap', 'swell', 'attack'], ['short', 'long', 'decay'], ['narrow', 'wide', 'width']]) {
      const dot = h('b', 'pp-dot');
      dot.style.left = `${Math.round(Math.max(0, Math.min(1, fval(it, key))) * 100)}%`;
      bars.append(h('div', 'pp-bar', h('span', 'pp-bar-label', lo), h('span', 'pp-bar-track', dot), h('span', 'pp-bar-label hi', hi)));
    }
    const open = h('button', 'pp-btn', 'OPEN IN OSC  →');
    open.onclick = () => this.showTab('OSC');
    right.replaceChildren(
      h('div', 'pp-head', h('span', 'ob-bar'), h('span', 'pp-title', 'PREVIEW')),
      h('div', 'pp-print', cv),
      h('div', 'pp-big-name', it.name),
      ...(it.tpl ? [h('span', 'pp-tpl', `${it.tpl} · ${it.tplName}`)] : []),
      h('p', 'pp-text', it.description),
      h('div', 'pp-tags', ...it.tags.slice(0, 4).map((t) => h('span', 'pp-tag', t))),
      bars,
      h('div', 'pp-buttons', open),
    );
  }

  /** The Randomizer (roll controls + the rolls) or User (the starred sounds) in the middle column. */
  private rollList(which: 'randomizer' | 'user', rs: RollState): HTMLElement {
    const src = this.presets!;
    const items = which === 'randomizer' ? rs.rolls : rs.user;
    const head = h('div', 'pp-head', h('span', 'ob-bar'), h('span', 'pp-title', which === 'randomizer' ? 'RANDOMIZER' : '★ USER'),
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
    const W = PRINT_W + 20, H = PRINT_H;
    const [cv, g] = canvas(W, H, 'disp');
    paper(g, W, H);
    const k = 2 + (id % 5) * 0.8, ph = id * 2.3;
    const pts: [number, number][] = [];
    for (let x = 0; x <= W; x += 2) {
      const u = x / W;
      pts.push([x, H * (0.5 - Math.sin(Math.PI * u) ** 1.2 * 0.3 * (Math.sin(u * 6.283 * k + ph) * 0.7 + 0.3 * Math.sin(u * 6.283 * k * 2.3 - ph)))]);
    }
    silver(g, pts, true, accentOf(this.presetPage));
    const star = h('button', 'pp-btn' + (it.starred ? ' starred' : ''), it.starred ? '★  IN USER' : '☆  STAR');
    star.onclick = () => src.starRoll(it.id);
    const open = h('button', 'pp-btn', 'OPEN IN OSC  →');
    open.onclick = () => this.showTab('OSC');
    right.replaceChildren(
      h('div', 'pp-head', h('span', 'ob-bar'), h('span', 'pp-title', 'PREVIEW')),
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
      g.fillStyle = '#030303';
      g.fillRect(0, 0, W, H);
      const body = g.createLinearGradient(3, 0, W - 3, 0);
      body.addColorStop(0, '#0e0e10');
      body.addColorStop(0.5, '#1c1c1f');
      body.addColorStop(1, '#0b0b0c');
      g.fillStyle = body;
      g.fillRect(3, 3, W - 6, H - 6);
      const light = g.createLinearGradient(0, 3, 0, H - 3);
      light.addColorStop(0, 'rgba(255,255,255,0.08)');
      light.addColorStop(0.5, 'rgba(255,255,255,0)');
      light.addColorStop(1, 'rgba(0,0,0,0.4)');
      g.fillStyle = light;
      g.fillRect(3, 3, W - 6, H - 6);
      g.fillStyle = 'rgba(255,255,255,0.035)';
      for (let i = 0; i < 18; i++) g.fillRect(6, 8 + (i * (H - 16)) / 17, W - 12, 1);
      const cy = 7 + (1 - v) * (H - 14);
      g.save();
      for (const [hh, a, b] of [[9, 0.25, 12], [3.5, 1, 5]]) {
        g.fillStyle = '#d6d6d6';
        g.globalAlpha = a;
        g.shadowColor = '#ffffff';
        g.shadowBlur = b;
        g.fillRect(4, cy - hh / 2, W - 8, hh);
      }
      g.restore();
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
    // Touch: how much playing harder makes notes louder and brighter (drag sideways); the tick
    // shows how hard the last note was played.
    const touchP = getParam('voice.velocity')!;
    const touchFill = h('span', 'kb-touch-fill');
    const touch = h('span', 'kb-touch', touchFill, this.velTick);
    touch.title = 'Touch: how much playing harder makes notes louder and brighter. 0 = every note the same. Drag sideways; the tick is your last note.';
    this.watch(['voice.velocity'], () => { touchFill.style.width = `${Math.round(this.num('voice.velocity') * 100)}%`; });
    let tx0 = 0, tv0 = 0;
    touch.addEventListener('pointerdown', (e) => {
      touch.setPointerCapture(e.pointerId);
      tx0 = e.clientX;
      tv0 = this.num('voice.velocity');
    });
    touch.addEventListener('pointermove', (e) => {
      if (!touch.hasPointerCapture(e.pointerId)) return;
      const v = Math.max(touchP.min!, Math.min(touchP.max!, tv0 + (e.clientX - tx0) / (touch.offsetWidth || 44)));
      this.set('voice.velocity', Math.round(v * 100) / 100);
    });
    touch.addEventListener('pointerup', (e) => touch.releasePointerCapture(e.pointerId));
    touch.addEventListener('dblclick', () => this.set('voice.velocity', touchP.default as number));
    const side = h('div', 'kb-side',
      h('div', 'kb-wheels', h('div', 'kb-w', pitch, h('span', 'kb-w-label', 'Pitch')), h('div', 'kb-w', mod, h('span', 'kb-w-label', 'Mod'))),
      h('div', 'kb-info',
        h('span', 'kb-label', 'OCTAVE'), h('div', 'kb-oct-row', down, octave, up),
        h('span', 'kb-label', 'MOVE'), move,
        h('span', 'kb-label', 'TOUCH'), touch));
    return h('div', 'kb-strip', side, this.keysEl);
  }

  // ------------------------------------------------------------------ the page

  /** The header's scene (code-drawn for now; a painted image can replace it). */
  private build(): void {
    this.page.style.setProperty('--dust', `url(${panelTexture()})`);
    this.page.style.setProperty('--light-grain', `url(${lightGrain()})`);
    this.page.style.setProperty('--key-grime', `url(${keyGrime()})`);
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
    void cap;
    void this.wobbleBox; // the wobble moves to its own place later (owner's call); until then it lives in "All controls"
    // Two rows of four boxes: OSC A, OSC B, amp envelope, filter; sub, noise, wobble, filter envelope.
    this.oscPage = h('div', 'v2-main osc-page',
      this.oscStrip(1), this.oscStrip(2), this.envBox('amp_env', 'AMP ENVELOPE', 'c-src box-amp'), this.filterBox(),
      this.subStrip(), this.noiseStrip(), this.scopeBox(), this.envBox('mod_env', 'FILTER ENVELOPE', 'c-flt box-fenv'));
    this.modPage = this.buildModPage();
    this.fxPage = this.buildFxPage();
    this.presetPage.style.display = 'none';
    this.modPage.style.display = 'none';
    this.fxPage.style.display = 'none';
    this.page.append(
      h('div', 'v2-top', h('div', 'v2-brand', h('span', 'brand-name', 'The Grimm'), h('span', 'brand-sub', 'Synthesizer')), this.presetSelector(), h('div', 'v2-top-right', tabs, this.zoomBtn)),
      this.oscPage,
      this.modPage,
      this.fxPage,
      this.presetPage,
      this.bottomBar(),
      this.keyboardStrip(),
      h('div', 'film'),
    );
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
