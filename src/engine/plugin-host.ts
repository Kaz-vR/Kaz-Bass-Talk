// Inside the plugin window (a WebView in the JUCE plugin) the UI talks to the C++
// engine instead of an AudioWorklet: the same calls as EngineHost, sent as JUCE
// events; the plugin answers with its parameters (host automation, program
// changes, a reopened window), the notes it plays and its output for the scope.

import { getParam, paramIndex, params, patchToArray, toEngineValue, validatePatch, type Patch, type ParamValue } from '../schema';
import { compileLoop, type Loop } from './core/sequencer';

interface JuceBackend {
  addEventListener(id: string, fn: (payload: unknown) => void): unknown;
  emitEvent(id: string, payload: unknown): void;
}
const juce = (): JuceBackend | undefined => (window as unknown as { __JUCE__?: { backend?: JuceBackend } }).__JUCE__?.backend;

/** True when the page runs inside the plugin window. */
export const inPlugin = (): boolean => !!juce();

/** What the plugin sends when the window opens or the host changes the whole patch. */
export interface PluginState {
  values: number[];
  name: string;
}
export interface PluginFeed {
  /** The whole patch (window opened, program change, state restored). */
  state(s: PluginState): void;
  /** Parameters the host changed (automation). */
  params(changes: [number, number][]): void;
  /** Notes the plugin is playing from the host's MIDI, and its mod wheel (-1: leave it). */
  notes(held: number[], wheel: number): void;
}

/** An AnalyserNode stand-in fed with the plugin's output. */
class PluginAnalyser {
  readonly fftSize = 4096;
  readonly frequencyBinCount = 2048;
  readonly context = { sampleRate: 48000 };
  private readonly buf = new Float32Array(4096);
  private readonly re = new Float32Array(4096);
  private readonly im = new Float32Array(4096);

  feed(samples: Float32Array, sampleRate: number): void {
    this.context.sampleRate = sampleRate;
    const n = Math.min(samples.length, this.buf.length);
    this.buf.copyWithin(0, n);
    this.buf.set(samples.subarray(samples.length - n), this.buf.length - n);
  }

  getFloatTimeDomainData(out: Float32Array): void {
    out.set(this.buf.subarray(this.buf.length - out.length));
  }

  /** dB magnitudes (Blackman window, radix-2 FFT), as the AnalyserNode gives them. */
  getFloatFrequencyData(out: Float32Array): void {
    const N = this.fftSize, re = this.re, im = this.im;
    for (let i = 0; i < N; i++) {
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N);
      re[i] = this.buf[i] * w;
      im[i] = 0;
    }
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const p = i + k, q = p + len / 2;
          const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
          re[q] = re[p] - tr;
          im[q] = im[p] - ti;
          re[p] += tr;
          im[p] += ti;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = t;
        }
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) / N + 1e-12);
  }
}

/** Engine values (schema order) → a patch, keeping the meta given. */
export function arrayToPatch(values: number[], meta: Patch['meta']): Patch {
  const patch: Record<string, unknown> = { meta };
  params.forEach((p, i) => {
    const v = values[i];
    if (v === undefined) return;
    patch[p.id] = p.type === 'enum' ? p.options![Math.round(v)] : p.type === 'bool' ? v > 0.5 : p.type === 'int' ? Math.round(v) : v;
  });
  return validatePatch(patch).patch;
}

const LAYERS = ['osc1', 'osc2', 'sub', 'noise', 'breath', 'texture'];
const mask = (names: string[]) => names.reduce((m, n) => (LAYERS.includes(n) ? m | (1 << LAYERS.indexOf(n)) : m), 0);

export class PluginHost {
  readonly analyser = new PluginAnalyser() as unknown as AnalyserNode;
  private wheelAt = -Infinity;
  /** The engine's live values (see LowTalkProcessor::live): cutoff, res, wobble phase, wobble filter, LFO phases ×4, values ×4, GRIND fc ×4, res ×4. */
  private live: number[] = [];

  constructor(feed: PluginFeed) {
    const b = juce()!;
    b.addEventListener('lt-state', (p) => feed.state(p as PluginState));
    b.addEventListener('lt-params', (p) => feed.params(p as [number, number][]));
    b.addEventListener('lt-live', (p) => {
      const { scope, rate, held, wheel, live } = p as { scope: string; rate: number; held: number[]; wheel: number; live?: number[] };
      if (live) this.live = live;
      if (scope) {
        const bin = atob(scope);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        (this.analyser as unknown as PluginAnalyser).feed(new Float32Array(bytes.buffer), rate);
      }
      // The wheel the plugin plays, unless it's the on-screen wheel being moved right now.
      feed.notes(held, performance.now() - this.wheelAt < 500 ? -1 : wheel);
    });
    this.send({ type: 'ready' });
  }

  private send(m: Record<string, unknown>): void {
    juce()?.emitEvent('lt', m);
  }

  /** Validate, clamp and send a whole patch (it becomes the plugin's parameters). */
  setPatch(input: unknown, _immediate = false): Patch {
    const { patch } = validatePatch(input);
    this.send({ type: 'patch', values: Array.from(patchToArray(patch)), name: String(patch.meta.name ?? '') });
    return patch;
  }

  setParam(id: string, value: ParamValue): void {
    const p = getParam(id);
    if (p) this.send({ type: 'param', index: paramIndex(id), value: toEngineValue(p, value) });
  }

  noteOn(note: number, velocity = 0.8): void {
    this.send({ type: 'noteOn', note, velocity });
  }

  noteOff(note: number): void {
    this.send({ type: 'noteOff', note });
  }

  pitchBend(value: number): void {
    this.send({ type: 'bend', value });
  }

  modWheel(value: number): void {
    this.wheelAt = performance.now();
    this.send({ type: 'wheel', value });
  }

  monitor(solo: string[], mute: string[]): void {
    this.send({ type: 'monitor', solo: mask(solo), mute: mask(mute) });
  }

  setLoop(loop: Loop | null): void {
    const c = loop ? compileLoop(loop) : null;
    this.send({ type: 'loop', bpm: c?.bpm ?? 120, length: c?.lengthBeats ?? 4, events: c ? Array.from(c.events.subarray(0, c.count * 4)) : [] });
  }

  play(): void {
    this.send({ type: 'play' });
  }

  stop(): void {
    this.send({ type: 'stop' });
  }

  panic(): void {
    this.send({ type: 'panic' });
  }

  async resume(): Promise<void> {}

  /** The newest voice's cutoff (Hz) and resonance, or null when nothing sounds. */
  liveFilter(): { cutoff: number; res: number } | null {
    const c = this.live[0];
    return c > 0 ? { cutoff: c, res: this.live[1] } : null;
  }

  /** Where the Wobbler is in its cycle (0..1), or null when it is off. */
  liveWobble(): number | null {
    const w = this.live[2];
    return w !== undefined && w >= 0 ? w : null;
  }

  /** The Wobbler filter's cutoff (Hz), or null when it is not working. */
  liveWobFilter(): number | null {
    const f = this.live[3];
    return f > 0 ? f : null;
  }

  /** Each LFO's phase (0..1) and value (-1..1). */
  liveLfos(): { phase: number[]; value: number[] } {
    return { phase: [0, 1, 2, 3].map((i) => this.live[4 + i] ?? 0), value: [0, 1, 2, 3].map((i) => this.live[8 + i] ?? 0) };
  }

  /** Each GRIND stage's filter frequency (Hz, -1 off) and resonance. */
  liveGrind(): { fc: number[]; res: number[] } {
    return { fc: [0, 1, 2, 3].map((i) => this.live[12 + i] ?? -1), res: [0, 1, 2, 3].map((i) => this.live[16 + i] ?? 0) };
  }
}
