// Low Talk synth engine core.
//
// Pure TypeScript with no browser APIs: the same class runs inside the
// AudioWorklet (real time), in Node for offline renders and tests, and is the
// reference for the Phase B C++ port.
//
// Real-time rules: after construction nothing here allocates, locks or
// touches the language layer. Patch changes arrive as a flat numeric array
// (see src/schema patchToArray) and are smoothed: continuous params glide
// over ~15 ms, discrete params (waves, unison count, filter type, ...) switch
// inside a 3 ms fade-out/fade-in so they never click.
//
// Signal path (one monophonic voice):
//   osc1 (+FM) + osc2 + noise → drive → filter → distortion → amp
//   + sub (clean, mono, phase-stable, bypasses filter/distortion)
//   → FX above fx.lowcut (chorus, phaser, reverb) → EQ → DC blocker
//   → mono below crossover → output gain → look-ahead limiter (always on)

import { PARAM_COUNT, paramIndex, params } from '../../schema';
import { Biquad, clamp, DcBlocker, Envelope, fastTanh, Ladder, polyBlep, Rng, Svf, TWO_PI } from './dsp';
import { Chorus, Limiter, Phaser, Reverb } from './fx';
import {
  FRAME_COUNT,
  FRAMES_PER_SEGMENT,
  getWavetable,
  MIP_LEVELS,
  mipForIncrement,
  TABLE_MASK,
  TABLE_SIZE,
} from './wavetable';

/** Samples per control-rate update (modulation, smoothing, coefficients). */
export const CONTROL_BLOCK = 16;
const MAX_UNISON = 7;
const DUCK_MS = 3;
const SMOOTH_MS = 15;
const LIMITER_CEILING_DB = -1;
const KEYTRACK_CENTER = 48; // C3: filter.cutoff is the actual cutoff at this note

// Gain staging.
const PRE_FILTER_GAIN = 0.5;
const POST_FILTER_GAIN = 1.6;
const VOICE_GAIN = 0.55;
const SUB_GAIN = 0.55;

// Enum option indices (must match data/schema.json order).
const WAVE_SINE = 0, WAVE_TRI = 1, WAVE_SAW = 2, WAVE_PULSE = 3; // 4 = wavetable
const FILTER_LP = 0, FILTER_BP = 1; // 2 = formant
const DIST_SOFT = 0, DIST_HARD = 1, DIST_FOLD = 2, DIST_CRUSH = 3;
const LFO_SINE = 0, LFO_TRI = 1, LFO_SAW_UP = 2, LFO_SAW_DOWN = 3, LFO_SQUARE = 4, LFO_SH = 5;
const SYNC_BEATS = [0, 16, 8, 4, 2, 3, 1, 1.5, 2 / 3, 0.5, 0.75, 1 / 3, 0.25, 0.375, 1 / 6, 0.125];

// Mod matrix sources / destinations (schema option order).
const SRC_LFO1 = 1, SRC_LFO2 = 2, SRC_MOD_ENV = 3, SRC_AMP_ENV = 4, SRC_VEL = 5, SRC_KEY = 6, SRC_MODWHEEL = 7, SRC_RANDOM = 8;
const SRC_COUNT = 9;
const D_PITCH = 1, D_OSC1_PITCH = 2, D_OSC2_PITCH = 3, D_OSC1_WT = 4, D_OSC2_WT = 5, D_OSC1_PW = 6, D_OSC2_PW = 7,
  D_OSC1_LEVEL = 8, D_OSC2_LEVEL = 9, D_DETUNE = 10, D_FM = 11, D_SUB = 12, D_NOISE = 13, D_DRIVE = 14,
  D_CUTOFF = 15, D_RES = 16, D_VOWEL = 17, D_DIST_DRIVE = 18, D_DIST_MIX = 19, D_AMP = 20, D_LFO1_RATE = 21, D_LFO2_RATE = 22;
const DEST_COUNT = 23;

// Formant table (Hz) for vowels A E I O U: F1, F2, F3.
const VOWELS = [
  [730, 1090, 2440],
  [530, 1840, 2480],
  [270, 2290, 3010],
  [570, 840, 2410],
  [300, 870, 2240],
];
const FORMANT_GAIN = [1, 0.5, 0.25];

// Module-local bindings: avoids live-binding getter overhead on hot paths in
// some module transforms (tsx / vite-node).
const N_PARAMS = PARAM_COUNT;
const tanh = fastTanh;
const blep = polyBlep;
const clampf = clamp;
const TABLE_N = TABLE_SIZE;
const TABLE_M = TABLE_MASK;

const ix = paramIndex;
const P = {
  legato: ix('voice.legato'), glide: ix('voice.glide'), octave: ix('voice.octave'), velocity: ix('voice.velocity'),
  osc: [1, 2].map((n) => ({
    wave: ix(`osc${n}.wave`), semi: ix(`osc${n}.semi`), fine: ix(`osc${n}.fine`), pw: ix(`osc${n}.pulse_width`),
    wt: ix(`osc${n}.wt_pos`), voices: ix(`osc${n}.unison_voices`), detune: ix(`osc${n}.unison_detune`),
    spread: ix(`osc${n}.unison_spread`), level: ix(`osc${n}.level`),
  })),
  fmAmount: ix('fm.amount'), fmRatio: ix('fm.ratio'),
  subWave: ix('sub.wave'), subOct: ix('sub.octave'), subLevel: ix('sub.level'),
  noise: ix('noise.level'), drive: ix('drive.amount'),
  fType: ix('filter.type'), cutoff: ix('filter.cutoff'), res: ix('filter.resonance'), keytrack: ix('filter.keytrack'),
  envAmt: ix('filter.env_amount'), vowel: ix('filter.vowel'),
  dType: ix('dist.type'), dDrive: ix('dist.drive'), dMix: ix('dist.mix'), dTone: ix('dist.post_tone'),
  amp: [ix('amp_env.attack'), ix('amp_env.decay'), ix('amp_env.sustain'), ix('amp_env.release')],
  mod: [ix('mod_env.attack'), ix('mod_env.decay'), ix('mod_env.sustain'), ix('mod_env.release')],
  peAmount: ix('pitch_env.amount'), peDecay: ix('pitch_env.decay'),
  lfo: [1, 2].map((n) => ({ shape: ix(`lfo${n}.shape`), rate: ix(`lfo${n}.rate`), sync: ix(`lfo${n}.sync`), retrig: ix(`lfo${n}.retrigger`) })),
  slots: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ src: ix(`mod${n}.source`), dst: ix(`mod${n}.dest`), amt: ix(`mod${n}.amount`) })),
  chorusMix: ix('chorus.mix'), chorusDepth: ix('chorus.depth'), phaserMix: ix('phaser.mix'), phaserRate: ix('phaser.rate'),
  reverbMix: ix('reverb.mix'), reverbSize: ix('reverb.size'), fxLowcut: ix('fx.lowcut'),
  eqLow: ix('eq.low_gain'), eqMid: ix('eq.mid_gain'), eqMidFreq: ix('eq.mid_freq'), eqHigh: ix('eq.high_gain'),
  outGain: ix('output.gain'), crossover: ix('output.crossover'),
};

interface OscState {
  phase: Float64Array;
  inc: Float64Array;
  panL: Float64Array;
  panR: Float64Array;
  voices: number;
  gain: number; // level / sqrt(voices)
  wave: number;
  baseA: number; // wavetable offsets for this block
  baseB: number;
  frac: number;
  pw: number;
  lastSpread: number;
  lastVoices: number;
}

function makeOsc(): OscState {
  return {
    phase: new Float64Array(MAX_UNISON),
    inc: new Float64Array(MAX_UNISON),
    panL: new Float64Array(MAX_UNISON),
    panR: new Float64Array(MAX_UNISON),
    voices: 1, gain: 0, wave: WAVE_SAW, baseA: 0, baseB: 0, frac: 0, pw: 0.5, lastSpread: -1, lastVoices: -1,
  };
}

export class Synth {
  readonly sampleRate: number;
  private readonly table = getWavetable().data;

  // Parameters: target (from patch), current (smoothed / applied).
  private readonly target = new Float64Array(PARAM_COUNT);
  private readonly cur = new Float64Array(PARAM_COUNT);
  private readonly isLog = new Uint8Array(PARAM_COUNT);
  private readonly isDiscrete = new Uint8Array(PARAM_COUNT);
  private readonly smoothCoef: number;
  private duckGain = 1;
  private duckDir = 0; // -1 fading out, +1 fading in
  private readonly duckStep: number;

  // Note state.
  private readonly stack = new Int32Array(16);
  private stackLen = 0;
  private gate = false;
  private note = 48; // current target note
  private pitch = 48; // glided pitch (semitones)
  private hasPlayed = false;
  private velocity = 1;
  private noteRandom = 0;
  private bend = 0;
  private modWheel = 0;
  private tempo = 120;

  // Modulation.
  private readonly ampEnv = new Envelope();
  private readonly modEnv = new Envelope();
  private pitchEnvLevel = 0;
  private readonly lfoPhase = new Float64Array(2);
  private readonly lfoValue = new Float64Array(2);
  private readonly lfoHold = new Float64Array(2);
  private readonly src = new Float64Array(SRC_COUNT);
  private readonly dst = new Float64Array(DEST_COUNT);
  private readonly rng = new Rng(0x1234567);

  // Oscillators.
  private readonly osc: OscState[] = [makeOsc(), makeOsc()];
  private fmPhase = 0;
  private fmInc = 0;
  private fmIndex = 0;
  private pmPrev = 0;
  private subPhase = 0;
  private subInc = 0;
  private subLevel = 0;
  private subWave = 0;
  private noiseLevel = 0;

  // Drive + filter.
  private driveMix = 0;
  private driveGain = 1;
  private driveComp = 1;
  private filterType = FILTER_LP;
  private g = 0.1;
  private gStep = 0;
  private gPrevTarget = -1;
  private k = 0;
  private readonly ladL = new Ladder();
  private readonly ladR = new Ladder();
  private readonly bpL = [new Svf(), new Svf()];
  private readonly bpR = [new Svf(), new Svf()];
  private readonly fmtL = [new Svf(), new Svf(), new Svf()];
  private readonly fmtR = [new Svf(), new Svf(), new Svf()];
  private readonly fmtG = new Float64Array(3);
  private fmtK = 0.2;

  // Distortion.
  private distType = DIST_SOFT;
  private distGain = 1;
  private distAmt = 0;
  private toneCoef = 1;
  private toneL = 0;
  private toneR = 0;
  private crushHold = 1;
  private crushQ = 32768;
  private crushCount = 0;
  private crushL = 0;
  private crushR = 0;

  // Amp.
  private ampMod = 1;
  private ampModStep = 0;
  private velGain = 1;

  // FX + output.
  private readonly hpL = new Biquad();
  private readonly hpR = new Biquad();
  private readonly chorus: Chorus;
  private readonly phaser: Phaser;
  private readonly reverb: Reverb;
  private readonly eqL = [new Biquad(), new Biquad(), new Biquad()];
  private readonly eqR = [new Biquad(), new Biquad(), new Biquad()];
  private readonly dcL = new DcBlocker();
  private readonly dcR = new DcBlocker();
  private readonly xo1 = new Biquad();
  private readonly xo2 = new Biquad();
  private readonly limiter: Limiter;
  private outGain = 1;
  private outGainStep = 0;
  private outTarget = 1;
  private lastOutDb = NaN;
  private lastDistDrive = -1;
  private lastTone = -1;
  private readonly lastFx = new Float64Array(6); // lowcut, eqLow, eqMid, eqMidFreq, eqHigh, crossover
  private readonly tmp = new Float64Array(2);
  private ctrlCount = 0;

  /** Peak of the last rendered output (for metering). */
  peak = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.smoothCoef = 1 - Math.exp(-CONTROL_BLOCK / ((SMOOTH_MS / 1000) * sampleRate));
    this.duckStep = 1 / ((DUCK_MS / 1000) * sampleRate);
    params.forEach((p, i) => {
      this.isLog[i] = p.curve === 'log' ? 1 : 0;
      this.isDiscrete[i] = p.type === 'float' ? 0 : 1;
      const d = p.default;
      const v = p.type === 'enum' ? p.options!.indexOf(d as string) : p.type === 'bool' ? (d ? 1 : 0) : (d as number);
      this.target[i] = this.cur[i] = v;
    });
    this.chorus = new Chorus(sampleRate);
    this.phaser = new Phaser(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.limiter = new Limiter(sampleRate, LIMITER_CEILING_DB);
    this.dcL.setup(sampleRate);
    this.dcR.setup(sampleRate);
    this.lastFx.fill(NaN);
    this.applyDiscrete();
    this.control();
  }

  get limiterCeiling(): number {
    return this.limiter.ceiling;
  }

  /** Latency of the output limiter, in samples. */
  get latency(): number {
    return this.limiter.lookahead - 1;
  }

  // ---------------------------------------------------------------- input

  /**
   * Set all parameters from a flat array in schema order (see patchToArray).
   * Values must already be validated/clamped. `immediate` skips smoothing
   * (use when loading while silent).
   */
  setParams(values: ArrayLike<number>, immediate = false): void {
    for (let i = 0; i < N_PARAMS; i++) this.target[i] = values[i];
    if (immediate || !this.ampEnv.stage) {
      for (let i = 0; i < N_PARAMS; i++) this.cur[i] = values[i];
      this.applyDiscrete();
    }
  }

  setParam(index: number, value: number): void {
    this.target[index] = value;
  }

  setTempo(bpm: number): void {
    this.tempo = clamp(bpm, 20, 400);
  }

  pitchBend(v: number): void {
    this.bend = clamp(v, -1, 1);
  }

  setModWheel(v: number): void {
    this.modWheel = clamp(v, 0, 1);
  }

  noteOn(note: number, velocity = 0.8): void {
    if (velocity <= 0) {
      this.noteOff(note);
      return;
    }
    this.removeFromStack(note);
    if (this.stackLen < this.stack.length) this.stack[this.stackLen++] = note;
    const overlapping = this.gate;
    this.startNote(note, overlapping);
    if (!overlapping || !this.cur[P.legato]) this.velocity = clamp(velocity, 0, 1);
  }

  noteOff(note: number): void {
    const wasCurrent = this.stackLen > 0 && this.stack[this.stackLen - 1] === note;
    this.removeFromStack(note);
    if (!wasCurrent) return;
    if (this.stackLen > 0) {
      this.startNote(this.stack[this.stackLen - 1], true);
    } else {
      this.gate = false;
      this.ampEnv.release();
      this.modEnv.release();
    }
  }

  allNotesOff(): void {
    this.stackLen = 0;
    this.gate = false;
    this.ampEnv.release();
    this.modEnv.release();
  }

  /** Stop everything and clear all DSP state (used after a fault). */
  panic(): void {
    this.allNotesOff();
    this.ampEnv.reset();
    this.modEnv.reset();
    this.ladL.reset();
    this.ladR.reset();
    for (let i = 0; i < 2; i++) {
      this.bpL[i].reset();
      this.bpR[i].reset();
    }
    for (let i = 0; i < 3; i++) {
      this.fmtL[i].reset();
      this.fmtR[i].reset();
      this.eqL[i].reset();
      this.eqR[i].reset();
    }
    this.hpL.reset();
    this.hpR.reset();
    this.xo1.reset();
    this.xo2.reset();
    this.chorus.reset();
    this.phaser.reset();
    this.reverb.reset();
    this.limiter.reset();
    this.dcL.reset();
    this.dcR.reset();
    this.toneL = this.toneR = this.crushL = this.crushR = 0;
  }

  private removeFromStack(note: number): void {
    let w = 0;
    for (let r = 0; r < this.stackLen; r++) if (this.stack[r] !== note) this.stack[w++] = this.stack[r];
    this.stackLen = w;
  }

  private startNote(note: number, overlapping: boolean): void {
    const legato = this.cur[P.legato] > 0.5;
    const glide = this.cur[P.glide] > 0.5;
    const sounding = this.ampEnv.stage !== 0;
    this.note = note;
    // Glide: legato mode slides only between overlapping notes; otherwise
    // any note slides from the previous pitch when glide > 0.
    if (!glide || !this.hasPlayed || (legato && !overlapping)) this.pitch = note;
    this.hasPlayed = true;
    this.gate = true;
    if (legato && overlapping) return; // no retrigger
    if (!sounding) {
      // Fresh note from silence: reset phases for a consistent, phase-stable attack.
      for (const o of this.osc) for (let j = 0; j < MAX_UNISON; j++) o.phase[j] = j === 0 ? 0 : (j * 0.381966) % 1;
      this.subPhase = 0;
      this.fmPhase = 0;
      this.pmPrev = 0;
      this.ladL.reset();
      this.ladR.reset();
    }
    this.ampEnv.trigger();
    this.modEnv.trigger();
    this.pitchEnvLevel = 1;
    this.noteRandom = this.rng.next();
    for (let l = 0; l < 2; l++) {
      if (this.cur[P.lfo[l].retrig] > 0.5) {
        this.lfoPhase[l] = 0;
        this.lfoHold[l] = this.rng.next();
      }
    }
  }

  // ---------------------------------------------------------- control rate

  private applyDiscrete(): void {
    for (let n = 0; n < 2; n++) {
      const o = this.osc[n];
      o.wave = this.cur[P.osc[n].wave];
      o.voices = this.cur[P.osc[n].voices];
    }
    this.filterType = this.cur[P.fType];
    this.distType = this.cur[P.dType];
    this.subWave = this.cur[P.subWave];
  }

  private smoothParams(): void {
    const c = this.smoothCoef;
    let discreteChanged = false;
    for (let i = 0; i < N_PARAMS; i++) {
      const t = this.target[i];
      const v = this.cur[i];
      if (t === v) continue;
      if (this.isDiscrete[i]) {
        discreteChanged = true;
      } else if (this.isLog[i]) {
        const nv = v * Math.pow(t / v, c);
        this.cur[i] = Math.abs(nv - t) < 1e-6 * t ? t : nv;
      } else {
        const nv = v + (t - v) * c;
        this.cur[i] = Math.abs(nv - t) < 1e-7 ? t : nv;
      }
    }
    if (discreteChanged) {
      if (!this.ampEnv.stage) {
        this.copyDiscrete();
      } else if (this.duckDir === 0 || this.duckDir === 1) {
        this.duckDir = -1;
      }
    }
  }

  private copyDiscrete(): void {
    for (let i = 0; i < N_PARAMS; i++) if (this.isDiscrete[i]) this.cur[i] = this.target[i];
    this.applyDiscrete();
  }

  private toInc(semis: number): number {
    return Math.min(0.45, (440 * Math.pow(2, (semis - 69) / 12)) / this.sampleRate);
  }

  private lfoShape(shape: number, p: number, hold: number): number {
    switch (shape) {
      case LFO_SINE: return Math.sin(TWO_PI * p);
      case LFO_TRI: return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
      case LFO_SAW_UP: return 2 * p - 1;
      case LFO_SAW_DOWN: return 1 - 2 * p;
      case LFO_SQUARE: return p < 0.5 ? 1 : -1;
      case LFO_SH: return hold;
      default: return 0;
    }
  }

  private control(): void {
    const fs = this.sampleRate;
    const cur = this.cur;
    this.smoothParams();

    // Envelope coefficients.
    this.ampEnv.set(cur[P.amp[0]], cur[P.amp[1]], cur[P.amp[2]], cur[P.amp[3]], fs);
    this.modEnv.set(cur[P.mod[0]], cur[P.mod[1]], cur[P.mod[2]], cur[P.mod[3]], fs);

    // Glide and pitch envelope.
    const glideMs = cur[P.glide];
    if (glideMs > 0.5) {
      const c = 1 - Math.exp((-CONTROL_BLOCK * 4.6) / ((glideMs / 1000) * fs));
      this.pitch += (this.note - this.pitch) * c;
    } else {
      this.pitch = this.note;
    }
    this.pitchEnvLevel *= Math.exp((-CONTROL_BLOCK * 4.6) / ((cur[P.peDecay] / 1000) * fs));

    // Mod sources.
    const src = this.src;
    src[0] = 0;
    src[SRC_LFO1] = this.lfoValue[0];
    src[SRC_LFO2] = this.lfoValue[1];
    src[SRC_MOD_ENV] = this.modEnv.level;
    src[SRC_AMP_ENV] = this.ampEnv.level;
    src[SRC_VEL] = this.velocity;
    src[SRC_KEY] = clamp((this.pitch - KEYTRACK_CENTER) / 24, -1, 1);
    src[SRC_MODWHEEL] = this.modWheel;
    src[SRC_RANDOM] = this.noteRandom;
    const dst = this.dst;
    dst.fill(0);
    for (let s = 0; s < 8; s++) {
      const slot = P.slots[s];
      const d = cur[slot.dst];
      if (d > 0) dst[d] += cur[slot.amt] * src[cur[slot.src]];
    }

    // LFOs (advance one control block).
    for (let l = 0; l < 2; l++) {
      const lp = P.lfo[l];
      const sync = cur[lp.sync];
      let rate = sync > 0 ? this.tempo / 60 / SYNC_BEATS[sync] : cur[lp.rate];
      const rm = dst[l === 0 ? D_LFO1_RATE : D_LFO2_RATE];
      if (rm !== 0) rate *= Math.pow(2, 3 * rm);
      let ph = this.lfoPhase[l] + (rate * CONTROL_BLOCK) / fs;
      if (ph >= 1) {
        ph -= Math.floor(ph);
        this.lfoHold[l] = this.rng.next();
      }
      this.lfoPhase[l] = ph;
      this.lfoValue[l] = this.lfoShape(cur[lp.shape], ph, this.lfoHold[l]);
    }

    // Pitch.
    const basePitch = this.pitch + 12 * cur[P.octave] + 2 * this.bend + cur[P.peAmount] * this.pitchEnvLevel + 24 * dst[D_PITCH];

    // Oscillators.
    for (let n = 0; n < 2; n++) {
      const o = this.osc[n];
      const op = P.osc[n];
      const pitch = basePitch + cur[op.semi] + cur[op.fine] / 100 + 24 * dst[n === 0 ? D_OSC1_PITCH : D_OSC2_PITCH];
      const center = this.toInc(pitch);
      const voices = o.voices;
      const detune = clamp(cur[op.detune] + 100 * dst[D_DETUNE], 0, 100);
      const spread = cur[op.spread];
      if (voices === 1) {
        o.inc[0] = center;
      } else {
        // Voices spread evenly over ±detune/2 cents.
        const step = Math.pow(2, detune / (1200 * (voices - 1)));
        let inc = center * Math.pow(2, -detune / 2400);
        for (let j = 0; j < voices; j++) {
          o.inc[j] = inc < 0.45 ? inc : 0.45;
          inc *= step;
        }
      }
      if (spread !== o.lastSpread || voices !== o.lastVoices) {
        for (let j = 0; j < voices; j++) {
          const pos = voices === 1 ? 0 : (2 * j) / (voices - 1) - 1; // -1..1
          const a = ((pos * spread + 1) * Math.PI) / 4; // equal-power, unity in the centre
          o.panL[j] = Math.SQRT2 * Math.cos(a);
          o.panR[j] = Math.SQRT2 * Math.sin(a);
        }
        o.lastSpread = spread;
        o.lastVoices = voices;
      }
      const level = clamp(cur[op.level] + dst[n === 0 ? D_OSC1_LEVEL : D_OSC2_LEVEL], 0, 1);
      o.gain = level / Math.sqrt(voices);
      o.pw = clamp(cur[op.pw] + 0.45 * dst[n === 0 ? D_OSC1_PW : D_OSC2_PW], 0.05, 0.95);
      // Wavetable frame selection.
      let wt: number;
      if (o.wave === WAVE_SINE) wt = 0;
      else if (o.wave === WAVE_TRI) wt = FRAMES_PER_SEGMENT / (FRAME_COUNT - 1);
      else wt = clamp(cur[op.wt] + dst[n === 0 ? D_OSC1_WT : D_OSC2_WT], 0, 1);
      const fpos = wt * (FRAME_COUNT - 1);
      const fa = Math.min(FRAME_COUNT - 2, Math.floor(fpos));
      const mip = mipForIncrement(o.inc[voices - 1] * (n === 0 && this.fmIndex > 0 ? 1.5 : 1));
      o.baseA = (fa * MIP_LEVELS + mip) * TABLE_SIZE;
      o.baseB = ((fa + 1) * MIP_LEVELS + mip) * TABLE_SIZE;
      o.frac = fpos - fa;
    }
    // FM: sine modulator phase-modulates osc 1 (index in cycles).
    const fmAmt = clamp(cur[P.fmAmount] + dst[D_FM], 0, 1);
    this.fmIndex = fmAmt * fmAmt * 1.3;
    this.fmInc = Math.min(0.45, this.toInc(basePitch + cur[P.osc[0].semi]) * cur[P.fmRatio]);

    // Sub.
    this.subInc = this.toInc(basePitch + 12 * cur[P.subOct]);
    this.subLevel = clamp(cur[P.subLevel] + dst[D_SUB], 0, 1) * SUB_GAIN;
    this.noiseLevel = clamp(cur[P.noise] + dst[D_NOISE], 0, 1) * 0.5;

    // Pre-filter drive.
    const drive = clamp(cur[P.drive] + dst[D_DRIVE], 0, 1);
    this.driveMix = Math.min(1, drive * 4);
    this.driveGain = 1 + 15 * drive * drive;
    this.driveComp = 1 / (1 + 0.6 * drive);

    // Filter.
    const res = clamp(cur[P.res] + dst[D_RES], 0, 1);
    const octs = (cur[P.keytrack] * (this.pitch + 12 * cur[P.octave] - KEYTRACK_CENTER)) / 12 +
      6 * cur[P.envAmt] * this.modEnv.level + 6 * dst[D_CUTOFF];
    const fc = clamp(cur[P.cutoff] * Math.pow(2, octs), 20, Math.min(20000, fs * 0.45));
    const gTarget = Math.tan((Math.PI * fc) / fs);
    if (this.gPrevTarget < 0) this.g = gTarget;
    this.gStep = (gTarget - this.g) / CONTROL_BLOCK;
    this.gPrevTarget = gTarget;
    if (this.filterType === FILTER_LP) {
      this.k = 3.85 * res;
    } else if (this.filterType === FILTER_BP) {
      this.k = 1.4 * (1 - res) + 0.08; // 1/Q
    } else {
      const v = clamp(cur[P.vowel] + dst[D_VOWEL], 0, 1) * 4;
      const vi = Math.min(3, Math.floor(v));
      const vf = v - vi;
      const shift = Math.sqrt(fc / 2000);
      for (let f = 0; f < 3; f++) {
        const hz = VOWELS[vi][f] * Math.pow(VOWELS[vi + 1][f] / VOWELS[vi][f], vf) * shift;
        this.fmtG[f] = Math.tan((Math.PI * clamp(hz, 40, fs * 0.45)) / fs);
      }
      this.fmtK = 1 / (3 + 15 * res);
    }

    // Distortion.
    const dDrive = clamp(cur[P.dDrive] + dst[D_DIST_DRIVE], 0, 1);
    const dMix = clamp(cur[P.dMix] + dst[D_DIST_MIX], 0, 1);
    this.distAmt = Math.min(1, dDrive * 5) * dMix;
    this.distGain = 1 + 49 * dDrive * dDrive;
    if (dDrive !== this.lastDistDrive) {
      this.crushHold = 1 + Math.floor(dDrive * dDrive * 24);
      this.crushQ = Math.pow(2, Math.round(15 - 12 * dDrive));
      this.lastDistDrive = dDrive;
    }
    if (cur[P.dTone] !== this.lastTone) {
      const toneHz = 300 * Math.pow(20000 / 300, cur[P.dTone]);
      this.toneCoef = 1 - Math.exp((-TWO_PI * Math.min(toneHz, fs * 0.45)) / fs);
      this.lastTone = cur[P.dTone];
    }

    // Amp.
    const ampTarget = clamp(1 + dst[D_AMP], 0, 2);
    this.ampModStep = (ampTarget - this.ampMod) / CONTROL_BLOCK;
    this.velGain = 1 - cur[P.velocity] * (1 - this.velocity);

    // FX filters: only recompute coefficients when values move.
    const lf = this.lastFx;
    const lowcut = cur[P.fxLowcut];
    if (lowcut !== lf[0]) {
      this.hpL.setHighpass(lowcut, Math.SQRT1_2, fs);
      this.hpR.setHighpass(lowcut, Math.SQRT1_2, fs);
      lf[0] = lowcut;
    }
    if (cur[P.eqLow] !== lf[1]) {
      this.eqL[0].setLowShelf(100, cur[P.eqLow], fs);
      this.eqR[0].setLowShelf(100, cur[P.eqLow], fs);
      lf[1] = cur[P.eqLow];
    }
    if (cur[P.eqMid] !== lf[2] || cur[P.eqMidFreq] !== lf[3]) {
      this.eqL[1].setPeak(cur[P.eqMidFreq], cur[P.eqMid], 0.9, fs);
      this.eqR[1].setPeak(cur[P.eqMidFreq], cur[P.eqMid], 0.9, fs);
      lf[2] = cur[P.eqMid];
      lf[3] = cur[P.eqMidFreq];
    }
    if (cur[P.eqHigh] !== lf[4]) {
      this.eqL[2].setHighShelf(5000, cur[P.eqHigh], fs);
      this.eqR[2].setHighShelf(5000, cur[P.eqHigh], fs);
      lf[4] = cur[P.eqHigh];
    }
    if (cur[P.crossover] !== lf[5]) {
      // Two cascaded Butterworth sections = Linkwitz-Riley 24 dB/oct.
      this.xo1.setHighpass(cur[P.crossover], Math.SQRT1_2, fs);
      this.xo2.setHighpass(cur[P.crossover], Math.SQRT1_2, fs);
      lf[5] = cur[P.crossover];
    }
    if (cur[P.outGain] !== this.lastOutDb) {
      this.outTarget = Math.pow(10, cur[P.outGain] / 20);
      this.lastOutDb = cur[P.outGain];
    }
    this.outGainStep = (this.outTarget - this.outGain) / CONTROL_BLOCK;
  }

  // ------------------------------------------------------------ audio rate

  private oscSample(o: OscState, ph: number, dt: number): number {
    switch (o.wave) {
      case WAVE_SAW:
        return 2 * ph - 1 - blep(ph, dt);
      case WAVE_PULSE: {
        let s = ph < o.pw ? 1 : -1;
        s += blep(ph, dt);
        let p2 = ph - o.pw;
        if (p2 < 0) p2 += 1;
        s -= blep(p2, dt);
        return s - (2 * o.pw - 1);
      }
      default: {
        // Wavetable (also used for band-limited sine and triangle).
        const t = this.table;
        const pos = ph * TABLE_N;
        const i = pos | 0;
        const f = pos - i;
        const i2 = (i + 1) & TABLE_M;
        const a = t[o.baseA + i] + (t[o.baseA + i2] - t[o.baseA + i]) * f;
        if (o.frac === 0) return a;
        const b = t[o.baseB + i] + (t[o.baseB + i2] - t[o.baseB + i]) * f;
        return a + (b - a) * o.frac;
      }
    }
  }

  private shape(x: number): number {
    const g = this.distGain;
    switch (this.distType) {
      case DIST_SOFT: return tanh(g * x);
      case DIST_HARD: { const y = g * x; return y > 1 ? 1 : y < -1 ? -1 : y; }
      case DIST_FOLD: return Math.sin(1.5707963 * g * x);
      default: return x;
    }
  }

  /**
   * Render `frames` samples into outL/outR starting at `offset`.
   * Allocation-free; safe to call from the audio thread.
   */
  render(outL: Float32Array, outR: Float32Array, offset: number, frames: number): void {
    const end = offset + frames;
    const out = this.tmp;
    const o1 = this.osc[0];
    const o2 = this.osc[1];
    let peak = this.peak;

    for (let n = offset; n < end; n++) {
      if (this.ctrlCount === 0) {
        this.control();
        this.ctrlCount = CONTROL_BLOCK;
      }
      this.ctrlCount--;

      // Discrete-parameter duck (fade out → switch → fade in).
      if (this.duckDir < 0) {
        this.duckGain -= this.duckStep;
        if (this.duckGain <= 0) {
          this.duckGain = 0;
          this.copyDiscrete();
          this.duckDir = 1;
        }
      } else if (this.duckDir > 0) {
        this.duckGain += this.duckStep;
        if (this.duckGain >= 1) {
          this.duckGain = 1;
          this.duckDir = 0;
        }
      }

      let l = 0;
      let r = 0;
      this.g += this.gStep;
      this.ampMod += this.ampModStep;
      this.outGain += this.outGainStep;

      if (this.ampEnv.stage !== 0) {
        const env = this.ampEnv.tick();
        this.modEnv.tick();

        // FM modulator.
        let dpm = 0;
        if (this.fmIndex > 0) {
          this.fmPhase += this.fmInc;
          if (this.fmPhase >= 1) this.fmPhase -= 1;
          const pm = this.fmIndex * Math.sin(TWO_PI * this.fmPhase);
          dpm = pm - this.pmPrev;
          this.pmPrev = pm;
        } else if (this.pmPrev !== 0) {
          dpm = -this.pmPrev;
          this.pmPrev = 0;
        }

        // Oscillators.
        if (o1.gain > 0) {
          for (let j = 0; j < o1.voices; j++) {
            const dt = o1.inc[j] + dpm;
            let ph = o1.phase[j] + dt;
            ph -= Math.floor(ph);
            o1.phase[j] = ph;
            const s = this.oscSample(o1, ph, dt) * o1.gain;
            l += s * o1.panL[j];
            r += s * o1.panR[j];
          }
        } else if (dpm !== 0) {
          for (let j = 0; j < o1.voices; j++) {
            const ph = o1.phase[j] + o1.inc[j] + dpm;
            o1.phase[j] = ph - Math.floor(ph);
          }
        }
        if (o2.gain > 0) {
          for (let j = 0; j < o2.voices; j++) {
            const dt = o2.inc[j];
            let ph = o2.phase[j] + dt;
            if (ph >= 1) ph -= 1;
            o2.phase[j] = ph;
            const s = this.oscSample(o2, ph, dt) * o2.gain;
            l += s * o2.panL[j];
            r += s * o2.panR[j];
          }
        }
        if (this.noiseLevel > 0) {
          const nz = this.rng.next() * this.noiseLevel;
          l += nz;
          r += nz;
        }
        l *= PRE_FILTER_GAIN;
        r *= PRE_FILTER_GAIN;

        // Pre-filter drive.
        if (this.driveMix > 0) {
          const dg = this.driveGain, dc = this.driveComp, dm = this.driveMix;
          l += (tanh(l * dg) * dc - l) * dm;
          r += (tanh(r * dg) * dc - r) * dm;
        }

        // Filter.
        const g = this.g;
        if (this.filterType === FILTER_LP) {
          l = this.ladL.process(l, g, this.k);
          r = this.ladR.process(r, g, this.k);
        } else if (this.filterType === FILTER_BP) {
          const k = this.k;
          this.bpL[0].process(l, g, k);
          this.bpL[1].process(this.bpL[0].bp * k, g, k);
          l = this.bpL[1].bp * k * 1.5;
          this.bpR[0].process(r, g, k);
          this.bpR[1].process(this.bpR[0].bp * k, g, k);
          r = this.bpR[1].bp * k * 1.5;
        } else {
          let fl = 0, fr = 0;
          const k = this.fmtK;
          for (let f = 0; f < 3; f++) {
            this.fmtL[f].process(l, this.fmtG[f], k);
            this.fmtR[f].process(r, this.fmtG[f], k);
            fl += this.fmtL[f].bp * k * FORMANT_GAIN[f];
            fr += this.fmtR[f].bp * k * FORMANT_GAIN[f];
          }
          l = fl * 2.2;
          r = fr * 2.2;
        }
        l *= POST_FILTER_GAIN;
        r *= POST_FILTER_GAIN;

        // Distortion (wet path gets the post-tone low-pass).
        if (this.distAmt > 0) {
          let wl: number, wr: number;
          if (this.distType === DIST_CRUSH) {
            if (this.crushCount <= 0) {
              this.crushL = Math.round(clampf(l, -1, 1) * this.crushQ) / this.crushQ;
              this.crushR = Math.round(clampf(r, -1, 1) * this.crushQ) / this.crushQ;
              this.crushCount = this.crushHold;
            }
            this.crushCount--;
            wl = this.crushL;
            wr = this.crushR;
          } else {
            wl = this.shape(l);
            wr = this.shape(r);
          }
          this.toneL += (wl - this.toneL) * this.toneCoef;
          this.toneR += (wr - this.toneR) * this.toneCoef;
          l += (this.toneL - l) * this.distAmt;
          r += (this.toneR - r) * this.distAmt;
        }

        // Amp.
        const amp = env * this.velGain * this.duckGain;
        const va = amp * this.ampMod * VOICE_GAIN;
        l *= va;
        r *= va;

        // Sub: clean, mono, phase-stable.
        if (this.subLevel > 0) {
          let sp = this.subPhase + this.subInc;
          if (sp >= 1) sp -= 1;
          this.subPhase = sp;
          let s: number;
          if (this.subWave === 0) s = Math.sin(TWO_PI * sp);
          else s = sp < 0.25 ? 4 * sp : sp < 0.75 ? 2 - 4 * sp : 4 * sp - 4;
          s *= this.subLevel * amp;
          l += s;
          r += s;
        } else {
          this.subPhase += this.subInc;
          if (this.subPhase >= 1) this.subPhase -= 1;
        }
      }

      // FX on the part above fx.lowcut only.
      const hl = this.hpL.process(l);
      const hr = this.hpR.process(r);
      let xl = hl, xr = hr;
      const cMix = this.cur[P.chorusMix];
      if (cMix > 1e-4) {
        this.chorus.process(xl, xr, cMix, this.cur[P.chorusDepth], out);
        xl = out[0];
        xr = out[1];
      }
      const pMix = this.cur[P.phaserMix];
      if (pMix > 1e-4) {
        this.phaser.process(xl, xr, pMix, this.cur[P.phaserRate], out);
        xl = out[0];
        xr = out[1];
      }
      const rMix = this.cur[P.reverbMix];
      if (rMix > 1e-4) {
        this.reverb.process(0.5 * (xl + xr), this.cur[P.reverbSize], out);
        xl += out[0] * rMix;
        xr += out[1] * rMix;
      }
      l = l - hl + xl;
      r = r - hr + xr;

      // EQ.
      for (let b = 0; b < 3; b++) {
        l = this.eqL[b].process(l);
        r = this.eqR[b].process(r);
      }

      // DC blocker.
      l = this.dcL.process(l);
      r = this.dcR.process(r);

      // Mono below the crossover: keep the mid intact, high-pass the side.
      const m = 0.5 * (l + r);
      const s = this.xo2.process(this.xo1.process(0.5 * (l - r)));
      l = (m + s) * this.outGain;
      r = (m - s) * this.outGain;

      // Fault guard: never let NaN/Inf reach the output.
      if (!(Math.abs(l) < 1e6) || !(Math.abs(r) < 1e6)) {
        this.panic();
        l = r = 0;
      }

      this.limiter.process(l, r, out);
      outL[n] = out[0];
      outR[n] = out[1];
      const a = Math.abs(out[0]) > Math.abs(out[1]) ? Math.abs(out[0]) : Math.abs(out[1]);
      if (a > peak) peak = a;
    }
    this.peak = peak;
  }

  /** True when the voice is silent (envelope idle). */
  get idle(): boolean {
    return this.ampEnv.stage === 0;
  }

  /** Current note stack size (for UI). */
  get heldNotes(): number {
    return this.stackLen;
  }
}
