// Main-thread side of the engine: owns the AudioContext and the worklet node,
// validates patches and compiles loops before handing them to the audio thread.

import { getParam, paramIndex, patchToArray, toEngineValue, validatePatch, type Patch, type ParamValue } from '../schema';
import { compileLoop, type Loop } from './core/sequencer';
import { PROCESSOR_NAME, type EngineMessage } from './messages';
import workletUrl from './worklet.ts?worker&url';

export class EngineHost {
  readonly ctx: AudioContext;
  readonly node: AudioWorkletNode;
  readonly analyser: AnalyserNode;
  /** Read the engine's live filter (output 2: cutoff, resonance). */
  private readonly ctlCut: AnalyserNode;
  private readonly ctlRes: AnalyserNode;
  private readonly ctlBuf = new Float32Array(32);

  private constructor(ctx: AudioContext, node: AudioWorkletNode) {
    this.ctx = ctx;
    this.node = node;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.6;
    node.connect(ctx.destination);
    node.connect(this.analyser);
    const split = ctx.createChannelSplitter(2);
    node.connect(split, 1);
    this.ctlCut = ctx.createAnalyser();
    this.ctlRes = ctx.createAnalyser();
    this.ctlCut.fftSize = this.ctlRes.fftSize = 32;
    split.connect(this.ctlCut, 0);
    split.connect(this.ctlRes, 1);
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
      numberOfOutputs: 2,
      outputChannelCount: [2, 2],
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
