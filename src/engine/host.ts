// Main-thread side of the engine: owns the AudioContext and the worklet node,
// validates patches and compiles loops before handing them to the audio thread.

import { getParam, paramIndex, patchToArray, toEngineValue, validatePatch, type Patch, type ParamValue } from '../schema';
import { compileLoop, type Loop } from './core/sequencer';
import { PROCESSOR_NAME, type EngineMessage } from './messages';
import workletUrl from './worklet.ts?worker&url';

/** The RUIN page's live view of its chain: 0 input, 1-2 the input again (SAT and PRE OTT were removed), 3-10 boxes 1-8, 11 RUIN's OTT, 12 the output. */
export interface RuinTaps {
  spec: Float32Array<ArrayBuffer>[];
  rms: number[];
  peak: number[];
  binHz: number;
}

export class EngineHost {
  readonly ctx: AudioContext;
  readonly node: AudioWorkletNode;
  readonly analyser: AnalyserNode;
  /** Read the engine's live filter (output 2: cutoff, resonance). */
  private readonly ctlCut: AnalyserNode;
  private readonly ctlRes: AnalyserNode;
  private readonly ctlWob: AnalyserNode;
  private readonly ctlLfo: AnalyserNode[] = [];
  private readonly ctlBuf = new Float32Array(32);
  /** The RUIN page's taps (output 3): an analyser on each point of the chain, read only while the page shows. */
  private readonly tapAn: AnalyserNode[] = [];
  private readonly tapTime = new Float32Array(2048);
  readonly ruinView: RuinTaps = { spec: [], rms: new Array(13).fill(0), peak: new Array(13).fill(0), binHz: 0 };

  private constructor(ctx: AudioContext, node: AudioWorkletNode) {
    this.ctx = ctx;
    this.node = node;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.6;
    node.connect(ctx.destination);
    node.connect(this.analyser);
    const split = ctx.createChannelSplitter(32);
    node.connect(split, 1);
    this.ctlCut = ctx.createAnalyser();
    this.ctlRes = ctx.createAnalyser();
    this.ctlWob = ctx.createAnalyser();
    this.ctlCut.fftSize = this.ctlRes.fftSize = this.ctlWob.fftSize = 32;
    split.connect(this.ctlCut, 0);
    split.connect(this.ctlRes, 1);
    split.connect(this.ctlWob, 2);
    const tsplit = ctx.createChannelSplitter(13);
    node.connect(tsplit, 2);
    for (let c = 0; c < 13; c++) {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0.8;
      a.minDecibels = -110;
      a.maxDecibels = 0;
      tsplit.connect(a, c);
      this.tapAn.push(a);
      this.ruinView.spec.push(new Float32Array(a.frequencyBinCount));
    }
    this.ruinView.binHz = ctx.sampleRate / 2048;
    for (let c = 3; c < 32; c++) {
      const a = ctx.createAnalyser();
      a.fftSize = 32;
      split.connect(a, c);
      this.ctlLfo.push(a);
    }
  }

  /** Each LFO's phase (0..1) and value (-1..1) right now; the LFOs run whether or not a note sounds. */
  liveLfos(): { phase: number[]; value: number[] } {
    const read = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(this.ctlBuf);
      return this.ctlBuf[31];
    };
    const a = this.ctlLfo;
    return { phase: [...a.slice(0, 4), a[17], a[18]].map(read), value: [...a.slice(4, 8), a[19], a[20]].map(read) };
  }

  /** Each GRIND stage's filter frequency right now (Hz), -1 when it is off or nothing sounds. */
  liveGrind(): { fc: number[]; res: number[] } {
    const read = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(this.ctlBuf);
      return this.ctlBuf[31];
    };
    // stages 1-4 on channels 12-15 / 16-19, stages 5-8 on 24-27 / 28-31
    const a = this.ctlLfo;
    return { fc: [...a.slice(9, 13), ...a.slice(21, 25)].map(read), res: [...a.slice(13, 17), ...a.slice(25, 29)].map(read) };
  }

  /** The RUIN page's taps right now: each point's spectrum (dB per bin), level (RMS) and peak, linear. */
  ruinTaps(): RuinTaps {
    const v = this.ruinView, t = this.tapTime;
    this.tapAn.forEach((a, k) => {
      a.getFloatFrequencyData(v.spec[k]);
      a.getFloatTimeDomainData(t);
      let s = 0, pk = 0;
      for (let i = 0; i < t.length; i++) {
        const x = t[i];
        s += x * x;
        const ax = Math.abs(x);
        if (ax > pk) pk = ax;
      }
      v.rms[k] = Math.sqrt(s / t.length);
      v.peak[k] = pk;
    });
    return v;
  }

  /** Listening on the RUIN page: `at` as the taps (0 none), `mode` 1 solo, 2 bypass, 3 delta. */
  listen(at: number, mode: number): void {
    this.post({ type: 'listen', at, mode });
  }

  /** The Wobbler filter's cutoff right now (Hz), or null when it is not working. */
  liveWobFilter(): number | null {
    this.ctlLfo[8].getFloatTimeDomainData(this.ctlBuf);
    const fc = this.ctlBuf[31];
    return fc > 0 ? fc : null;
  }

  /** Where the Wobbler is in its cycle, 0..1, or null when it is off or silent. */
  liveWobble(): number | null {
    this.ctlWob.getFloatTimeDomainData(this.ctlBuf);
    const p = this.ctlBuf[31];
    return p >= 0 && this.liveFilter() ? p : null;
  }

  /** The newest sounding voice's cutoff (Hz) and resonance, or null when nothing sounds. */
  liveFilter(): { cutoff: number; res: number } | null {
    this.ctlCut.getFloatTimeDomainData(this.ctlBuf);
    const cutoff = this.ctlBuf[31];
    if (!(cutoff > 0)) return null;
    this.ctlRes.getFloatTimeDomainData(this.ctlBuf);
    return { cutoff, res: this.ctlBuf[31] };
  }


  static async create(): Promise<EngineHost> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 3,
      outputChannelCount: [2, 32, 13],
    });
    return new EngineHost(ctx, node);
  }

  private post(m: EngineMessage): void {
    this.node.port.postMessage(m);
  }

  /** Validate, clamp and send a whole patch. Returns the validated patch. */
  setPatch(input: unknown, immediate = false): Patch {
    const { patch } = validatePatch(input);
    this.post({ type: 'params', values: patchToArray(patch), immediate });
    return patch;
  }

  setParam(id: string, value: ParamValue): void {
    const p = getParam(id);
    if (!p) return;
    this.post({ type: 'param', index: paramIndex(id), value: toEngineValue(p, value) });
  }

  noteOn(note: number, velocity = 0.8): void {
    this.post({ type: 'noteOn', note, velocity });
  }

  noteOff(note: number): void {
    this.post({ type: 'noteOff', note });
  }

  pitchBend(value: number): void {
    this.post({ type: 'bend', value });
  }

  modWheel(value: number): void {
    this.post({ type: 'modwheel', value });
  }

  /** Listening aid, not part of the patch: solo / mute sound layers. */
  monitor(solo: string[], mute: string[]): void {
    this.post({ type: 'monitor', solo, mute });
  }

  setLoop(loop: Loop | null): void {
    this.post({ type: 'loop', loop: loop ? compileLoop(loop) : null });
  }

  play(): void {
    this.post({ type: 'play' });
  }

  stop(): void {
    this.post({ type: 'stop' });
  }

  panic(): void {
    this.post({ type: 'panic' });
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }
}
