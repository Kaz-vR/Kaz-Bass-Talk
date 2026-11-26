// The synth page (the owner's darkroom layout): the sources as channel strips on the left, a live
// oscilloscope above the amp envelope, the filter with its envelope, the dirt chain and the mod
// wheel, and the play bar. Three knob sizes carry the weight (big for what matters most). It edits
// the same patch as the full parameter view under it (opened with "All controls"), so both always
// show the same values.
import { Biquad, ENV_ATTACK_BEND, ENV_FALL_BEND, envSegment } from '../engine/core/dsp';
import { fromNormalized, getParam, params, toNormalized, type ParamValue, type Patch } from '../schema';
import { formatValue } from './params-panel';
import { DRIVE_FAMILIES, RUIN_RECIPES, recipeParams, stageParams, type RuinStage } from './ruin-recipes';
import { corrosionTexture, frameTexture, keyGrime, lightGrain, logoWear, panelTexture, woodTexture } from './texture';
import logoSvg from '../../design/logo.svg?raw';
import { GRIND_BEAT_NAMES, grindBeat, grindHz, unpackBells, unpackPhaser } from '../engine/core/grind';
import { BELL_ARCHETYPES, type BellArchetype, rollBells } from './bells-roll';
import { WOB_MAX_POINTS, WOB_RANDOM_STEPS, WOB_TABLE, WOB_TEMPLATES, wobPointsAt, wobSmoothRadius, wobSmoothTable, wobTableAt, type WobPoint } from '../engine/core/wobshape';
import { toHex } from './color';

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
  /** Download every ★ User sound as one file (data/user-sounds.json builds them into the synth). */
  exportUser: () => void;
  removeRoll: (id: number, from: 'rolls' | 'user') => void;
  pick: (shelf: string, index: number) => void;
  step: (dir: number) => void;
}

type Sort = 'bank' | 'name' | 'template' | 'hard' | 'bright' | 'moving';
const SORTS: [Sort, string][] = [['bank', 'BANK ORDER'], ['name', 'NAME'], ['template', 'TEMPLATE'], ['hard', 'SOFT → HARD'], ['bright', 'DARK → BRIGHT'], ['moving', 'STILL → MOVING']];
const fval = (it: PresetItem, k: string) => Math.max(0, Math.min(1, Number(it.features[k] ?? 0.5)));
type Size = 'big' | 'mid' | 'small' | 'lg' | 'tiny';
type Zone = 'src' | 'flt' | 'dirt' | 'mat';

const DESIGN_WIDTH = 1200;
/** The wooden side panels either side of the page (the owner's own images: L2 left, R2 right). */
const WOOD = 67 + 36; // the panel and the dark gap between it and the boxes, as in the owner's reference
const ZOOMS = [1, 1.25, 1.5];
const ZOOM_KEY = 'lowtalk.zoom';
const FS = 48000;
// One dial size everywhere (the owner's call: same size, big enough to read at a glance).
const PX: Record<Size, number> = { big: 40, mid: 40, small: 40, lg: 46, tiny: 30 };

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
  return (el.isConnected && toHex(getComputedStyle(el).getPropertyValue('--knob-accent').trim())) || INK;
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

/** The colour darkened towards black (k = 1 unchanged): a dimmer line in the same hue. */
function shade(hex: string, k: number): string {
  if (!hex.startsWith('#')) return hex;
  const v = parseInt(hex.slice(1, 7), 16), f = (sh: number) => Math.round(((v >> sh) & 255) * k).toString(16).padStart(2, '0');
  return `#${f(16)}${f(8)}${f(0)}`;
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

/** A curve's bend dot: a small ring on the middle of its segment (as on Serum's envelopes). */
function bendDot(g: CanvasRenderingContext2D, x: number, y: number, hot = false): void {
  const col = accentOf(g.canvas);
  g.save();
  g.shadowColor = col;
  g.shadowBlur = hot ? 10 : 6;
  g.fillStyle = '#060607';
  g.strokeStyle = hot ? '#ffffff' : col;
  g.lineWidth = 1.3;
  g.beginPath();
  g.arc(x, y, hot ? 3.6 : 2.8, 0, 2 * Math.PI);
  g.fill();
  g.stroke();
  g.restore();
}

/** A round glowing lamp (the darkroom's safelight) used for every on/off light. */
/** Scroll a list so `el` sits in its middle, without moving the window (scrollIntoView would). */
function centerIn(list: Element | null, el: HTMLElement): void {
  if (!list) return;
  const l = list as HTMLElement;
  l.scrollTop = el.offsetTop - l.offsetTop - (l.clientHeight - el.offsetHeight) / 2;
}

/** Small line icons for the header (drawn in SVG so they stay sharp at every zoom). */
function icon(kind: 'prev' | 'next' | 'undo' | 'redo' | 'save'): SVGSVGElement {
  const paths: Record<typeof kind, string> = {
    prev: 'M9.5 3.5 5 8l4.5 4.5',
    next: 'M6.5 3.5 11 8l-4.5 4.5',
    undo: 'M5.5 3.5 2.5 6.5l3 3M2.8 6.5h6.7a3.5 3.5 0 0 1 0 7H7',
    redo: 'M10.5 3.5l3 3-3 3M13.2 6.5H6.5a3.5 3.5 0 0 0 0 7H9',
    save: 'M3 2.5h8l2.5 2.5v8.5h-11zM5.5 2.5v3.5h5V2.5M5 13.5V9.5h6v4',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', `ico ico-${kind}`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[kind]);
  svg.append(path);
  return svg;
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
    case 'warm sine': return 0.86 * (Math.sin(2 * Math.PI * x) + 0.3 * Math.sin(4 * Math.PI * x));
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
    default: return saw;
  }
}

/**
 * Dial looks to choose from (owner's review): 'ref' (the reference's knurled cap with a tick
 * above), 'photo' (lit like a real object), 'silver' (brushed aluminium), 'flat' (minimal) and
 * 'glass' (a dark glass dome), 'scale' (a printed tick scale around a machined cap). Same geometry: the
 * value shows outside the cap.
 */
function drawKnobVariant(g: CanvasRenderingContext2D, style: string, k: { cx: number; cy: number; r: number; n: number; av: number; zero: number; a0: number; a1: number; accent: string; off: boolean; noValue?: boolean; body?: string }): void {
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
    // (a modulation ring on the dial takes the value arc's place, as in Serum)
    if (Math.abs(av - zero) > 0.02 && !k.noValue) {
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
      // owner's reference: a grey cap lighter than the box so it stands out, a dark gap round it,
      // lit softly from above
      circle(kr + 0.8, '#040405');
      // the cap's colour is the page's --knob-body (default #222225), lit 9 levels lighter on top and 9 darker at the edge
      const bc = /^#[0-9a-f]{6}$/i.test(k.body ?? '') ? k.body! : '#222225';
      const shade = (d: number) => '#' + [1, 3, 5].map((i) => Math.max(0, Math.min(255, parseInt(bc.slice(i, i + 2), 16) + d)).toString(16).padStart(2, '0')).join('');
      const body = g.createRadialGradient(cx, cy - kr * 0.25, kr * 0.1, cx, cy, kr);
      body.addColorStop(0, shade(9));
      body.addColorStop(0.7, bc);
      body.addColorStop(1, shade(-9));
      circle(kr, body);
      g.save();
      const edge = g.createLinearGradient(cx, cy - kr, cx, cy + kr);
      edge.addColorStop(0, 'rgba(255,255,255,0.22)');
      edge.addColorStop(1, 'rgba(255,255,255,0.05)');
      g.strokeStyle = edge;
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
/** The drive types in columns, gentle to destroyed. */
const DRIVE_GROUPS: [string, string[]][] = [
  ['WARM', ['tape', 'tube', 'starved', 'amp']], ['CLIP', ['soft clip', 'hard clip', 'diode']], ['BREAK', ['wavefold', 'rectify']], ['DIGITAL', ['downsample']],
];

/** The RUIN page's live view of the chain (EngineHost.ruinTaps). */
export interface RuinTapsView {
  spec: Float32Array[];
  rms: number[];
  peak: number[];
  binHz: number;
}

/** A spectrum (dB per bin) as points across a print, 20 Hz … 20 kHz log, lo … hi dB bottom to top (the loudest bin per column). */
function ruinSpecPts(spec: Float32Array, binHz: number, W: number, H: number, lo: number, hi: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= W; x += 2) {
    const f0 = 20 * Math.pow(1000, x / W), f1 = 20 * Math.pow(1000, (x + 2) / W);
    let b0 = Math.floor(f0 / binHz), b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz));
    b0 = Math.max(1, b0);
    b1 = Math.min(spec.length, b1);
    let m = -200;
    for (let b = b0; b < b1; b++) if (spec[b] > m) m = spec[b];
    // a gentle tilt (+4.5 dB / octave around 1 kHz) so a bass doesn't fill the print and the top still shows
    m += 4.5 * Math.log2(f0 / 1000);
    pts.push([x, H - Math.max(0, Math.min(1, (m - lo) / (hi - lo))) * H]);
  }
  return pts;
}

/** One sine cycle through a drive type at a healthy drive, as an SVG path (22 x 12) for its menu entry and tile. */
function driveIconPath(type: string): string {
  const W = 22, H = 12, N = 44, g = 3;
  const th = Math.tanh;
  const f = (x: number): number => {
    const u = g * x;
    switch (type) {
      case 'tape': return (u + 0.08) / Math.sqrt(1 + (u + 0.08) ** 2);
      case 'tube': return th(u + 0.2) - th(0.2);
      case 'amp': return th(1.6 * u + 0.3) - th(0.3);
      case 'soft clip': { const v = Math.max(-1, Math.min(1, u / 1.5)); return 1.5 * v - 0.5 * v * v * v; }
      case 'hard clip': return Math.max(-1, Math.min(1, u / 1.6));
      case 'diode': return u >= 0 ? th(u) : 0.5 * th(2 * u);
    case 'starved': return u > 0.08 ? th(u - 0.08) : u < -0.25 ? 0.7 * th(u + 0.25) : 0;
      case 'wavefold': return Math.sin(1.7 * u);
      case 'rectify': return 2 * Math.abs(th(u)) - 1;
      default: return x;
    }
  };
  const pts: string[] = [];
  let peak = 0;
  const ys: number[] = [];
  for (let i = 0; i <= N; i++) {
    let ph = i / N;
    if (type === 'downsample') ph = Math.floor(ph * 7) / 7; // held steps
    const y = f(Math.sin(2 * Math.PI * ph));
    ys.push(y);
    peak = Math.max(peak, Math.abs(y));
  }
  ys.forEach((y, i) => pts.push(`${i ? 'L' : 'M'}${((i / N) * W).toFixed(1)},${(H / 2 - (y / (peak || 1)) * (H / 2 - 1)).toFixed(1)}`));
  return pts.join('');
}

/** A small picture of a RUIN filter type's curve (22 x 12), for its tile. */
function filterIconPath(type: string): string {
  const W = 22, H = 12, N = 60, ys: number[] = [];
  for (let i = 0; i <= N; i++) {
    const x = i / N, d = x - 0.5;
    const sig = (z: number) => 1 / (1 + Math.exp(-z));
    if (BELL_TYPES.includes(type) || type === 'bells') {
      ys.push(type === 'low cut 48' ? sig((x - 0.4) * 40) : type === 'low cut 12' ? sig((x - 0.4) * 14) : type === 'low shelf' ? 1.6 - 0.6 * sig((x - 0.45) * 18)
        : type === 'bell' ? 1 + 0.9 * Math.exp(-(d * d) / 0.01) : type === 'notch' ? 1 - Math.exp(-(d * d) / 0.004)
        : type === 'band' ? 0.15 + 0.85 * Math.exp(-(d * d) / 0.012) : type === 'comb' ? 0.55 + 0.45 * Math.cos(x * Math.PI * 8)
        : type === 'phaser' ? 1 - 0.8 * Math.exp(-((x - 0.33) ** 2) / 0.003) - 0.8 * Math.exp(-((x - 0.66) ** 2) / 0.003)
        : type === 'high shelf' ? 1 + 0.6 * sig((x - 0.55) * 18) : type === 'high cut 12' ? sig((0.6 - x) * 14) : type === 'high cut 48' ? sig((0.6 - x) * 40)
        : 1 + 0.5 * Math.exp(-((x - 0.2) ** 2) / 0.003) - 0.6 * Math.exp(-((x - 0.45) ** 2) / 0.002) + 0.5 * Math.exp(-((x - 0.7) ** 2) / 0.004));
      continue;
    }
    ys.push(type === 'notch' ? 1 - Math.exp(-(d * d) / 0.004) : type === 'peak' ? 1 + 1.2 * Math.exp(-(d * d) / 0.008)
      : type === 'band' ? 0.25 + 0.75 * Math.exp(-(d * d) / 0.02) : type === 'comb' ? 0.55 + 0.45 * Math.cos(x * Math.PI * 8)
      : 1 - 0.8 * Math.exp(-((x - 0.33) ** 2) / 0.003) - 0.8 * Math.exp(-((x - 0.66) ** 2) / 0.003));
  }
  const lo = Math.min(...ys, 0), hi = Math.max(...ys, 1.2);
  return ys.map((y, i) => `${i ? 'L' : 'M'}${((i / N) * W).toFixed(1)},${(H - 1 - ((y - lo) / (hi - lo)) * (H - 2)).toFixed(1)}`).join('');
}

/** BELLS: a band's types, as EQ Eight's (grind<n>.bell<b>_type order). */
const BELL_TYPES = ['low cut 48', 'low cut 12', 'low shelf', 'bell', 'notch', 'high shelf', 'high cut 12', 'high cut 48', 'band', 'comb', 'phaser'];
/** A band type with no gain (the cuts and the notch). */
const bellNoGain = (t: string): boolean => t.includes('cut') || t === 'notch' || t === 'band' || t === 'phaser';
/** A band type with no Q (the comb: its Gain is how hard it rings). */
const bellNoQ = (t: string): boolean => t === 'comb';

/** The LFO history: samples a second, and how many (40 s). */
const LFO_HIST_HZ = 30, LFO_HIST = 40 * LFO_HIST_HZ;
/** The shapes that never repeat: their print is their real recent path, scrolling, not a picture of a cycle. */
const LFO_RANDOM = new Set(['wander', 'drift', 'slow drift', 'sample_hold', 'random']);

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

const LFO_SHAPE: Record<string, string> = { sine: 'SINE', triangle: 'TRIANGLE', saw_up: 'SAW UP', saw_down: 'SAW DOWN', square: 'SQUARE', sample_hold: 'RANDOM STEPS', wander: 'HUMANIZE', bloom: 'BLOOM', drop: 'DROP', random: 'RANDOM ON TRIGGER', drift: 'DRIFT', 'slow drift': 'SLOW DRIFT', drift_down: 'DRIFT DOWN', vibrato: 'SINE VIBRATO', vib_triangle: 'TRIANGLE VIBRATO', vib_saw_up: 'SAW UP VIBRATO', vib_saw_down: 'SAW DOWN VIBRATO', vib_square: 'SQUARE VIBRATO' };
/** The LFO shape menu (owner's list): SHAPES that repeat, OTHER that wander, hold or fall. */
/** The shapes that always restart on every note (the one shots and VIBRATO): Retrig does nothing on them. */
const VIB_SHAPES = new Set(['vibrato', 'vib_triangle', 'vib_saw_up', 'vib_saw_down', 'vib_square']);
const K_ALWAYS_PER_NOTE = new Set(['random', 'drop', 'drift_down', ...VIB_SHAPES]);
/** A vibrato wave (as the engine's vibWave), -1..1 at x through the cycle. */
const vibWaveUi = (shape: string, x: number): number => {
  const p = x - Math.floor(x);
  switch (shape) {
    case 'vib_triangle': { const q = (p + 0.25) % 1; return q < 0.5 ? 4 * q - 1 : 3 - 4 * q; }
    case 'vib_saw_up': return 2 * p - 1;
    case 'vib_saw_down': return 1 - 2 * p;
    case 'vib_square': return p < 0.5 ? 1 : -1;
    default: return Math.sin(2 * Math.PI * p);
  }
};
const LFO_SHAPE_GROUPS: [string, string[]][] = [
  ['SHAPES', ['sine', 'triangle', 'saw_up', 'saw_down', 'square']],
  ['OTHER', ['wander', 'sample_hold']],
  ['ONE SHOTS', ['random', 'drop', 'drift_down']],
  ['MOD WHEEL', ['vibrato', 'vib_triangle', 'vib_saw_up', 'vib_saw_down', 'vib_square']],
];
/** A little picture of an LFO shape for its menu (22 x 12), as the RUIN band types have. */
function lfoIconPath(shape: string): string {
  const W = 22, H = 12, N = 44, ys: number[] = [];
  const steps = [0.7, 0.2, 0.9, 0.4, 0.6, 0.1];
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    let y: number;
    switch (shape) {
      case 'sine': y = 0.5 + 0.5 * Math.sin(2 * Math.PI * x); break;
      case 'triangle': y = 1 - Math.abs(((2 * x + 0.5) % 2) - 1); break;
      case 'saw_up': y = (2 * x) % 1; break;
      case 'saw_down': y = 1 - ((2 * x) % 1); break;
      case 'square': y = (2 * x) % 1 < 0.5 ? 1 : 0; break;
      case 'sample_hold': y = steps[Math.min(5, Math.floor(x * 6))]; break;
      case 'wander': y = 0.5 + 0.3 * Math.sin(5.1 * x) + 0.18 * Math.sin(13.7 * x + 1) + 0.1 * Math.sin(29 * x); break;
      case 'random': y = x < 0.08 ? 0.5 : 0.78; break;
      case 'drop': y = (1 - x) * (1 - x); break;
      case 'drift_down': y = 1 - Math.min(1, Math.pow(x, 2.5) + 0.03 * x * Math.sin(2 * Math.PI * 5.3 * x)); break;
      case 'vibrato': case 'vib_triangle': case 'vib_saw_up': case 'vib_saw_down': case 'vib_square': y = 0.5 + 0.42 * vibWaveUi(shape, 4 * x) * Math.min(1, x * 1.6); break;
      default: y = 0.5;
    }
    ys.push(y);
  }
  return ys.map((y, i) => `${i ? 'L' : 'M'}${((i / N) * W).toFixed(1)},${(H - 1 - y * (H - 2)).toFixed(1)}`).join('');
}
/** What LFO 1-4 can move (owner's call: the LFO page's targets, no matrix). */
const LFO_TARGETS: [string, string[]][] = [
  ['NONE', ['none']],
  ['VOLUME', ['amp', 'osc12_level', 'osc1_level', 'osc2_level', 'sub_level', 'texture_level']],
  ['FILTER', ['lfo_filter', 'lfo_filter_ab', 'lfo_filter_a', 'lfo_filter_b', 'lfo_filter_sub', 'lfo_filter_noise', 'filter_resonance']],
  ['PITCH', ['pitch', 'osc_pitch', 'osc1_pitch', 'osc2_pitch', 'sub_pitch']],
];
/** LFO targets as the title row names them (owner's list). */
const LFO_TARGET_NAME: Record<string, string> = {
  none: 'NONE',
  amp: 'VOLUME', osc12_level: 'A+B VOLUME', osc1_level: 'A VOLUME', osc2_level: 'B VOLUME', sub_level: 'SUB VOLUME', texture_level: 'NOISE VOLUME',
  lfo_filter: 'FILTER', lfo_filter_ab: 'A+B FILTER', lfo_filter_a: 'A FILTER', lfo_filter_b: 'B FILTER', lfo_filter_sub: 'SUB FILTER', lfo_filter_noise: 'NOISE FILTER',
  filter_cutoff: 'CUTOFF', filter_resonance: 'RESONANCE', drive: 'FILTER DRIVE',
  osc1_detune: 'A DETUNE', osc2_detune: 'B DETUNE', unison_detune: 'A+B DETUNE',
  dist_tone: 'FX DRIVE TONE', dist_mix: 'FX DRIVE MIX', crush_mix: 'CRUSH MIX', tape_wow: 'TAPE WOW', chorus_depth: 'CHORUS DEPTH',
  phaser_mix: 'PHASER MIX', reverb_mix: 'REVERB MIX',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((k) => [`lfo${k}_rate`, `LFO ${k} RATE`])),
  pitch: 'PITCH', osc_pitch: 'A+B PITCH', osc1_pitch: 'A PITCH', osc2_pitch: 'B PITCH', sub_pitch: 'SUB PITCH',
  osc12_shape: 'A+B SHAPE', osc1_pw: 'A SHAPE', osc2_pw: 'B SHAPE',
  ruin_drives: 'ALL RUIN DRIVES', dist_drive: 'FX DRIVE',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((k) => [`ruin_drive${k}`, `RUIN DRIVE ${k}`])),
};
/** The RUIN boxes' slot parameters (which box holds a drive decides the DRIVE targets). */
/** The custom LFO's three targets and their signed depths (owner's call). */
// the four custom LFOs' parameter prefixes (owner's call), and each one's four targets
const WOB_PREFIXES = ['wobble', 'wobble2', 'wobble3', 'wobble4'];
const wobDests = (W: string) => [`${W}.dest`, `${W}.dest2`, `${W}.dest3`, `${W}.dest4`];
const wobAmts = (W: string) => [1, 2, 3, 4].map((k) => `${W}.amt${k}`);
const wobOffs = (W: string) => [1, 2, 3, 4].map((k) => `${W}.offset${k}`);
const wobTargetIds = (W: string) => [...wobDests(W), ...wobAmts(W), ...wobOffs(W), `${W}.master`];
const RUIN_SLOT_IDS = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => `grind.slot${k}`);
/** Every dial an LFO can be connected to (owner's rule: every dial on the pages; the dest menus' 'p:' options). */
const DIAL_TARGETS = new Set(getParam('mod1.dest')!.options!.filter((o) => o.startsWith('p:')).map((o) => o.slice(2)));
/** Beats in a note value like 1/4, 1/8D or 1/16T. */
function syncBeats(v: string): number {
  const m = /^(\d+)\/(\d+)([DT]?)$/.exec(v);
  if (!m) return 1;
  const b = (4 * Number(m[1])) / Number(m[2]);
  return m[3] === 'D' ? b * 1.5 : m[3] === 'T' ? (b * 2) / 3 : b;
}
/** OSC page prints: one height for all; widths follow the box (beside a side column, the amp box, the wide box). */
/** The shelves' colours on the PRESETS page, in shelf order. */
/** Options kept only as placeholders (removed, owner's call): never offered in a menu. */
const RETIRED = new Set<string>(); // options kept in the data but never offered (none right now: formant came back, owner's call)

const SHELF_COLOURS = ['#ff2a14', '#ff6a1a', '#e8b46a', '#3fe3b6', '#9a7cff', '#5f9bff', '#a9dcff', '#ff6fae', '#d4d4da'];
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
  /** Whether the modulator is on (off = no ring); and what else to redraw on. */
  on?: () => boolean;
  deps?: string[];
}
/** The filter envelope → cutoff: ±1 is ±6 octaves on a 20 Hz – 20 kHz log dial (the amount reaches ±1.661: the whole dial). */
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
  onUndo: () => void = () => {};
  onRedo: () => void = () => {};
  /** Save the sound on screen as your own preset (it lands in ★ User). */
  onSave: () => void = () => {};
  private readonly undoBtn = h('button', 'hist-btn');
  private readonly redoBtn = h('button', 'hist-btn');
  private readonly saveBtn = h('button', 'save-btn');
  onWheel: (v: number) => void = () => {};
  onPitch: (v: number) => void = () => {};
  onOctave: (dir: number) => void = () => {};
  presets: PresetSource | null = null;
  private readonly menu = h('div', 'pre-menu');
  private menuShelf = '';
  private oscPage: HTMLElement | null = null;
  // The envelope balls: when the newest note started and was released (ms), notes held, redraws.
  private noteT0 = -1;
  /** The newest note played (for RUIN's KEY on the page). */
  private lastNote = 48;
  /** A note is sounding (held, or still in its amp release). */
  private noteSounding(): boolean {
    return this.noteT0 >= 0 && (this.relT0 < 0 || performance.now() - this.relT0 < this.num('amp_env.release') + 50);
  }
  /** RUIN's KEY factor for the newest note, as the engine has it (Freq is where a stage sits at C3). */
  private ruinKey(): number {
    return this.get('grind.key') ? Math.pow(2, (this.lastNote + 12 * this.num('voice.octave') - 48) / 12) : 1;
  }
  private relT0 = -1;
  private held = 0;
  private dotRaf = 0;
  private readonly dotDraws: (() => void)[] = [];
  /**
   * The MOD page's prints that move while a note sounds (dots along the LFOs, the pitch
   * envelope and vibrato; the matrix's amount bars), and the clock they read: seconds since the note started and since it
   * was released (-1 while held), and the amp envelope's level right now.
   */
  private readonly animDraws: { el: HTMLElement; f: () => void; free?: () => boolean }[] = [];
  /**
   * The LFOs and drifts run all the time, not only while a note sounds, so their dots and matrix
   * bars keep moving whenever they are on screen (30 fps; the envelopes still wait for a note).
   */
  private liveLfo: { phase: number[]; value: number[] } | null = null;
  private readLfos: (() => { phase: number[]; value: number[] }) | null = null;
  /** Wraps of each LFO's phase seen so far, to place its dot across the cycles its print shows. */
  private readonly lfoCycles = [0, 0, 0, 0, 0, 0];
  /**
   * What each LFO really did lately (owner's rule: an LFO always looks like what it is doing): the
   * engine's value 30 times a second for the last 40 s, so the random shapes draw their real path.
   */
  private readonly lfoHist = Array.from({ length: 6 }, () => new Float32Array(LFO_HIST));
  private lfoHistAt = 0;
  private lfoHistLast = 0;
  /** Until when (ms) a retriggered LFO's restart is expected: its phase drop is the restart, not a cycle. */
  private readonly lfoRetrigUntil = [0, 0, 0, 0, 0, 0];

  /** The engine's real LFO phases and values (the dots and bars follow them, as the Wobbler's dot does). */
  setLiveLfos(read: () => { phase: number[]; value: number[] }): void {
    this.readLfos = read;
    let frame = 0;
    const step = () => {
      if (frame++ % 2 === 0) {
        const v = this.readLfos?.() ?? null;
        if (v && this.liveLfo) {
          const now = performance.now();
          for (let l = 0; l < 6; l++) {
            const restart = now < this.lfoRetrigUntil[l];
            // a drop in phase is a new cycle, or (just after a note) the retrigger's restart
            if (v.phase[l] < this.liveLfo.phase[l] - (restart ? 0.02 : 0.5)) {
              if (restart) {
                this.lfoCycles[l] = 0;
                this.lfoRetrigUntil[l] = 0;
              } else this.lfoCycles[l]++;
            }
          }
        }
        this.liveLfo = v;
        if (v) {
          const now = performance.now();
          // 30 samples a second, however fast the screen refreshes (a long gap is filled with the last value)
          // the first reading fills the whole history, so the line starts where the LFO is, not at 0
          if (this.lfoHistLast === 0) for (let l = 0; l < 6; l++) this.lfoHist[l].fill(v.value[l]);
          // after a long gap (a hidden tab) pick up from now
          if (now - this.lfoHistLast > 2000) this.lfoHistLast = now - 1000 / LFO_HIST_HZ;
          let k = Math.floor((now - this.lfoHistLast) / (1000 / LFO_HIST_HZ));
          if (k > 0) {
            this.lfoHistLast += k * (1000 / LFO_HIST_HZ);
            // what the LFO really does to the sound: its value times its fade-in from the last note
            // (owner's call: the fade lives in the same line, flat at each note and growing back)
            const tNote = this.anim.on ? (now - this.noteT0) / 1000 : Infinity;
            const faded = [0, 1, 2, 3, 4, 5].map((l) => {
              const f = this.num(`lfo${l + 1}.fade`) / 1000;
              return f > 0 ? Math.min(1, tNote / f) : 1;
            });
            for (; k > 0; k--) {
              this.lfoHistAt = (this.lfoHistAt + 1) % LFO_HIST;
              for (let l = 0; l < 6; l++) this.lfoHist[l][this.lfoHistAt] = v.value[l] * faded[l];
            }
          }
        }
        if (!this.anim.on) for (const a of this.animDraws) if (a.free?.() && a.el.offsetParent !== null) a.f();
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  private readonly anim = { on: false, t: 0, rel: -1, amp: 0 };
  private animFrame = 0;
  /** The engine's live filter (what the print shows while notes sound), and the prints that draw it. */
  private liveFilter: { cutoff: number; res: number } | null = null;
  private readonly liveDraws: (() => void)[] = [];
  private modPage: HTMLElement | null = null;
  private lfoPage: HTMLElement | null = null;
  /** The wobble's live phase (0..1) and what draws it. */
  /** Each custom LFO's phase from the engine (0..1, null when it does nothing or nothing sounds). */
  private liveWobs: (number | null)[] = [null, null, null, null];
  private readonly wobDraws: (() => void)[] = [];
  private fxPage: HTMLElement | null = null;
  private grindPage: HTMLElement | null = null;
  /** GRIND: which stages ROLL / VARY leave alone, how wild a roll is, the last rolls (newest first). */
  private readonly grindLocks = [false, false, false, false, false, false, false, false];
  private grindWeird = 0.3;
  /** Every WEIRD slider on the RUIN page (the RUIN box's and each filter's: one value), redrawn together. */
  private readonly weirdViews: (() => void)[] = [];
  /** Each filter's archetype for its dice (BELLS). */
  private readonly grindArch: BellArchetype[] = Array(8).fill('any');
  /** The recipe the last ROLL started from (shown on the ROLL button). */
  private grindRecipe = '';
  /** How many stages ROLL uses: 0 = random (AUTO), 1-4. */
  private grindCount = 0;
  /** Each GRIND stage's filter frequency right now (from the engine, -1 when silent) and the prints that follow it. */
  private readonly grindLive = [-1, -1, -1, -1, -1, -1, -1, -1];
  private readonly grindLiveRes = [0, 0, 0, 0, 0, 0, 0, 0];
  /** Each phaser's live L / R LFO, packed (-1 off). */
  private readonly phaserLive = [-1, -1, -1, -1, -1, -1, -1, -1];
  /** Each RUIN EQ's selected band (0-3). */
  private readonly ruinEqSel = [1, 1, 1, 1, 1, 1, 1, 1];
  /** BELLS: the selected bell per filter (its Freq / Gain / Q on the dials). */
  private readonly ruinBellSel = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly grindLiveDraws: (() => void)[] = [];
  /** The RUIN page: the selected box (0 filter 1, 1 drive 1 … 7 drive 4) and the engine's taps right now. */
  private ruinSel = 0;
  private ruinTaps: RuinTapsView | null = null;
  private ruinRead: (() => RuinTapsView | null) | null = null;
  private ruinSelect: (k: number) => void = () => {};
  private ruinFrame: () => void = () => {};
  private ruinTick = 0;
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
    // the wooden sides, generated (owner's call: like the reference, no image): weathered dark red-brown boards
    for (const side of ['l', 'r']) this.page.append(h('div', `wood wood-${side}`));
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
      const s = Math.max(0.4, Math.min(this.zoom, root.clientWidth / (DESIGN_WIDTH + 2 * WOOD), tall));
      this.page.style.transform = `scale(${s})`;
      this.page.style.marginLeft = `${Math.max(0, (root.clientWidth - (DESIGN_WIDTH + 2 * WOOD) * s) / 2) + WOOD * s}px`;
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
    // repaint every control (a dev colour tuner changes the boxes' colours; the dials only redraw on a value change)
    window.addEventListener('ruin:repaint', () => { for (const v of this.allViews) v(); });
    requestAnimationFrame(fit);
  }

  // ------------------------------------------------------------------ state

  /** Show a whole patch (a preset was loaded). */
  show(patch: Patch): void {
    this.values = { ...(patch as unknown as Record<string, ParamValue>) };
    this.tapeLast = ''; // a new sound: its tape is a machine only if its dials match one
    for (const v of this.allViews) v();
    if (this.presetPage.isConnected && this.presetPage.style.display !== 'none') this.markCurrent();
  }

  /** The rolls or starred sounds changed: redraw the PRESETS page if it's showing. */
  refreshPresets(): void {
    if (this.presetPage.style.display !== 'none' && this.presetPage.isConnected) this.renderPresetPage();
  }

  /** A note started (keyboard, MIDI or the host): the envelope balls start running. */
  noteOn(note?: number): void {
    if (note !== undefined) this.lastNote = note;
    const legato = this.held > 0 && this.num('voice.polyphony') <= 1 && !!this.get('voice.legato');
    this.held++;
    if (!legato) {
      this.noteT0 = performance.now();
      this.relT0 = -1;
      // A retriggered LFO starts its shape again: its dot goes back to the start of the print.
      for (let l = 0; l < 6; l++) {
        if (this.get(`lfo${l + 1}.retrigger`)) {
          this.lfoCycles[l] = 0;
          this.lfoRetrigUntil[l] = this.noteT0 + 200;
        }
      }
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
      this.live(() => { for (const f of this.dotDraws) f(); });
      const now = performance.now();
      // The envelopes' balls and the MOD page's moving prints run until the longest release.
      const longest = Math.max(this.num('amp_env.release'), this.num('mod_env.release'));
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
        this.live(() => { for (const f of this.dotDraws) f(); });
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


  /** The RUIN page's taps (meters, spectra). */
  setRuinTaps(read: () => RuinTapsView | null): void {
    this.ruinRead = read;
  }

  /** Follow each GRIND stage's real filter on its print (while the GRIND page shows). */
  setLiveGrind(read: () => { fc: number[]; res: number[]; ph?: number[] }): void {
    const step = () => {
      if (this.grindPage && this.grindPage.offsetParent !== null) {
        // the chain's meters and spectra, 30 times a second
        if (this.ruinRead && this.ruinTick++ % 2 === 0) {
          this.ruinTaps = this.ruinRead();
          this.ruinFrame();
        }
        const { fc: v, res, ph } = read();
        let moved = false;
        if (ph) for (let i = 0; i < 8; i++) {
          if (Math.abs(ph[i] - this.phaserLive[i]) > 0.5) {
            this.phaserLive[i] = ph[i];
            moved = true;
          }
        }
        for (let i = 0; i < 8; i++) {
          const x = v[i] > 0 ? v[i] : -1, was = this.grindLive[i];
          if ((x > 0) !== (was > 0) || (x > 0 && (Math.abs(x / was - 1) > 0.002 || Math.abs(res[i] - this.grindLiveRes[i]) > 0.003))) {
            this.grindLive[i] = x;
            this.grindLiveRes[i] = res[i];
            moved = true;
          }
        }
        if (moved) this.live(() => { for (const f of this.grindLiveDraws) f(); });
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Follow the engine's real cutoff and resonance (envelope, LFOs, wobble, keytracking…) on the filter print. */
  setLiveFilter(read: () => { cutoff: number; res: number } | null): void {
    const step = () => {
      const v = read();
      const was = this.liveFilter;
      const moved = !v !== !was || (v && was && (Math.abs(v.cutoff / was.cutoff - 1) > 0.002 || Math.abs(v.res - was.res) > 0.002));
      if (moved) {
        this.liveFilter = v;
        this.live(() => { for (const f of this.liveDraws) f(); });
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
    this.live(() => { for (const f of this.wheelViews) f(); });
  }

  /** The keyboard moved an octave (base = its lowest C as a MIDI note). */
  setOctave(base: number): void {
    this.octaveVal.textContent = `C${base / 12 - 1}`;
  }

  /** How hard the last note was played (0..1). */
  setVelocity(v: number): void {
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
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.24)';
    g.fillRect(0, 0, W, H);
    g.restore();
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
    // while a view draws, a dial an LFO moves reads where the LFO has it right now (owner's call: it is seen moving)
    if (this.liveView) {
      const m = this.dialLive.get(id);
      if (m !== undefined) return m;
    }
    return Number(this.get(id));
  }

  /** Run views with the dials where the LFOs have them right now (the live loops: dots, the live filter, RUIN). */
  private live(run: () => void): void {
    const was = this.liveView;
    this.liveView = true;
    try {
      run();
    } finally {
      this.liveView = was;
    }
  }

  /** The dials the LFOs move right now (id -> value), and whether a view is drawing (so num() reads them). */
  private dialLive = new Map<string, number>();
  private liveView = false;

  /** The engine's moved dials (parameter index -> 0..1): every view of a dial that moves or stops redraws. */
  setLiveDials(read: () => Map<number, number>): void {
    const step = () => {
      const raw = read();
      const next = new Map<string, number>();
      for (const [i, n] of raw) {
        const p = params[i];
        if (p) next.set(p.id, fromNormalized(p, n));
      }
      const changed: string[] = [];
      for (const [id, v] of next) if (this.dialLive.get(id) !== v) changed.push(id);
      for (const id of this.dialLive.keys()) if (!next.has(id)) changed.push(id);
      this.dialLive = next;
      for (const id of changed) for (const f of this.watchers.get(id) ?? []) f();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private set(id: string, v: ParamValue): void {
    if (this.values[id] === v) return;
    this.values[id] = v;
    this.onChange(id, v);
    for (const f of this.watchers.get(id) ?? []) f();
    // routing an LFO or envelope in the matrix switches it on
    const src = /^mod\d+\.source$/.test(id) && /^(lfo\d|env[23])$/.test(String(v)) ? String(v) : null;
    if (src && !this.get(`${src}.on`)) this.set(`${src}.on`, true);
    // touching the filter envelope (a dial, a point, a bend) switches it on
    if (/^mod_env\.(attack|decay|sustain|release)(_bend)?$/.test(id) && !this.get('mod_env.on')) this.fenvOn();
  }

  /** Run `view` now, whenever one of `ids` changes, and when a patch loads. */
  private watch(ids: string[], draw: () => void): void {
    // (a view always draws with the dials where the LFOs have them right now)
    const view = () => {
      const was = this.liveView;
      this.liveView = true;
      try {
        draw();
      } finally {
        this.liveView = was;
      }
    };
    for (const id of ids) {
      if (!this.watchers.has(id)) this.watchers.set(id, []);
      this.watchers.get(id)!.push(view);
    }
    this.allViews.push(view);
  }

  // ------------------------------------------------------------------ controls

  /** A dial bound to a float/int parameter. Big = the controls that matter most, small = details. */
  private knob(id: string, label: string, size: Size = 'mid', opts: { fmt?: (v: number) => string; parse?: (text: string) => number | null; disabled?: () => boolean; deps?: string[]; showValue?: boolean; mod?: KnobMod; fromMax?: boolean } = {}): HTMLElement {
    const p = getParam(id)!;
    const mod = opts.mod;
    const px = PX[size];
    const [cv, g] = canvas(px, px, 'knob');
    const val = h('div', 'k-val');
    // The value stays hidden (the dial shows enough) and appears over the name on hover / drag.
    const el = h('div', `k k-${size}${opts.showValue ? '' : ' quiet'}`, cv, h('div', 'k-label', label), val);
    el.dataset.param = id;
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
      // (a high cut lights from the right: fully right = off = no light)
      const zero = opts.fromMax ? a1 : bipolar ? a0 + (a1 - a0) * toNormalized(p, 0) : a0;
      const av = a0 + (a1 - a0) * n;
      const cs = getComputedStyle(el);
      const accent = toHex(cs.getPropertyValue('--knob-accent').trim()) || '#ff8f75';
      const kr = r - 3;
      // Alternative dial looks (picked by the page's --knob-style), else the default below.
      const style = cs.getPropertyValue('--knob-style').trim();
      // A modulation that is on takes the place of the value arc with its own lighter ring.
      const modOn = !!mod && (mod.on?.() ?? true) && Math.abs(this.num(mod.id)) > 1e-4;
      if (style && style !== 'ring') drawKnobVariant(g, style, { cx, cy, r, n, av, zero, a0, a1, accent, off, noValue: modOn, body: toHex(cs.getPropertyValue('--knob-body').trim()) });
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
      if (Math.abs(av - zero) > 0.02 && !modOn) {
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
        if (modOn && Math.abs(am - av) > 0.01) {
          g.save();
          g.lineCap = 'round';
          g.lineWidth = 2;
          g.strokeStyle = mod.color;
          g.shadowColor = mod.color;
          g.shadowBlur = 4;
          g.beginPath();
          g.arc(cx, cy, r - 1.5, Math.min(av, am), Math.max(av, am));
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
          g.arc(cx + Math.cos(al) * (r - 1.5), cy + Math.sin(al) * (r - 1.5), 1.9, 0, 2 * Math.PI);
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
    this.watch([id, ...(mod ? [mod.id, ...(mod.deps ?? [])] : []), ...(opts.deps ?? [])], draw);
    if (mod?.live) this.liveDraws.push(draw);
    return el;
  }

  /** A dropdown for an enum parameter (‹ › step through it, the name opens the list). */
  private selector(id: string, opts: { label?: (o: string) => string; deps?: string[]; groups?: [string, readonly string[]][]; only?: boolean } = {}): HTMLElement {
    const p = getParam(id)!;
    const sel = h('select', 'sel-name');
    const name = (o: string) => (opts.label ?? ((x: string) => x.replace(/_/g, ' ')))(o).toUpperCase();
    let list: string[];
    if (opts.groups) {
      // the menu in columns with headings (the dropdown draws an <optgroup> as a column)
      list = [];
      const used = new Set(opts.groups.flatMap(([, os]) => os));
      const groups = opts.groups.map(([t, os]) => [t, os.filter((o) => p.options!.includes(o))] as const);
      // (only: the groups are the whole menu; an option can sit in more than one column)
      const rest = opts.only ? [] : p.options!.filter((o) => !used.has(o) && !RETIRED.has(o));
      if (rest.length) groups[groups.length - 1][1].push(...rest);
      for (const [title, os] of groups) {
        const og = document.createElement('optgroup');
        og.label = title;
        for (const o of os) {
          og.append(new Option(name(o), o));
          if (!list.includes(o)) list.push(o);
        }
        sel.append(og);
      }
    } else {
      list = p.options!.filter((o) => !RETIRED.has(o));
      for (const o of list) sel.append(new Option(name(o), o));
    }
    const pick = (to: string) => {
      if (String(this.get(id)) !== to) this.set(id, to);
    };
    sel.onchange = () => pick(sel.value);
    const step = (d: number) => {
      const i = list.indexOf(String(this.get(id)));
      pick(list[(i + d + list.length) % list.length]);
    };
    const prev = h('button', 'sel-btn', '‹');
    const next = h('button', 'sel-btn', '›');
    prev.onclick = () => step(-1);
    next.onclick = () => step(1);
    const el = h('div', 'sel', sel, prev, next);
    el.title = `${p.label}: ${p.describes}`;
    this.watch([id, ...(opts.deps ?? [])], () => {
      // by each option's own value (an option can sit in more than one column)
      for (const o of sel.options) o.text = name(o.value);
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

  /**
   * A lamp switch that can't be on together with `other`: switching it on switches `other` off.
   * Used for Direct out against the filter's S / N lamps (a source on its own clean path can't
   * also go through the filter; the engine enforces the same rule, Direct out winning).
   */
  private exclusive(id: string, other: string, label: string, cls = ''): HTMLElement {
    const b = this.toggle(id, label, cls);
    b.onclick = () => {
      const on = !this.get(id);
      if (on && this.get(other)) this.set(other, false);
      this.set(id, on);
    };
    this.watch([other], () => b.classList.toggle('on', !!this.get(id) && !(id.startsWith('filter.') && this.get(other))));
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
    if (ids[0]) el.dataset.param = ids[0];
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
      // one cycle per 90 px at -1, doubling with every octave up (capped so it stays readable)
      const cycles = (W / 90) * Math.min(8, Math.pow(2, this.num('sub.octave') + 1)), lvl = this.num('sub.level');
      const k = 1 + this.num('sub.clip') / 3, clip = (v: number) => (k > 1.01 ? Math.tanh(v * k) / Math.tanh(k) : v);
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i++) pts.push([i, H / 2 - clip(waveShape(String(this.get('sub.wave')), ((i / W) * cycles) % 1, 0.25, 0)) * (H / 2 - 9) * (0.3 + 0.6 * lvl)]);
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
      // a HIT type draws as the bed it is named after, inside one burst (as breath's puff)
      const chosen = String(this.get('texture.type'));
      const hitType = chosen.endsWith(' hit');
      const type = hitType ? chosen.slice(0, -4) : chosen;
      const breath = hitType;
      const grainHit = hitType && (type === 'crackle' || type === 'dust' || type === 'static');
      const lvl = this.num('texture.level');
      const tone = this.num('texture.tone'), ch = this.num('texture.density');
      // the noise types get thicker with Density (a fuller, rougher trace), the grains more frequent
      const grain = type === 'crackle' || type === 'dust' || type === 'static';
      const thick = grain ? 1 : 0.55 + 0.9 * ch;
      const tail = Math.min(1, this.num('texture.tail') / 3000);
      // the octave stretches the bed in time, as tape run slower: fewer, broader grains and slower cycles
      const rate = Math.pow(2, this.num('texture.octave'));
      let seed = 3 + chosen.length;
      const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i += 1.5 / rate) {
        // each type's grain, varied by Density
        const pop = (type === 'crackle' && Math.abs(r()) > 0.5 - 0.03 * Math.pow(2, 5 * (ch - 0.5)) * 0.4) || (type === 'static' && Math.abs(r()) > 0.495 - 0.012 * Math.pow(2, 4 * (ch - 0.5))) ? 3 : 1;
        // breath: one puff at the start of the note, as long as Tail (the print spans 1 s), then nothing
        const env = breath ? (grainHit ? 1.2 : 1.6 * Math.min(1, (i / W) * 60)) * Math.exp((-3 * (i / W)) / Math.max(0.02, this.num('texture.tail') / 1000)) : type === 'rumble' ? 0.6 : 1;
        const fade = breath ? 1 : Math.min(1, Math.max(0, (1 - i / W) / Math.max(0.05, 0.25 + 0.75 * tail)) * 1.6);
        // crackle is pops only: a quiet line between them
        let y = r() * (H - 10) * (0.25 + 0.75 * lvl) * pop * env * fade * (type === 'air' ? 0.6 : 1) * thick * (type === 'crackle' && pop === 1 ? 0.06 : 1);
        if (type === 'tape hiss') y *= 0.4;
        if (type === 'dust') y *= 0.5 + ch;
        // a crackle pop is a sharp spike from the quiet line
        if (type === 'crackle' && (pop > 1 || (hitType && i === 0))) y = (r() < 0 ? -1 : 1) * (0.35 + Math.abs(r())) * (H - 14) * 0.9 * (0.3 + 0.7 * lvl) * fade * Math.min(1, env);
        pts.push([i, H / 2 + y]);
      }
      silver(g, smoothY(pts, type === 'crackle' ? 0 : (1 - tone) * 4 * Math.min(1, rate)), lvl > 0);
      if (String(this.get('texture.filter_type')).startsWith('high')) loCutStrip(g, W, H, this.num('texture.filter_cutoff'), lvl > 0, accentOf(cv));
    };
    this.watch(['texture.type', 'texture.level', 'texture.tone', 'texture.density', 'texture.octave', 'texture.tail', 'texture.filter_cutoff', 'texture.filter_type'], redraw);
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
        case 'sem': return [['lp', fc, 1 / (1.9 * (1 - res) + 0.12)]];
        case 'highpass': return [['hp', fc, 0.54], ['hp', fc, 1.31 + res * 5]];
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
        handle(g, x, ys[Math.round(x)] ?? H / 2);
      }
      vignette(g, W, H);
    };
    this.watch(['filter.type', 'filter.cutoff', 'filter.resonance', 'filter.vowel', 'filter.on', 'drive.on', 'drive.amount'], redraw);
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

  /**
   * An ADSR print with handles you drag: A sideways, D sideways and S up/down, R sideways; on the
   * amp and filter envelopes a small dot in the middle of each segment bends it (up / down, as in
   * Serum; double-click it for the analog default).
   */
  private envPrint(prefix: string, W: number, H: number): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    const ids = ['attack', 'decay', 'sustain', 'release'].map((s) => `${prefix}.${s}`);
    // Env 2 / 3 have an on / off switch; the amp and filter envelopes are always on
    const onId = `${prefix}.on`, isOn = () => !getParam(onId) || !!this.get(onId);
    let span = 1000;
    let hot = -1;
    // the segments' bends (only the amp and filter envelopes have them; Env 2 / 3 keep the analog shape)
    const bendIds = ['attack', 'decay', 'release'].map((s) => `${prefix}.${s}_bend`);
    const hasBend = !!getParam(bendIds[0]);
    const BEND_DEF = [ENV_ATTACK_BEND, ENV_FALL_BEND, ENV_FALL_BEND];
    const bends = () => (hasBend ? bendIds.map((id) => this.num(id)) : BEND_DEF);
    const geo = () => {
      const a = this.num(ids[0]), d = this.num(ids[1]), s = this.num(ids[2]), r = this.num(ids[3]);
      const hold = Math.max(250, 0.25 * (a + d));
      const X = (t: number) => 8 + (t / span) * (W - 16);
      const Y = (v: number) => H - 10 - v * (H - 26);
      const [ab, db, rb] = bends();
      // the level along each segment (p = 0..1), shaped as the engine shapes it
      const atk = (p: number) => envSegment(p, ab);
      const dec = (p: number) => s + (1 - s) * (1 - envSegment(p, db));
      const rel = (p: number, from: number) => from * (1 - envSegment(p, rb));
      return { a, d, s, r, hold, X, Y, atk, dec, rel };
    };
    const reSpan = () => {
      const { a, d, r, hold } = geo();
      const total = a + d + hold + r;
      span = total <= 1000 ? 1000 : total <= 4000 ? Math.ceil(total / 1000) * 1000 : total;
    };
    const points = () => {
      const { a, d, s, r, hold, X, Y, atk, dec, rel } = geo();
      const pts = [[X(a), Y(1)], [X(a + d), Y(s)], [X(a + d + hold), Y(s)], [X(a + d + hold + r), Y(0)]] as [number, number][];
      // 4..6: the bend dots, halfway along attack, decay and release
      if (hasBend) pts.push([X(a / 2), Y(atk(0.5))], [X(a + d / 2), Y(dec(0.5))], [X(a + d + hold + r / 2), Y(rel(0.5, s))]);
      return pts;
    };
    const draw = () => {
      const { a, d, s, r, hold, X, Y, atk, dec, rel } = geo();
      paper(g, W, H);
      const pts: [number, number][] = [[X(0), Y(0)]];
      const N = 40;
      for (let i = 0; i <= N; i++) pts.push([X((a * i) / N), Y(atk(i / N))]);
      for (let i = 1; i <= N; i++) pts.push([X(a + (d * i) / N), Y(dec(i / N))]);
      pts.push([X(a + d + hold), Y(s)]);
      for (let i = 1; i <= N; i++) pts.push([X(a + d + hold + (r * i) / N), Y(rel(i / N, s))]);
      fillUnder(g, pts, H, accentOf(cv));
      silver(g, pts, isOn());
      vignette(g, W, H);
      // the handles you drag only while the envelope is on
      if (isOn()) points().forEach(([x, y], i) => (i >= 4 ? bendDot(g, x, y, i === hot) : handle(g, x, y, i === hot)));
      // Where the playing note is in the envelope: a ball that runs along it (as in Serum), not
      // while the envelope is switched off.
      const at = isOn() ? playhead() : null;
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
      const { a, d, s, r, hold, X, Y, atk, dec, rel } = geo();
      const heldAt = (t: number): [number, number] => {
        if (t < a) return [t, atk(t / Math.max(a, 1e-3))];
        if (t < a + d) return [t, dec((t - a) / Math.max(d, 1e-3))];
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
      return [X(a + d + hold + tr), Y(rel(tr / Math.max(r, 1e-3), v0))];
    };
    this.dotDraws.push(draw);
    this.watch([...ids, ...(getParam(onId) ? [onId] : []), ...(hasBend ? bendIds : [])], () => {
      if (hot < 0) reSpan();
      draw();
    });
    // dragging the handles
    const P = ids.map((id) => getParam(id)!);
    let start: { x: number; y: number; v: number[]; b: number[] } | null = null;
    const local = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!isOn()) return;
      const [x, y] = local(e);
      let best = -1, bd = 18 * 18;
      points().forEach(([px, py], i) => {
        // the bend dots are small: they win only when the pointer is right on them
        const dd = (px - x) ** 2 + (py - y) ** 2 + (i >= 4 ? 40 : 0);
        if (dd < bd) { bd = dd; best = i; }
      });
      if (best < 0) return;
      hot = best;
      cv.setPointerCapture(e.pointerId);
      start = { x, y, v: ids.map((id) => this.num(id)), b: bends() };
      draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!start || !cv.hasPointerCapture(e.pointerId)) {
        const [x, y] = local(e);
        cv.style.cursor = isOn() && points().some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < 18 * 18) ? 'grab' : '';
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
      if (hot >= 4) {
        // up bends a rising segment towards fast-first, a falling one towards slow-first (the dot follows the pointer)
        const k = hot - 4, up = -(y - start.y) / (H - 26);
        this.set(bendIds[k], Math.round(Math.max(-1, Math.min(1, start.b[k] + (k === 0 ? 2 : -2) * up)) * 1000) / 1000);
      }
    });
    cv.addEventListener('dblclick', (e) => {
      if (!hasBend || !isOn()) return;
      const [x, y] = local(e);
      points().forEach(([px, py], i) => {
        if (i >= 4 && (px - x) ** 2 + (py - y) ** 2 < 10 * 10) this.set(bendIds[i - 4], BEND_DEF[i - 4]);
      });
    });
    cv.addEventListener('pointerup', (e) => {
      if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
      start = null;
      hot = -1;
      reSpan();
      draw();
    });
    cv.title = hasBend
      ? 'Drag the points: attack, decay and sustain, release · drag a small dot up / down to bend its curve (double-click it: back to analog)'
      : 'Drag the points: attack, decay and sustain, release';
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
      )],
      print: this.wavePrint(n, PRINT_W, PRINT_H),
      dials: [
        // UNI sits with the dials it governs: how many copies, then how far apart (owner's layout).
        h('div', 'k uni-dial', this.chip('UNI', () => this.num(`${o}.unison_voices`), (v) => this.set(`${o}.unison_voices`, v), 1, 7, [`${o}.unison_voices`], 'Unison voices (stacked detuned copies)')),
        this.knob(`${o}.unison_detune`, 'Detune', 'lg', { disabled: uniOff, deps: [`${o}.unison_voices`] }),
        this.knob(`${o}.unison_spread`, 'Spread', 'lg', { disabled: uniOff, deps: [`${o}.unison_voices`] }),
        pw, wt, this.knob(`${o}.level`, 'Level', 'lg'), this.lowCut(`${o}.highpass`, `${o}.filter_type`),
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
        this.chip('OCT', () => this.num('sub.octave'), (v) => this.set('sub.octave', v), -4, 4, ['sub.octave'], 'Sub octave: -4 to +4 against the played note')),
        this.exclusive('sub.direct', 'filter.route_s', 'Direct out', 'small direct-out')],
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
    // The same four dials and Direct out for every noise type, breath included (owner's call).
    const dials = [this.knob('texture.tone', 'Tone', 'lg'), this.knob('texture.density', 'Density', 'lg'), this.knob('texture.tail', 'Tail', 'lg'),
      this.lowCut('texture.filter_cutoff', 'texture.filter_type'), this.knob('texture.level', 'Level', 'lg')];
    const direct = this.exclusive('texture.direct', 'filter.route_n', 'Direct out', 'small direct-out');
    const power = (el: HTMLElement) => {
      const b = h('button', 'power', lamp());
      b.title = 'On / off';
      const on = () => this.num('texture.level') > 0;
      b.onclick = () => {
        if (on()) {
          this.remembered.set('texture.level', this.num('texture.level'));
          this.set('texture.level', 0);
        } else this.set('texture.level', this.remembered.get('texture.level') ?? 0.5);
      };
      this.watch(['texture.type', 'texture.level'], () => {
        b.classList.toggle('on', on());
        el.classList.toggle('is-off', !on());
        // "air hit (breath)" is the longest name: set a little smaller so the title row still fits
        el.classList.toggle('long-name', String(this.get('texture.type')) === 'air hit');
      });
      return b;
    };
    return this.obox('NOISE', 'c-src noise box-noise', {
      power,
      // the types in family columns, as the matrix menus are
      // the hits sit to the right, each in the same row as the bed it bursts (air hit is the breath)
      head: [this.selector('texture.type', { label: (o) => (o === 'air hit' ? 'air hit (breath)' : o), groups: [
        ['GRAIN', ['crackle', 'dust', 'static']],
        ['NOISE', ['tape hiss', 'air', 'rumble', 'white noise']],
        ['HIT', ['crackle hit', 'dust hit', 'static hit']],
        ['HIT', ['tape hiss hit', 'air hit', 'rumble hit', 'white noise hit']],
      ] }), h('div', 'ob-chips',
        this.chip('OCT', () => this.num('texture.octave'), (v) => this.set('texture.octave', v), -6, 2, ['texture.octave'], 'Noise octave: plays the bed slower (darker, bigger) or faster, like tape; with KEY on, where middle C sits')), direct],
      print: this.noisePrint(PRINT_W, PRINT_H),
      // KEY: the noise plays across the keyboard like a sample (its speed follows the note, glide and bend)
      corner: [this.toggle('texture.key', 'Key', 'small')],
      dials,
    });
  }

  // ------------------------------------------------------------------ the middle: scope + amp envelope

  /** The oscilloscope fills its box; the box's own dark edge shows around the screen. */
  private scopeBox(): HTMLElement {
    const W = 279, H = 205;
    const [cv, g] = canvas(W, H, 'scope-screen');
    this.scopeG = g;
    this.scopeSize = [W, H];
    // transparent (owner's reference): the screen shows the box's own worn surface behind the trace
    g.clearRect(0, 0, W, H);
    const el = h('div', 'c ob box-scope', h('div', 'scope-glass', cv));
    el.title = 'Oscilloscope: the sound coming out, as a waveform';
    return el;
  }

  /** Switch the filter envelope on: with no amount it starts at the last amount it had (or +2 oct). */
  private fenvOn(): void {
    if (Math.abs(this.num('filter.env_amount')) < 1e-4) this.set('filter.env_amount', this.remembered.get('filter.env_amount') ?? 0.33);
    this.set('mod_env.on', true);
  }

  private envBox(prefix: 'amp_env' | 'mod_env', title: string, cls: string): HTMLElement {
    // The filter envelope has an on / off (as in Serum's envelopes on a dial): switched on with no
    // amount, it starts at the last amount it had (or +2 oct) so its ring shows on Cutoff.
    const power = prefix === 'mod_env' ? (el: HTMLElement) => {
      const b = h('button', 'power', lamp());
      b.title = getParam('mod_env.on')!.describes;
      b.onclick = () => {
        if (this.get('mod_env.on')) {
          this.set('mod_env.on', false);
          return;
        }
        this.fenvOn();
      };
      this.watch(['mod_env.on', 'filter.env_amount'], () => {
        const amt = this.num('filter.env_amount');
        if (Math.abs(amt) > 1e-4) this.remembered.set('filter.env_amount', amt);
        b.classList.toggle('on', !!this.get('mod_env.on'));
        el.classList.toggle('is-off', !this.get('mod_env.on'));
      });
      return b;
    } : undefined;
    return this.obox(title, `env ${cls}`, {
      power,
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
    const routes = h('div', 'ob-routes',
      this.toggle('filter.route_a', 'A', 'route route-a'),
      this.toggle('filter.route_b', 'B', 'route route-b'),
      this.exclusive('filter.route_s', 'sub.direct', 'S', 'route route-s'),
      this.exclusive('filter.route_n', 'texture.direct', 'N', 'route route-n'),
    );
    routes.title = 'What goes through the filter, in the order of the sources: oscillator A, oscillator B, sub, noise (a texture bed or breath)';
    const drive = this.knob('drive.amount', 'Drive', 'lg', { disabled: () => !this.get('drive.on'), deps: ['drive.on'] });
    // Turning the drive up switches the drive stage on.
    drive.addEventListener('pointerdown', () => { if (!this.get('drive.on')) this.set('drive.on', true); }, true);
    // As in Serum: while the filter envelope is on, its sweep is a lighter ring on Cutoff (in place
    // of the dial's own arc), set with the glowing ENV number beside it (owner's pick: no second dial).
    const fenvOn = () => !!this.get('mod_env.on');
    const cutoff = this.knob('filter.cutoff', 'Cutoff', 'lg', { mod: { ...FENV_MOD, on: fenvOn, deps: ['mod_env.on'], live: () => this.liveFilter?.cutoff ?? null } });
    cutoff.title += ' The lighter ring is how far the filter envelope sweeps it (the ENV number beside it).';
    const envAmt = this.envNumber(fenvOn);
    // Each type's own control shows only while that type is picked: the 303 diode's ACCENT, formant's VOWEL.
    const vowel = this.glowNumber('filter.vowel', 'VOWEL', (v) => {
      const x = Math.max(0, Math.min(1, v)) * 4, i = Math.min(3, Math.floor(x)), f = x - i, L = 'AEIOU';
      return f < 0.15 ? L[i] : f > 0.85 ? L[i + 1] : `${L[i]}·${L[i + 1]}`;
    }, 'The vowel the formant filter sings, A → E → I → O → U; Cutoff moves it up or down like a smaller or bigger throat. Drag up / down (Shift = fine), double-click for A.');
    const accent = this.glowNumber('filter.accent', 'ACCENT', (v) => `${Math.round(v * 100)}%`,
      'Accent, as on the 303: harder notes kick the cutoff, the filter envelope and the resonance. Drag up / down (Shift = fine), double-click for 0.');
    this.watch(['filter.type'], () => {
      const t = String(this.get('filter.type'));
      accent.style.display = t === 'diode' ? '' : 'none';
      vowel.style.display = t === 'formant' ? '' : 'none';
    });
    return this.obox('FILTER', 'c-flt main-filter box-flt', {
      power: (el) => this.boolPower('filter.on', el),
      head: [this.selector('filter.type'), this.keyTrack()],
      print: this.filterPrint(PRINT_W, PRINT_H),
      dials: [routes, h('div', 'envn-stack', envAmt), cutoff, this.knob('filter.resonance', 'Res', 'lg'), drive],
      corner: [accent, vowel],
    });
  }

  /**
   * The filter envelope's amount as glowing text only ("ENV" over "+2.0", in octaves; owner's pick):
   * drag it up / down (Shift = fine), scroll it, double-click for 0. Lit while the envelope is on,
   * dark ink when it is off; dragging it switches the envelope on.
   */
  private envNumber(isOn: () => boolean): HTMLElement {
    const id = 'filter.env_amount', p = getParam(id)!;
    const val = h('span', 'envn-val');
    const el = h('div', 'envn', h('span', 'envn-label', 'ENV'), val);
    el.dataset.param = id;
    const set = (v: number) => this.set(id, Math.round(Math.max(p.min!, Math.min(p.max!, v)) * 1000) / 1000);
    this.watch([id, 'mod_env.on'], () => {
      const a = this.num(id), oct = a * 6;
      val.textContent = Math.abs(oct) < 0.05 ? '0.0' : `${oct > 0 ? '+' : '−'}${Math.abs(oct).toFixed(1)}`;
      el.classList.toggle('on', isOn() && Math.abs(oct) >= 0.05);
    });
    let y0 = 0, v0 = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      y0 = e.clientY;
      v0 = this.num(id);
      if (!isOn()) this.set('mod_env.on', true);
    });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) set(v0 + (y0 - e.clientY) / (e.shiftKey ? 1200 : 240)); });
    el.addEventListener('pointerup', (e) => el.releasePointerCapture(e.pointerId));
    el.addEventListener('dblclick', () => set(0));
    el.addEventListener('wheel', (e) => { e.preventDefault(); set(this.num(id) - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.01)); }, { passive: false });
    el.title = 'Filter envelope amount, in octaves: how far the filter envelope sweeps the cutoff (the lighter ring on Cutoff). Drag up / down (Shift = fine), double-click for 0. Dragging it switches the filter envelope on.';
    return el;
  }

  /** A parameter as glowing text you drag (label then value, in a print's corner): lit while it is above 0. */
  private glowNumber(id: string, label: string, fmt: (v: number) => string, title: string): HTMLElement {
    const p = getParam(id)!;
    const val = h('span', 'envn-val');
    const el = h('div', 'envn envn-row', h('span', 'envn-label', label), val);
    el.dataset.param = id;
    const set = (v: number) => this.set(id, Math.round(Math.max(p.min!, Math.min(p.max!, v)) * 1000) / 1000);
    this.watch([id], () => {
      const v = this.num(id);
      val.textContent = fmt(v);
      el.classList.toggle('on', v > 0.001);
    });
    let y0 = 0, v0 = 0;
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = this.num(id); });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) set(v0 + (y0 - e.clientY) / (e.shiftKey ? 1000 : 200)); });
    el.addEventListener('pointerup', (e) => el.releasePointerCapture(e.pointerId));
    el.addEventListener('dblclick', () => set(0));
    el.addEventListener('wheel', (e) => { e.preventDefault(); set(this.num(id) - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.01)); }, { passive: false });
    el.title = title;
    return el;
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
    el.dataset.param = id;
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
    glide.dataset.param = 'voice.glide';
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
      this.toggle('voice.halfspeed', 'Oct down'),
      glide,
      gear,
      h('div', 'master', this.readout('output.gain', 'Master'), meter),
    );
  }

  // ------------------------------------------------------------------ the preset selector

  /** name ‹ › in the top middle (the arrows right beside the name, so stepping is a short move), then undo, redo and save. */
  private presetSelector(): HTMLElement {
    const prev = h('button', 'pre-step', icon('prev'));
    const next = h('button', 'pre-step', icon('next'));
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
    this.undoBtn.append(icon('undo'));
    this.redoBtn.append(icon('redo'));
    this.saveBtn.append(icon('save'));
    this.undoBtn.title = 'Undo (Ctrl+Z)';
    this.redoBtn.title = 'Redo (Ctrl+Shift+Z)';
    this.saveBtn.title = 'Save this sound as your own preset (Ctrl+S): it goes to ★ User';
    this.undoBtn.onclick = () => this.onUndo();
    this.redoBtn.onclick = () => this.onRedo();
    this.saveBtn.onclick = () => this.onSave();
    this.setHistory(false, false);
    this.menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.closeMenu());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeMenu(); });
    return h('div', 'pre-sel',
      h('div', 'pre-row', name, h('div', 'pre-steps', prev, next), h('div', 'pre-hist', this.undoBtn, this.redoBtn, this.saveBtn)),
      this.subEl, this.menu);
  }

  /** Undo / redo light up only when there is a step to take. */
  setHistory(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  /** A short glow on the save icon once a sound is saved. */
  flashSaved(): void {
    this.saveBtn.classList.remove('saved');
    void this.saveBtn.offsetWidth;
    this.saveBtn.classList.add('saved');
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

  /** An LFO's print: two cycles of its shape, with its fade-in; the per-note shapes from a note's start. */
  private lfoPrint(n: number, W: number, H: number): HTMLElement {
    const [cv, g] = canvas(W, H, 'disp');
    const L = `lfo${n}`;
    const redraw = () => {
      paper(g, W, H);
      const shape = String(this.get(`${L}.shape`));
      const sync = String(this.get(`${L}.sync`));
      // Seconds per cycle (synced rates at 120 BPM), to place the fade on the same time axis.
      const beats = sync === 'free' ? 0 : syncBeats(sync);
      const period = beats ? beats * 0.5 : 1 / Math.max(0.01, this.num(VIB_SHAPES.has(shape) ? `${L}.vib_rate` : `${L}.rate`));
      // A fixed 2-second window (at 120 BPM): a faster rate shows more cycles. Bloom and drop show
      // their whole rise or fall, per note a held value for each of a few notes.
      const perNote = shape === 'bloom' || shape === 'drop' || shape === 'random' || shape === 'drift_down';
      const span = perNote && shape !== 'random' ? Math.max(2, period * 1.25) : 2;
      const bendPow = Math.pow(4, 2 * this.num(`${L}.bend`) - 1);
      // Depth (owner's call): the picture shows the real movement, flat at 0; Phase shifts the repeating shapes
      const depth = VIB_SHAPES.has(shape) ? this.num(`${L}.vib_depth`) : n <= 4 ? Math.cbrt(this.num(`mod${n}.amount`)) : 1, // the knob's position (Depth is on a cubed curve)
      phase = ['sine', 'triangle', 'saw_up', 'saw_down', 'square'].includes(shape) ? this.num(`${L}.phase`) : 0;
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
          case 'bloom': { const x = Math.min(1, ph); return -0.85 + 1.7 * (0.5 - 0.5 * Math.cos(Math.PI * x)); }
          case 'drop': { const x = Math.min(1, ph); return -0.85 + 1.7 * Math.pow(1 - x, 2 * bendPow); }
          case 'drift_down': { const x = Math.min(1, ph); return 0.85 - 1.7 * Math.min(1, Math.pow(x, 2.5 * bendPow) + 0.03 * x * Math.sin(2 * Math.PI * 5.3 * x)); }
          case 'vibrato': case 'vib_triangle': case 'vib_saw_up': case 'vib_saw_down': case 'vib_square': return vibWaveUi(shape, ph);
          case 'random': return steps[Math.floor((ph * period) / 0.5) % 10] * 0.85;
          case 'drift': { const x = ph * 1.6, i = Math.floor(x), t = x - i, s = 1 - Math.pow(1 - t, 3); return (steps[i % 10] + (steps[(i + 1) % 10] - steps[i % 10]) * s) * 0.85; }
          case 'slow drift': { const x = ph * 1.6, i = Math.floor(x), t = x - i, s = 0.5 - 0.5 * Math.cos(Math.PI * t); return (steps[i % 10] + (steps[(i + 1) % 10] - steps[i % 10]) * s) * 0.85; }
          default: { const x = ph * 2, i = Math.floor(x), t = x - i, s = t * t * (3 - 2 * t); return (steps[i % 10] + (steps[(i + 1) % 10] - steps[i % 10]) * s) * 0.85 + 0 * c; }
        }
      };
      const pts: [number, number][] = [];
      // A random shape is drawn as what it really did: its path over the last few moves, scrolling
      // left, now at the right edge (owner's rule: never a made-up curve that looks like a loop).
      const real = LFO_RANDOM.has(shape) && this.liveLfo;
      const histSpan = Math.max(2, Math.min(30, 2 * period));
      if (real) {
        const hist = this.lfoHist[n - 1], N = Math.round(histSpan * LFO_HIST_HZ);
        for (let i = 0; i <= W; i++) {
          const x = (i / W) * (N - 1), j = Math.floor(x), fr = x - j;
          const at = (k: number) => hist[(this.lfoHistAt - (N - 1) + k + LFO_HIST * 2) % LFO_HIST];
          const v = at(j) + (j + 1 < N ? (at(j + 1) - at(j)) * fr : 0);
          pts.push([i, H / 2 - v * depth * 0.85 * (H / 2 - 7)]);
        }
      } else {
        for (let i = 0; i <= W; i++) {
          const t = (i / W) * span;
          pts.push([i, H / 2 - f(t / period + phase) * depth * (H / 2 - 7)]);
        }
      }
      if (VIB_SHAPES.has(shape)) {
        // VIBRATO (owner's pick, option 1): the full vibrato faint, the bright line what the mod wheel plays now
        // (flat at wheel 0, growing into the faint one as the wheel goes up: the width is the wheel squared)
        g.save();
        g.strokeStyle = accentOf(cv);
        g.globalAlpha = 0.22;
        g.lineWidth = 1;
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
        g.restore();
        const w2 = this.wheel * this.wheel;
        for (const p of pts) p[1] = H / 2 + (p[1] - H / 2) * w2;
      }
      silver(g, pts, !!this.get(`${L}.on`));
      if (VIB_SHAPES.has(shape)) {
        g.save();
        g.fillStyle = 'rgba(234,227,215,0.45)';
        g.font = '8px "Space Grotesk", sans-serif';
        g.letterSpacing = '0.12em';
        g.textAlign = 'right';
        g.fillText(`MOD WHEEL ${Math.round(this.wheel * 100)}%`, W - 6, 10);
        g.restore();
      }
      // Retrig: every note starts the shape from the top (a tick at the start); not on the shapes that always restart
      if (this.get(`${L}.retrigger`) && !K_ALWAYS_PER_NOTE.has(shape)) {
        g.save();
        g.fillStyle = accentOf(cv);
        g.shadowColor = accentOf(cv);
        g.shadowBlur = 6;
        g.fillRect(1, 2, 1.5, H - 4);
        g.restore();
      }
      // While playing: a dot at where the LFO is now (from the note's start when it retriggers).
      // (always: the LFO runs whether or not a note sounds; retriggered from the last note's start)
      if (this.get(`${L}.on`)) {
        // the engine's real phase when it is running, else the page's own clock
        const live = this.liveLfo;
        if (real) liveDot(g, pts, 1, accentOf(cv));
        else if (perNote) {
          // from the newest note's start: bloom and drop stop at the end of their cycle
          const t = shape === 'random' ? (this.anim.on ? this.anim.t : 0) : live ? live.phase[n - 1] * period : this.anim.on ? Math.min(this.anim.t, period) : 0;
          liveDot(g, pts, (t % span) / span, accentOf(cv));
        } else {
          const t = live ? (this.lfoCycles[n - 1] + live.phase[n - 1]) * period : this.get(`${L}.retrigger`) && this.anim.on ? this.anim.t : performance.now() / 1000;
          liveDot(g, pts, (t % span) / span, accentOf(cv));
        }
      }
    };
    this.watch([`${L}.shape`, `${L}.phase`, `${L}.bend`, `${L}.rate`, `${L}.vib_rate`, `${L}.vib_depth`, `${L}.sync`, `${L}.on`, `${L}.retrigger`, ...(n <= 4 ? [`mod${n}.amount`] : [])], redraw);
    this.animDraws.push({ el: cv, f: redraw, free: () => !!this.get(`${L}.on`) });
    this.wheelViews.push(() => { if (VIB_SHAPES.has(String(this.get(`${L}.shape`)))) redraw(); });
    return cv;
  }

  /** A custom LFO is doing something: switched on, its Depth up, with at least one target that moves. */
  private wobActive(W: string): boolean {
    return !!this.get(`${W}.on`) && this.num(`${W}.master`) > 0 && [0, 1, 2, 3].some((t) => this.get(wobDests(W)[t]) !== 'none' && (this.num(wobAmts(W)[t]) !== 0 || this.num(wobOffs(W)[t]) !== 0));
  }

  /** The RUIN boxes (1-8) that hold a drive. */
  private ruinDriveBoxes(): number[] {
    return [1, 2, 3, 4, 5, 6, 7, 8].filter((k) => String(this.get(`grind.slot${k}`)).startsWith('drive'));
  }

  /**
   * A target menu's DRIVE group (owner's call), rebuilt as RUIN's boxes change: ALL RUIN DRIVES and RUIN DRIVE n for
   * the boxes that hold a drive (none when there are none), FX DRIVE always, at the bottom.
   */
  private driveGroup(sel: HTMLSelectElement): void {
    sel.querySelector('optgroup.og-drive')?.remove();
    const og = document.createElement('optgroup');
    og.label = 'DRIVE';
    og.className = 'og-drive';
    const boxes = this.ruinDriveBoxes();
    if (boxes.length) og.append(new Option('ALL RUIN DRIVES', 'ruin_drives'));
    for (const k of boxes) og.append(new Option(`RUIN DRIVE ${k}`, `ruin_drive${k}`));
    og.append(new Option('FX DRIVE', 'dist_drive'));
    sel.append(og);
  }

  /** A target aimed at a RUIN drive that is gone (its box emptied or changed) goes to none: nothing hidden moves the sound. */
  private dropGoneDrive(id: string): void {
    const v = String(this.get(id)), boxes = this.ruinDriveBoxes();
    const gone = v === 'ruin_drives' ? boxes.length === 0 : v.startsWith('ruin_drive') ? !boxes.includes(Number(v.slice(10))) : false;
    if (gone) this.set(id, 'none');
  }

  /** The target a dial is as an LFO destination ('p:<id>'), or null when it can't be one. */
  private learnDest(param: string): string | null {
    return DIAL_TARGETS.has(param) ? `p:${param}` : null;
  }

  /** A dial target's name: its box and its own name on the page ("OSC A DETUNE"), else the schema's label. */
  private dialName(dest: string): string {
    if (!dest.startsWith('p:')) return LFO_TARGET_NAME[dest] ?? dest.replace(/_/g, ' ').toUpperCase();
    const id = dest.slice(2);
    const el = this.page.querySelector<HTMLElement>(`[data-param="${id}"]`);
    const own = el?.querySelector('.k-label, .chip-label, .envn-label, .ro-label, .glide-label')?.textContent?.trim();
    const box = el?.closest('.c, .ob, .mb')?.querySelector('.c-title')?.textContent?.trim();
    if (own) return `${box && !box.startsWith('CUSTOM') ? `${box} ` : ''}${own}`.toUpperCase();
    return (getParam(id)?.label ?? id).toUpperCase();
  }

  /**
   * A target picked with the crosshair that no column lists (owner's call: no CUSTOM column): kept as an option
   * outside the columns, so the menu shows its name without listing it.
   */
  private customOption(sel: HTMLSelectElement, current: string): void {
    sel.querySelector('option.opt-custom')?.remove();
    if ([...sel.querySelectorAll('option')].some((o) => o.value === current)) return;
    const o = new Option(this.dialName(current), current);
    o.className = 'opt-custom';
    sel.append(o);
  }

  /** The crosshair beside a target menu (owner's pick): click it, then click a blinking dial to connect it. */
  private learnButton(start: (btn: HTMLElement) => void): HTMLElement {
    const b = h('button', 'learn-btn');
    b.innerHTML = '<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M7 0.5v3M7 10.5v3M0.5 7h3M10.5 7h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="7" cy="7" r="1" fill="currentColor"/></svg>';
    b.title = 'Connect: click, then click any blinking dial (on any page) for this LFO to move it. Escape stops.';
    b.onclick = (e) => {
      e.stopPropagation();
      if (b.classList.contains('on')) this.learnEnd?.();
      else start(b);
    };
    return b;
  }

  private learnEnd: (() => void) | null = null;

  /**
   * CUSTOM (owner's call): every dial an LFO can move blinks (on every page); clicking one connects it, clicking
   * anything else or Escape stops. Switching tabs keeps it going.
   */
  private startLearn(apply: (dest: string) => void, exclude = '', btn?: HTMLElement): void {
    this.learnEnd?.();
    btn?.classList.add('on');
    const marked = [...this.page.querySelectorAll<HTMLElement>('[data-param]')].filter((el) => {
      const d = this.learnDest(el.dataset.param!);
      return d !== null && !d.startsWith(exclude || '\u0000');
    });
    for (const el of marked) el.classList.add('learnable');
    this.page.classList.add('mod-learning');
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (t.closest('.tab') || (btn && btn.contains(t))) return;
      const k = t.closest('.learnable') as HTMLElement | null;
      e.preventDefault();
      e.stopPropagation();
      if (k) apply(this.learnDest(k.dataset.param!)!);
      end();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') end(); };
    const end = () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
      for (const el of marked) el.classList.remove('learnable');
      this.page.classList.remove('mod-learning');
      btn?.classList.remove('on');
      this.learnEnd = null;
    };
    // (after the click that picked CUSTOM has finished)
    setTimeout(() => {
      document.addEventListener('pointerdown', down, true);
      document.addEventListener('keydown', key);
    }, 0);
    this.learnEnd = end;
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
    // VIBRATO has its own Rate (3-12 Hz) and Depth (±0-50 cents): realistic only (owner's call)
    const vibRateK = this.knob(`${L}.vib_rate`, 'Rate', 'lg', { fmt: (v) => `${v.toFixed(1)} Hz` });
    // in cents on a pitch target (±50 at most), in % on the others
    const vibDepK = this.knob(`${L}.vib_depth`, 'Depth', 'lg', { fmt: (v) => (String(this.get(`mod${n}.dest`)).endsWith('pitch') ? `±${Math.round(v * 50)}¢` : `${Math.round(v * 100)}%`), deps: [`mod${n}.dest`] });
    this.watch([id, `${L}.shape`], () => {
      const free = this.get(id) === 'free', vib = VIB_SHAPES.has(String(this.get(`${L}.shape`)));
      rate.style.display = free && !vib ? '' : 'none';
      vibRateK.style.display = free && vib ? '' : 'none';
      note.style.display = free ? 'none' : '';
    });
    // the shapes in two columns with a little picture each (owner's list): bloom and the old drifts are gone
    const shapeSel = this.selector(`${L}.shape`, { label: (o) => LFO_SHAPE[o] ?? o, groups: LFO_SHAPE_GROUPS, only: true });
    for (const o of shapeSel.querySelectorAll('option')) o.dataset.icon = lfoIconPath(o.value);
    // LFO 1-4 (owner's call, the LFO page without a matrix): each drives one target directly, through slot n of the
    // engine's matrix (its source always this LFO), with its Amount
    const slot = `mod${n}`;
    const own = () => {
      if (this.get(`${slot}.source`) !== L) this.set(`${slot}.source`, L);
      if (!this.get(`${slot}.on`)) this.set(`${slot}.on`, true);
    };
    const tsel = h('select', 'sel-name lfo-target') as HTMLSelectElement;
    for (const [title, os] of LFO_TARGETS) {
      const og = document.createElement('optgroup');
      og.label = title;
      for (const o of os) og.append(new Option(LFO_TARGET_NAME[o] ?? o, o));
      tsel.append(og);
    }
    tsel.onchange = () => { own(); this.set(`${slot}.dest`, tsel.value); };
    const learn = this.learnButton((b) => this.startLearn((d) => { own(); this.set(`${slot}.dest`, d); }, `p:${L}.rate`, b));
    this.watch([`${slot}.dest`, ...RUIN_SLOT_IDS], () => {
      this.driveGroup(tsel);
      this.dropGoneDrive(`${slot}.dest`);
      this.customOption(tsel, String(this.get(`${slot}.dest`)));
      tsel.value = String(this.get(`${slot}.dest`));
    });
    const target = h('div', 'sel lfo-target-sel', h('span', 'lfo-target-arrow', '→'), tsel);
    target.title = 'What this LFO moves';
    // on a pitch target Depth reads in cents / semitones (100 % = ±2 octaves), elsewhere in %
    const pitchDest = () => String(this.get(`${slot}.dest`)).endsWith('pitch');
    const amt = this.knob(`${slot}.amount`, 'Depth', 'lg', {
      fmt: (v) => !pitchDest() ? `${Math.round(v * 100)}%` : v * 24 < 1 ? `±${Math.round(v * 2400)}¢` : `±${(v * 24).toFixed(1)} st`,
    });
    const phaseK = this.knob(`${L}.phase`, 'Phase', 'lg', { fmt: (v) => `${Math.round(v * 360)}°` });
    const bendK = this.knob(`${L}.bend`, 'Bend', 'lg', { fmt: (v) => `${v > 0.5 ? '+' : ''}${Math.round((v - 0.5) * 200)}` });
    const blank = h('div', 'k k-lg lfo-blank');
    // Retrig only where it does something: the one shots and VIBRATO always restart on every note
    const retrigT = this.toggle(`${L}.retrigger`, 'Retrig', 'small');
    const third = h('div', 'lfo-third', phaseK, bendK, blank);
    this.watch([`${L}.shape`], () => {
      const sh = String(this.get(`${L}.shape`));
      const which = sh === 'drop' || sh === 'drift_down' ? bendK : sh === 'random' ? blank : VIB_SHAPES.has(sh) ? null : phaseK;
      for (const el of [phaseK, bendK, blank]) el.style.display = el === which ? '' : 'none';
      amt.style.display = VIB_SHAPES.has(sh) ? 'none' : '';
      retrigT.style.visibility = K_ALWAYS_PER_NOTE.has(sh) ? 'hidden' : '';
      vibDepK.style.display = VIB_SHAPES.has(sh) ? '' : 'none';
    });
    amt.addEventListener('pointerdown', own, true);
    // picking VIBRATO sets it up ready to play (owner's call): the mod wheel plays it; a classic vibrato on A+B pitch
    // (the sub stays steady), 5.5 Hz free, restarting per note, ±30 cents at full wheel; a pitch target already chosen is kept
    // switching between the vibrato waves keeps their settings; coming from another shape sets them up
    let lastShape = String(this.get(`${L}.shape`));
    this.watch([`${L}.shape`], () => { queueMicrotask(() => { lastShape = String(this.get(`${L}.shape`)); }); });
    shapeSel.addEventListener('change', () => {
      const was = lastShape;
      lastShape = String(this.get(`${L}.shape`));
      if (!VIB_SHAPES.has(lastShape) || VIB_SHAPES.has(was)) return;
      own();
      if (!pitchDest()) this.set(`${slot}.dest`, 'osc_pitch');
      this.set(`${L}.on`, true);
      this.set(id, 'free');
      this.set(`${L}.vib_rate`, 5.5);
      this.set(`${L}.vib_depth`, 0.6);
      this.set(`${L}.retrigger`, true);
    });
    return this.obox(`LFO ${n}`, `mb box-lfo${n}`, {
      power: (el) => this.boolPower(`${L}.on`, el),
      head: [shapeSel, target, learn],
      print: this.lfoPrint(n, MB_PRINT_W, MB_PRINT_H),
      // HZ / SYNC sits just left of the rate it switches, RETRIG under it
      // the third dial fits the shape (owner's call): PHASE on the repeating shapes, BEND on DROP and
      // DRIFT DOWN, nothing on RANDOM ON TRIGGER and VIBRATO
      dials: [h('div', 'lfo-sync lfo-sync-col', sync, retrigT), rate, vibRateK, note, third, amt, vibDepK],
    });
  }


  /** The custom shape's points from the patch. */
  private wobCustomPoints(W: string): WobPoint[] {
    const n = Math.max(2, Math.min(WOB_MAX_POINTS, Math.round(this.num(`${W}.points`))));
    return Array.from({ length: n }, (_, i) => ({ x: this.num(`${W}.x${i + 1}`), y: this.num(`${W}.y${i + 1}`), s: !!this.get(`${W}.s${i + 1}`) }));
  }

  /** The points shown for a shape: the custom ones, a preset shape's template, none for Random. */
  private wobPoints(W: string, shape = String(this.get(`${W}.shape`))): WobPoint[] {
    if (shape === 'custom') return this.wobCustomPoints(W);
    if (shape === 'random') return [];
    return WOB_TEMPLATES[shape] ?? WOB_TEMPLATES['saw down'];
  }

  /** A shape's level (0 = shut .. 1 = open) at q in the drawn cycle; Random shows a fixed example. */
  private wobValueFor(W: string, shape: string, q: number): number {
    if (shape === 'random') return SynthView.WOB_RANDOM_PREVIEW[Math.min(WOB_RANDOM_STEPS - 1, Math.floor(q * WOB_RANDOM_STEPS))];
    return wobPointsAt(this.wobPoints(W, shape), q);
  }
  private static readonly WOB_RANDOM_PREVIEW = [0.62, 0.18, 0.86, 0.4, 0.95, 0.08, 0.55, 0.3];

  /**
   * One cycle as heard, sampled at n + 1 points across the cycle: Smooth rounds the corners with the
   * engine's own table (wobSmoothTable), then the shift moves it along.
   */
  private wobCurve(W: string, shape: string, n: number): number[] {
    let ph = this.num(`${W}.phase`);
    if (shape !== String(this.get(`${W}.shape`))) ph = 0; // palette tiles show the shape as drawn
    const r = wobSmoothRadius(this.num(`${W}.smooth`));
    let at = (q: number) => this.wobValueFor(W, shape, q);
    if (r > 0) {
      wobSmoothTable(at, r, this.wobTable, this.wobTmp);
      at = (q) => wobTableAt(this.wobTable, q);
    }
    const out: number[] = [];
    for (let k = 0; k <= n; k++) {
      const q = k / n - ph;
      out.push(at(q - Math.floor(q)));
    }
    return out;
  }
  private readonly wobTable = new Float64Array(WOB_TABLE);
  private readonly wobTmp = new Float64Array(WOB_TABLE);

  /** Write points as the custom shape (and switch to it). */
  private setWobPoints(W: string, pts: WobPoint[]): void {
    const sorted = [...pts].sort((a, b) => a.x - b.x).slice(0, WOB_MAX_POINTS);
    for (let i = 0; i < WOB_MAX_POINTS; i++) {
      const q = sorted[i] ?? { x: 1, y: 0, s: false };
      this.set(`${W}.x${i + 1}`, Math.round(q.x * 10000) / 10000);
      this.set(`${W}.y${i + 1}`, Math.round(q.y * 10000) / 10000);
      this.set(`${W}.s${i + 1}`, q.s);
    }
    this.set(`${W}.points`, sorted.length);
    this.set(`${W}.shape`, 'custom');
  }

  /** Wobbler lock: while on, switching presets keeps the Wobbler (every wobble.* setting) as it is. */
  private lfo5Locked = (() => {
    try { return localStorage.getItem('lt.lfo5.lock') === '1'; } catch { return false; }
  })();
  private readonly lockViews: (() => void)[] = [];
  /** The Wobbler's level right now (0..1, null when no note sounds) and whether it is on, for its tab's bar. */
  private wobNows: (number | null)[] = [null, null, null, null];
  private wobOns = [false, false, false, false];
  /** The custom LFO shown on the LFO page (0-3), its boxes and its number switches. */
  private wobSel = 0;
  private readonly wobBoxes: HTMLElement[][] = [];
  private readonly wobSelViews: (() => void)[] = [];
  private readonly wobLevelViews: (() => void)[] = [];

  /** Called when a preset (or roll) loads: carries the Wobbler (while locked) and locked RUIN stages over from the previous patch. */
  keepLocked(next: Patch, prev: Patch | null): void {
    if (!prev) return;
    const from = prev as Record<string, unknown>, to = next as Record<string, unknown>;
    if (this.lfo5Locked) for (const p of params) if (/^wobble\d?\./.test(p.id)) to[p.id] = from[p.id] ?? p.default;
    // a locked GRIND stage stays as it is, and keeps the chain on if it was on
    let kept = false;
    for (let n = 1; n <= 8; n++) {
      if (!this.grindLocks[n - 1]) continue;
      for (const k of GRIND_KEYS) to[`grind${n}.${k}`] = from[`grind${n}.${k}`] ?? getParam(`grind${n}.${k}`)!.default;
      kept ||= !!from[`grind${n}.on`];
    }
    if (kept && from['grind.on']) to['grind.on'] = true;
  }

  private setLfo5Lock(on: boolean): void {
    this.lfo5Locked = on;
    try { localStorage.setItem('lt.lfo5.lock', on ? '1' : '0'); } catch { /* private window: the lock just isn't remembered */ }
    for (const f of this.lockViews) f();
  }

  /** A padlock in the Wobbler's title row: closed and lit = it stays when you switch presets. */
  private lfo5LockButton(): HTMLElement {
    const b = h('button', 'lfo5-lock');
    const draw = () => {
      const on = this.lfo5Locked;
      b.classList.toggle('on', on);
      b.innerHTML = `<svg viewBox="0 0 14 16" width="11" height="13" aria-hidden="true"><path d="${on ? 'M3.5 7V4.8a3.5 3.5 0 0 1 7 0V7' : 'M3.5 7V4.8a3.5 3.5 0 0 1 6.6-1.6'}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="1.5" y="7" width="11" height="8" rx="1.2" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4"/></svg><span>${on ? 'LOCKED' : 'LOCK'}</span>`;
      b.title = on ? 'The Wobbler is locked: switching presets keeps it as it is. Click to unlock.' : 'Lock the Wobbler: switching presets keeps it as it is.';
    };
    b.onclick = () => this.setLfo5Lock(!this.lfo5Locked);
    this.lockViews.push(draw);
    draw();
    return b;
  }

  /** The engine's wobble phase for the Wobbler's dot (0..1, null when off or silent). */
  setLiveWobble(read: () => (number | null)[]): void {
    const step = () => {
      const v = read();
      if (v.some((x, i) => x !== this.liveWobs[i])) {
        this.liveWobs = v;
        this.live(() => { for (const f of this.wobDraws) f(); });
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /**
   * A studio-console rocker for a bool (owner's pick): pressed in at the top (the lit "I") when on,
   * at the bottom (the "O") when off. The face's light and shade swap with the state.
   */
  private bigToggle(id: string, label: string, opts: { isOn?: () => boolean; turnOn?: () => void; deps?: string[] } = {}): HTMLElement {
    const b = h('button', 'big-toggle rocker');
    b.innerHTML = `<svg viewBox="0 0 60 96" width="60" height="96" aria-hidden="true">
        <defs>
          <linearGradient id="rkOn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d2d32"/><stop offset=".5" stop-color="#1b1b1f"/><stop offset=".52" stop-color="#121215"/><stop offset="1" stop-color="#0c0c0e"/></linearGradient>
          <linearGradient id="rkOff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0c0e"/><stop offset=".48" stop-color="#121215"/><stop offset=".5" stop-color="#1b1b1f"/><stop offset="1" stop-color="#2d2d32"/></linearGradient>
          <filter id="rkGlow" filterUnits="userSpaceOnUse" x="0" y="0" width="60" height="96"><feGaussianBlur stdDeviation="2.4" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <rect x="2" y="2" width="56" height="92" rx="6" fill="#050506" stroke="rgba(255,255,255,0.09)"/>
        <rect class="rk-face" x="7" y="7" width="46" height="82" rx="4"/>
        <rect class="rk-press" x="7" y="7" width="46" height="41" rx="4" fill="rgba(0,0,0,0.25)"/>
        <line class="rk-i" x1="30" y1="17" x2="30" y2="35" stroke-width="3" stroke-linecap="round"/>
        <circle class="rk-o" cx="30" cy="70" r="7.5" fill="none" stroke-width="2.4"/>
      </svg>
      <span class="bt-label">${label}</span>`;
    b.title = getParam(id)!.describes;
    const isOn = opts.isOn ?? (() => !!this.get(id));
    b.onclick = () => {
      if (isOn()) this.set(id, false);
      else if (opts.turnOn) opts.turnOn();
      else this.set(id, true);
    };
    this.watch([id, ...(opts.deps ?? [])], () => b.classList.toggle('on', isOn()));
    return b;
  }


  /**
   * The Wobbler page (owner's layout): the shape you draw over the six left boxes, as in ShaperBox
   * (a hard point sits on the line, a soft one pulls the line towards itself; drag a point, Shift
   * snaps to the grid, click it for soft / hard, double-click a point to remove it or empty space
   * to add one), the rate in its title row, a dot following the engine's real phase, the shape
   * palette under it, and one SETTINGS column on the right.
   */
  private buildLfoPage(n: number): HTMLElement {
    const WP = WOB_PREFIXES[n - 1];
    const WOB_DESTS = wobDests(WP), WOB_AMTS = wobAmts(WP), WOB_OFFS = wobOffs(WP), WOB_TARGET_IDS = wobTargetIds(WP);
    const ids = [`${WP}.on`, ...WOB_TARGET_IDS, `${WP}.rate`, `${WP}.free`, `${WP}.hz`, `${WP}.shape`, `${WP}.phase`, `${WP}.smooth`, `${WP}.lowcut`, `${WP}.points`];
    for (let i = 1; i <= WOB_MAX_POINTS; i++) ids.push(`${WP}.x${i}`, `${WP}.y${i}`, `${WP}.s${i}`);
    // (it always looks on, owner's call: targets on NONE simply move nothing)
    const on = () => !!this.get(`${WP}.on`);
    const W = 870, H = 236, PAD = 14, GX = 16, GY = 8;
    const [cv, g] = canvas(W, H, 'disp');
    const [ov, og] = canvas(W, H, 'lfo5-overlay');
    const X = (x: number) => PAD + x * (W - 2 * PAD), Y = (y: number) => PAD + (1 - y) * (H - 2 * PAD);
    // a point's place on screen after the shift (the end point sits where the start does)
    const shown = (x: number) => {
      const ph = this.num(`${WP}.phase`);
      if (ph < 1e-6) return x;
      const d = x + ph;
      return x >= 1 ? ph : d - Math.floor(d);
    };
    let hover = -1, drag = -1, curve: number[] = [], heard: number[] = [];
    // selected points (a box dragged over empty space picks them; dragging one of them moves them all)
    let sel = new Set<number>();
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    let group: { mx: number; my: number; start: WobPoint[] } | null = null;
    const N = W - 2 * PAD;
    const redraw = () => {
      paper(g, W, H);
      // the grid the points snap to (Shift): sixteenths across, eighths up
      for (let i = 0; i <= GX; i++) {
        g.fillStyle = i % 4 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.035)';
        g.fillRect(Math.round(X(i / GX)), PAD, 1, H - 2 * PAD);
      }
      for (let j = 0; j <= GY; j++) {
        g.fillStyle = j % 4 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
        g.fillRect(PAD, Math.round(Y(j / GY)), W - 2 * PAD, 1);
      }
      const shape = String(this.get(`${WP}.shape`));
      const full = this.wobCurve(WP, shape, N);
      // The main line is the shape itself (the points sit on it); each target's own line runs faint with it, as it
      // moves the target (owner's call): depth 100% = on the shape, 0 = flat, -100% = upside down, offset = up / down
      curve = full;
      const rows = [0, 1, 2].map((t) => ({ dest: String(this.get(WOB_DESTS[t])), a: this.num(WOB_AMTS[t]), o: this.num(WOB_OFFS[t]) })).filter((r) => r.dest !== 'none' && (r.a !== 0 || r.o !== 0));
      const lines = rows.map((r) => full.map((v) => Math.max(0, Math.min(1, 0.5 + r.a * (v - 0.5) + r.o / 2))));
      // what is heard, for the level bar under the tab: the first target's line
      heard = lines[0] ?? full;
      const drawTargets = () => {
        if (!on()) return;
        const acc = accentOf(cv);
        for (const ys of lines) {
          g.save();
          g.globalAlpha = 0.55;
          g.strokeStyle = acc;
          g.lineWidth = 1;
          g.lineJoin = 'round';
          g.beginPath();
          ys.forEach((v, i) => (i ? g.lineTo(X(i / N), Y(v)) : g.moveTo(X(i / N), Y(v))));
          g.stroke();
          g.restore();
        }
      };
      const line: [number, number][] = curve.map((v, i) => [X(i / N), Y(v)]);
      if (on()) fillUnder(g, line, H - PAD, accentOf(cv), 0.12, 0.02);
      silver(g, line, on());
      drawTargets();
      // the low cut, as on every print (lit while Volume is on: the gate only works above it)
      // the points: a filled dot sits on the line (hard), a ring pulls the line (soft)
      const col = accentOf(cv);
      const pts = this.wobPoints(WP, shape);
      pts.forEach((q, i) => {
        const r = i === hover || i === drag ? 6 : 4.5, px = X(shown(q.x)), py = Y(q.y);
        const soft = q.s && i > 0 && i < pts.length - 1;
        if (sel.has(i)) {
          // a selected point: a lit ring around it
          g.save();
          g.strokeStyle = col;
          g.lineWidth = 1.2;
          g.shadowColor = col;
          g.shadowBlur = 8;
          g.beginPath();
          g.arc(px, py, r + 4, 0, 2 * Math.PI);
          g.stroke();
          g.restore();
        }
        g.save();
        g.shadowColor = col;
        g.shadowBlur = on() ? 10 : 0;
        g.beginPath();
        g.arc(px, py, r, 0, 2 * Math.PI);
        if (soft) {
          g.fillStyle = '#060607';
          g.fill();
          g.lineWidth = 1.6;
          g.strokeStyle = on() ? '#f2f6fa' : '#6a6a70';
          g.stroke();
        } else {
          g.fillStyle = on() ? '#f2f6fa' : '#6a6a70';
          g.fill();
        }
        g.restore();
      });
      // the selection box while it is dragged
      if (box) {
        const x = Math.min(box.x0, box.x1), y = Math.min(box.y0, box.y1), w = Math.abs(box.x1 - box.x0), hh = Math.abs(box.y1 - box.y0);
        g.save();
        g.fillStyle = hexA(col.startsWith('#') ? col : '#a9dcff', 0.07);
        g.fillRect(x, y, w, hh);
        g.setLineDash([3, 3]);
        g.strokeStyle = 'rgba(230,236,242,0.55)';
        g.lineWidth = 1;
        g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(hh));
        g.restore();
      }
    };
    this.watch(ids, redraw);
    // the moving dot: where the wobble is right now
    const drawDot = () => {
      og.clearRect(0, 0, W, H);
      const p = this.liveWobs[n - 1];
      // what the Wobbler does right now (0..1), for the level bar under its tab (on every page)
      this.wobNows[n - 1] = p !== null && on() && heard.length ? heard[Math.min(N, Math.round(p * N))] : null;
      this.wobOns[n - 1] = on();
      for (const f of this.wobLevelViews) f();
      if (p === null || !on() || ov.offsetParent === null || !curve.length) return;
      const x = X(p), y = Y(curve[Math.min(N, Math.round(p * N))]), col = accentOf(cv);
      og.save();
      og.fillStyle = 'rgba(255,255,255,0.06)';
      og.fillRect(Math.round(x), PAD, 1, H - 2 * PAD);
      og.shadowColor = col;
      og.shadowBlur = 14;
      og.fillStyle = '#ffffff';
      og.beginPath();
      og.arc(x, y, 5, 0, 2 * Math.PI);
      og.fill();
      og.restore();
    };
    this.wobDraws.push(drawDot);

    // editing (in the shape's own time: the shift is taken back out)
    const at = (e: PointerEvent | MouseEvent) => {
      const r = ov.getBoundingClientRect();
      const dx = Math.max(0, Math.min(1, ((e.clientX - r.left) * (W / r.width) - PAD) / (W - 2 * PAD)));
      let x = dx - this.num(`${WP}.phase`);
      x -= Math.floor(x);
      return { x, y: Math.max(0, Math.min(1, 1 - ((e.clientY - r.top) * (H / r.height) - PAD) / (H - 2 * PAD))) };
    };
    const snap = (v: { x: number; y: number }, e: MouseEvent) => (e.shiftKey ? { x: Math.round(v.x * GX) / GX, y: Math.round(v.y * GY) / GY } : v);
    const hit = (e: PointerEvent | MouseEvent) => {
      const r = ov.getBoundingClientRect(), mx = (e.clientX - r.left) * (W / r.width), my = (e.clientY - r.top) * (H / r.height);
      let best = -1, bd = 10;
      this.wobPoints(WP).forEach((q, i) => {
        const d = Math.hypot(X(shown(q.x)) - mx, Y(q.y) - my);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };
    let moved = false, clickTimer = 0;
    const local = (e: PointerEvent | MouseEvent) => {
      const r = ov.getBoundingClientRect();
      return { mx: (e.clientX - r.left) * (W / r.width), my: (e.clientY - r.top) * (H / r.height) };
    };
    ov.addEventListener('pointerdown', (e) => {
      if (this.get(`${WP}.shape`) === 'random') return;
      const i = hit(e);
      ov.setPointerCapture(e.pointerId);
      moved = false;
      if (i < 0) {
        // empty space: drag a box to select points (Shift adds to the selection)
        const { mx, my } = local(e);
        if (!e.shiftKey) sel = new Set();
        box = { x0: mx, y0: my, x1: mx, y1: my };
        redraw();
        return;
      }
      if (sel.has(i) && sel.size > 1) {
        // one of the selected points: they all move together
        const { mx, my } = local(e);
        group = { mx, my, start: this.wobPoints(WP).map((q) => ({ ...q })) };
        drag = i;
        return;
      }
      sel = new Set();
      drag = i;
    });
    ov.addEventListener('pointermove', (e) => {
      if (box) {
        const { mx, my } = local(e);
        box.x1 = mx;
        box.y1 = my;
        redraw();
        return;
      }
      if (drag < 0) {
        const i = hit(e);
        if (i !== hover) { hover = i; ov.style.cursor = i >= 0 ? 'grab' : 'crosshair'; redraw(); }
        return;
      }
      if (group) {
        const { mx, my } = local(e);
        const st = group.start, last = st.length - 1;
        let dx = (mx - group.mx) / (W - 2 * PAD), dy = -(my - group.my) / (H - 2 * PAD);
        if (e.shiftKey) {
          dx = Math.round(dx * GX) / GX;
          dy = Math.round(dy * GY) / GY;
        }
        // keep every selected point inside the graph and in order with the points that stay
        for (const i of sel) {
          dy = Math.max(-st[i].y, Math.min(1 - st[i].y, dy));
          if (i === 0 || i === last) continue;
          if (!sel.has(i - 1)) dx = Math.max(st[i - 1].x + 0.002 - st[i].x, dx);
          if (!sel.has(i + 1)) dx = Math.min(st[i + 1].x - 0.002 - st[i].x, dx);
        }
        const pts = st.map((q, i) => (sel.has(i) ? { ...q, x: i === 0 || i === last ? q.x : q.x + dx, y: q.y + dy } : { ...q }));
        moved = true;
        this.setWobPoints(WP, pts);
        return;
      }
      const pts = this.wobPoints(WP).map((q) => ({ ...q }));
      let { x, y } = snap(at(e), e);
      const last = pts.length - 1;
      // the first and last points stay at the start and end of the cycle; the rest keep their order
      x = drag === 0 ? 0 : drag === last ? 1 : Math.max(pts[drag - 1].x + 0.002, Math.min(pts[drag + 1].x - 0.002, x));
      if (Math.abs(x - pts[drag].x) < 1e-6 && Math.abs(y - pts[drag].y) < 1e-6) return;
      moved = true;
      pts[drag] = { ...pts[drag], x, y };
      this.setWobPoints(WP, pts);
    });
    ov.addEventListener('pointerup', (e) => {
      if (ov.hasPointerCapture(e.pointerId)) ov.releasePointerCapture(e.pointerId);
      if (box) {
        const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1), y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
        this.wobPoints(WP).forEach((q, i) => {
          const px = X(shown(q.x)), py = Y(q.y);
          if (px >= x0 && px <= x1 && py >= y0 && py <= y1) sel.add(i);
        });
        box = null;
        redraw();
        return;
      }
      if (drag < 0) return;
      const i = drag;
      drag = -1;
      const wasGroup = !!group;
      group = null;
      // a click (no drag) switches a point between hard (on the line) and soft (pulling it), unless
      // a double-click follows; the first and last points always stay on the line
      if (!moved && !wasGroup) {
        clearTimeout(clickTimer);
        clickTimer = window.setTimeout(() => {
          const pts = this.wobPoints(WP).map((q) => ({ ...q }));
          if (pts[i] && i > 0 && i < pts.length - 1) pts[i].s = !pts[i].s;
          this.setWobPoints(WP, pts);
        }, 230);
      }
      redraw();
    });
    // Delete / Backspace removes the selected points (the first and last stay); Escape drops the selection.
    document.addEventListener('keydown', (e) => {
      if (!sel.size || ov.offsetParent === null) return;
      if (e.key === 'Escape') {
        sel = new Set();
        redraw();
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const pts = this.wobPoints(WP);
      const keep = pts.filter((_, i) => !sel.has(i) || i === 0 || i === pts.length - 1);
      sel = new Set();
      if (keep.length !== pts.length) this.setWobPoints(WP, keep.map((q) => ({ ...q })));
      else redraw();
      e.preventDefault();
    });
    // switching to another shape (a palette tile, a preset) drops the selection
    this.watch([`${WP}.shape`, `${WP}.points`], () => {
      const n = this.wobPoints(WP).length;
      for (const i of [...sel]) if (i >= n) sel.delete(i);
    });
    ov.addEventListener('dblclick', (e) => {
      clearTimeout(clickTimer);
      if (this.get(`${WP}.shape`) === 'random') return;
      sel = new Set();
      const pts = this.wobPoints(WP).map((q) => ({ ...q }));
      const i = hit(e);
      if (i >= 0) {
        // double-click a point: remove it (the first and last stay)
        if (i > 0 && i < pts.length - 1) pts.splice(i, 1);
        else return;
      } else {
        if (pts.length >= WOB_MAX_POINTS) return;
        const { x, y } = snap(at(e), e);
        if (x <= 0.002 || x >= 0.998) return;
        pts.push({ x, y, s: false });
      }
      this.setWobPoints(WP, pts);
    });
    ov.addEventListener('pointerleave', () => { if (hover >= 0) { hover = -1; redraw(); } });
    ov.title = 'Drag a point (Shift snaps to the grid) · click it: on the line (hard) or pulling the line (soft) · double-click a point to remove it, empty space to add one · drag over empty space to select several points, then drag one of them to move them together (Delete removes them)';
    const edit = h('div', 'lfo5-edit', cv, ov);

    // the rate in the title row: a big value that opens the rate menu (triplet / straight / dotted
    // columns, as in ShaperBox), and arrows either side that step shorter / longer
    const rateP = getParam(`${WP}.rate`)!;
    const rateSel = h('select', 'sel-name lfo5-rate-sel');
    const groups: [string, (o: string) => boolean][] = [['TRIPLET', (o) => o.endsWith('T')], ['STRAIGHT', (o) => !/[Td]$/.test(o) && o !== '3/4' && !/^(1\.5|3) /.test(o)], ['DOTTED', (o) => o.endsWith('d') || o === '3/4' || /^(1\.5|3) /.test(o)]];
    for (const [name, has] of groups) {
      const og = document.createElement('optgroup');
      og.label = name;
      for (const o of rateP.options!) if (has(o)) og.append(new Option(o, o));
      rateSel.append(og);
    }
    rateSel.dataset.ddStep = '1';
    rateSel.onchange = () => this.set(`${WP}.rate`, rateSel.value);
    // the arrows step within the current column (straight stays straight, triplet stays triplet)
    const stepRate = (d: number) => {
      const cur = String(this.get(`${WP}.rate`));
      const o = rateP.options!.filter((x) => (groups.find(([, has]) => has(cur)) ?? groups[1])[1](x)), i = o.indexOf(cur);
      this.set(`${WP}.rate`, o[Math.max(0, Math.min(o.length - 1, i + d))]);
    };
    const rPrev = h('button', 'lfo5-arrow lfo5-rate-arrow', '‹'), rNext = h('button', 'lfo5-arrow lfo5-rate-arrow', '›');
    rPrev.title = 'Shorter (faster)';
    rNext.title = 'Longer (slower)';
    this.watch([`${WP}.rate`], () => { rateSel.value = String(this.get(`${WP}.rate`)); });
    // HZ mode (owner's call): the note value gives way to a Hz value, dragged up / down (Shift = fine), the arrows
    // stepping a semitone of rate; double-click = 2 Hz
    const hzP = getParam(`${WP}.hz`)!;
    const hzBox = h('button', 'sel-name lfo5-rate-sel lfo5-hz');
    hzBox.dataset.param = `${WP}.hz`;
    hzBox.title = `${hzP.describes} Drag up / down (Shift = fine), double-click = 2 Hz.`;
    const setHz = (v: number) => this.set(`${WP}.hz`, Math.round(Math.max(hzP.min!, Math.min(hzP.max!, v)) * 1000) / 1000);
    hzBox.addEventListener('pointerdown', (e) => {
      hzBox.setPointerCapture(e.pointerId);
      const y0 = e.clientY, v0 = this.num(`${WP}.hz`);
      const move = (m: PointerEvent) => setHz(v0 * Math.pow(2, ((y0 - m.clientY) / (m.shiftKey ? 400 : 80))));
      const up = () => { hzBox.removeEventListener('pointermove', move); hzBox.removeEventListener('pointerup', up); };
      hzBox.addEventListener('pointermove', move);
      hzBox.addEventListener('pointerup', up);
    });
    hzBox.ondblclick = () => setHz(2);
    const free = () => !!this.get(`${WP}.free`);
    const step = (d: number) => (free() ? setHz(this.num(`${WP}.hz`) * Math.pow(2, -d / 12)) : stepRate(d));
    rPrev.onclick = () => step(-1);
    rNext.onclick = () => step(1);
    const hzSw = this.textSwitch(['HZ', 'SYNC'], free, (f) => this.set(`${WP}.free`, f), [`${WP}.free`]);
    this.watch([`${WP}.free`, `${WP}.hz`], () => {
      const v = this.num(`${WP}.hz`);
      hzBox.textContent = `${v < 10 ? v.toFixed(2) : v.toFixed(1)} Hz`;
      hzBox.style.display = free() ? '' : 'none';
      rateSel.style.display = free() ? 'none' : '';
      rPrev.title = free() ? 'Faster' : 'Shorter (faster)';
      rNext.title = free() ? 'Slower' : 'Longer (slower)';
    });
    const rate = h('div', 'lfo5-rate', hzSw, rPrev, rateSel, hzBox, rNext);
    rate.title = rateP.describes;
    const big = this.obox('CUSTOM LFO', 'box-wob lfo5-main', {
      head: [rate, this.lfo5LockButton()],
      print: edit,
    });

    // SETTINGS: the switch, depth / low cut / smooth, the shift arrows, the two targets
    const shift = (d: number) => {
      let v = Math.round(this.num(`${WP}.phase`) * GX) + d;
      v = ((v % GX) + GX) % GX;
      this.set(`${WP}.phase`, v / GX);
    };
    const sPrev = h('button', 'lfo5-arrow', '<'), sNext = h('button', 'lfo5-arrow', '>');
    sPrev.title = 'Move the shape earlier (a sixteenth of the cycle)';
    sNext.title = 'Move the shape later (a sixteenth of the cycle)';
    sPrev.onclick = () => shift(-1);
    sNext.onclick = () => shift(1);
    this.watch([`${WP}.phase`], () => sPrev.parentElement?.classList.toggle('shifted', this.num(`${WP}.phase`) > 1e-6));
    const lampFor = (id: string, label: string) => {
      const b = h('button', 'led', lamp(), label);
      b.onclick = () => this.set(id, !this.get(id));
      this.watch([id], () => b.classList.toggle('on', !!this.get(id)));
      b.title = getParam(id)!.describes;
      return b;
    };
    // its targets (owner's pick, option 1): up to three rows, each a target menu, a centre bar for its depth (left =
    // minus, right = plus; drag it, double-click = 0), the value and ×; + ADD TARGET under them. FILTER and VOLUME are
    // its own filter and gate (the classic wobble, Lo cut keeping the low end out); the rest move as LFO 1-4 move them
    const rowsBox = h('div', 'lfo5-rows', h('div', 'lfo5-heads', h('span', '', 'DEPTH'), h('span', '', 'OFFSET')));
    const rowEls: HTMLElement[] = [];
    for (let t = 0; t < 4; t++) {
      const dId = WOB_DESTS[t], aId = WOB_AMTS[t];
      const sel = h('select', 'sel-name') as HTMLSelectElement;
      for (const [title, os] of LFO_TARGETS) {
        const og = document.createElement('optgroup');
        og.label = title;
        // (its FILTER is its own filter; the per-source filters are LFO 1-4's)
        for (const o of os) if (!o.startsWith('lfo_filter_')) og.append(new Option(LFO_TARGET_NAME[o] ?? o, o));
        sel.append(og);
      }
      const pick = (d: string) => {
        this.set(dId, d);
        if (d !== 'none' && this.num(aId) === 0 && this.num(WOB_OFFS[t]) === 0) this.set(aId, 1);
        this.set(`${WP}.on`, true);
      };
      sel.onchange = () => pick(sel.value);
      const learn = this.learnButton((b) => this.startLearn(pick, `p:${WP}.`, b));
      // Depth and Offset (owner's pick, knobs only): small dials, their values on hover like every dial
      const depthK = this.knob(aId, 'Depth', 'tiny', { fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%` });
      const offK = this.knob(WOB_OFFS[t], 'Offset', 'tiny', { fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%` });
      // the four rows are always there (owner's call), a row on NONE moves nothing
      const row = h('div', 'lfo5-row', h('div', 'sel lfo5-target-sel', sel), learn, h('div', 'lfo5-dials', depthK, offK));
      rowEls.push(row);
      rowsBox.append(row);
      this.watch([dId, ...RUIN_SLOT_IDS], () => {
        this.driveGroup(sel);
        this.dropGoneDrive(dId);
        const dest = String(this.get(dId));
        this.customOption(sel, dest);
        sel.value = dest;
      });
    }
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    // under the four targets (owner's layout): the master Depth and Smooth on the left, ONE SHOT over Shift on the right
    const settings = h('div', 'c ob box-wob lfo5-settings',
      h('div', 'ob-head', h('span', 'ob-bar'), h('span', 'c-title', 'TARGET')),
      h('div', 'lfo5-sec lfo5-switch', rowsBox),
      h('div', 'lfo5-sec lfo5-bottom',
        h('div', 'lfo5-knobs',
          this.knob(`${WP}.master`, 'Depth', 'lg', { fmt: pct }),
          this.knob(`${WP}.smooth`, 'Smooth', 'lg', { fmt: pct })),
        h('div', 'lfo5-right',
          // ONE SHOT (owner's call): the shape runs once from every note and holds its end
          h('div', 'lfo5-oneshot', this.toggle(`${WP}.oneshot`, 'ONE SHOT', 'small')),
          h('div', 'lfo5-shift', h('span', 'k-label', 'Shift'), sPrev, sNext))));
    void lampFor;

    // off (switched off, or Depth at 0): the settings go dark like any other box's, the switch stays lit
    this.watch([`${WP}.on`, ...WOB_TARGET_IDS], () => {
      settings.classList.toggle('is-off', !on());
      big.classList.toggle('is-off', !on());
    });

    // The shape palette under the print (as in ShaperBox): one tile per shape, the chosen one lit.
    const TW = 96, TH = 46, TN = TW - 16;
    const tiles: HTMLElement[] = [];
    // the first eight on the palette, the rest in MORE ▾
    const allShapes = getParam(`${WP}.shape`)!.options!;
    const moreShapes = allShapes.slice(8);
    for (const shape of allShapes) {
      const [tc, tgx] = canvas(TW, TH, 'disp');
      const tile = h('button', 'lfo5-tile', tc, h('span', 'lfo5-tile-name', shape.toUpperCase()));
      tile.title = `Shape: ${shape} (resets the shift)`;
      tile.onclick = () => {
        this.set(`${WP}.phase`, 0);
        this.set(`${WP}.shape`, shape);
      };
      this.watch(ids, () => {
        const chosen = this.get(`${WP}.shape`) === shape;
        tile.classList.toggle('on', chosen);
        paper(tgx, TW, TH);
        const pts: [number, number][] = [];
        for (let i = 0; i <= TN; i++) pts.push([8 + i, TH - 7 - this.wobValueFor(WP, shape, i / TN) * (TH - 14)]);
        silver(tgx, pts, chosen && on());
      });
      tiles.push(tile);
    }
    // MORE ▾ under the last tile opens a dropdown with the 8 more shapes (lit while one of them is chosen).
    const menu = h('div', 'lfo5-more-menu', ...tiles.slice(8));
    const more = h('button', 'lfo5-more', 'MORE ▾');
    more.title = '8 more shapes';
    this.watch([`${WP}.shape`], () => more.classList.toggle('picked', moreShapes.includes(String(this.get(`${WP}.shape`)))));
    const palette = h('div', 'c ob box-wob lfo5-palette', ...tiles.slice(0, 8), more, menu);
    const close = () => {
      menu.classList.remove('open');
      more.classList.remove('on');
    };
    more.onclick = (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
      more.classList.toggle('on', menu.classList.contains('open'));
    };
    document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target as Node) && e.target !== more) close(); });
    menu.addEventListener('click', (e) => { if ((e.target as Element).closest('.lfo5-tile')) close(); });
    // the LFO page (owner's call): the shapes as a menu from the custom LFO's title row: ‹ SINE ▾ › opens all of
    // them as tiles over the drawing, picking one closes it
    const shapeName = h('span', 'lfo5-shape-name');
    const shapeBtn = h('button', 'lfo5-shape-btn', shapeName, h('span', 'lfo5-shape-caret', '▾'));
    shapeBtn.title = 'Pick a ready shape (or draw your own on the grid)';
    this.watch([`${WP}.shape`], () => { shapeName.textContent = String(this.get(`${WP}.shape`)).toUpperCase(); });
    const pop = h('div', 'lfo5-shape-pop', ...tiles);
    const closePop = () => { pop.classList.remove('open'); shapeBtn.classList.remove('on'); };
    shapeBtn.onclick = (e) => {
      e.stopPropagation();
      pop.classList.toggle('open');
      shapeBtn.classList.toggle('on', pop.classList.contains('open'));
    };
    pop.addEventListener('click', (e) => { if ((e.target as Element).closest('.lfo5-tile')) closePop(); });
    document.addEventListener('pointerdown', (e) => { if (!pop.contains(e.target as Node) && !shapeBtn.contains(e.target as Node)) closePop(); });
    // the four custom LFOs (owner's call): 1 2 3 4 between the title and the shape menu, the shown one lit, the
    // others marked while they do something
    const nums = h('div', 'lfo5-nums', ...[1, 2, 3, 4].map((k) => {
      const b = h('button', 'lfo5-num', String(k));
      b.title = `Custom LFO ${k}`;
      b.onclick = () => this.showWob(k - 1);
      const view = () => {
        b.classList.toggle('on', k === n);
        b.classList.toggle('busy', this.wobOns[k - 1]);
      };
      this.wobSelViews.push(view);
      this.watch(WOB_PREFIXES.flatMap((w) => [`${w}.on`, ...wobTargetIds(w)]), view);
      return b;
    }));
    big.querySelector('.ob-head .c-title')?.after(nums);
    nums.after(shapeBtn);
    this.wobBoxes[n - 1] = [big, settings];
    big.append(pop);
    void palette;
    return h('div', 'v2-main osc-page lfo-page', big, settings);
  }


  /**
   * The MOD page: LFO 1–6 on the left (two columns of three) and the 12-slot matrix filling the
   * right half.
   */
  /**
   * The LFO page (owner's pick, option 1): the custom LFO (the Wobbler's drawn shape, empty on every preset) across
   * the top with its TARGET box, LFO 1-4 below, each with its own target. No matrix, no LFO 5-6, no WOBBLER tab.
   */
  private buildModPage(wob: HTMLElement): HTMLElement {
    const page = h('div', 'v2-main mod-page2 lfo-all', ...this.wobBoxes.flat(), this.lfoBox(1), this.lfoBox(2), this.lfoBox(3), this.lfoBox(4));
    void wob;
    this.showWob(this.wobSel);
    return page;
  }

  /** Show custom LFO i (0-3) on the LFO page: its drawing and its TARGET box; the others hide. */
  private showWob(i: number): void {
    this.wobSel = i;
    this.wobBoxes.forEach(([big, settings], k) => {
      big.classList.toggle('wob-hidden', k !== i);
      settings.classList.toggle('wob-hidden', k !== i);
    });
    for (const f of this.wobSelViews) f();
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

  /**
   * The Tape box's machines (owner's call, the classic preset menu): picking one only sets the box's
   * dials (Wow and Drift) to that machine's; touching a dial afterwards shows "· CUSTOM" after its name.
   * Wow is set so the pitch swings as the machine's measured wow & flutter does (a weighted 0.1 % ≈
   * ±2.4 cents at its peaks): pro reels under 0.04 %, the best cassette decks ~0.08 %, a Sony WM-2
   * 0.4 % on a fresh belt and 0.8 % on a worn one; the rest estimated from typical figures. Drift is
   * how old the rest of the rig sounds alongside it.
   */
  /**
   * A drive type menu (RUIN's stages and the FX page's DRIVE; owner's pick): the types in columns by what
   * they do, gentle to destroyed (WARM saturates, CLIP cuts the peaks, BREAK rewrites the wave, DIGITAL
   * takes the resolution away), each with a tiny picture of one sine cycle through it.
   */
  private driveTypeSelector(id: string): HTMLElement {
    const el = this.selector(id, { groups: DRIVE_GROUPS, only: true });
    for (const o of el.querySelectorAll('option')) o.dataset.icon = driveIconPath(o.value);
    return el;
  }

  /** RUIN's filter types as the title's menu: CUT / BOOST, each with a picture of its curve. */
  private tapeLast = '';
  private tapeTypes(): HTMLElement {
    const TYPES: [string, number, number][] = [
      ['STUDIO REEL', 0.04, 0.1], ['CASSETTE DECK', 0.09, 0.2], ['4-TRACK', 0.13, 0.3], ['WALKMAN', 0.33, 0.3],
      ['DICTAPHONE', 0.36, 0.5], ['WORN WALKMAN', 0.45, 0.4], ['WARPED VINYL', 0.46, 0.2], ['BROKEN', 0.87, 0.7],
    ];
    const sel = h('select', 'sel-name') as HTMLSelectElement;
    for (const [n] of TYPES) sel.append(new Option(n, n));
    const custom = new Option('CUSTOM', '_custom');
    custom.hidden = true;
    sel.append(custom);
    const near = (a: number, b: number) => Math.abs(a - b) < 0.006;
    sel.onchange = () => {
      const t = TYPES.find(([n]) => n === sel.value);
      if (!t) return;
      this.tapeLast = t[0];
      if (!this.get('tape.on')) this.set('tape.on', true);
      this.set('tape.wow', t[1]);
      this.set('voice.analog', t[2]);
    };
    this.watch(['tape.wow', 'voice.analog'], () => {
      const wow = this.num('tape.wow'), drift = this.num('voice.analog');
      const hit = TYPES.find(([, w, d]) => near(w, wow) && near(d, drift));
      if (hit) {
        this.tapeLast = hit[0];
        sel.value = hit[0];
      } else {
        custom.text = this.tapeLast ? `${this.tapeLast} · CUSTOM` : 'CUSTOM';
        sel.value = '_custom';
      }
    });
    const el = h('div', 'sel', sel);
    el.title = 'Tape machines: picking one sets Wow and Drift to that machine; change a dial and it becomes custom';
    return el;
  }

  /**
   * The Tape print (owner's call: show exactly how the pitch moves): pitch in cents over 4 seconds,
   * the centre in tune, top and bottom ±20 cents or as far as the line needs. Wow and flutter move the
   * whole sound together, at the engine's own curved depths (the reel's ~0.55 Hz swing, up to ±200 cents,
   * and its 7.3 Hz flutter, up to ±50): the bright line. Drift moves each oscillator on its own (up to
   * ±40 cents on the core, ±60 on the unison copies): it rides on the bright line, the copies as fainter lines around it when
   * unison is on. The drift's path is random in the engine, so its line shows its size and pace.
   */
  private tapePitchPrint(): HTMLElement {
    const W = PRINT_W, H = PRINT_H, TAU = 2 * Math.PI, SPAN = 4;
    const [cv, g] = canvas(W, H, 'disp');
    const redraw = () => {
      paper(g, W, H);
      const wow = this.get('tape.on') ? this.num('tape.wow') : 0, an = this.num('voice.analog');
      // the engine's curved depths (cents): wow, flutter, drift on the core and on the unison copies
      const w4 = wow ** 4, a4 = an ** 4;
      const wowC = 13.2 * wow + 186.8 * w4, flutC = 9.5 * wow + 40.5 * w4, coreC = 2.5 * an + 37.5 * a4, copyC = 7 * an + 53 * a4;
      const uni = Math.max(this.num('osc1.unison_voices'), this.num('osc2.unison_voices'));
      // the scale grows with the depth: ±20 cents, or whatever the line needs (in steps of 20)
      const RANGE = Math.max(20, Math.ceil((wowC + flutC + (uni > 1 ? copyC : coreC)) / 20) * 20);
      const lit = wow > 0 || an > 0, col = accentOf(cv);
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.09)';
      g.setLineDash([2, 4]);
      g.beginPath();
      g.moveTo(0, H / 2);
      g.lineTo(W, H / 2);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = lit ? hexA(col, 0.6) : '#55555b';
      g.font = '9px "Space Grotesk", sans-serif';
      g.textAlign = 'right';
      g.fillText(RANGE >= 100 ? `±${(RANGE / 100).toFixed(RANGE % 100 ? 1 : 0)} ST` : `±${RANGE} CT`, W - 6, 12);
      g.restore();
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      const wander = () => {
        const p = Array.from({ length: 8 }, rnd);
        return (t: number) => { const x = (t / SPAN) * 6, i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f); return p[i] + (p[i + 1] - p[i]) * s; };
      };
      const core = wander(), copies = [wander(), wander()];
      const wowAt = (t: number) => wowC * Math.sin(TAU * 0.55 * t) + flutC * Math.sin(TAU * 7.3 * t);
      const y = (c: number) => H / 2 - Math.max(-1.05, Math.min(1.05, c / RANGE)) * (H / 2 - 8);
      const line = (cents: (t: number) => number): [number, number][] => Array.from({ length: W + 1 }, (_, i) => [i, y(cents((i / W) * SPAN))]);
      if (an > 0 && uni > 1) for (const c of copies) silver(g, line((t) => wowAt(t) + copyC * c(t)), lit, shade(col, 0.45));
      silver(g, line((t) => wowAt(t) + coreC * core(t)), lit);
      loCutStrip(g, W, H, this.num('tape.lowcut'), wow > 0, col);
    };
    this.watch(['tape.on', 'tape.wow', 'tape.lowcut', 'voice.analog', 'osc1.unison_voices', 'osc2.unison_voices'], redraw);
    return cv;
  }

  /**
   * The chorus print: the wave and its copies, offset in time like a chorus plays them. Classic is two,
   * ensemble three, hyper six; Depth spreads them further apart, Mix lights the copies.
   */
  private chorusPrint(): HTMLElement {
    const W = PRINT_W, H = PRINT_H, TAU = 2 * Math.PI;
    const [cv, g] = canvas(W, H, 'disp');
    const redraw = () => {
      paper(g, W, H);
      const lit = !!this.get('chorus.on') && this.num('chorus.mix') > 0, col = lit ? accentOf(cv) : '#4a4a50';
      const mode = this.get('chorus.mode'), v = mode === 'hyper' ? 6 : mode === 'ensemble' ? 3 : 2;
      const d = this.num('chorus.depth'), m = this.num('chorus.mix');
      const wave = (off: number): [number, number][] => Array.from({ length: W + 1 }, (_, x) => [x, H / 2 - 4 - 0.62 * (H / 2 - 10) * Math.sin(TAU * ((x / W) * 2.5 - off))]);
      if (m > 0) for (let i = 0; i < v; i++) silver(g, wave(((i + 1) / v) * (0.03 + 0.2 * d) * (i % 2 ? -1 : 1)), lit, shade(col, 0.3 + 0.55 * m));
      silver(g, wave(0), lit);
      loCutStrip(g, W, H, this.num('chorus.lowcut'), lit, col);
    };
    this.watch(['chorus.on', 'chorus.mix', 'chorus.depth', 'chorus.mode', 'chorus.lowcut'], redraw);
    return cv;
  }

  /**
   * HYPER / DIMENSION's print: Unison copies of the wave, pulled apart by Detune, their bend by Rate, as bright as Mix;
   * DIMENSION a faint left / right pair spread by Size, as bright as its Mix.
   */
  private hyperPrint(): HTMLElement {
    const W = PRINT_W, H = PRINT_H, TAU = 2 * Math.PI;
    const [cv, g] = canvas(W, H, 'disp');
    const redraw = () => {
      paper(g, W, H);
      const on = !!this.get('hyper.on'), m = this.num('hyper.mix'), dm = this.num('hyper.dim_mix');
      const lit = on && (m > 0 || dm > 0), col = lit ? accentOf(cv) : '#4a4a50';
      const u = Math.round(this.num('hyper.unison')), d = this.num('hyper.detune'), rate = this.num('hyper.rate');
      const bend = 0.04 * Math.log2(1 + rate);
      const wave = (off: number, amp = 1, dy = 0): [number, number][] =>
        Array.from({ length: W + 1 }, (_, x) => [x, H / 2 - 4 + dy - amp * 0.6 * (H / 2 - 10) * Math.sin(TAU * ((x / W) * 2.5 - off + bend * Math.sin(TAU * (x / W) * (0.5 + rate / 4))))]);
      if (on && dm > 0) {
        const sp = 3 + 9 * this.num('hyper.size');
        silver(g, wave(0.02, 0.9, -sp), lit, shade(col, 0.15 + 0.4 * dm));
        silver(g, wave(-0.02, 0.9, sp), lit, shade(col, 0.15 + 0.4 * dm));
      }
      if (on && m > 0) for (let i = 0; i < u; i++) {
        const k = u > 1 ? i / (u - 1) - 0.5 : 0;
        silver(g, wave(k * (0.02 + 0.3 * d)), lit, shade(col, 0.3 + 0.55 * m));
      }
      silver(g, wave(0), lit);
    };
    this.watch(['hyper.on', 'hyper.mix', 'hyper.dim_mix', 'hyper.unison', 'hyper.detune', 'hyper.rate', 'hyper.size'], redraw);
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
   * A drive's band as Ableton's Overdrive shows it (RUIN's stages and the FX page's DRIVE): the band as a
   * curve with a ball you drag (sideways = where, up / down = how wide; double-click = the whole sound),
   * Tone as a dotted top, more drive a brighter fill, and the Lo cut as the strip along the bottom.
   */
  private drivePad(o: { on: () => boolean; freq: string; width: string; tone: string; drive: string; lowcut?: string; deps?: string[] }): HTMLElement {
    const W = PRINT_W, H = PRINT_H;
    const [cv, g] = canvas(W, H, 'disp gr-band');
    const bandY = (w: number) => H - 10 - ((w - 0.5) / 8.5) * (H - 22);
    const draw = () => {
      // as a RUIN drive draws it (owner's call): the band as a shaded zone where the drive bites (brighter the
      // harder it drives), the sound outside it a flat line (it passes untouched), Tone a dotted line, the ring
      paper(g, W, H);
      const on = o.on(), col = on ? accentOf(cv) : '#4a4a50';
      const fc = this.num(o.freq), w = this.num(o.width), tone = this.num(o.tone), drive = this.num(o.drive);
      const full = w >= 8.95;
      const lo = full ? 20 : fc * Math.pow(2, -w / 2), hi = full ? 20000 : fc * Math.pow(2, w / 2);
      const x0 = freqX(lo, W), x1 = freqX(hi, W), y0 = grindY(1, H), lift = (H * 0.28) * (0.25 + drive);
      if (on) {
        g.fillStyle = hexA(col, 0.04 + 0.14 * drive);
        g.fillRect(x0, 0, x1 - x0, H);
        g.fillStyle = hexA(col, 0.6);
        g.fillRect(x0, 0, x1 - x0, 2);
      }
      // the line: flat outside the band, raised inside it (driven), with soft shoulders at its edges
      const pts: [number, number][] = [];
      for (let i = 0; i <= W; i += 2) {
        const f = 20 * Math.pow(1000, i / W), oct = Math.log2(f / fc);
        const inside = full ? 1 : 1 / (1 + Math.pow(Math.abs(oct) / Math.max(0.25, w / 2), 8));
        pts.push([i, y0 - (on ? lift * inside : 0)]);
      }
      silver(g, pts, on);
      if (on && tone < 0.999) {
        const tx = freqX(200 * Math.pow(100, tone), W);
        g.save();
        g.setLineDash([2, 3]);
        g.strokeStyle = hexA(col, 0.6);
        g.beginPath();
        g.moveTo(tx, 14);
        g.lineTo(tx, H);
        g.stroke();
        g.restore();
      }
      g.save();
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.shadowColor = col;
      g.shadowBlur = on ? 8 : 0;
      g.fillStyle = '#0d0d0f';
      g.beginPath();
      g.arc(freqX(fc, W), bandY(w), 4.5, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
      g.restore();
      g.fillStyle = on ? hexA(col, 0.85) : '#55555b';
      g.font = '9px "Space Grotesk", sans-serif';
      g.textAlign = 'right';
      g.fillText(full ? 'WHOLE SOUND' : `${fc >= 1000 ? (fc / 1000).toFixed(2) + ' kHz' : Math.round(fc) + ' Hz'} · ${w.toFixed(1)} oct`, W - 6, 12);
      g.textAlign = 'left';
      if (o.lowcut) loCutStrip(g, W, H, this.num(o.lowcut), on, col);
    };
    const set = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
      this.set(o.freq, Math.round(Math.max(50, Math.min(18000, 20 * Math.pow(1000, x / W)))));
      this.set(o.width, Math.round(Math.max(0.5, Math.min(9, 0.5 + ((H - 10 - y) / (H - 22)) * 8.5)) * 100) / 100);
    };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); set(e); });
    cv.addEventListener('pointermove', (e) => { if (cv.hasPointerCapture(e.pointerId)) set(e); });
    cv.addEventListener('dblclick', () => this.set(o.width, 9));
    cv.title = "The drive's band: only the shaded part is driven, the rest passes untouched. Drag the ring sideways for where, up / down for how wide; double-click for the whole sound";
    this.watch([o.freq, o.width, o.tone, o.drive, ...(o.lowcut ? [o.lowcut] : []), ...(o.deps ?? [])], draw);
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
    const md6 = (id: string, label: string, opts: Parameters<SynthView['knob']>[3] = {}) => this.knob(id, label, 'mid', opts);
    const distLow = md6('dist.clean_below', 'Lo cut', { fmt: (v) => (v <= 21 ? 'off' : `${Math.round(v)} Hz`) });
    distLow.title = 'Keeps everything below this frequency clean (the distortion only works on the part above it). Fully left = off.';
    // DRIVE: RUIN's drive on the FX page (Ableton's Overdrive layout): the band you drag, then the type,
    // Drive, Tone, Dynamics, Dry/Wet and the Lo cut below which the sound stays clean
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const dist = this.obox('DRIVE', 'fx-box box-dist', {
      power: (el) => this.boolPower('dist.on', el),
      head: [this.driveTypeSelector('dist.type')],
      print: this.drivePad({ on: () => !!this.get('dist.on') && this.num('dist.mix') > 0, freq: 'dist.band_freq', width: 'dist.band_width', tone: 'dist.post_tone', drive: 'dist.drive', lowcut: 'dist.clean_below', deps: ['dist.on', 'dist.mix'] }),
      // six dials: the RUIN boxes' smaller size, so they fit
      dials: [md6('dist.drive', 'Drive', { fmt: pct }), md6('dist.post_tone', 'Tone', { fmt: pct }), md6('dist.mix', 'Dry/Wet', { fmt: pct }), md6('dist.output', 'Output', { fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB` }), distLow],
    });

    const crush = this.obox('CRUSH', 'fx-box box-crush', {
      power: (el) => this.boolPower('crush.on', el),
      print: this.fxLine(['crush.bits', 'crush.rate', 'crush.mix', 'crush.on'], lit('crush.on', 'crush.mix'), (x) => {
        // More bits = finer steps (spread so every bit shows), a higher rate = longer held steps.
        const hold = Math.max(1, this.num('crush.rate')) / 300, q = 1 + (this.num('crush.bits') - 1) * 1.6;
        const xs = Math.floor(x / hold) * hold, c = Math.round(Math.sin(xs * 2 * Math.PI * 2) * 0.9 * q) / q;
        const m = this.get('crush.on') && this.num('crush.mix') > 0 ? this.num('crush.mix') : 1;
        return Math.sin(x * 2 * Math.PI * 2) * 0.9 * (1 - m) + c * m;
      }, false, { lowcut: 'crush.lowcut' }),
      dials: [lg('crush.mix', 'Mix'), lg('crush.bits', 'Bits'), lg('crush.rate', 'Rate'), lowCut('crush')],
    });

    // Tape: Wow, Drift and Lo cut (owner's call: its drive and age were removed); the print is the pitch itself.
    const drift = lg('voice.analog', 'Drift');
    drift.title = 'Analog drift: the oscillators drift slightly in pitch and the filter varies a touch per note, like an old analog synth. 0 is perfectly steady.';
    const tape = this.obox('TAPE', 'fx-box box-tape', {
      power: (el) => this.boolPower('tape.on', el),
      head: [this.tapeTypes()],
      print: this.tapePitchPrint(),
      dials: [lg('tape.wow', 'Wow'), drift, lowCut('tape')],
    });

    const chorus = this.obox('CHORUS', 'fx-box box-chorus', {
      power: (el) => this.boolPower('chorus.on', el),
      head: [this.selector('chorus.mode')],
      print: this.chorusPrint(),
      dials: [lg('chorus.mix', 'Mix'), lg('chorus.depth', 'Depth'), lowCut('chorus')],
    });

    // HYPER / DIMENSION (owner's call, as Serum's): Rate, Detune, Retrig, Unison, Mix | Size, Mix
    const md = (id: string, label: string, opts: Parameters<SynthView['knob']>[3] = {}) => this.knob(id, label, 'mid', opts);
    const hyperUni = h('div', 'hyper-uni',
      h('div', 'k uni-dial', this.chip('UNI', () => this.num('hyper.unison'), (v) => this.set('hyper.unison', v), 1, 7, ['hyper.unison'], 'Unison: how many copies are stacked (1-7)')),
      this.toggle('hyper.retrig', 'RETRIG', 'small'));
    const hyper = this.obox('HYPER', 'fx-box box-hyper', {
      power: (el) => this.boolPower('hyper.on', el),
      head: [h('span', 'fx-kind hyper-dim', 'DIMENSION')],
      print: this.hyperPrint(),
      dials: [md('hyper.rate', 'Rate', { fmt: (v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} Hz` }), md('hyper.detune', 'Detune', { fmt: pct }), hyperUni,
        md('hyper.mix', 'Mix', { fmt: pct }), h('span', 'hyper-div'), md('hyper.size', 'Size', { fmt: pct }), md('hyper.dim_mix', 'Mix', { fmt: pct })],
    });

    // DELAY (owner's call, 26 Nov: back, as it was): the time in its title, the repeats as spikes
    const delay = this.obox('DELAY', 'fx-box box-delay', {
      power: (el) => this.boolPower('delay.on', el),
      head: [this.selector('delay.time', { label: (o) => o })],
      print: this.fxSpikes(['delay.time', 'delay.feedback', 'delay.mix', 'delay.on', 'delay.tone'], lit('delay.on', 'delay.mix'), () => {
        const step = syncBeats(String(this.get('delay.time'))) / 4, fb = this.num('delay.feedback');
        const out: [number, number][] = [[0, 1]];
        const keep = Math.max(0.05, fb) * (0.55 + 0.45 * this.num('delay.tone'));
        for (let i = 1, a = 0.9 * Math.max(0.05, this.num('delay.mix') * 1.4); i < 32 && i * step < 1; i++, a *= keep) out.push([i * step, Math.min(1, a)]);
        return out;
      }, 'delay.lowcut'),
      dials: [lg('delay.mix', 'Mix'), lg('delay.feedback', 'Feedbk'), lg('delay.tone', 'Tone'), lowCut('delay')],
    });

    // The tail as it is: pre-delay as a gap, each type's build-up (a room's early reflections, a
    // cathedral's slow bloom), Decay as its length (log, 0.2-20 s across the print).
    const reverb = this.obox('REVERB', 'fx-box box-reverb', {
      power: (el) => this.boolPower('reverb.on', el),
      head: [this.selector('reverb.type'), h('div', 'ob-chips',
        this.chip('OCT', () => this.num('reverb.octave'), (v) => this.set('reverb.octave', v), -1, 0, ['reverb.octave'], 'Reverb octave: -1 lets each note sink into a dark cloud an octave below itself'))],
      print: this.fxSpikes(['reverb.type', 'reverb.decay', 'reverb.predelay', 'reverb.mix', 'reverb.on', 'reverb.octave'], lit('reverb.on', 'reverb.mix'), () => {
        const type = String(this.get('reverb.type'));
        const len = 0.08 + 0.92 * (Math.log(this.num('reverb.decay') / 0.2) / Math.log(100));
        const mix = 0.35 + 0.65 * Math.min(1, this.num('reverb.mix') * 2.5);
        const gap = 0.3 * (this.num('reverb.predelay') / 250);
        const rise = ({ room: 0.01, plate: 0.004, hall: 0.05, cathedral: 0.12 } as Record<string, number>)[type] ?? 0.05;
        const grain = ({ room: 0.75, plate: 0.15, hall: 0.4, cathedral: 0.45 } as Record<string, number>)[type] ?? 0.4;
        const out: [number, number][] = [];
        // an octave down: half as many, broader grains (the tail moves at half speed)
        const step = this.num('reverb.octave') < 0 ? 2 : 1;
        for (let i = 0; i < 80; i += step) {
          const x = i / 80;
          if (x < gap) continue;
          const t = x - gap;
          const env = (1 - Math.exp(-t / rise)) * Math.exp((-3.5 * t) / len);
          // a room's first reflections stand out as a few tall spikes
          const early = type === 'room' && t < 0.08 && i % 3 === 0 ? 1.25 : 1;
          out.push([x, Math.min(1, mix * env * early * (1 - grain * 0.7 + grain * 0.7 * noise[i]))]);
        }
        return out;
      }, 'reverb.lowcut'),
      dials: [lg('reverb.mix', 'Mix'), lg('reverb.decay', 'Decay'), lg('reverb.predelay', 'Pre-delay'), lowCut('reverb')],
    });

    const eq = this.eqBox();

    return h('div', 'v2-main osc-page fx-page2', dist, crush, tape, chorus, hyper, delay, reverb, eq);
  }

  /**
   * The EQ (owner's layout, like Ableton's EQ Eight): four balls on the graph, a low shelf, two bells
   * and a high shelf, flat by default. Click a ball to select it, drag it (sideways = frequency,
   * up / down = gain), scroll for its Q, double-click to switch it (shelf ↔ high- / low-pass on the
   * outer two, bell ↔ notch on the middle two). Freq, Gain and Q show the selected ball; Scale
   * multiplies every gain (-200 … 200 %). The high cut stays in the engine (under "All controls").
   */
  private eqBox(): HTMLElement {
    const W = PRINT_W, H = PRINT_H, MAXDB = 18;
    const bands = [1, 2, 3, 4].map((n) => `eq.b${n}`);
    const ids = ['eq.on', 'eq.scale', 'eq.highcut', ...bands.flatMap((b) => [`${b}_type`, `${b}_freq`, `${b}_gain`, `${b}_q`])];
    let sel = 1;
    const [cv, g] = canvas(W, H, 'disp eq-graph');
    const bq = [new Biquad(), new Biquad(), new Biquad(), new Biquad(), new Biquad()];
    const xOf = (f: number) => (Math.log(f / 20) / Math.log(1000)) * W;
    const fOf = (x: number) => 20 * Math.pow(1000, Math.max(0, Math.min(1, x / W)));
    const yOf = (db: number) => H / 2 - (Math.max(-MAXDB, Math.min(MAXDB, db)) / MAXDB) * (H / 2 - 7);
    const dbOf = (y: number) => Math.max(-MAXDB, Math.min(MAXDB, ((H / 2 - y) / (H / 2 - 7)) * MAXDB));
    const isPass = (i: number) => Number(getParam(`${bands[i]}_type`)!.options!.indexOf(String(this.get(`${bands[i]}_type`)))) === 1;
    const ball = (i: number): [number, number] => [xOf(this.num(`${bands[i]}_freq`)), isPass(i) ? H / 2 : yOf(this.num(`${bands[i]}_gain`) * this.num('eq.scale'))];
    const redraw = () => {
      paper(g, W, H);
      const on = !!this.get('eq.on'), col = on ? accentOf(cv) : '#4a4a50', sc = this.num('eq.scale');
      for (let i = 0; i < 4; i++) {
        const b = bands[i], hz = Math.min(this.num(`${b}_freq`), FS * 0.45), db = this.num(`${b}_gain`) * sc, q = this.num(`${b}_q`), pass = isPass(i);
        if (i === 0) pass ? bq[i].setHighpass(hz, q, FS) : bq[i].setLowShelf(hz, db, FS, q);
        else if (i === 3) pass ? bq[i].setLowpass(hz, q, FS) : bq[i].setHighShelf(hz, db, FS, q);
        else pass ? bq[i].setNotch(hz, q, FS) : bq[i].setPeak(hz, db, q, FS);
      }
      bq[4].setLowpass(Math.min(this.num('eq.highcut'), FS * 0.45), Math.SQRT1_2, FS);
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.beginPath();
      g.moveTo(0, H / 2);
      g.lineTo(W, H / 2);
      g.stroke();
      g.restore();
      const pts: [number, number][] = [];
      for (let x = 0; x <= W; x += 1.5) {
        const f = fOf(x);
        const m = bq.reduce((a, b, j) => (j === 4 && this.num('eq.highcut') >= 19500 ? a : a * biquadMag(b, f)), 1);
        pts.push([x, yOf(20 * Math.log10(Math.max(m, 1e-5)))]);
      }
      if (on) fillUnder(g, pts, H, col, 0.12);
      silver(g, pts, on);
      for (let i = 0; i < 4; i++) {
        const [x, y] = ball(i), hot = i === sel;
        g.save();
        g.shadowColor = col;
        g.shadowBlur = hot ? 12 : 6;
        g.fillStyle = hot ? '#fff' : on ? col : '#5a5a60';
        g.beginPath();
        g.arc(x, y, hot ? 4.5 : 3.6, 0, 2 * Math.PI);
        g.fill();
        g.shadowBlur = 0;
        g.fillStyle = hot ? '#111' : 'rgba(0,0,0,0.75)';
        g.font = '600 6.5px "Space Grotesk", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(i + 1), x, y + 0.3);
        g.restore();
      }
    };
    this.watch(ids, redraw);
    const near = (e: PointerEvent | MouseEvent): number => {
      let best = -1, bd = 14;
      for (let i = 0; i < 4; i++) {
        const [x, y] = ball(i), d = Math.hypot(e.offsetX - x, e.offsetY - y);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };
    let drag = -1;
    cv.addEventListener('pointerdown', (e) => {
      const i = near(e);
      if (i < 0) return;
      select(i);
      drag = i;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (drag < 0 || !cv.hasPointerCapture(e.pointerId)) return;
      const b = bands[drag];
      this.set(`${b}_freq`, Math.round(fOf(e.offsetX)));
      const sc = this.num('eq.scale');
      if (!isPass(drag) && Math.abs(sc) > 0.01) this.set(`${b}_gain`, Math.round((dbOf(e.offsetY) / sc) * 10) / 10);
    });
    cv.addEventListener('pointerup', (e) => { drag = -1; cv.releasePointerCapture(e.pointerId); });
    cv.addEventListener('dblclick', (e) => {
      const i = near(e);
      if (i < 0) return;
      const id = `${bands[i]}_type`, opts = getParam(id)!.options!;
      this.set(id, opts[isPass(i) ? 0 : 1]);
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const id = `${bands[sel]}_q`, p = getParam(id)!;
      const q = this.num(id) * Math.pow(1.12, -Math.sign(e.deltaY) * (e.shiftKey ? 0.25 : 1));
      this.set(id, Math.round(Math.max(p.min!, Math.min(p.max!, q)) * 100) / 100);
    }, { passive: false });
    cv.title = 'Click a ball to select it, drag it (sideways = frequency, up / down = gain), scroll for its Q, double-click to switch its type.';
    // Freq / Gain / Q of the selected ball (one set per band, the selected one shows), then Scale
    const lg = (id: string, label: string, opts: Parameters<SynthView['knob']>[3] = {}) => this.knob(id, label, 'lg', opts);
    const sets = bands.map((b, i) => {
      const gain = lg(`${b}_gain`, 'Gain', { disabled: () => isPass(i), deps: [`${b}_type`] });
      const el = h('span', 'eq-set', lg(`${b}_freq`, 'Freq'), gain, lg(`${b}_q`, 'Q'));
      return el;
    });
    const select = (i: number) => {
      sel = i;
      sets.forEach((el, j) => { el.style.display = j === i ? '' : 'none'; });
      redraw();
    };
    select(sel);
    const scale = lg('eq.scale', 'Scale', { fmt: (v) => `${Math.round(v * 100)}%` });
    return this.obox('EQ', 'fx-box box-eq', { power: (el) => this.boolPower('eq.on', el), print: cv, dials: [...sets, scale] });
  }

  // ------------------------------------------------------------------ the GRIND page

  /**
   * RUIN (the GRIND chain), option A of the redesign (owner's pick): a strip (ROLL, count, WEIRD, KEY / ONE SHOT /
   * NOISE THRU, OTT, Lo cut, Mix, Output, the rocker), the chain as eight live boxes left to right
   * (filter 1, drive 1 … filter 4, drive 4: each its own spectrum, a level meter with a red cap when it goes over
   * 0 dB, and S / B / Δ to listen), and under it the selected box up close: what it does (before dotted, after lit,
   * the new part filled) with its filter or its drive band on top, the drive's curve with how far the real signal
   * reaches into it, and only its controls.
   */
  private buildGrindPage(): HTMLElement {
    const page = h('div', 'v2-main grind-page ruin-a');
    // the 24 parts (owner's call: up to eight of each): filter 1-8 (k 0-7), drive 1-8 (8-15), EQ 1-8 (16-23),
    // placed in the boxes by grind.slot1..8; part n of each kind belongs to stage n (grind<n>.*)
    const KINDS = ['filter', 'drive', 'eq', 'phaser'] as const;
    const PARTS = KINDS.flatMap((kind) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n, kind, drive: kind === 'drive' })));
    // colours (owner's call, tied to the OSC page, which leads): every drive the OSC A red, every filter the filter's
    // blue, one each, no tints (the page's --c-red / --c-blue, so a change on the OSC page moves them too); the EQs
    // keep their bone, pale to grey (tone shaping, not an effect).
    const EQ_COLS = ['#f4ecdc', '#e6dcc8', '#d8ceba', '#c9c0ae', '#bab3a4', '#aaa59a', '#9a9790', '#8b8a86'];
    const tied = (k: number) => PARTS[k].kind === 'drive' ? '--c-red' : PARTS[k].kind === 'eq' ? '' : PARTS[k].kind === 'phaser' ? '--c-phaser' : '--c-blue';
    // COLVAR: for CSS (follows the variable live); COLS[k]: the colour itself, for drawing on canvas
    const COLVAR = (k: number) => (tied(k) ? `var(${tied(k)})` : EQ_COLS[PARTS[k].n - 1]);
    const COLS = new Proxy([] as string[], { get: (_t, key) => {
      const k = Number(key); if (typeof key !== 'string' || !Number.isInteger(k) || !PARTS[k]) return undefined;
      const v = tied(k) ? toHex(getComputedStyle(this.page).getPropertyValue(tied(k)).trim()) : '';
      return v || (PARTS[k].kind === 'drive' ? '#f20000' : PARTS[k].kind === 'eq' ? EQ_COLS[PARTS[k].n - 1] : PARTS[k].kind === 'phaser' ? '#aa418e' : '#5f64c8'); } });
    const NAMES = PARTS.map((p) => `${p.kind.toUpperCase()} ${p.n}`);
    const ALL_K = PARTS.map((_, k) => k);
    const stageOf = (k: number) => PARTS[k].n;
    const kindOf = (k: number) => PARTS[k].kind;
    const isDrive = (k: number) => PARTS[k].drive;
    const isEq = (k: number) => PARTS[k].kind === 'eq';
    const isPh = (k: number) => PARTS[k].kind === 'phaser';
    // which box holds part k (-1 = it is not in the chain); box s is the engine's tap 3 + s
    const SLOT_IDS = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => `grind.slot${s}`);
    const PART_VALUE = PARTS.map((p) => `${p.kind} ${p.n}`);
    const slotOf = (k: number) => SLOT_IDS.findIndex((id) => this.get(id) === PART_VALUE[k]);
    const tapOf = (k: number) => 3 + Math.max(0, slotOf(k));
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const md = (id: string, label: string, opts: Parameters<SynthView['knob']>[3] = {}) => this.knob(id, label, 'mid', opts);
    const dB = (x: number) => (x > 1e-6 ? 20 * Math.log10(x) : -120);
    const stageOn = (n: number) => !!this.get('grind.on') && !!this.get(`grind${n}.on`);

    // ---- the RUIN box (option B of the house-style pitch): the chain-wide controls, right of the focus
    const strip = h('div', 'c ob gr-master');
    const roll = h('button', 'gr-roll');
    roll.innerHTML = `${DICE_SVG}<span>ROLL</span>`;
    roll.title = 'Roll the whole chain from one of the recipes, nudged as far as WEIRD says (at the top of WEIRD: anything). Locked stages stay as they are.';
    const recipeName = h('span', 'gr-recipe', '');
    roll.onclick = () => {
      this.grindRoll([1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !this.grindLocks[n - 1]), true);
      recipeName.textContent = this.grindRecipe;
      const r = RUIN_RECIPES.find((x) => x.name === this.grindRecipe);
      recipeName.title = r ? `Rolled from ${r.name}: ${r.idea}` : 'Rolled with WEIRD at the top: anything goes';
    };
    const count = h('span', 'fx-kinds sw-small gr-count');
    const countBtns = ['AUTO', '1', '2', '3', '4'].map((t, i) => {
      const b = h('button', 'fx-kind', t);
      b.onclick = () => {
        this.grindCount = i;
        countBtns.forEach((x, j) => x.classList.toggle('on', j === i));
      };
      b.classList.toggle('on', i === this.grindCount);
      count.append(b);
      return b;
    });
    count.title = 'How many stages ROLL uses: AUTO picks a random number each time.';
    const fill = h('div', 'glide-fill');
    const weird = h('div', 'glide-track gr-weird', fill);
    const showWeird = () => { fill.style.width = `${this.grindWeird * 100}%`; };
    this.weirdViews.push(showWeird);
    const fromX = (x: number) => {
      const r = weird.getBoundingClientRect();
      this.grindWeird = Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 100) / 100;
      for (const f of this.weirdViews) f();
    };
    weird.addEventListener('pointerdown', (e) => { weird.setPointerCapture(e.pointerId); fromX(e.clientX); });
    weird.addEventListener('pointermove', (e) => { if (weird.hasPointerCapture(e.pointerId)) fromX(e.clientX); });
    weird.title = 'Weirdness: low stays near the recipes, high goes anywhere, harder and stranger.';
    showWeird();
    const rocker = this.bigToggle('grind.on', '');
    rocker.classList.add('gr-rocker');
    const lowcut = md('grind.lowcut', 'Lo cut', { fmt: (v) => (v <= 21 ? 'off' : `${Math.round(v)} Hz`) });
    const mix = md('grind.mix', 'Mix', { fmt: pct });
    const ott = md('grind.ott', 'OTT', { fmt: pct });
    const out = md('grind.output', 'Output', { fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB` });
    const lamps = h('span', 'gr-lamps gr-lamps-row', this.toggle('grind.key', 'KEY', 'small'), this.toggle('grind.noise_thru', 'NOISE THRU', 'small'));
    // CHAINS (owner's call: preset chains live in the strip): one of the recipes, exactly as it is (ROLL nudges them)
    const chains = h('select', 'gr-chains') as HTMLSelectElement;
    chains.append(new Option('CHAINS', ''), ...RUIN_RECIPES.map((rc) => new Option(rc.name, rc.name)));
    chains.title = 'Load a ready chain: a serial distortion recipe, laid out in the boxes';
    chains.onchange = () => {
      const rc = RUIN_RECIPES.find((x) => x.name === chains.value);
      chains.value = '';
      if (!rc) return;
      for (const [id, v] of Object.entries(recipeParams(rc))) this.set(id, v);
      this.layoutRuinSlots(true);
      this.grindRecipe = rc.name;
      recipeName.textContent = rc.name;
      recipeName.title = `${rc.name}: ${rc.idea}`;
    };
    chains.classList.add('sel-name');
    strip.append(h('div', 'ob-head', h('span', 'ob-bar'), h('span', 'c-title', 'RUIN'), h('div', 'sel gr-chains-sel', chains), rocker),
      h('div', 'gr-m-body', h('div', 'gr-m-row', roll, count), h('div', 'gr-m-row', h('span', 'gr-sub', 'WEIRD'), weird, recipeName), lamps),
      h('div', 'ob-dials gr-knobs', ott, lowcut, mix, out));

    // ---- the chain: eight boxes in free order (owner's call); each holds one of the four filters or drives, or nothing
    const chain = h('div', 'gr-chain');
    const NW = 128, NH = 88;
    const nodeDraws: ((t: RuinTapsView | null) => void)[] = [];
    let paintThumb: (g: CanvasRenderingContext2D, w: number, hh: number, k: number) => void = () => {};
    const nodes: HTMLElement[] = [];
    const partOn = (k: number) => {
      const n = stageOf(k);
      return slotOf(k) >= 0 && !!this.get(`grind${n}.on`) && !!this.get(`grind${n}.${kindOf(k)}_on`);
    };
    const typeLine = (k: number): string => {
      const n = stageOf(k);
      if (!partOn(k)) return 'OFF';
      if (isEq(k)) return 'EQ';
      if (isPh(k)) return 'PHASER';
      return String(this.get(isDrive(k) ? `grind${n}.drive_type` : `grind${n}.filter`)).toUpperCase();
    };
    // a box's thin bar switches its part on / off without taking it out of the chain (the ✕ takes it out)
    const partPower = (k: number) => {
      const n = stageOf(k), pre = `grind${n}`, part = kindOf(k);
      const b = h('button', 'power', lamp());
      b.title = `${NAMES[k]} on / off`;
      b.onclick = (e) => {
        e.stopPropagation();
        if (partOn(k)) this.set(`${pre}.${part}_on`, false);
        else {
          this.set(`${pre}.${part}_on`, true);
          this.set(`${pre}.on`, true);
          if (!this.get('grind.on')) this.set('grind.on', true);
        }
      };
      this.watch([`${pre}.on`, `${pre}.${part}_on`, ...SLOT_IDS], () => b.classList.toggle('on', partOn(k)));
      return b;
    };
    // take a part out of its box (the box goes empty; its settings stay for when it comes back)
    const removePart = (k: number) => {
      const s = slotOf(k);
      if (s < 0) return;
      this.set(SLOT_IDS[s], 'empty');
      this.set(`grind${stageOf(k)}.${kindOf(k)}_on`, false);
      if (this.ruinSel === k) {
        const other = ALL_K.find((j) => slotOf(j) >= 0);
        this.ruinSelect(other ?? k);
      }
    };
    // put the first free filter, drive or EQ into an empty box, switched on
    const addPart = (s: number, kind: (typeof KINDS)[number]) => {
      const k = ALL_K.find((j) => kindOf(j) === kind && slotOf(j) < 0);
      if (k === undefined) return;
      const n = stageOf(k);
      this.set(SLOT_IDS[s], PART_VALUE[k]);
      this.set(`grind${n}.${kind}_on`, true);
      // a new filter lands on BELLS, the main one (owner's call)
      if (kind === 'filter') this.set(`grind${n}.filter`, 'bells');
      this.set(`grind${n}.on`, true);
      if (!this.get('grind.on')) this.set('grind.on', true);
      this.ruinSelect(k);
    };
    for (let k = 0; k < PARTS.length; k++) {
      const node = h('div', 'gr-node');
      node.style.setProperty('--knob-accent', COLVAR(k));
      const n = stageOf(k);
      const x = h('button', 'gr-x', '✕');
      x.title = `Take ${NAMES[k]} out of the chain`;
      x.onclick = (e) => { e.stopPropagation(); removePart(k); };
      const head = h('div', 'gr-node-head', partPower(k), h('span', 'gr-node-name', NAMES[k]), x);
      this.watch(['grind.on', `grind${n}.on`, `grind${n}.filter`, `grind${n}.filter_on`, `grind${n}.drive_type`, `grind${n}.drive_on`, `grind${n}.eq_on`, `grind${n}.phaser_on`, ...SLOT_IDS], () => {
        node.classList.toggle('is-off', typeLine(k) === 'OFF' || !this.get('grind.on'));
      });
      const [cv, g] = canvas(NW, NH, 'gr-node-cv');
      if (isEq(k)) {
        // an EQ has no type: its footer just names it
        const foot = h('div', 'gr-node-foot', h('span', 'gr-node-eq', '4-BAND EQ'));
        node.append(head, h('div', 'gr-node-cv-wrap', cv), foot);
      } else if (isPh(k)) {
        // a phaser's footer steps its notch count: ‹ 4 NOTCHES ›
        const nid = `grind${n}.ph_notches`, lab = h('span', 'gr-node-eq');
        const stepN = (d: number) => (e: Event) => { e.stopPropagation(); this.set(nid, Math.max(1, Math.min(12, Math.round(this.num(nid)) + d))); };
        const pv = h('button', 'gr-step', '‹'), nx = h('button', 'gr-step', '›');
        pv.onclick = stepN(-1);
        nx.onclick = stepN(1);
        this.watch([nid], () => { const v = Math.round(this.num(nid)); lab.textContent = `${v} NOTCH${v === 1 ? '' : 'ES'}`; });
        node.append(head, h('div', 'gr-node-cv-wrap', cv), h('div', 'gr-node-foot', pv, lab, nx));
      }
      // the type as a stepper in the footer (owner's pick, option 6): ‹ TYPE ›, the name opens the menu
      const tid = isDrive(k) ? `grind${n}.drive_type` : `grind${n}.filter`;
      const step = (d: number) => (e: Event) => {
        e.stopPropagation();
        const opts = getParam(tid)!.options!, i = opts.indexOf(String(this.get(tid)));
        this.set(tid, opts[(i + d + opts.length) % opts.length]);
      };
      const prev = h('button', 'gr-step', '‹'), next = h('button', 'gr-step', '›');
      prev.onclick = step(-1);
      next.onclick = step(1);
      prev.title = next.title = 'Step through the types';
      if (kindOf(k) === 'filter') {
        // a filter is the four bands (owner's call: no type menu); an old preset's filter shows its type
        const lab = h('span', 'gr-node-eq');
        this.watch([tid], () => { const t = String(this.get(tid)); lab.textContent = t === 'bells' ? '4 BANDS' : t.toUpperCase(); });
        node.append(head, h('div', 'gr-node-cv-wrap', cv), h('div', 'gr-node-foot', lab));
      } else if (!isEq(k) && !isPh(k)) {
        const sel = isDrive(k) ? this.driveTypeSelector(tid) : this.selector(tid);
        sel.classList.add('gr-node-sel');
        sel.addEventListener('click', (e) => e.stopPropagation());
        const foot = h('div', 'gr-node-foot', prev, sel, next);
        node.append(head, h('div', 'gr-node-cv-wrap', cv), foot);
      }
      node.onclick = () => this.ruinSelect(k);
      nodes.push(node);
      nodeDraws.push((t) => {
        if (slotOf(k) < 0) return;
        g.clearRect(0, 0, NW, NH);
        const col = COLS[k];
        const MW = 6, SW = NW - MW - 6;
        // a small copy of its focus graph: what it does, with its filter or drive band on top
        g.save();
        g.beginPath();
        g.rect(0, 0, SW, NH);
        g.clip();
        paintThumb(g, SW, NH, k);
        g.restore();
        if (t) {
          // its meter: RMS as the bar, the peak as a tick, red over 0 dB
          const rd = dB(t.rms[tapOf(k)]), pd = dB(t.peak[tapOf(k)]);
          const yOf = (d: number) => NH - Math.max(0, Math.min(1, (d + 48) / 54)) * NH;
          g.fillStyle = '#0a0a0c';
          g.fillRect(NW - MW, 0, MW, NH);
          g.fillStyle = col;
          g.globalAlpha = 0.85;
          g.fillRect(NW - MW + 1, yOf(rd), MW - 2, NH - yOf(rd));
          g.globalAlpha = 1;
          g.fillStyle = pd > 0 ? '#ff2a14' : '#e8e8ea';
          g.fillRect(NW - MW, yOf(pd) - 1, MW, 2);
          if (pd > 0) g.fillRect(NW - MW, 0, MW, 3);
        }
      });
    }
    // an empty box (owner's pick): a big thin +, which opens into four tiles in the box (filter, drive, EQ, phaser)
    const ADD_ICON: Record<(typeof KINDS)[number], string> = {
      filter: 'M0,9 L6,9 C9,9 10,2 12,2 C14,2 15,9 18,9 L24,9',
      drive: 'M0,11 C6,11 8,1 12,1 L24,1',
      eq: 'M0,7 C4,7 5,3 7,3 C9,3 9,7 12,7 C15,7 15,11 17,11 C19,11 20,7 24,7',
      phaser: 'M0,3 L4,3 C6,3 6,11 7,11 C8,11 8,3 10,3 L14,3 C16,3 16,11 17,11 C18,11 18,3 20,3 L24,3',
    };
    const ADD_COL: Record<(typeof KINDS)[number], string> = { filter: 'var(--c-blue)', drive: 'var(--c-red)', eq: '#d8ceba', phaser: 'var(--c-phaser)' };
    const closeAdds: (() => void)[] = [];
    const empties = SLOT_IDS.map((_, s) => {
      const plus = h('button', 'gr-plus', '+');
      plus.title = 'Add a filter, a drive, an EQ or a phaser to this box';
      const grid = h('div', 'gr-add-grid');
      for (const kind of KINDS) {
        const t = h('button', 'gr-add-tile');
        t.innerHTML = `<svg width="30" height="15" viewBox="0 0 24 12" aria-hidden="true"><path d="${ADD_ICON[kind]}" fill="none" stroke="${ADD_COL[kind]}" stroke-width="1.5"/></svg><span>${kind.toUpperCase()}</span>`;
        t.style.setProperty('--tile-col', ADD_COL[kind]);
        t.onclick = (e) => { e.stopPropagation(); close(); addPart(s, kind); };
        grid.append(t);
      }
      const box = h('div', 'gr-node gr-empty', h('span', 'gr-empty-n', String(s + 1)), plus, grid);
      const close = () => box.classList.remove('gr-adding');
      closeAdds.push(close);
      plus.onclick = (e) => {
        e.stopPropagation();
        for (const c of closeAdds) c();
        box.classList.add('gr-adding');
      };
      return box;
    });
    document.addEventListener('pointerdown', (e) => { if (!(e.target as HTMLElement).closest?.('.gr-empty')) for (const c of closeAdds) c(); });
    // lay the boxes out from the slots whenever they change
    this.watch(SLOT_IDS, () => {
      chain.replaceChildren(...SLOT_IDS.map((id, s) => {
        const k = PART_VALUE.indexOf(String(this.get(id)));
        return k >= 0 ? nodes[k] : empties[s];
      }));
      for (const d of nodeDraws) d(this.ruinTaps);
      this.ruinSelect(this.ruinSel);
    });
    // drag a box to another place, the way apps move on a phone (owner's call): hold it and drag, the boxes it
    // passes step aside to show where it will land, let go and it drops there (the chain plays in the new order)
    // after a drop the numbers read 1, 2, 3 … left to right again, per kind (owner's call): each part's
    // settings move with it to its new number, so the chain sounds exactly as it was dropped
    const KIND_KEYS: Record<(typeof KINDS)[number], string[]> = {
      filter: ['filter', 'freq', 'range', 'rate', 'clock', 'width', 'depth', 'filter_level', 'bell_link', 'bell_count', ...[1, 2, 3, 4].flatMap((b) => ['type', 'freq', 'gain', 'q', 'range'].map((x) => `bell${b}_${x}`))],
      drive: ['drive_type', 'drive', 'mix', 'drive_level', 'drive_freq', 'drive_width', 'drive_tone', 'drive_dyn'],
      eq: ['eq_level', 'eq_scale', ...[1, 2, 3, 4].flatMap((b) => ['type', 'freq', 'gain', 'q'].map((x) => `eq_b${b}_${x}`))],
      phaser: ['phaser_level', 'ph_notches', 'ph_center', 'ph_spread', 'ph_amount', 'ph_rate', 'ph_clock', 'ph_feedback', 'ph_stereo'],
    };
    const renumber = () => {
      const vals = SLOT_IDS.map((id) => String(this.get(id)));
      const stageOnBefore = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => !!this.get(`grind${n}.on`));
      const heard: boolean[][] = [[], [], [], [], [], [], [], [], []];
      const selKind = kindOf(this.ruinSel);
      let selStage = stageOf(this.ruinSel);
      let changed = false;
      for (const kind of KINDS) {
        // the order this kind should be numbered in: the boxes left to right, then the parts not in the chain
        const inChain = vals.filter((v) => v.startsWith(`${kind} `)).map((v) => Number(v.split(' ')[1]));
        const src = [...inChain, ...[1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !inChain.includes(n))];
        if (src.every((n, i) => n === i + 1)) {
          for (let m = 1; m <= 8; m++) heard[m].push(stageOnBefore[m - 1] && !!this.get(`grind${m}.${kind}_on`));
          continue;
        }
        changed = true;
        const keys = KIND_KEYS[kind].filter((k) => getParam(`grind1.${k}`));
        const old = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => keys.map((k) => this.get(`grind${n}.${k}`)));
        const oldOn = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => stageOnBefore[n - 1] && !!this.get(`grind${n}.${kind}_on`));
        for (let m = 1; m <= 8; m++) {
          const from = src[m - 1];
          keys.forEach((k, j) => this.set(`grind${m}.${k}`, old[from - 1][j]));
          this.set(`grind${m}.${kind}_on`, oldOn[from - 1]);
          heard[m].push(oldOn[from - 1]);
        }
        vals.forEach((v, s) => { if (v.startsWith(`${kind} `)) vals[s] = `${kind} ${src.indexOf(Number(v.split(' ')[1])) + 1}`; });
        if (kind === selKind) selStage = src.indexOf(selStage) + 1;
      }
      if (!changed) return;
      // a stage is on when one of its parts is heard (a part keeps its own on / off as it moves)
      for (let m = 1; m <= 8; m++) this.set(`grind${m}.on`, heard[m].some(Boolean));
      SLOT_IDS.forEach((id, s) => this.set(id, vals[s]));
      this.ruinSelect(PART_VALUE.indexOf(`${selKind} ${selStage}`));
    };
    let press: { box: HTMLElement; from: number; x: number; y: number; id: number } | null = null;
    let held: { rects: DOMRect[]; to: number } | null = null;
    let swallowClick = false;
    const kids = () => Array.from(chain.children) as HTMLElement[];
    const arrange = (from: number, to: number) => {
      const order = kids().map((_, i) => i).filter((i) => i !== from);
      order.splice(to, 0, from);
      return order;
    };
    const endDrag = (commit: boolean) => {
      const p = press, d = held;
      press = null;
      held = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (!p || !d) return;
      const was = p.box.getBoundingClientRect();
      for (const el of kids()) {
        el.classList.remove('gr-shift', 'gr-dragging');
        el.style.transform = '';
      }
      chain.classList.remove('gr-held-on');
      if (commit && d.to !== p.from) {
        const vals = SLOT_IDS.map((id) => String(this.get(id)));
        const order = arrange(p.from, d.to);
        SLOT_IDS.forEach((id, s) => this.set(id, vals[order[s]]));
        renumber();
      }
      // the dropped box glides from where it was let go into its place
      const now = p.box.getBoundingClientRect();
      p.box.style.transition = 'none';
      p.box.style.transform = `translate(${was.left - now.left}px, ${was.top - now.top}px)`;
      void p.box.offsetWidth;
      p.box.style.transition = 'transform 160ms ease-out';
      p.box.style.transform = '';
      window.setTimeout(() => { p.box.style.transition = ''; }, 200);
    };
    const onMove = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      const dx = e.clientX - press.x, dy = e.clientY - press.y;
      if (!held) {
        if (Math.hypot(dx, dy) < 6) return;
        held = { rects: kids().map((el) => el.getBoundingClientRect()), to: press.from };
        chain.classList.add('gr-held-on');
        kids().forEach((el) => el.classList.add(el === press!.box ? 'gr-dragging' : 'gr-shift'));
        swallowClick = true;
      }
      press.box.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
      // the place under the pointer: the box whose centre is nearest
      let to = held.to, best = Infinity;
      held.rects.forEach((r, i) => {
        const dd = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        if (dd < best) { best = dd; to = i; }
      });
      if (to === held.to) return;
      held.to = to;
      const order = arrange(press.from, to), rects = held.rects;
      kids().forEach((el, i) => {
        if (i === press!.from) return;
        const at = order.indexOf(i);
        el.style.transform = `translate(${rects[at].left - rects[i].left}px, ${rects[at].top - rects[i].top}px)`;
      });
    };
    const onUp = (e: PointerEvent) => { if (press && e.pointerId === press.id) endDrag(true); };
    const onCancel = (e: PointerEvent) => { if (press && e.pointerId === press.id) endDrag(false); };
    chain.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || press) return;
      const t = e.target as HTMLElement;
      if (t.closest('button, select, input, .sel')) return;
      const box = t.closest('.gr-node') as HTMLElement | null;
      if (!box || box.parentElement !== chain || box.classList.contains('gr-empty')) return;
      press = { box, from: kids().indexOf(box), x: e.clientX, y: e.clientY, id: e.pointerId };
      swallowClick = false;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    });
    // a drag is not a click: the box you let go of is not selected by it
    chain.addEventListener('click', (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
    }, true);

    // ---- the focus: what the selected node adds, its drive curve, its controls
    const GW = 520, GH = 168, LMW = 30;
    const [gcv, gg] = canvas(GW, GH, 'disp gr-graph-cv');
    // the selected box's level, beside the graph (owner's call: the graph shows tone, not level): its output as a
    // meter over -48 … +6 dB with the 0 dB line and red over it, and a handle that turns the box down (or up)
    const [lcv, lg] = canvas(LMW, GH, 'disp gr-level-cv');
    lcv.title = 'The level leaving this box. Drag the handle to turn it down (or up to +6 dB); double-click = 0 dB.';
    // the focus box (house style): the selected part's title row, its graph and level as the print, its dials
    const graphBox = h('div', 'c ob gr-focus', h('div', 'gr-print', gcv, lcv));
    const ctl = graphBox;
    const emptyHint = h('div', 'gr-about', 'The chain is empty: add a filter or a drive to a box above, or pick a chain from CHAINS.');
    ctl.append(emptyHint);
    const sets: HTMLElement[] = [];
    const eqBandViews: (() => void)[] = [];
    const bellViews: (() => void)[] = [];

    // per box: its own controls (a filter: type, MOVES, Freq / Res / H Range / V Range / Rate and its clock, the die
    // and lock; a drive: type, Drive / Tone / Dry/Wet / Bias / OTT)
    for (let n = 1; n <= 8; n++) {
      const pre = `grind${n}`;
      const dice = h('button', 'gr-ic gr-dice');
      dice.innerHTML = DICE_SVG;
      dice.title = `Roll filter ${n} only: on BELLS a new set of bands and movement from the archetype on its left`;
      dice.onclick = () => this.filterRoll(n);
      // left of the dice (owner's call): the archetype the dice rolls from, WEIRD and LINK (BELLS only, but WEIRD)
      const arch = h('select', 'sel-name gr-arch') as HTMLSelectElement;
      for (const a of BELL_ARCHETYPES) arch.append(new Option(a.toUpperCase(), a));
      arch.value = this.grindArch[n - 1];
      arch.onchange = () => { this.grindArch[n - 1] = arch.value as BellArchetype; };
      arch.title = 'What the dice rolls: ANY picks one each time (the yoi sweep and the talker most often).';
      const wFill = h('div', 'glide-fill');
      const wTrack = h('div', 'glide-track gr-weird gr-fweird', wFill);
      const wShow = () => { wFill.style.width = `${this.grindWeird * 100}%`; };
      this.weirdViews.push(wShow);
      wShow();
      const wFrom = (x: number) => {
        const r = wTrack.getBoundingClientRect();
        this.grindWeird = Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 100) / 100;
        for (const f of this.weirdViews) f();
      };
      wTrack.addEventListener('pointerdown', (e) => { wTrack.setPointerCapture(e.pointerId); wFrom(e.clientX); });
      wTrack.addEventListener('pointermove', (e) => { if (wTrack.hasPointerCapture(e.pointerId)) wFrom(e.clientX); });
      wTrack.title = 'Weirdness of the dice (the same as RUIN\'s WEIRD): low stays near the archetype, high goes further.';
      const wBox = h('span', 'gr-fweird-box', h('span', 'gr-fweird-n', 'WEIRD'), wTrack);
      const link = h('button', 'fx-kind gr-link', 'LINK');
      link.title = 'LINK: all four bands move on one path, together (a vowel talking); off, each moves on its own.';
      link.onclick = () => this.set(`${pre}.bell_link`, !this.get(`${pre}.bell_link`));
      this.watch([`${pre}.bell_link`, `${pre}.filter`], () => {
        link.classList.toggle('on', !!this.get(`${pre}.bell_link`));
        const bells = this.get(`${pre}.filter`) === 'bells';
        link.style.display = bells ? '' : 'none';
        arch.style.display = bells ? '' : 'none';
      });
      const lock = h('button', 'gr-ic gr-lock');
      const drawLock = () => {
        const on = this.grindLocks[n - 1];
        lock.classList.toggle('on', on);
        lock.innerHTML = lockSvg(on);
        lock.title = on ? `Stage ${n} is locked: ROLL leaves it as it is. Click to unlock.` : `Lock stage ${n}: ROLL leaves it as it is.`;
      };
      lock.onclick = () => {
        this.grindLocks[n - 1] = !this.grindLocks[n - 1];
        drawLock();
      };
      drawLock();
      const rateFmt = (v: number) => {
        const clock = this.get(`${pre}.clock`), avg = clock === 'random' ? '~' : '';
        if (clock === 'sync') return GRIND_BEAT_NAMES[grindBeat(v)];
        return `${avg}${grindHz(v).toFixed(grindHz(v) < 1 ? 2 : 1)} Hz`;
      };
      const sync = h('span', 'fx-kinds sw-small gr-sync');
      const clocks = (['hz', 'sync', 'random'] as const).map((c) => {
        const b = h('button', 'fx-kind', c === 'random' ? 'RAND' : c.toUpperCase());
        b.onclick = () => this.set(`${pre}.clock`, c);
        sync.append(b);
        return b;
      });
      this.watch([`${pre}.clock`], () => clocks.forEach((b, j) => b.classList.toggle('on', ['hz', 'sync', 'random'][j] === this.get(`${pre}.clock`))));
      sync.title = getParam(`${pre}.clock`)!.describes;
      const fk = n - 1, dk = 8 + n - 1, ek = 16 + n - 1;
      const fhead = h('div', 'ob-head gr-row-head', partPower(fk), h('span', 'c-title', `FILTER ${n}`), h('span', 'gr-icons', arch, wBox, link, dice, lock));
      // Freq and H Range are the ball on the graph (owner's call): only Res, Depth and Rate are dials
      // BELLS (owner's call): Width and Depth make way for the selected bell's Freq / Gain / Q, as Ableton's EQ
      const wd = h('span', 'eq-set', md(`${pre}.width`, 'Width', { fmt: pct }), md(`${pre}.depth`, 'Depth', { fmt: pct }));
      const bellSets = [1, 2, 3, 4].map((b) => {
        const bp = `${pre}.bell${b}`;
        // the band's type in a box on the left of its dials (owner's call), as EQ Eight's eight
        const tsel = this.selector(`${bp}_type`, { groups: [['LOW', ['low cut 48', 'low cut 12', 'low shelf']], ['MID', ['bell', 'notch', 'band']], ['HIGH', ['high shelf', 'high cut 12', 'high cut 48']], ['RUIN', ['comb', 'phaser']]], only: true });
        for (const o of tsel.querySelectorAll('option')) o.dataset.icon = filterIconPath(o.value);
        // (owner's call: a small clean box with only the type's picture, "BAND n:" beside it on the left)
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 22 12');
        icon.setAttribute('class', 'gr-type-icon');
        const ipath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        icon.append(ipath);
        this.watch([`${bp}_type`], () => {
          ipath.setAttribute('d', filterIconPath(String(this.get(`${bp}_type`))));
          tsel.title = `Band ${b} type: ${String(this.get(`${bp}_type`)).toUpperCase()}`;
        });
        const tbox = h('div', 'gr-bell-type', tsel, icon);
        // its direction (owner's pick, three segments): left right (Freq moves), up down (Gain moves), cross (both)
        const dirs = getParam(`${bp}_dir`)!.options!;
        const seg = h('div', 'gr-dir-seg');
        const segBtns = ['↔', '↕', '✛'].map((s, j) => {
          const btn = h('button', '', s);
          btn.title = ['Left right: the band moves along the frequencies', 'Up down: the band moves in gain', 'Cross: both at once'][j];
          btn.onclick = () => this.set(`${bp}_dir`, dirs[j]);
          seg.append(btn);
          return btn;
        });
        this.watch([`${bp}_dir`], () => segBtns.forEach((btn, j) => btn.classList.toggle('on', this.get(`${bp}_dir`) === dirs[j])));
        const noGain = () => bellNoGain(String(this.get(`${bp}_type`)));
        const noQ = () => bellNoQ(String(this.get(`${bp}_type`)));
        return h('span', 'eq-set', h('span', 'gr-band-n', `BAND ${b}:`), tbox, seg, md(`${bp}_freq`, 'Freq'), md(`${bp}_gain`, 'Gain', { disabled: noGain, deps: [`${bp}_type`] }), md(`${bp}_q`, 'Q', { disabled: noQ, deps: [`${bp}_type`] }));
      });
      const showBell = () => {
        const bells = this.get(`${pre}.filter`) === 'bells';
        wd.style.display = bells ? 'none' : '';
        bellSets.forEach((el, j) => { el.style.display = bells && j === this.ruinBellSel[n - 1] ? '' : 'none'; });
      };
      bellViews[n - 1] = showBell;
      this.watch([`${pre}.filter`], showBell);
      // how many bands (owner's call: a box like OSC's UNI, left of the band's type), 1-4
      const count = h('div', 'k uni-dial gr-bcount', this.chip('BANDS', () => this.num(`${pre}.bell_count`), (v) => {
        this.set(`${pre}.bell_count`, v);
        if (this.ruinBellSel[n - 1] >= v) { this.ruinBellSel[n - 1] = v - 1; showBell(); }
      }, 1, 4, [`${pre}.bell_count`], 'How many bands (1-4)'));
      this.watch([`${pre}.filter`], () => { count.style.display = this.get(`${pre}.filter`) === 'bells' ? '' : 'none'; });
      // (owner's layout: what is for all the bands left of a thin divider, the selected band's own on its right)
      const divider = h('span', 'gr-band-div');
      this.watch([`${pre}.filter`], () => { divider.style.display = this.get(`${pre}.filter`) === 'bells' ? '' : 'none'; });
      const fdials = h('div', 'ob-dials gr-fdials', wd, count,
        md(`${pre}.rate`, 'Rate', { fmt: rateFmt, deps: [`${pre}.clock`] }), sync, divider, ...bellSets);
      const dhead = h('div', 'ob-head gr-row-head', partPower(dk), h('span', 'c-title', `DRIVE ${n}`), this.driveTypeSelector(`${pre}.drive_type`));
      const ddials = h('div', 'ob-dials gr-ddials', md(`${pre}.drive`, 'Drive', { fmt: pct }), md(`${pre}.drive_tone`, 'Tone', { fmt: pct }), md(`${pre}.mix`, 'Dry/Wet', { fmt: pct }));
      sets[fk] = h('div', `gr-set gr-s${n}`, fhead, fdials);
      sets[dk] = h('div', `gr-set gr-s${n}`, dhead, ddials);
      // the EQ: the FX page's EQ (owner's call): Freq / Gain / Q of the selected ball, then Scale
      const ehead = h('div', 'ob-head gr-row-head', partPower(ek), h('span', 'c-title', `EQ ${n}`), h('span', 'gr-eq-hint', 'click a ball · drag · scroll = Q · double-click = type'));
      const bandSets = [1, 2, 3, 4].map((b) => {
        const bp = `${pre}.eq_b${b}`;
        const passType = () => getParam(`${bp}_type`)!.options!.indexOf(String(this.get(`${bp}_type`))) === 1;
        const el = h('span', 'eq-set', md(`${bp}_freq`, `${b} Freq`), md(`${bp}_gain`, 'Gain', { disabled: passType, deps: [`${bp}_type`] }), md(`${bp}_q`, 'Q'));
        return el;
      });
      const showBand = () => bandSets.forEach((el, j) => { el.style.display = j === this.ruinEqSel[n - 1] ? '' : 'none'; });
      eqBandViews[n - 1] = showBand;
      showBand();
      const edials = h('div', 'ob-dials gr-edials', ...bandSets, md(`${pre}.eq_scale`, 'Scale', { fmt: (v) => `${Math.round(v * 100)}%` }));
      sets[ek] = h('div', `gr-set gr-s${n}`, ehead, edials);
      // the PHASER (owner's pick, option 4): NOTCH box, Center, Spread, Amount, Rate, Feedback, Stereo and its clock
      const pk = 24 + n - 1;
      const pdice = h('button', 'gr-ic gr-dice');
      pdice.innerHTML = DICE_SVG;
      pdice.title = `Roll phaser ${n} only`;
      pdice.onclick = () => this.phaserRoll(n);
      const phead = h('div', 'ob-head gr-row-head', partPower(pk), h('span', 'c-title', `PHASER ${n}`), h('span', 'gr-icons', pdice));
      const pclock = h('span', 'fx-kinds sw-small gr-sync');
      const pclocks = (['hz', 'sync', 'random'] as const).map((c) => {
        const b = h('button', 'fx-kind', c === 'random' ? 'RAND' : c.toUpperCase());
        b.onclick = () => this.set(`${pre}.ph_clock`, c);
        pclock.append(b);
        return b;
      });
      this.watch([`${pre}.ph_clock`], () => pclocks.forEach((b, j) => b.classList.toggle('on', ['hz', 'sync', 'random'][j] === this.get(`${pre}.ph_clock`))));
      const pRateFmt = (v: number) => (this.get(`${pre}.ph_clock`) === 'sync' ? GRIND_BEAT_NAMES[grindBeat(v)] : `${this.get(`${pre}.ph_clock`) === 'random' ? '~' : ''}${grindHz(v).toFixed(grindHz(v) < 1 ? 2 : 1)} Hz`);
      const notch = h('div', 'k uni-dial', this.chip('NOTCH', () => this.num(`${pre}.ph_notches`), (v) => this.set(`${pre}.ph_notches`, v), 1, 12, [`${pre}.ph_notches`], 'How many notches (1-12)'));
      const oct = (v: number) => `${v.toFixed(1)} oct`;
      const pdials = h('div', 'ob-dials gr-pdials', notch,
        md(`${pre}.ph_center`, 'Center', { fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)} Hz`) }),
        md(`${pre}.ph_spread`, 'Spread', { fmt: oct }), md(`${pre}.ph_amount`, 'Amount', { fmt: oct }),
        md(`${pre}.ph_rate`, 'Rate', { fmt: pRateFmt, deps: [`${pre}.ph_clock`] }), md(`${pre}.ph_feedback`, 'Feedback', { fmt: pct }),
        md(`${pre}.ph_stereo`, 'Stereo', { fmt: (v) => `${Math.round(v)}°` }), pclock);
      sets[pk] = h('div', `gr-set gr-s${n}`, phead, pdials);
    }
    sets.forEach((el, k) => {
      el.style.setProperty('--knob-accent', COLVAR(k));
      ctl.append(el);
    });
    const edit = h('div', 'gr-edit', graphBox, strip);

    // the EQ parts: band b's pass type (high-pass / notch / low-pass), its ball on a graph, the curve's biquads
    const eqPass = (n: number, b: number) => getParam(`grind${n}.eq_b${b + 1}_type`)!.options!.indexOf(String(this.get(`grind${n}.eq_b${b + 1}_type`))) === 1;
    const eqDbY = (GH: number, db: number) => GH * 0.42 - Math.max(-30, Math.min(18, db)) * (GH / 62);
    const eqBall = (n: number, b: number, W: number, fY: (m: number) => number): [number, number] => {
      const bp = `grind${n}.eq_b${b + 1}`;
      return [freqX(this.num(`${bp}_freq`), W), eqPass(n, b) ? fY(1) : fY(Math.pow(10, (this.num(`${bp}_gain`) * this.num(`grind${n}.eq_scale`)) / 20))];
    };
    const eqBq = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
    // ---- BELLS: four bands, each a numbered dot (Freq / Gain) and a wing (where it moves: drag its round ends)
    const bellZone = (n: number, b: number) => ruinZone(this.num(`grind${n}.bell${b + 1}_freq`) * this.ruinKey(), this.num(`grind${n}.bell${b + 1}_range`));
    /** Where each bell is: the engine's live positions while a note sounds, its Freq at rest. */
    const bellsNow = (n: number): { fc: number[]; pos: number[]; live: boolean } => {
      const live = this.noteSounding() ? this.grindLive[n - 1] : 0;
      const fc = [0, 1, 2, 3].map((b) => this.num(`grind${n}.bell${b + 1}_freq`) * this.ruinKey());
      if (!(live > 0)) return { fc, pos: [0.5, 0.5, 0.5, 0.5], live: false };
      const pos = [0, ...unpackBells(this.grindLiveRes[n - 1])];
      const [l0, h0] = bellZone(n, 0);
      // (moving up down only, band 1's live value is an octave around its Freq, carrying its position)
      pos[0] = bellDir(n, 0) === 1 ? Math.max(0, Math.min(1, Math.log2(live / fc[0]) + 0.5)) : h0 > l0 * 1.0001 ? Math.log(live / l0) / Math.log(h0 / l0) : 0.5;
      return { fc: pos.map((p, b) => { if (bellDir(n, b) === 1) return fc[b]; const [lo, hi] = bellZone(n, b); return lo * Math.pow(hi / lo, Math.max(0, Math.min(1, p))); }), pos, live: true };
    };
    /** A band's direction: 0 left right, 1 up down, 2 cross (owner's call). */
    const bellDir = (n: number, b: number) => Math.max(0, getParam(`grind${n}.bell${b + 1}_dir`)!.options!.indexOf(String(this.get(`grind${n}.bell${b + 1}_dir`))));
    /** A band's gain at a position of its up down swing (± half its range around its Gain). */
    const bellGainAt = (n: number, b: number, p: number) => Math.max(-18, Math.min(18, this.num(`grind${n}.bell${b + 1}_gain`) + this.num(`grind${n}.bell${b + 1}_vrange`) * (p - 0.5)));
    const bellType = (n: number, b: number) => String(this.get(`grind${n}.bell${b + 1}_type`));
    const bellCount = (n: number) => Math.max(1, Math.min(4, Math.round(this.num(`grind${n}.bell_count`))));
    const bellDot = (n: number, b: number, W: number, fY: (m: number) => number): [number, number] =>
      [freqX(this.num(`grind${n}.bell${b + 1}_freq`) * this.ruinKey(), W), fY(bellNoGain(bellType(n, b)) ? 1 : Math.pow(10, this.num(`grind${n}.bell${b + 1}_gain`) / 20))];
    /** A band's wing: where it moves, from end to end, at the height of its dot (owner's pick, wings with round caps). */
    // a wing's end rings stop against the numbered dot (owner's call): they never slide in behind it, so they can
    // always be grabbed; WING_MIN px from the dot's centre (its radius + a ring's + a hair)
    const WING_MIN = 10.5;
    const bellWing = (n: number, b: number, W: number, fY: (m: number) => number, mini = false): [number, number, number] => {
      const [lo, hi] = bellZone(n, b), [dx, dy] = bellDot(n, b, W, fY), m = mini ? 4 : WING_MIN;
      return [Math.min(freqX(lo, W), dx - m), Math.max(freqX(hi, W), dx + m), dy];
    };
    /** A band's up down wing (owner's call): from its lowest to its highest gain, through its dot, rings at the ends. */
    const bellVWing = (n: number, b: number, W: number, fY: (m: number) => number, mini = false): [number, number, number] => {
      const [dx, dy] = bellDot(n, b, W, fY), m = mini ? 4 : WING_MIN;
      const yt = fY(Math.pow(10, bellGainAt(n, b, 1) / 20)), yb = fY(Math.pow(10, bellGainAt(n, b, 0) / 20));
      return [Math.min(yt, dy - m), Math.max(yb, dy + m), dx];
    };
    const paintBells = (gg: CanvasRenderingContext2D, GW: number, _GH: number, n: number, col: string, mini: boolean, fY: (m: number) => number, bm: number) => {
      void bm;
      const now = bellsNow(n), sel = this.ruinBellSel[n - 1];
      // 0 dB and the curve: the four bands where they are now
      gg.save();
      gg.strokeStyle = 'rgba(255,255,255,0.12)';
      gg.setLineDash([1, 4]);
      gg.beginPath();
      gg.moveTo(0, fY(1));
      gg.lineTo(GW, fY(1));
      gg.stroke();
      gg.restore();
      const NB = bellCount(n);
      const bs = [0, 1, 2, 3].slice(0, NB).map((b) => ({ fc: now.fc[b], t: bellType(n, b), db: now.live && bellDir(n, b) !== 0 ? bellGainAt(n, b, now.pos[b]) : this.num(`grind${n}.bell${b + 1}_gain`), q: this.num(`grind${n}.bell${b + 1}_q`) }));
      gg.strokeStyle = 'rgba(255,255,255,0.9)';
      gg.lineWidth = 1.4;
      gg.beginPath();
      for (let x = 0; x <= GW; x += 2) {
        const f = 20 * Math.pow(1000, x / GW), y = fY(bs.reduce((a, q) => a * bellMag(q.t, q.db, q.q, f / q.fc), 1));
        x ? gg.lineTo(x, y) : gg.moveTo(x, y);
      }
      gg.stroke();
      // each band's wing: a thin line from its dot out to where it moves, a small ring at each end you drag
      for (let b = 0; b < NB; b++) {
        const hot = b === sel && !mini, [x0, x1, y] = bellWing(n, b, GW, fY, mini), cap = mini ? 1.6 : hot ? 3.5 : 2.5;
        const dir = bellDir(n, b), [y0, y1, vx] = bellVWing(n, b, GW, fY, mini);
        gg.save();
        gg.strokeStyle = hexA(col, hot || mini ? 0.95 : 0.45);
        gg.lineWidth = hot ? 1.5 : 1;
        gg.fillStyle = '#060607';
        // left right: the wing across; up down: the wing up and down through the dot; cross: both
        if (dir !== 1) {
          gg.beginPath();
          gg.moveTo(x0 + cap, y);
          gg.lineTo(x1 - cap, y);
          gg.stroke();
          for (const x of [x0, x1]) {
            gg.beginPath();
            gg.arc(x, y, cap, 0, 2 * Math.PI);
            gg.fill();
            gg.stroke();
          }
        }
        if (dir !== 0) {
          gg.beginPath();
          gg.moveTo(vx, y0 + cap);
          gg.lineTo(vx, y1 - cap);
          gg.stroke();
          for (const yy of [y0, y1]) {
            gg.beginPath();
            gg.arc(vx, yy, cap, 0, 2 * Math.PI);
            gg.fill();
            gg.stroke();
          }
        }
        // where the band is right now, riding its wing(s)
        if (now.live) {
          gg.fillStyle = '#fff';
          gg.shadowColor = col;
          gg.shadowBlur = 8;
          gg.beginPath();
          const lx = dir === 1 ? vx : freqX(now.fc[b], GW), ly = dir === 0 ? y : fY(Math.pow(10, bellGainAt(n, b, now.pos[b]) / 20));
          gg.arc(lx, ly, mini ? 1.2 : 2.2, 0, 2 * Math.PI);
          gg.fill();
        }
        gg.restore();
      }
      for (let b = 0; b < NB; b++) {
        const hot = b === sel && !mini, [dx, dy] = bellDot(n, b, GW, fY);
        // the band's dot (Freq / Gain), numbered as the EQ's
        gg.save();
        gg.shadowColor = col;
        gg.shadowBlur = hot ? 12 : 6;
        gg.fillStyle = hot ? '#fff' : col;
        gg.beginPath();
        gg.arc(dx, dy, mini ? 2.5 : hot ? 6 : 5, 0, 2 * Math.PI);
        gg.fill();
        gg.shadowBlur = 0;
        if (!mini) {
          gg.fillStyle = '#111';
          gg.font = '600 8px "Space Grotesk", sans-serif';
          gg.textAlign = 'center';
          gg.textBaseline = 'middle';
          gg.fillText(String(b + 1), dx, dy + 0.5);
        }
        gg.restore();
      }
    };
    // ---- drawing the focus
    // the focus graph, drawn big below the chain and small in each box (mini: no words, smaller balls)
    const paint = (gg: CanvasRenderingContext2D, GW: number, GH: number, k: number, mini: boolean) => {
      const bm = mini ? 0 : 14;
      const bandY = (w: number) => GH - (mini ? 4 : 26) - ((w - 0.5) / 8.5) * (GH - (mini ? 8 : 60));
      const fY = (mag: number) => {
        const d = 20 * Math.log10(Math.max(mag, 1e-4));
        return GH * 0.42 - Math.max(-30, Math.min(18, d)) * (GH / 62);
      };
      // the filter's ball on the graph, as the drive's: sideways = Freq, up / down = H Range (0 at the bottom, the whole
      // spectrum at the top); with KEY on, shown where it sits for the note playing, as the engine has it
      const rangeY = (oct: number) => GH - (mini ? 4 : 26) - (oct / 10) * (GH - (mini ? 8 : 60));
      const filterBall = (n: number) => ({ x: freqX(this.num(`grind${n}.freq`) * this.ruinKey(), GW), y: rangeY(this.num(`grind${n}.range`)) });
      const t = this.ruinTaps, col = COLS[k], n = stageOf(k), tk = tapOf(k);
      paper(gg, GW, GH);
      // frequency grid
      gg.font = '9px "Space Grotesk", sans-serif';
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
        const x = freqX(f, GW);
        // no grid lines (house style: the prints carry no axes); only the big graph keeps its quiet labels
        gg.fillStyle = '#3c3c42';
        !mini && gg.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, GH - 4);
      }
      // the drive's band (where it bites), brighter the harder it drives
      const driveOn = isDrive(k) && stageOn(n) && !!this.get(`grind${n}.drive_on`);
      const bfc = n ? this.num(`grind${n}.drive_freq`) : 0, bw = n ? this.num(`grind${n}.drive_width`) : 9;
      if (driveOn) {
        const drive = this.num(`grind${n}.drive`);
        const lo = bw >= 8.95 ? 20 : bfc * Math.pow(2, -bw / 2), hi = bw >= 8.95 ? 20000 : bfc * Math.pow(2, bw / 2);
        const x0 = freqX(lo, GW), x1 = freqX(hi, GW);
        gg.fillStyle = hexA(col, 0.02 + 0.05 * drive);
        gg.fillRect(x0, 0, x1 - x0, GH - bm);
        gg.fillStyle = hexA(col, 0.6);
        gg.fillRect(x0, 0, x1 - x0, 2);
        gg.fillStyle = hexA(col, 0.75);
        !mini && gg.fillText(`DRIVE ${String(this.get(`grind${n}.drive_type`)).toUpperCase()}${bw >= 8.95 ? ' · WHOLE SOUND' : ''}`, x0 + 5, 13);
        // Tone: where it rounds the top off
        const tone = this.num(`grind${n}.drive_tone`);
        if (tone < 0.999) {
          const tx = freqX(200 * Math.pow(100, tone), GW);
          gg.save();
          gg.setLineDash([2, 4]);
          gg.strokeStyle = hexA(col, 0.6);
          gg.beginPath();
          gg.moveTo(tx, 18);
          gg.lineTo(tx, GH - bm);
          gg.stroke();
          gg.restore();
          gg.fillStyle = hexA(col, 0.6);
          !mini && gg.fillText('TONE', Math.min(GW - 30, tx + 4), 28);
        }
      }
      // what it adds: the spectrum before (dotted) and after (lit), the new part filled
      if (slotOf(k) < 0) {
        !mini && gg.fillText('Empty chain: add a filter or a drive above.', 16, GH / 2);
      } else if (t) {
        const after = ruinSpecPts(t.spec[tk], t.binHz, GW, GH - bm, -100, 0);
        // the sound before, at its real level (owner's call: no loudness matching), so wherever the box doesn't
        // work (outside a drive's band) the two lines lie on top of each other
        const before: [number, number][] | null = ruinSpecPts(t.spec[tk - 1], t.binHz, GW, GH - bm, -100, 0);
        fillUnder(gg, after, GH - bm, col, 0.1, 0.0);
        if (before) {
          gg.fillStyle = hexA(col, 0.32);
          for (let i = 0; i < after.length; i++) {
            const ya = after[i][1], yb = before[i][1];
            if (yb - ya > 5) gg.fillRect(after[i][0], ya, 2, yb - ya);
          }
          gg.save();
          gg.setLineDash([2, 3]);
          gg.strokeStyle = 'rgba(200,200,206,0.55)';
          gg.lineWidth = 1;
          gg.beginPath();
          before.forEach(([x, y], i) => (i ? gg.lineTo(x, y) : gg.moveTo(x, y)));
          gg.stroke();
          gg.restore();
        }
        silver(gg, after, true, col);
      } else {
        gg.fillStyle = '#55555b';
        gg.font = '11px "Space Grotesk", sans-serif';
        !mini && gg.fillText('Play a note: the sound before (dotted) and after this step shows here.', 16, GH / 2 + 40);
      }
      // the stage's filter on top, live
      if (kindOf(k) === 'filter' && stageOn(n) && this.get(`grind${n}.filter_on`) && this.get(`grind${n}.filter`) === 'bells') {
        paintBells(gg, GW, GH, n, col, mini, fY, bm);
      } else if (kindOf(k) === 'filter' && stageOn(n) && this.get(`grind${n}.filter_on`)) {
        // while a note sounds the engine's real filter; at rest it sits at the ball (owner's call)
        const st = this.grindStage(n), live = this.noteSounding() ? this.grindLive[n - 1] : 0;
        const fc = live > 0 ? live : st.freq * this.ruinKey(), res = live > 0 ? this.grindLiveRes[n - 1] : st.res;
        const s2 = { ...st, res: Math.max(0, Math.min(1, res)) };
        const pts: [number, number][] = [];
        for (let x = 0; x <= GW; x += 2) pts.push([x, fY(grindMag(s2, fc, 20 * Math.pow(1000, x / GW)))]);
        gg.save();
        gg.strokeStyle = 'rgba(255,255,255,0.12)';
        gg.setLineDash([1, 4]);
        gg.beginPath();
        gg.moveTo(0, fY(1));
        gg.lineTo(GW, fY(1));
        gg.stroke();
        gg.restore();
        gg.strokeStyle = 'rgba(255,255,255,0.9)';
        gg.lineWidth = 1.4;
        gg.beginPath();
        pts.forEach(([x, y], i) => (i ? gg.lineTo(x, y) : gg.moveTo(x, y)));
        gg.stroke();
        // where it moves, as the drive's band (owner's call): a shaded zone from Freq down and up by half the
        // H Range, with the ball you drag (sideways = Freq, up / down = H Range) and the live dot running inside it
        const fb = filterBall(n), hr = this.num(`grind${n}.range`) / 2;
        const [zlo, zhi] = ruinZone(this.num(`grind${n}.freq`) * this.ruinKey(), this.num(`grind${n}.range`));
        const x0 = freqX(zlo, GW), x1 = freqX(zhi, GW);
        gg.fillStyle = hexA(col, 0.08);
        gg.fillRect(x0, 0, Math.max(1, x1 - x0), GH - bm);
        gg.fillStyle = hexA(col, 0.6);
        gg.fillRect(x0, 0, Math.max(1, x1 - x0), 2);
        gg.fillStyle = hexA(col, 0.75);
        gg.font = '9px "Space Grotesk", sans-serif';
        !mini && gg.fillText(hr > 0.01 ? (zhi / zlo > 999 ? 'MOVES OVER THE WHOLE SPECTRUM' : `MOVES ${(2 * hr).toFixed(1)} OCT`) : 'STANDS STILL', Math.min(x0 + 5, GW - 170), 13);
        gg.save();
        gg.strokeStyle = hexA(col, 0.4);
        gg.setLineDash([2, 3]);
        gg.beginPath();
        gg.moveTo(x0, fb.y);
        gg.lineTo(x1, fb.y);
        gg.stroke();
        gg.restore();
        gg.save();
        gg.strokeStyle = col;
        gg.lineWidth = 2;
        gg.shadowColor = col;
        gg.shadowBlur = 8;
        gg.fillStyle = '#0d0d0f';
        gg.beginPath();
        gg.arc(fb.x, fb.y, mini ? 3 : 6, 0, 2 * Math.PI);
        gg.fill();
        gg.stroke();
        gg.restore();
        if (live > 0) {
          gg.save();
          gg.fillStyle = '#fff';
          gg.shadowColor = col;
          gg.shadowBlur = 10;
          gg.beginPath();
          gg.arc(freqX(fc, GW), fb.y, 2.8, 0, 2 * Math.PI);
          gg.fill();
          gg.restore();
        }
      }
      // a PHASER (owner's pick, option 4): the left (its colour) and right (pale pink) responses where they are right
      // now, the space between them lit: where they differ is the stereo swirl
      if (isPh(k) && stageOn(n) && this.get(`grind${n}.phaser_on`)) {
        const pre = `grind${n}`, N = Math.round(this.num(`${pre}.ph_notches`)), spread = this.num(`${pre}.ph_spread`), amt = this.num(`${pre}.ph_amount`);
        const cen = this.num(`${pre}.ph_center`), fb = this.num(`${pre}.ph_feedback`), st = this.num(`${pre}.ph_stereo`);
        const live = this.noteSounding() && this.phaserLive[n - 1] >= 0;
        // at rest: the left at the centre, the right where STEREO puts it
        const [mL, mR] = live ? unpackPhaser(this.phaserLive[n - 1]) : [0, Math.sin((Math.PI * st) / 180)];
        const ys = (m: number) => {
          const pts: [number, number][] = [];
          for (let x = 0; x <= GW; x += mini ? 2 : 1.5) pts.push([x, fY(phaserMag(20 * Math.pow(1000, x / GW), cen, N, spread, 0.5 * amt * m, fb))]);
          return pts;
        };
        const L = ys(mL), R = ys(mR);
        gg.save();
        gg.strokeStyle = 'rgba(255,255,255,0.12)';
        gg.setLineDash([1, 4]);
        gg.beginPath();
        gg.moveTo(0, fY(1));
        gg.lineTo(GW, fY(1));
        gg.stroke();
        gg.restore();
        gg.fillStyle = 'rgba(255,255,255,0.05)';
        gg.beginPath();
        L.forEach(([x, y], i) => (i ? gg.lineTo(x, y) : gg.moveTo(x, y)));
        [...R].reverse().forEach(([x, y]) => gg.lineTo(x, y));
        gg.fill();
        const line = (pts: [number, number][], c: string, w: number, blur: number) => {
          gg.save();
          gg.strokeStyle = c;
          gg.lineWidth = w;
          gg.shadowColor = c;
          gg.shadowBlur = blur;
          gg.beginPath();
          pts.forEach(([x, y], i) => (i ? gg.lineTo(x, y) : gg.moveTo(x, y)));
          gg.stroke();
          gg.restore();
        };
        line(L, col, mini ? 1.2 : 1.6, mini ? 4 : 8);
        // the right channel in pale pink, the phaser's own colour lightened (owner's pick)
        line(R, '#f2a6d8', mini ? 1 : 1.4, mini ? 3 : 6);
        if (!mini) {
          gg.font = '600 9px "Space Grotesk", sans-serif';
          gg.fillStyle = col;
          gg.fillText('L', 8, 13);
          gg.fillStyle = '#f2a6d8';
          gg.fillText('R', 20, 13);
          gg.fillStyle = 'rgba(200,200,206,0.55)';
          gg.textAlign = 'right';
          gg.fillText(`STEREO ${Math.round(st)}°`, GW - 6, 13);
          gg.textAlign = 'left';
        }
      }
      // an EQ: its curve on top in white and its four numbered balls, as the FX page's EQ
      if (isEq(k) && stageOn(n) && this.get(`grind${n}.eq_on`)) {
        const sc = this.num(`grind${n}.eq_scale`), selB = this.ruinEqSel[n - 1];
        for (let b = 0; b < 4; b++) {
          const bp = `grind${n}.eq_b${b + 1}`, hz = Math.min(this.num(`${bp}_freq`), FS * 0.45), db = this.num(`${bp}_gain`) * sc, q = this.num(`${bp}_q`), pass = eqPass(n, b);
          const f = eqBq[b];
          if (b === 0) pass ? f.setHighpass(hz, q, FS) : f.setLowShelf(hz, db, FS, q);
          else if (b === 3) pass ? f.setLowpass(hz, q, FS) : f.setHighShelf(hz, db, FS, q);
          else pass ? f.setNotch(hz, q, FS) : f.setPeak(hz, db, q, FS);
        }
        gg.save();
        gg.strokeStyle = 'rgba(255,255,255,0.12)';
        gg.setLineDash([1, 4]);
        gg.beginPath();
        gg.moveTo(0, fY(1));
        gg.lineTo(GW, fY(1));
        gg.stroke();
        gg.restore();
        const pts: [number, number][] = [];
        for (let x = 0; x <= GW; x += 2) {
          const f = 20 * Math.pow(1000, x / GW);
          pts.push([x, fY(eqBq.reduce((a, bq) => a * biquadMag(bq, f), 1))]);
        }
        gg.strokeStyle = 'rgba(255,255,255,0.9)';
        gg.lineWidth = 1.4;
        gg.beginPath();
        pts.forEach(([x, y], i) => (i ? gg.lineTo(x, y) : gg.moveTo(x, y)));
        gg.stroke();
        for (let b = 0; b < 4; b++) {
          const [x, y] = eqBall(n, b, GW, fY), hot = b === selB && !mini;
          gg.save();
          gg.shadowColor = col;
          gg.shadowBlur = hot ? 12 : 6;
          gg.fillStyle = hot ? '#fff' : col;
          gg.beginPath();
          gg.arc(x, y, mini ? 2.5 : hot ? 6 : 5, 0, 2 * Math.PI);
          gg.fill();
          gg.shadowBlur = 0;
          if (!mini) {
            gg.fillStyle = '#111';
            gg.font = '600 8px "Space Grotesk", sans-serif';
            gg.textAlign = 'center';
            gg.textBaseline = 'middle';
            gg.fillText(String(b + 1), x, y + 0.5);
          }
          gg.restore();
        }
      }
      // the drive band's ball (drag it: sideways = where, up / down = how wide)
      if (driveOn) {
        gg.save();
        gg.strokeStyle = col;
        gg.lineWidth = 2;
        gg.shadowColor = col;
        gg.shadowBlur = 8;
        gg.fillStyle = '#0d0d0f';
        gg.beginPath();
        gg.arc(freqX(bfc, GW), bandY(bw), mini ? 3 : 6, 0, 2 * Math.PI);
        gg.fill();
        gg.stroke();
        gg.restore();
      }
    
    };
    const LY0 = 16, LY1 = GH - 14;
    const lvY = (d: number) => LY1 - Math.max(0, Math.min(1, (d + 48) / 54)) * (LY1 - LY0);
    const lvId = () => `grind${stageOf(this.ruinSel)}.${kindOf(this.ruinSel)}_level`;
    const drawLevel = () => {
      const k = this.ruinSel, col = COLS[k], t = this.ruinTaps, x0 = 4, w = LMW - 8;
      lg.clearRect(0, 0, LMW, GH);
      lg.fillStyle = '#08080a';
      lg.fillRect(x0, LY0, w, LY1 - LY0);
      lg.fillStyle = 'rgba(255,48,32,0.14)';
      lg.fillRect(x0, LY0, w, lvY(0) - LY0);
      const pk = t ? dB(t.peak[tapOf(k)]) : -120, rm = t ? dB(t.rms[tapOf(k)]) : -120, over = pk > 0;
      lg.fillStyle = hexA(col, 0.55);
      lg.fillRect(x0 + 3, lvY(rm), w - 6, LY1 - lvY(rm));
      lg.fillStyle = over ? '#ff2a14' : col;
      lg.fillRect(x0 + 3, lvY(pk) - 1, w - 6, 2);
      if (over) lg.fillRect(x0 + 3, lvY(pk), w - 6, lvY(0) - lvY(pk));
      lg.fillStyle = over ? '#ff2a14' : 'rgba(255,255,255,0.4)';
      lg.fillRect(x0, lvY(0), w, 1);
      lg.font = '9px "Space Grotesk", sans-serif';
      lg.textAlign = 'center';
      lg.fillStyle = over ? '#ff2a14' : '#8a8a90';
      lg.fillText(pk > -100 ? `${over ? '+' : ''}${pk.toFixed(1)}` : '–', LMW / 2, 10);
      // the handle: the box's level, 0 dB on the 0 dB line
      const lv = this.num(lvId()), hy = lvY(lv);
      lg.fillStyle = '#e8e8ea';
      lg.shadowColor = col;
      lg.shadowBlur = 6;
      lg.fillRect(1, hy - 2, LMW - 2, 4);
      lg.shadowBlur = 0;
      lg.fillStyle = '#0d0d0f';
      lg.fillRect(LMW / 2 - 5, hy - 0.5, 10, 1);
      lg.fillStyle = lv !== 0 ? '#e8e8ea' : '#6a6a70';
      lg.fillText(lv !== 0 ? `${lv > 0 ? '+' : ''}${lv.toFixed(1)}` : '0 dB', LMW / 2, GH - 3);
      lg.textAlign = 'left';
    };
    const lvDrag = (e: PointerEvent) => {
      const r = lcv.getBoundingClientRect(), y = ((e.clientY - r.top) / r.height) * GH;
      const d = -48 + ((LY1 - y) / (LY1 - LY0)) * 54;
      const v = Math.max(-24, Math.min(6, Math.round(d * 2) / 2));
      this.set(lvId(), Math.abs(v) < 0.75 ? 0 : v);
    };
    lcv.addEventListener('pointerdown', (e) => { lcv.setPointerCapture(e.pointerId); lvDrag(e); });
    lcv.addEventListener('pointermove', (e) => { if (lcv.hasPointerCapture(e.pointerId)) lvDrag(e); });
    lcv.addEventListener('dblclick', () => this.set(lvId(), 0));
    const drawGraph = () => {
      paint(gg, GW, GH, this.ruinSel, false);
      drawLevel();
    };
    paintThumb = (g, w, hh, k) => paint(g, w, hh, k, true);
    // dragging on the graph: the drive's ring (where / how wide) or the filter's ball (Freq / H Range), anywhere on it
    let dragging: 'band' | 'filter' | 'eq' | 'bell' | 'bellRange' | 'bellVRange' | 'ph' | null = null;
    const isBells = (k: number) => kindOf(k) === 'filter' && this.get(`grind${stageOf(k)}.filter`) === 'bells';
    /** The band dot or wing end under the pointer: [band, 'bell' | 'bellRange'], or null (a dot wins a tie). */
    const nearBell = (n: number, x: number, y: number): [number, 'bell' | 'bellRange' | 'bellVRange'] | null => {
      let best: [number, 'bell' | 'bellRange' | 'bellVRange'] | null = null, bd = 12;
      for (let b = 0; b < bellCount(n); b++) {
        const [dx, dy] = bellDot(n, b, GW, gfY), [x0, x1, wy] = bellWing(n, b, GW, gfY), [y0, y1, vx] = bellVWing(n, b, GW, gfY), dir = bellDir(n, b);
        const d1 = Math.hypot(x - dx, y - dy) - 2;
        const d2 = dir !== 1 ? Math.min(Math.hypot(x - x0, y - wy), Math.hypot(x - x1, y - wy)) : Infinity;
        const d3 = dir !== 0 ? Math.min(Math.hypot(x - vx, y - y0), Math.hypot(x - vx, y - y1)) : Infinity;
        if (d1 < bd) { bd = d1; best = [b, 'bell']; }
        if (d2 < bd) { bd = d2; best = [b, 'bellRange']; }
        if (d3 < bd) { bd = d3; best = [b, 'bellVRange']; }
      }
      return best;
    };
    const gfY = (mag: number) => eqDbY(GH, 20 * Math.log10(Math.max(mag, 1e-4)));
    const nearBall = (n: number, x: number, y: number) => {
      let best = -1, bd = 16;
      for (let b = 0; b < 4; b++) {
        const [bx, by] = eqBall(n, b, GW, gfY), d = Math.hypot(x - bx, y - by);
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    };
    const at = (e: MouseEvent) => {
      const r = gcv.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * GW, ((e.clientY - r.top) / r.height) * GH];
    };
    const drag = (e: PointerEvent) => {
      if (!dragging) return;
      const n = stageOf(this.ruinSel), pre = `grind${n}`;
      const [x, y] = at(e), f = 20 * Math.pow(1000, Math.max(0, Math.min(1, x / GW)));
      if (dragging === 'ph') {
        this.set(`${pre}.ph_center`, Math.round(Math.max(40, Math.min(12000, f))));
        this.set(`${pre}.ph_amount`, Math.round(Math.max(0, Math.min(6, ((GH - 20 - y) / (GH - 40)) * 6)) * 10) / 10);
      } else if (dragging === 'bell') {
        const bp = `${pre}.bell${this.ruinBellSel[n - 1] + 1}`;
        this.set(`${bp}_freq`, Math.round(Math.max(20, Math.min(20000, f / this.ruinKey()))));
        if (!bellNoGain(String(this.get(`${bp}_type`)))) this.set(`${bp}_gain`, Math.round(Math.max(-18, Math.min(18, (GH * 0.42 - y) / (GH / 62))) * 10) / 10);
      } else if (dragging === 'bellRange') {
        // a wing's end: how far the band moves, the same each side of its Freq
        const bp = `${pre}.bell${this.ruinBellSel[n - 1] + 1}`, centre = this.num(`${bp}_freq`) * this.ruinKey();
        // the ends stop against the dot: never a range smaller than where the rings touch it
        const minR = 2 * WING_MIN * (Math.log2(1000) / GW);
        this.set(`${bp}_range`, Math.round(Math.max(minR, Math.min(10, 2 * Math.abs(Math.log2(f / centre)))) * 10) / 10);
      } else if (dragging === 'bellVRange') {
        // an up down wing's end: how far the band's gain moves, the same each side of its Gain
        const bp = `${pre}.bell${this.ruinBellSel[n - 1] + 1}`, db = (GH * 0.42 - y) / (GH / 62);
        const minV = 2 * WING_MIN / (GH / 62);
        this.set(`${bp}_vrange`, Math.round(Math.max(minV, Math.min(36, 2 * Math.abs(db - this.num(`${bp}_gain`))))));
      } else if (dragging === 'eq') {
        const bp = `${pre}.eq_b${this.ruinEqSel[n - 1] + 1}`, sc = this.num(`${pre}.eq_scale`);
        this.set(`${bp}_freq`, Math.round(Math.max(20, Math.min(20000, f))));
        const db = Math.max(-18, Math.min(18, (GH * 0.42 - y) / (GH / 62)));
        if (!eqPass(n, this.ruinEqSel[n - 1]) && Math.abs(sc) > 0.01) this.set(`${bp}_gain`, Math.round((db / sc) * 10) / 10);
      } else if (dragging === 'band') {
        this.set(`${pre}.drive_freq`, Math.round(Math.max(50, Math.min(18000, f))));
        this.set(`${pre}.drive_width`, Math.round(Math.max(0.5, Math.min(9, 0.5 + ((GH - 26 - y) / (GH - 60)) * 8.5)) * 100) / 100);
      } else {
        this.set(`${pre}.freq`, Math.round(Math.max(40, Math.min(12000, f / this.ruinKey()))));
        this.set(`${pre}.range`, Math.round(Math.max(0, Math.min(10, ((GH - 26 - y) / (GH - 60)) * 10)) * 10) / 10);
      }
    };
    gcv.addEventListener('pointerdown', (e) => {
      const k = this.ruinSel, n = stageOf(k);
      if (isPh(k)) {
        dragging = this.get(`grind${n}.phaser_on`) ? 'ph' : null;
      } else if (isBells(k)) {
        const [x, y] = at(e), hit = this.get(`grind${n}.filter_on`) ? nearBell(n, x, y) : null;
        dragging = hit ? hit[1] : null;
        if (hit) {
          this.ruinBellSel[n - 1] = hit[0];
          bellViews[n - 1]?.();
          drawGraph();
        }
      } else if (isEq(k)) {
        const [x, y] = at(e), b = this.get(`grind${n}.eq_on`) ? nearBall(n, x, y) : -1;
        dragging = b >= 0 ? 'eq' : null;
        if (b >= 0) {
          this.ruinEqSel[n - 1] = b;
          eqBandViews[n - 1]?.();
          drawGraph();
        }
      } else dragging = isDrive(k) ? (this.get(`grind${n}.drive_on`) ? 'band' : null) : this.get(`grind${n}.filter_on`) ? 'filter' : null;
      if (!dragging) return;
      gcv.setPointerCapture(e.pointerId);
      drag(e);
    });
    gcv.addEventListener('pointermove', (e) => { if (gcv.hasPointerCapture(e.pointerId)) drag(e); });
    gcv.addEventListener('pointerup', () => { dragging = null; });
    gcv.addEventListener('wheel', (e) => {
      if (!isEq(this.ruinSel) && !isBells(this.ruinSel)) return;
      e.preventDefault();
      const n = stageOf(this.ruinSel);
      const id = isBells(this.ruinSel) ? `grind${n}.bell${this.ruinBellSel[n - 1] + 1}_q` : `grind${n}.eq_b${this.ruinEqSel[n - 1] + 1}_q`, p = getParam(id)!;
      const q = this.num(id) * Math.pow(1.12, -Math.sign(e.deltaY) * (e.shiftKey ? 0.25 : 1));
      this.set(id, Math.round(Math.max(p.min!, Math.min(p.max!, q)) * 100) / 100);
    }, { passive: false });
    gcv.addEventListener('dblclick', (e) => {
      const n = stageOf(this.ruinSel);
      if (isBells(this.ruinSel)) {
        // double-click: a dot goes flat (0 dB), a wing's end makes the band stand still
        const [x, y] = at(e), hit = nearBell(n, x, y);
        if (hit) this.set(`grind${n}.bell${hit[0] + 1}_${hit[1] === 'bell' ? 'gain' : hit[1] === 'bellVRange' ? 'vrange' : 'range'}`, 0);
      } else if (isEq(this.ruinSel)) {
        const [x, y] = at(e), b = nearBall(n, x, y);
        if (b < 0) return;
        const id = `grind${n}.eq_b${b + 1}_type`, opts = getParam(id)!.options!;
        this.set(id, opts[eqPass(n, b) ? 0 : 1]);
      } else if (isDrive(this.ruinSel)) this.set(`grind${n}.drive_width`, 9);
      else this.set(`grind${n}.range`, 0);
    });
    gcv.title = 'Drag the ball: sideways = where (a filter: Freq; a drive: its band), up / down = how wide (a filter: how far it moves, H Range; a drive: its band). Double-click: a filter stands still, a drive takes the whole sound.';

    // select a node: its box lit, its controls shown
    this.ruinSelect = (k: number) => {
      // a part that isn't in the chain can't be open: the first one that is, or nothing (an empty chain)
      if (slotOf(k) < 0) k = ALL_K.filter((j) => slotOf(j) >= 0).sort((a, b) => slotOf(a) - slotOf(b))[0] ?? k;
      this.ruinSel = k;
      const inChain = slotOf(k) >= 0;
      nodes.forEach((el, j) => el.classList.toggle('gr-cur', j === k));
      sets.forEach((el, j) => { el.style.display = j === k && inChain ? '' : 'none'; });
      emptyHint.style.display = inChain ? 'none' : '';
      page.style.setProperty('--knob-accent', COLVAR(k));
      drawGraph();
    };
    this.ruinFrame = () => {
      const t = this.ruinTaps;
      for (const d of nodeDraws) d(t);
      drawGraph();
    };
    this.grindLiveDraws.push(drawGraph);
    this.watch(['grind.on', ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => GRIND_KEYS.map((key) => `grind${n}.${key}`))], () => {
      drawGraph();
      for (const d of nodeDraws) d(this.ruinTaps);
    });
    page.append(chain, edit);
    this.ruinSelect(this.ruinSel);
    return page;
  }

  /**
   * Put the parts that are on into RUIN's boxes: `fresh` lays them out in the classic order (filter 1, drive 1,
   * filter 2 …; after a ROLL or a chain), otherwise the boxes keep their order, parts switched off leave and parts
   * switched on join at the end.
   */
  private layoutRuinSlots(fresh: boolean): void {
    const on: string[] = [];
    for (let n = 1; n <= 8; n++) {
      if (!this.get(`grind${n}.on`)) continue;
      if (this.get(`grind${n}.filter_on`)) on.push(`filter ${n}`);
      if (this.get(`grind${n}.eq_on`)) on.push(`eq ${n}`);
      if (this.get(`grind${n}.phaser_on`)) on.push(`phaser ${n}`);
      if (this.get(`grind${n}.drive_on`)) on.push(`drive ${n}`);
    }
    const now = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => String(this.get(`grind.slot${s}`)));
    const order = fresh ? on : [...now.filter((v) => on.includes(v)), ...on.filter((v) => !now.includes(v))];
    for (let s = 1; s <= 8; s++) this.set(`grind.slot${s}`, order[s - 1] ?? 'empty');
  }

  /** A GRIND stage's settings (from the patch on screen, or from a stored roll). */
  private grindStage(n: number, from?: Record<string, ParamValue>): GrindView {
    const v = (k: string) => (from ? from[`grind${n}.${k}`] : this.get(`grind${n}.${k}`));
    return { filter: String(v('filter')), freq: Number(v('freq')), range: Number(v('range')), res: 1 - Number(v('width')), depth: Number(v('depth')) };
  }

  /**
   * A filter box's own dice (owner's call): only that filter changes. BELLS rolls its four bands, LINK, Rate and clock
   * from the box's archetype (bells-roll.ts); another type keeps its type and gets a new place, width, depth and movement.
   */
  private filterRoll(n: number): void {
    const pre = `grind${n}`, w = this.grindWeird, rnd = Math.random;
    if (this.get(`${pre}.filter`) === 'bells') {
      const r = rollBells(this.grindArch[n - 1], w);
      r.bands.forEach((b, i) => {
        const bp = `${pre}.bell${i + 1}`;
        this.set(`${bp}_type`, b.type);
        this.set(`${bp}_freq`, b.freq);
        this.set(`${bp}_gain`, b.gain);
        this.set(`${bp}_q`, b.q);
        this.set(`${bp}_range`, b.range);
      });
      this.set(`${pre}.bell_link`, r.link);
      this.set(`${pre}.bell_count`, 4);
      this.set(`${pre}.rate`, r.rate);
      this.set(`${pre}.clock`, r.clock);
      return;
    }
    const round = (v: number, d = 100) => Math.round(v * d) / d;
    this.set(`${pre}.freq`, Math.round(300 * Math.pow(10, rnd())));
    this.set(`${pre}.width`, round(0.2 + 0.6 * rnd()));
    this.set(`${pre}.depth`, round(0.6 + 0.4 * rnd()));
    this.set(`${pre}.range`, round(1 + 3 * rnd(), 10));
    const sync = rnd() < 0.55;
    this.set(`${pre}.clock`, sync ? 'sync' : 'random');
    this.set(`${pre}.rate`, sync ? [0.4, 0.6, 0.8][Math.floor(rnd() * 3)] : round(0.3 + 0.4 * rnd() + 0.2 * w));
  }

  /** A phaser box's own dice: a new set of notches and sweep, kept musical (WEIRD widens it). */
  private phaserRoll(n: number): void {
    const pre = `grind${n}`, w = this.grindWeird, rnd = Math.random, r2 = (v: number, d = 100) => Math.round(v * d) / d;
    this.set(`${pre}.ph_notches`, 2 + Math.floor(rnd() * (4 + 6 * w)));
    this.set(`${pre}.ph_center`, Math.round(300 * Math.pow(8, rnd())));
    this.set(`${pre}.ph_spread`, r2(0.5 + rnd() * (0.8 + 1.2 * w), 10));
    this.set(`${pre}.ph_amount`, r2(0.8 + rnd() * (1.5 + 2.5 * w), 10));
    const sync = rnd() < 0.5;
    this.set(`${pre}.ph_clock`, sync ? 'sync' : rnd() < 0.6 ? 'hz' : 'random');
    this.set(`${pre}.ph_rate`, sync ? [0.2, 0.4, 0.6][Math.floor(rnd() * 3)] : r2(0.15 + rnd() * (0.3 + 0.3 * w)));
    this.set(`${pre}.ph_feedback`, r2(0.2 + rnd() * (0.4 + 0.3 * w)));
    this.set(`${pre}.ph_stereo`, Math.round([0, 45, 90, 90, 180][Math.floor(rnd() * 5)]));
  }

  /** Roll GRIND stages: low weirdness keeps to the classic neuro moves, high goes anywhere. The chain switches on. */
  private grindRoll(stages: number[], counted = false): void {
    const w = this.grindWeird, rnd = Math.random;
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
    const round = (v: number, d = 100) => Math.round(v * d) / d;
    const clampv = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    // nudge a value by up to ±spread, the spread growing with WEIRD (controlled random, owner's call)
    const nudge = (v: number, spread: number, lo: number, hi: number) => clampv(v + (rnd() * 2 - 1) * spread * (0.25 + 1.5 * w), lo, hi);
    const ALL_TYPES = DRIVE_FAMILIES.flat();
    const FILTERS = ['notch', 'peak', 'band', 'comb', 'phaser'] as const;
    // the top of WEIRD: anything goes
    const wild = w > 0.85;
    // a recipe's stage, nudged: near the recipe when tame, its types swapped more often as it gets weird
    const vary = (src: RuinStage): RuinStage => {
      const s = { ...src };
      s.freq = Math.round(clampv(s.freq * Math.pow(2, (rnd() * 2 - 1) * (0.2 + 1.2 * w)), 60, 9000));
      s.width = round(nudge(s.width, 0.08, 0.08, 0.95));
      s.depth = round(nudge(s.depth ?? 1, 0.1, 0.4, 1));
      s.range = round(nudge(s.range, 0.3, 0, 4), 10);
      s.rate = round(nudge(s.rate, 0.06, 0.05, 0.9));
      s.drive = round(nudge(s.drive, 0.06, 0.05, 0.9));
      s.tone = round(nudge(s.tone, 0.08, 0.3, 1));
      s.mix = round(nudge(s.mix, 0.06, 0.4, 1));
      if (rnd() < 0.6 * w) s.type = w < 0.5 ? pick(DRIVE_FAMILIES.find((f) => f.includes(s.type)) ?? ALL_TYPES) : pick(ALL_TYPES);
      if (rnd() < 0.4 * w) s.filter = rnd() < 0.15 ? null : pick(FILTERS);
      // the clock is the movement: HZ / SYNC swing, RANDOM wanders
      if (rnd() < 0.25 * w) s.clock = s.clock === 'random' ? 'hz' : 'random';
      return s;
    };
    const anyStage = (): RuinStage => {
      if (!wild) return vary(pick(RUIN_RECIPES.flatMap((r) => r.stages.filter((x): x is RuinStage => !!x))));
      return {
        filter: rnd() < 0.15 ? null : pick(FILTERS), freq: Math.round(80 * Math.pow(90, rnd())), width: round(0.05 + 0.85 * rnd()), depth: round(0.4 + 0.6 * rnd()), range: round(4 * rnd(), 10),
        rate: round(0.1 + 0.8 * rnd()), clock: rnd() < 0.7 ? 'random' : 'hz',
        type: pick(ALL_TYPES), drive: round(0.15 + 0.8 * rnd()), tone: round(0.3 + 0.7 * rnd()), mix: round(0.4 + 0.6 * rnd()),
      };
    };
    const put = (n: number, st: RuinStage) => {
      for (const [k, v] of Object.entries(stageParams(`grind${n}`, st))) this.set(k, v);
      // the filter is the four bands now (owner's call): rolled from the archetypes, the recipe's movement kept
      if (st.filter) {
        this.set(`grind${n}.filter`, 'bells');
        const r = rollBells(this.grindArch[n - 1], this.grindWeird);
        r.bands.forEach((b, i) => {
          const bp = `grind${n}.bell${i + 1}`;
          this.set(`${bp}_type`, b.type);
          this.set(`${bp}_freq`, b.freq);
          this.set(`${bp}_gain`, b.gain);
          this.set(`${bp}_q`, b.q);
          this.set(`${bp}_range`, b.range);
        });
        this.set(`grind${n}.bell_link`, r.link);
        this.set(`grind${n}.bell_count`, 4);
      }
    };
    if (!counted) {
      // a stage's own die: one stage from any recipe, nudged
      for (const n of stages) put(n, anyStage());
      this.layoutRuinSlots(false);
      this.set('grind.on', true);
      return;
    }
    // ROLL: a recipe (or, at the top of WEIRD, anything), its stages laid into the unlocked slots in order
    const recipe = pick(RUIN_RECIPES);
    let chain = wild ? [anyStage(), anyStage(), anyStage(), anyStage()].slice(0, 1 + Math.floor(4 * rnd())) : recipe.stages.filter((x): x is RuinStage => !!x).map(vary);
    // how many stages: the recipe's own (AUTO) or the count, locked stages that are on counting too
    const lockedOn = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => this.grindLocks[n - 1] && !!this.get(`grind${n}.on`)).length;
    const want = Math.max(0, Math.min(stages.length, (this.grindCount || chain.length + lockedOn) - lockedOn));
    while (chain.length < want) chain.splice(Math.floor(rnd() * (chain.length + 1)), 0, anyStage());
    while (chain.length > want) chain.splice(1 + Math.floor(rnd() * Math.max(1, chain.length - 1)), 1); // keep the first (the warm start)
    chain = chain.slice(0, want);
    stages.forEach((n, i) => {
      if (i < chain.length) put(n, chain[i]);
      else this.set(`grind${n}.on`, false);
    });
    const r = recipe;
    this.set('grind.ott', round(wild ? rnd() * 0.8 : nudge(r.ott, 0.08, 0, 1)));
    this.set('grind.lowcut', Math.round(wild ? 60 + 240 * rnd() : clampv(r.lowcut * Math.pow(2, (rnd() * 2 - 1) * 0.5 * w), 40, 400)));
    this.set('grind.mix', round(wild ? 0.6 + 0.4 * rnd() : r.mix));
    this.set('grind.output', wild ? -3 : r.output);
    this.grindRecipe = wild ? 'WILD' : r.name;
    this.layoutRuinSlots(true);
    this.set('grind.on', true);
  }

  // ------------------------------------------------------------------ the PRESETS page

  /** Switch between the synth page (OSC) and the preset browser (PRESETS). */
  private showTab(t: string): void {
    for (const [name, b] of this.tabBtns) b.classList.toggle('on', name === t);
    if (this.oscPage!.style.display !== 'none') this.pageHeight = this.oscPage!.offsetHeight || this.pageHeight;
    const pages: [string, HTMLElement][] = [['OSC', this.oscPage!], ['LFO', this.modPage!], ['RUIN', this.grindPage!], ['FX', this.fxPage!], ['PRESETS', this.presetPage]];
    if (t === 'PRESETS') {
      this.pageShelf = this.presets?.current().shelf || this.pageShelf || (this.presets?.shelves()[0]?.id ?? '');
      this.renderPresetPage();
    }
    for (const [name, el] of pages) {
      // The browser keeps the synth page's height; LFO and FX take what they need.
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
      h('span', 'pp-sub', which === 'randomizer' ? `${items.length} rolls` : `${items.length} ${items.length === 1 ? 'sound' : 'sounds'}`));
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
    } else {
      const exp = h('button', 'pp-clear', 'Export all');
      exp.disabled = !items.length;
      exp.title = 'Download every User sound as one file (user-sounds.json), to build them into the synth';
      exp.onclick = () => src.exportUser();
      col.append(h('div', 'pp-rollbar', exp));
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
      this.live(() => { for (const f of this.wheelViews) f(); });
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

        h('span', 'kb-label', 'TOUCH'), touch));
    return h('div', 'kb-strip', side, this.keysEl);
  }

  // ------------------------------------------------------------------ the page

  /** The website's logo at the left of the header, its top on the name's top and its bottom on SYNTHESIZER's bottom. */
  private logoPlate(): HTMLElement {
    const plate = h('div', 'v2-logo');
    // cropped to the mark's own edges (triangle and its stroke), so its top and bottom are the glyph's
    plate.innerHTML = logoSvg.replace(/viewBox="[^"]*"/, 'viewBox="1.3 2.3 49.4 45.4"');
    plate.append(h('div', 'v2-logo-wear'));
    plate.title = 'RUIN-1';
    return plate;
  }

  /** The header's scene (code-drawn for now; a painted image can replace it). */
  private build(): void {
    this.page.style.setProperty('--dust', `url(${panelTexture()})`);
    // RUIN's boxes have other proportions: their own surface at their own size (2x), so the grain isn't stretched
    this.page.style.setProperty('--dust-node', `url(${panelTexture(294, 300, 6)})`);
    this.page.style.setProperty('--dust-wide', `url(${panelTexture(1194, 592, 7)})`);
    this.page.style.setProperty('--light-grain', `url(${lightGrain()})`);
    // the frame behind the boxes, also round the page (the wrapper is outside this element, so it goes on the root)
    document.documentElement.style.setProperty('--frame', `url(${frameTexture()})`);
    this.page.style.setProperty('--corrosion', `url(${corrosionTexture()})`);
    this.page.style.setProperty('--logo-wear', `url(${logoWear()})`);
    this.page.style.setProperty('--wood-l', `url(${woodTexture('l')})`);
    this.page.style.setProperty('--wood-r', `url(${woodTexture('r')})`);
    this.page.style.setProperty('--key-grime', `url(${keyGrime()})`);
    const tabs = h('div', 'v2-tabs');
    for (const [t, ready] of [['OSC', true], ['LFO', true], ['RUIN', true], ['FX', true], ['PRESETS', true]] as const) {
      const b = h('button', 'tab' + (t === 'OSC' ? ' on' : ''), t);
      if (!ready) {
        b.disabled = true;
        b.title = 'Coming later (until then: "All controls" opens every control)';
      } else b.onclick = () => this.showTab(t);
      if (t === 'LFO') {
        this.lockViews.push(() => b.classList.toggle('locked', this.lfo5Locked));
        // A level bar under the name while the Wobbler is on: it grows and shrinks with what the
        // Wobbler does right now (owner's pick); off, the tab looks like any other.
        const fill = h('span', 'tab-level-fill'), bar = h('span', 'tab-level', fill);
        b.append(bar);
        const view = () => {
          // (the busiest of the four custom LFOs)
          bar.classList.toggle('on', this.wobOns.some((o) => o));
          fill.style.width = `${Math.round(Math.max(0, ...this.wobNows.map((v) => v ?? 0)) * 100)}%`;
        };
        this.wobLevelViews.push(view);
        const all = WOB_PREFIXES.flatMap((w) => [`${w}.on`, ...wobTargetIds(w)]);
        this.watch(all, () => {
          this.wobOns = WOB_PREFIXES.map((w) => this.wobActive(w));
          view();
        });
      }
      this.tabBtns.set(t, b);
      tabs.append(b);
    }
    const cap = (n: string, name: string, note: string, zone: Zone) =>
      h('div', `zone-cap cap-${zone}`, h('span', 'cap-name', `${n}  ${name}`), h('span', 'cap-note', note), h('span', 'cap-line'));
    void cap;
    // Two rows of four boxes: OSC A, OSC B, amp envelope, filter; sub, noise, wobble, filter envelope.
    this.oscPage = h('div', 'v2-main osc-page',
      this.oscStrip(1), this.oscStrip(2), this.envBox('amp_env', 'AMP ENVELOPE', 'c-src box-amp'), this.filterBox(),
      this.subStrip(), this.noiseStrip(), this.scopeBox(), this.envBox('mod_env', 'FILTER ENVELOPE', 'c-flt box-fenv'));
    this.lfoPage = h('div', 'v2-main osc-page lfo-page', ...[1, 2, 3, 4].flatMap((n) => [...this.buildLfoPage(n).children] as HTMLElement[]));
    this.modPage = this.buildModPage(this.lfoPage);
    this.fxPage = this.buildFxPage();
    this.grindPage = this.buildGrindPage();
    this.grindPage.style.display = 'none';
    this.presetPage.style.display = 'none';
    this.modPage.style.display = 'none';
    this.fxPage.style.display = 'none';
    this.lfoPage.style.display = 'none';
    this.page.append(
      h('div', 'v2-top', h('div', 'v2-corrode'), this.logoPlate(), h('div', 'v2-brand', h('span', 'brand-name', 'RUIN-1'), h('span', 'brand-sub', 'Synthesizer')), this.presetSelector(), h('div', 'v2-top-right', tabs, this.zoomBtn)),
      this.oscPage,
      this.modPage,
      this.lfoPage,
      this.grindPage,
      this.fxPage,
      this.presetPage,
      this.bottomBar(),
      this.keyboardStrip(),
      h('div', 'film'),
    );
  }
}

// ------------------------------------------------------------------ GRIND prints

/** A GRIND stage's parameters (grind<n>.*), in the order a roll snapshot keeps them. */
const GRIND_KEYS = ['on', 'filter', 'freq', 'range', 'rate', 'clock', 'width', 'depth', 'drive_type', 'drive', 'mix', 'filter_on', 'drive_on', 'filter_level', 'drive_level',
  'drive_freq', 'drive_width', 'drive_tone', 'eq_on', 'eq_level', 'eq_scale', ...[1, 2, 3, 4].flatMap((b) => ['type', 'freq', 'gain', 'q'].map((x) => `eq_b${b}_${x}`)),
  'bell_link', 'bell_count', ...[1, 2, 3, 4].flatMap((b) => ['type', 'freq', 'gain', 'q', 'range'].map((x) => `bell${b}_${x}`)),
  'phaser_on', 'phaser_level', 'ph_notches', 'ph_center', 'ph_spread', 'ph_amount', 'ph_rate', 'ph_clock', 'ph_feedback', 'ph_stereo'];
type GrindView = { filter: string; freq: number; range: number; res: number; depth?: number };
type Cx = [number, number];
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: Cx, b: Cx): Cx => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cabs = (a: Cx): number => Math.hypot(a[0], a[1]);
/** A state-variable band-pass (s / (s² + ks + 1)) at w = f / fc. */
const svfBp = (w: number, k: number): Cx => cdiv([0, w], [1 - w * w, k * w]);

/**
 * |H| of a RUIN phaser (as the engine plays it): N second-order all-passes (k = 1/1.1) at the centre ± the spread,
 * moved by `shift` octaves, with feedback, summed with the dry and levelled as the engine does.
 */
function phaserMag(f: number, center: number, N: number, spread: number, shift: number, fb: number): number {
  const k = 1 / 1.1;
  let A: Cx = [1, 0];
  for (let i = 0; i < N; i++) {
    const fi = center * Math.pow(2, (i - (N - 1) / 2) * spread + shift), w = f / fi;
    A = cmul(A, cdiv([1 - w * w, -k * w], [1 - w * w, k * w]));
  }
  const V = cdiv(A, [1 - fb * A[0], -fb * A[1]]), c = (1 - fb) / (2 - fb);
  return cabs([c * (1 + V[0]), c * V[1]]);
}

/** |H| of one BELLS band (as the engine plays it: an SVF mixed c0·x + c1·bp + c2·lp + c3·hp) at w = f / fc. */
function bellMag(t: string, db: number, q: number, w: number): number {
  const A = Math.pow(10, db / 40), k = 1 / q;
  // one SVF section at w' (lp, bp, hp)
  const sec = (w2: number, k2: number): [Cx, Cx, Cx] => {
    const D: Cx = [1 - w2 * w2, k2 * w2];
    return [cdiv([1, 0], D), cdiv([0, w2], D), cdiv([-w2 * w2, 0], D)];
  };
  if (t === 'low cut 48' || t === 'high cut 48') {
    const QS = [0.5098, 0.6013, 0.9, 2.5629 * (q / 0.7071)];
    return QS.reduce((m, qq) => { const [lp, , hp] = sec(w, 1 / qq); return m * cabs(t === 'low cut 48' ? hp : lp); }, 1);
  }
  if (t === 'comb') {
    // rings on Freq and its harmonics (the delay is one period of Freq), its peaks at 0 dB
    const fb = 0.92 * Math.max(-1, Math.min(1, db / 18)), ph = 2 * Math.PI * w;
    return (1 - Math.abs(fb)) / Math.hypot(1 - fb * Math.cos(ph), fb * Math.sin(ph));
  }
  if (t === 'phaser') {
    const fb = 0.85 * Math.min(1, Math.log2(1 + q) / Math.log2(19)), ap1 = cdiv([1, -w], [1, w]);
    const ap4 = cmul(cmul(ap1, ap1), cmul(ap1, ap1));
    const v = cdiv(ap4, [1 - fb * ap4[0], -fb * ap4[1]]), c = (1 - fb) / (2 - fb);
    return cabs([c * (1 + v[0]), c * v[1]]);
  }
  const w2 = t === 'low shelf' ? w * Math.sqrt(A) : t === 'high shelf' ? w / Math.sqrt(A) : w;
  const [lp, bp, hp] = sec(w2, k);
  const c = t === 'band' ? [0, k, 0, 0] : t === 'low cut 12' ? [0, 0, 0, 1] : t === 'high cut 12' ? [0, 0, 1, 0] : t === 'notch' ? [0, 0, 1, 1]
    : t === 'low shelf' ? [1, k * (A - 1), A * A - 1, 0] : t === 'high shelf' ? [A * A, k * (1 - A) * A, 1 - A * A, 0] : [1, (A * A - 1) * k, 0, 0];
  return cabs([c[0] + c[1] * bp[0] + c[2] * lp[0] + c[3] * hp[0], c[1] * bp[1] + c[2] * lp[1] + c[3] * hp[1]]);
}

/** |H| of a GRIND stage's filter (as the engine plays it) at f, with its centre at fc. */
function grindMag(st: GrindView, fc: number, f: number): number {
  // the filter's response H, then Depth blends it in as the engine does: 1 + depth (H - 1)
  const w = f / fc, res = st.res, d = st.depth ?? 1;
  let H: [number, number];
  switch (st.filter) {
    case 'notch': {
      const k = 1.6 * (1 - res) + 0.08;
      H = cdiv([1 - w * w, 0], [1 - w * w, k * w]);
      break;
    }
    case 'peak': {
      const k = 1.2 * (1 - res) + 0.15, pk = 6, bp = svfBp(w, k);
      H = [1 + pk * k * bp[0], pk * k * bp[1]];
      break;
    }
    case 'band': {
      const k = 1.4 * (1 - res) + 0.1, bp = svfBp(w, k);
      H = [k * bp[0], k * bp[1]];
      break;
    }
    case 'comb': {
      const fb = 0.92 * res, ph = 2 * Math.PI * w;
      const q = cdiv([1, 0], [1 - fb * Math.cos(ph), fb * Math.sin(ph)]);
      H = [(1 - fb) * q[0], (1 - fb) * q[1]];
      break;
    }
    case 'phaser': {
      const fb = 0.75 * res, ap1 = cdiv([1, -w], [1, w]);
      const ap4 = cmul(cmul(ap1, ap1), cmul(ap1, ap1));
      const v = cdiv(ap4, [1 - fb * ap4[0], -fb * ap4[1]]), c = (1 - fb) / (2 - fb);
      H = [c * (1 + v[0]), c * v[1]];
      break;
    }
    default: return 1;
  }
  return cabs([1 + d * (H[0] - 1), d * H[1]]);
}
/** A magnitude on a print: -30 … +12 dB, 0 dB about two thirds up. */
function grindY(mag: number, H: number): number {
  const db = 20 * Math.log10(Math.max(mag, 1e-4));
  return H - 6 - Math.max(0, Math.min(1, (db + 30) / 42)) * (H - 12);
}
/** A frequency's x on a print (20 Hz … 20 kHz, log). */
/** Where a RUIN filter moves (Hz): centre ± half the H Range in octaves, slid inside 20 Hz-20 kHz, as the engine does. */
function ruinZone(centre: number, range: number): [number, number] {
  const L = Math.log2(20), Hh = Math.log2(20000), c = Math.log2(Math.max(centre, 1)), h = range / 2;
  let lo = c - h, hi = c + h;
  if (hi - lo >= Hh - L) { lo = L; hi = Hh; }
  else if (lo < L) { hi += L - lo; lo = L; }
  else if (hi > Hh) { lo -= hi - Hh; hi = Hh; }
  return [Math.pow(2, lo), Math.pow(2, hi)];
}
const freqX = (f: number, W: number): number => Math.max(0, Math.min(W, (Math.log(f / 20) / Math.log(1000)) * W));
const DICE_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5.2" cy="5.2" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="10.8" cy="10.8" r="1.2" fill="currentColor"/></svg>';
const lockSvg = (on: boolean): string =>
  `<svg viewBox="0 0 14 16" width="11" height="13" aria-hidden="true"><path d="${on ? 'M3.5 7V4.8a3.5 3.5 0 0 1 7 0V7' : 'M3.5 7V4.8a3.5 3.5 0 0 1 6.6-1.6'}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="1.5" y="7" width="11" height="8" rx="1.2" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4"/></svg>`;

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
