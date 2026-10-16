// One synth voice: everything that belongs to a single note, from the
// oscillators through the amp, plus its clean sub and attack transient.
//
//   osc1 (+FM) + osc2 + noise
//   → [2× oversampled: drive → filter → distortion (optionally mids only)]
//   → bitcrusher → tape (saturation, wow/flutter, age) → DC filter → amp
//   + transient + sub (clean, mono, phase-stable: bypasses everything above)
//
// The Synth owns up to 8 of these (polyphony) and everything shared: the
// parameters, LFOs and drift sources, the texture bed and the FX chain.
// Pure TypeScript, allocation-free after construction.

import { AUX_SLOT, Biquad, clamp, Clipper, Envelope, Ladder, OSC_SLOT, Rng, SlotFilter, Svf, TWO_PI } from './dsp';
import { Crusher, Tape } from './fx';
import { Downsampler2x, OVERSAMPLE_LATENCY, Upsampler2x } from './oversample';
import * as K from './params';
import { Comb, DiodeLadder, KarplusString, Shepard, Transient } from './voicefx';
import { FRAME_COUNT, FRAMES_PER_SEGMENT, MIP_LEVELS, mipForIncrement, TABLE_MASK, TABLE_SIZE } from './wavetable';

// Module-local bindings: avoids live-binding getter overhead on hot paths in
// some module transforms (tsx / vite-node).
const P = K.P;
const CONTROL_BLOCK = K.CONTROL_BLOCK, MAX_UNISON = K.MAX_UNISON, OS = K.OS, SAW_FRAME = K.SAW_FRAME;
const KEYTRACK_CENTER = K.KEYTRACK_CENTER, VOICE_DC_HZ = K.VOICE_DC_HZ;
const MID_CLIP_REF = 0.8;
/** polyBLEP residual for a unit step at phase 0 (t in 0..1, dt = phase increment). */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}
const PRE_FILTER_GAIN = K.PRE_FILTER_GAIN, POST_FILTER_GAIN = K.POST_FILTER_GAIN, VOICE_GAIN = K.VOICE_GAIN, SUB_GAIN = K.SUB_GAIN;
/** The sub routed into the main filter arrives at about the level the clean path would have had. */
const SUB_ROUTE_GAIN = 1 / (VOICE_GAIN * PRE_FILTER_GAIN * POST_FILTER_GAIN);
const WAVE_SINE = K.WAVE_SINE, WAVE_TRI = K.WAVE_TRI, WAVE_SAW = K.WAVE_SAW, WAVE_PULSE = K.WAVE_PULSE, WAVE_PWMSAW = K.WAVE_PWMSAW;
const WAVE_STRING = K.WAVE_STRING, WAVE_SHEPARD = K.WAVE_SHEPARD;
const FILTER_LP = K.FILTER_LP, FILTER_BP = K.FILTER_BP, FILTER_DIODE = K.FILTER_DIODE, FILTER_NOTCH = K.FILTER_NOTCH;
const FILTER_COMB = K.FILTER_COMB, FILTER_LPG = K.FILTER_LPG;
const DIST_SOFT = K.DIST_SOFT, DIST_HARD = K.DIST_HARD, DIST_FOLD = K.DIST_FOLD;
const TUBE_BIAS = K.TUBE_BIAS, TUBE_OFFSET = K.TUBE_OFFSET, HALF_PI = K.HALF_PI;
const tanh = K.tanh, tanhIntegral = K.tanhIntegral;
const SLOT_COUNT = K.SLOT_COUNT, SRC_COUNT = K.SRC_COUNT, DEST_COUNT = K.DEST_COUNT;
const VOWELS = K.VOWELS, FORMANT_GAIN = K.FORMANT_GAIN;
const TABLE_N = TABLE_SIZE, TABLE_M = TABLE_MASK;
const D = {
  PITCH: K.D_PITCH, OSC1_PITCH: K.D_OSC1_PITCH, OSC2_PITCH: K.D_OSC2_PITCH, OSC1_WT: K.D_OSC1_WT, OSC2_WT: K.D_OSC2_WT,
  OSC1_PW: K.D_OSC1_PW, OSC2_PW: K.D_OSC2_PW, OSC1_LEVEL: K.D_OSC1_LEVEL, OSC2_LEVEL: K.D_OSC2_LEVEL, DETUNE: K.D_DETUNE,
  FM: K.D_FM, SUB: K.D_SUB, NOISE: K.D_NOISE, DRIVE: K.D_DRIVE, CUTOFF: K.D_CUTOFF, RES: K.D_RES, VOWEL: K.D_VOWEL,
  DIST_DRIVE: K.D_DIST_DRIVE, DIST_MIX: K.D_DIST_MIX, AMP: K.D_AMP, FM2: K.D_FM2, CRUSH: K.D_CRUSH, TAPE_WOW: K.D_TAPE_WOW,
  DIST_TONE: K.D_DIST_TONE, VIBRATO: K.D_VIBRATO, BREATH: K.D_BREATH,
};

/** Offsets (in grid steps) of interior unison voices from an even spread. */
const UNISON_SKEW = [0, 0.19, -0.13, 0.08, -0.17, 0.11, 0];

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
  baseSaw: number; // mip-mapped saw table offset for this block
  drift: Float64Array; // analog pitch drift per unison voice (-1..1)
  /** Hard sync: the slave's previous sample, held back one sample so a reset can be smoothed on both sides (polyBLEP). */
  held: Float64Array;
  driftTarget: Float64Array;
}

function makeOsc(): OscState {
  return {
    phase: new Float64Array(MAX_UNISON),
    inc: new Float64Array(MAX_UNISON),
    panL: new Float64Array(MAX_UNISON),
    panR: new Float64Array(MAX_UNISON),
    voices: 1, gain: 0, wave: WAVE_SAW, baseA: 0, baseB: 0, baseSaw: 0, frac: 0, pw: 0.5, lastSpread: -1, lastVoices: -1,
    drift: new Float64Array(MAX_UNISON), driftTarget: new Float64Array(MAX_UNISON), held: new Float64Array(MAX_UNISON),
  };
}

export class Voice {
  private readonly fs: number;
  private readonly cur: Float64Array;
  private readonly table: Float32Array;
  private readonly rng: Rng;

  // Note state.
  note = 48; // target note
  pitch = 48; // glided pitch (semitones)
  velocity = 1;
  gate = false;
  /** Trigger order (higher = newer), for voice stealing and "newest voice" FX targets. */
  order = 0;
  /** The main filter's current cutoff (Hz) and resonance, for the texture bed's copy of it. */
  fcNow = 1000;
  resNow = 0;
  /** Samples left to drain the sub delay line after the amp envelope ends. */
  tail = 0;
  private hasPlayed = false;
  private noteRandom = 0;
  /** 1 when this voice carries the sub (poly: only the lowest note does); ramped per sample. */
  subOn = 1;
  private subMix = 1;
  private readonly subRamp: number;

  // Modulation.
  readonly ampEnv = new Envelope();
  private readonly modEnv = new Envelope();
  private readonly env2 = new Envelope(); // slow 'bloom' envelope, ticked at control rate
  private pitchEnvLevel = 0;
  private readonly src = new Float64Array(SRC_COUNT);
  // LFO fade-in per voice, from this note's start: a shared fade would restart on every new
  // note and, in a fast arp or a chord, never get to fade in.
  private readonly lfoFade = new Float64Array(4).fill(1);
  /** Mod matrix result for this voice (the Synth reads the newest voice's FX targets). */
  readonly dst = new Float64Array(DEST_COUNT);

  // Oscillators.
  private readonly osc: OscState[] = [makeOsc(), makeOsc()];
  private fmPhase = 0;
  private fmInc = 0;
  private fmIndex = 0;
  private pmPrev = 0;
  private fm2Phase = 0;
  private fm2Inc = 0;
  private fm2Index = 0;
  private fmFbAmt = 0;
  private fmPrevOut = 0;
  private fmEnv = 0;
  private fmEnvCoef = 0.99;
  private fmPunchIdx = 0;
  private fmAlgo = 0;
  private fmActive = false;
  private readonly strings: KarplusString[];
  private readonly strPeriod = new Float64Array(2);
  private readonly strGain = new Float64Array(2);
  private strTone = 0.5;
  private readonly shepards = [new Shepard(), new Shepard()];
  private shepRate = 0;
  private readonly transient = new Transient();
  private clickLevel = 0;
  // Delayed vibrato (per note: its own phase and a slightly different rate).
  private noteTime = 0;
  private vibPhase = 0;
  private vibRate = 5;
  // Breath: band-passed noise through the filter, an attack chiff plus a sustained level.
  private readonly breathSvf = new Svf();
  private breathG = 0.1;
  private chiffEnv = 0;
  private chiffCoef = 0.99;
  private chiffAmt = 0;
  private breathLvl = 0;
  private breathOn = false;
  private accentAmt = 0;
  private subPhase = 0;
  // Hard sync: the master's phase and increment (oscillator 1's pitch, no unison), and whether it's on.
  private syncPhase = 0;
  private syncInc = 0;
  private syncOn = false;
  // Delays the sub by the oversampler latency so it stays phase-aligned with the voice.
  private readonly subDelay = new Float64Array(32);
  private subDelayPos = 0;
  private subInc = 0;
  private subLevel = 0;
  private subWave = 0;
  // Soft clippers (knee as a fraction of the nominal peak; 0 = off): sub only, and osc 1 + 2 only.
  private readonly subClip: Clipper;
  private readonly midClip: Clipper;
  private readonly clipOut = new Float64Array(2);
  // Oscillator high-pass before the drive (24 dB/oct, per oscillator; 20 Hz = off).
  // Each oscillator's own filter slot (high-pass by default), the sub's, and the routing into the main filter.
  private readonly oscF = [new SlotFilter(2), new SlotFilter(2)];
  private readonly subF = new SlotFilter(1);
  /** The oscillators' low cut once more after the dirt (removes the rumble it created). */
  private readonly postCut = new SlotFilter(2);
  private routeA = true;
  private routeB = true;
  private routeS = false;
  private routeBr = true;
  private routeCl = false;
  private subDirect = true;
  /** Some source skips the drive and main filter: it gets its own oversampled path. */
  private bypassOn = false;
  private readonly upBL = new Upsampler2x();
  private readonly upBR = new Upsampler2x();
  // Filter fat (low shelf + saturation after the filter) and mix (dry/filtered).
  private fat = 0;
  private fatDrive = 1;
  private fMix = 1;
  private readonly fatL = new Biquad();
  private readonly fatR = new Biquad();
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
  private readonly diodeL = new DiodeLadder();
  private readonly diodeR = new DiodeLadder();
  private readonly notchL = [new Svf(), new Svf()];
  private readonly notchR = [new Svf(), new Svf()];
  private readonly lpgL = new Svf();
  private readonly lpgR = new Svf();
  private readonly combL: Comb;
  private readonly combR: Comb;
  private combDelay = 100;
  private combFb = 0;
  private readonly bpL = [new Svf(), new Svf()];
  private readonly bpR = [new Svf(), new Svf()];
  private readonly fmtL = [new Svf(), new Svf(), new Svf()];
  private readonly fmtR = [new Svf(), new Svf(), new Svf()];
  private readonly fmtG = new Float64Array(3);
  private fmtK = 0.2;

  // Oversampling around the nonlinear section.
  private readonly upL = new Upsampler2x();
  private readonly upR = new Upsampler2x();
  private readonly dnL = new Downsampler2x();
  private readonly dnR = new Downsampler2x();
  private readonly osOut = new Float64Array(4);
  private readonly voiceDcL = new Biquad();
  private readonly voiceDcR = new Biquad();
  private analog = 0;
  private noteCutoffJitter = 0;

  // Distortion.
  private distType = DIST_SOFT;
  private distGain = 1;
  private distAmt = 0;
  private toneCoef = 1;
  private toneL = 0;
  private toneR = 0;
  private lastTone = -1;
  private splitG = 0; // 0 = full-band distortion
  private lastSplit = NaN;
  private readonly adaaU = new Float64Array(2);
  private readonly driveU = new Float64Array(2);
  private readonly driveF = new Float64Array(2).fill(tanhIntegral(0));
  private readonly adaaF = new Float64Array(2);
  private readonly split = [new Svf(), new Svf(), new Svf(), new Svf(), new Svf(), new Svf()];

  // Bitcrusher, tape.
  private readonly crusher = new Crusher();
  private crushQ = 128;
  private crushRate = 1;
  private crushMix = 0;
  private readonly tape: Tape;
  private tapeWow = 0;
  /** Tape-age low-pass coefficient (the Synth's texture bed uses the newest voice's). */
  tapeLpCoef = 1;
  private lastTapeAge = -1;
  private tapeOn = false;

  // Amp.
  private ampMod = 1;
  private ampModStep = 0;
  private velGain = 1;
  private readonly tmp = new Float64Array(2);

  constructor(fs: number, cur: Float64Array, table: Float32Array, seed: number, private readonly dstMask?: Float64Array) {
    this.fs = fs;
    this.cur = cur;
    this.table = table;
    this.rng = new Rng(seed);
    this.subRamp = 1 / (0.01 * fs);
    this.combL = new Comb(Math.ceil((fs * OS) / 20));
    this.combR = new Comb(Math.ceil((fs * OS) / 20));
    this.strings = [new KarplusString(Math.ceil(fs / 15)), new KarplusString(Math.ceil(fs / 15))];
    this.tape = new Tape(fs);
    this.subClip = new Clipper(fs);
    this.midClip = new Clipper(fs);
    this.voiceDcL.setHighpass(VOICE_DC_HZ, Math.SQRT1_2, fs);
    this.voiceDcR.setHighpass(VOICE_DC_HZ, Math.SQRT1_2, fs);
  }

  /** True while the voice makes sound (amp envelope not idle). */
  get active(): boolean {
    return this.ampEnv.stage !== 0;
  }

  // ---------------------------------------------------------------- notes

  /**
   * Start a note. `glide`: slide from the previous pitch (mono only);
   * `retrigger`: false = legato (keep envelopes running, only change pitch).
   */
  start(note: number, velocity: number, glide: boolean, retrigger: boolean, order: number): void {
    const sounding = this.ampEnv.stage !== 0;
    this.note = note;
    if (!glide || !this.hasPlayed) this.pitch = note;
    this.hasPlayed = true;
    this.gate = true;
    this.order = order;
    this.tail = 40;
    if (!retrigger) return;
    this.velocity = clamp(velocity, 0, 1);
    const cur = this.cur;
    if (!sounding) {
      // Fresh note from silence: reset phases for a consistent, phase-stable attack.
      // Voice 0 always starts at phase 0 (consistent punch); other unison voices
      // start at fixed spread phases, or free-running random ones with analog drift.
      const free = cur[P.analog] > 0.01;
      for (const o of this.osc) {
        for (let j = 0; j < MAX_UNISON; j++) {
          o.phase[j] = j === 0 ? 0 : free ? 0.5 * (this.rng.next() + 1) : (j * 0.381966) % 1;
        }
      }
      this.subPhase = 0;
      this.syncPhase = 0;
      this.osc[1].held.fill(0);
      this.fmPhase = 0;
      this.pmPrev = 0;
      this.ladL.reset();
      this.ladR.reset();
      this.upL.reset();
      this.upR.reset();
      this.dnL.reset();
      this.dnR.reset();
      this.diodeL.reset();
      this.diodeR.reset();
      this.fm2Phase = 0;
      this.fmPrevOut = 0;
    }
    this.noteCutoffJitter = this.rng.next();
    // Per-note excitations: FM punch, string pluck, transient layer.
    this.fmEnv = 1;
    const noteHz = 440 * Math.pow(2, (note + 12 * cur[P.octave] - 69) / 12);
    for (let n = 0; n < 2; n++) {
      if (cur[P.osc[n].wave] === WAVE_STRING) {
        const hz = noteHz * Math.pow(2, cur[P.osc[n].semi] / 12);
        this.strings[n].pluck(this.fs / hz);
      }
    }
    // The transient's pitch follows the sub's register (an 808's kick and sub are one thump):
    // an octave above the sub, as at the default sub octave.
    if (cur[P.clickLevel] > 0) {
      const kickHz = noteHz * Math.pow(2, cur[P.subOct] + 1);
      this.transient.trigger(cur[P.clickType], cur[P.clickDecay], cur[P.clickTone], kickHz, this.fs);
    }
    this.ampEnv.trigger();
    this.modEnv.trigger();
    this.env2.trigger();
    this.pitchEnvLevel = 1;
    this.noteRandom = this.rng.next();
    for (let l = 0; l < 4; l++) this.lfoFade[l] = cur[P.lfo[l].fade] > 0 ? 0 : 1;
    this.noteTime = 0;
    this.vibPhase = 0.5 * (this.rng.next() + 1);
    this.vibRate = cur[P.vibRate] * (1 + 0.05 * this.rng.next());
    this.chiffEnv = 1;
  }

  release(): void {
    this.gate = false;
    this.ampEnv.release();
    this.modEnv.release();
    this.env2.release();
  }

  /** Clear all DSP state (after a fault). */
  reset(): void {
    this.gate = false;
    this.ampEnv.reset();
    this.modEnv.reset();
    this.env2.reset();
    this.ladL.reset();
    this.ladR.reset();
    for (let i = 0; i < 2; i++) {
      this.bpL[i].reset();
      this.bpR[i].reset();
    }
    for (let i = 0; i < 3; i++) {
      this.fmtL[i].reset();
      this.fmtR[i].reset();
    }
    this.toneL = this.toneR = 0;
    this.upL.reset();
    this.upR.reset();
    this.dnL.reset();
    this.dnR.reset();
    this.voiceDcL.reset();
    this.voiceDcR.reset();
    for (const f of this.split) f.reset();
    this.diodeL.reset();
    this.diodeR.reset();
    for (const f of [...this.notchL, ...this.notchR, this.lpgL, this.lpgR]) f.reset();
    this.combL.reset();
    this.combR.reset();
    for (const st of this.strings) st.reset();
    for (const sh of this.shepards) sh.reset();
    this.transient.reset();
    this.breathSvf.reset();
    this.crusher.reset();
    this.tape.reset();
    this.subClip.reset();
    this.midClip.reset();
    this.subDelay.fill(0);
    for (const f of this.oscF) f.reset();
    this.subF.reset();
    this.postCut.reset();
    this.upBL.reset();
    this.upBR.reset();
    this.fatL.reset();
    this.fatR.reset();
    this.tail = 0;
  }

  /** Pick up discrete parameters (waves, unison count, filter/distortion type, sub wave). */
  applyDiscrete(): void {
    const cur = this.cur;
    for (let n = 0; n < 2; n++) {
      const o = this.osc[n];
      o.wave = cur[P.osc[n].wave];
      o.voices = cur[P.osc[n].voices];
    }
    this.filterType = cur[P.fType];
    this.distType = cur[P.dType];
    // Keep the ADAA state consistent with the (possibly new) curve.
    this.adaaF[0] = this.curveIntegral(this.adaaU[0]);
    this.adaaF[1] = this.curveIntegral(this.adaaU[1]);
    this.subWave = cur[P.subWave];
  }

  // ---------------------------------------------------------- control rate

  private toInc(semis: number): number {
    return Math.min(0.45, (440 * Math.pow(2, (semis - 69) / 12)) / this.fs);
  }

  /**
   * Per-block update: envelopes, glide, this voice's mod matrix (global
   * sources from `gsrc`, per-voice ones filled in here) and every coefficient.
   */
  control(gsrc: Float64Array, bend: number, xdst: Float64Array): void {
    const fs = this.fs;
    const cur = this.cur;

    this.ampEnv.set(cur[P.amp[0]], cur[P.amp[1]], cur[P.amp[2]], cur[P.amp[3]], fs, cur[P.ampCurve]);
    this.modEnv.set(cur[P.mod[0]], cur[P.mod[1]], cur[P.mod[2]], cur[P.mod[3]], fs);
    this.env2.set(cur[P.env2[0]], cur[P.env2[1]], cur[P.env2[2]], cur[P.env2[3]], fs / CONTROL_BLOCK);
    if (this.env2.stage !== 0) this.env2.tick();

    // Glide and pitch envelope.
    const glideMs = cur[P.glide];
    if (glideMs > 0.5) {
      const c = 1 - Math.exp((-CONTROL_BLOCK * 4.6) / ((glideMs / 1000) * fs));
      this.pitch += (this.note - this.pitch) * c;
    } else {
      this.pitch = this.note;
    }
    this.pitchEnvLevel *= Math.exp((-CONTROL_BLOCK * 4.6) / ((cur[P.peDecay] / 1000) * fs));

    // Mod matrix: global sources plus this voice's own.
    const src = this.src;
    src.set(gsrc);
    for (let l = 0; l < 4; l++) {
      if (this.lfoFade[l] < 1) {
        const fadeMs = cur[P.lfo[l].fade];
        this.lfoFade[l] = fadeMs > 0 ? Math.min(1, this.lfoFade[l] + (CONTROL_BLOCK * 1000) / (fadeMs * fs)) : 1;
      }
    }
    src[K.SRC_LFO1] *= this.lfoFade[0];
    src[K.SRC_LFO2] *= this.lfoFade[1];
    src[K.SRC_LFO3] *= this.lfoFade[2];
    src[K.SRC_LFO4] *= this.lfoFade[3];
    src[K.SRC_PRODUCT] = src[K.SRC_LFO1] * src[K.SRC_LFO2];
    src[K.SRC_MOD_ENV] = this.modEnv.level;
    src[K.SRC_AMP_ENV] = this.ampEnv.level;
    src[K.SRC_VEL] = this.velocity;
    src[K.SRC_KEY] = clamp((this.pitch - KEYTRACK_CENTER) / 24, -1, 1);
    src[K.SRC_RANDOM] = this.noteRandom;
    src[K.SRC_ENV2] = this.env2.level;
    const dst = this.dst;
    dst.set(xdst); // the mod wheel's move and the wobble, shared by all voices
    for (let s = 0; s < SLOT_COUNT; s++) {
      const slot = P.slots[s];
      const d = cur[slot.dst];
      if (d > 0) dst[d] += cur[slot.amt] * src[cur[slot.src]];
    }
    // Switched-off blocks and muted layers ignore their modulation.
    const mask = this.dstMask;
    if (mask) for (let d = 1; d < dst.length; d++) dst[d] *= mask[d];

    this.analog = cur[P.analog];
    // Sync needs a table oscillator on osc 2 (not string or shepard).
    this.syncOn = cur[P.osc2Sync] > 0.5;

    // Delayed vibrato: the note starts straight, then sings.
    this.noteTime += CONTROL_BLOCK / fs;
    let vib = 0;
    const vibDepth = clamp(cur[P.vibDepth] + 100 * dst[D.VIBRATO], 0, 100);
    if (vibDepth > 0) {
      const t = this.noteTime - cur[P.vibDelay] / 1000;
      if (t > 0) {
        this.vibPhase += (this.vibRate * CONTROL_BLOCK) / fs;
        if (this.vibPhase >= 1) this.vibPhase -= 1;
        vib = (vibDepth / 100) * Math.min(1, t / (cur[P.vibFade] / 1000)) * Math.sin(TWO_PI * this.vibPhase);
      }
    }

    // Pitch.
    const basePitch = this.pitch + 12 * cur[P.octave] + 2 * bend + cur[P.peAmount] * this.pitchEnvLevel + 24 * dst[D.PITCH] + vib;

    // Oscillators.
    for (let n = 0; n < 2; n++) {
      const o = this.osc[n];
      const op = P.osc[n];
      const pitch = basePitch + cur[op.semi] + cur[op.fine] / 100 + 24 * dst[n === 0 ? D.OSC1_PITCH : D.OSC2_PITCH];
      // Fold up by octaves below 20 Hz (e.g. during deep pitch dives): inaudible, only eats headroom.
      let center = this.toInc(pitch);
      while (center < 20 / fs) center *= 2;
      if (n === 0) this.syncInc = center;
      const voices = o.voices;
      const detune = clamp(cur[op.detune] + 100 * dst[D.DETUNE], 0, 100);
      const spread = cur[op.spread];
      if (voices === 1) {
        o.inc[0] = center;
      } else {
        // Voices spread over ±detune/2 cents. Interior voices sit slightly off the even
        // grid: evenly spaced detunes beat at exact multiples of each other and the
        // pattern repeats like a clock; uneven ones never line up.
        const last = voices - 1;
        for (let j = 0; j < voices; j++) {
          const pos = j / last - 0.5 + (j > 0 && j < last ? UNISON_SKEW[j] / last : 0);
          const inc = center * Math.pow(2, (detune * pos) / 1200);
          o.inc[j] = inc < 0.45 ? inc : 0.45;
        }
      }
      if (this.analog > 0) {
        // Analog drift: each unison voice wanders a few cents (voice 0 less, to keep the core pitch steady).
        for (let j = 0; j < voices; j++) {
          if (this.rng.next() > 0.996) o.driftTarget[j] = this.rng.next();
          o.drift[j] += (o.driftTarget[j] - o.drift[j]) * 0.003;
          const cents = this.analog * (j === 0 ? 2.5 : 7) * o.drift[j];
          o.inc[j] *= 1 + cents * 0.000577623; // ≈ 2^(cents/1200)
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
      const level = clamp(cur[op.level] + dst[n === 0 ? D.OSC1_LEVEL : D.OSC2_LEVEL], 0, 1);
      if (o.wave === WAVE_STRING || o.wave === WAVE_SHEPARD) {
        // Single-voice oscillators: unison doesn't apply.
        o.gain = level;
        this.strPeriod[n] = 1 / center;
        // Loop gain per period for a T60 of 0.08 .. 8 s.
        const t60 = 0.08 * Math.pow(100, cur[P.strDecay]);
        this.strGain[n] = Math.pow(10, (-3 * this.strPeriod[n]) / (t60 * fs));
      } else {
        o.gain = level / Math.sqrt(voices);
      }
      o.pw = clamp(cur[op.pw] + 0.45 * dst[n === 0 ? D.OSC1_PW : D.OSC2_PW], 0.05, 0.95);
      // Wavetable frame selection.
      let wt: number;
      if (o.wave === WAVE_SINE) wt = 0;
      else if (o.wave === WAVE_TRI) wt = FRAMES_PER_SEGMENT / (FRAME_COUNT - 1);
      else wt = clamp(cur[op.wt] + dst[n === 0 ? D.OSC1_WT : D.OSC2_WT], 0, 1);
      const fpos = wt * (FRAME_COUNT - 1);
      const fa = Math.min(FRAME_COUNT - 2, Math.floor(fpos));
      const mip = mipForIncrement(o.inc[voices - 1] * (n === 0 && this.fmActive ? 2 : 1));
      o.baseA = (fa * MIP_LEVELS + mip) * TABLE_SIZE;
      o.baseB = ((fa + 1) * MIP_LEVELS + mip) * TABLE_SIZE;
      o.frac = fpos - fa;
      o.baseSaw = (SAW_FRAME * MIP_LEVELS + mip) * TABLE_SIZE;
    }
    for (let n = 0; n < 2; n++) {
      const [kind, p24] = OSC_SLOT[cur[P.osc[n].fType]] ?? OSC_SLOT[0];
      let hz = cur[P.osc[n].hp];
      if (cur[P.osc[n].fKey] > 0.5) hz *= Math.pow(2, (this.pitch + 12 * cur[P.octave] - KEYTRACK_CENTER) / 12);
      this.oscF[n].set(kind, p24, hz, fs);
    }
    this.routeA = cur[P.routeA] > 0.5;
    this.routeB = cur[P.routeB] > 0.5;
    this.routeS = cur[P.routeS] > 0.5;
    this.routeBr = cur[P.routeBr] > 0.5;
    this.routeCl = cur[P.routeCl] > 0.5;
    {
      let hz = Infinity;
      for (let n = 0; n < 2; n++) {
        const t = cur[P.osc[n].fType];
        if (t <= 1 && cur[P.osc[n].hp] > 21) hz = Math.min(hz, cur[P.osc[n].hp]); // high 24 / high 12
      }
      const on = cur[P.postCut] > 0.5 && !this.routeS && hz < Infinity;
      this.postCut.set(on ? 1 : 0, true, on ? hz : 20, fs);
    }
    this.subDirect = cur[P.subDirect] > 0.5;
    const bypass = !this.routeA || !this.routeB || !this.routeBr;
    if (bypass && !this.bypassOn) {
      this.upBL.reset();
      this.upBR.reset();
    }
    this.bypassOn = bypass;
    {
      const [kind, p24] = AUX_SLOT[cur[P.subFType]] ?? AUX_SLOT[0];
      let hz = cur[P.subFCut];
      if (cur[P.subFKey] > 0.5) hz *= Math.pow(2, (this.pitch + 12 * cur[P.octave] - KEYTRACK_CENTER) / 12);
      this.subF.set(kind, p24, hz, fs);
    }
    this.strTone = cur[P.strTone];
    this.shepRate = (cur[P.shepRate] * 0.4) / fs; // octaves per sample (±0.4 oct/s)

    // FM: sine operators phase-modulate osc 1 (indices in cycles). Operator 1
    // has a steady depth plus a decaying punch and self-feedback; operator 2
    // either modulates operator 1 (stack) or the oscillator directly (parallel).
    const fmAmt = clamp(cur[P.fmAmount] + dst[D.FM], 0, 1);
    const fm2 = clamp(cur[P.fm2Amount] + dst[D.FM2], 0, 1);
    this.fmIndex = fmAmt * fmAmt * 1.3;
    this.fmPunchIdx = cur[P.fmPunch] * 2;
    this.fm2Index = fm2 * fm2 * 1.3;
    this.fmFbAmt = cur[P.fmFb] * 0.3;
    this.fmAlgo = cur[P.fmAlgo];
    this.fmEnvCoef = Math.exp(-4.6 / ((cur[P.fmDecay] / 1000) * fs));
    this.fmActive = this.fmIndex > 0 || this.fmPunchIdx > 0 || this.fm2Index > 0;
    const carrier = this.toInc(basePitch + cur[P.osc[0].semi]);
    this.fmInc = Math.min(0.45, carrier * cur[P.fmRatio]);
    this.fm2Inc = Math.min(0.45, carrier * cur[P.fm2Ratio]);
    this.clickLevel = cur[P.clickLevel];

    // Sub, folded up an octave at a time if it would fall below 20 Hz (inaudible, wastes headroom).
    // The sub follows the played note (glide, bend, pitch envelope) but never the
    // pitch modulation (vibrato, drift, the mod matrix): it stays phase-locked under everything.
    const subPitch = this.pitch + 12 * cur[P.octave] + 2 * bend + cur[P.peAmount] * this.pitchEnvLevel;
    let subInc = this.toInc(subPitch + 12 * cur[P.subOct]);
    while (subInc < 20 / fs) subInc *= 2;
    this.subInc = subInc;
    this.subLevel = clamp(cur[P.subLevel] + dst[D.SUB], 0, 1) * SUB_GAIN;
    this.noiseLevel = clamp(cur[P.noise] + dst[D.NOISE], 0, 1) * 0.5;
    this.chiffAmt = cur[P.chiff];
    this.breathLvl = clamp(cur[P.breath] + dst[D.BREATH], 0, 1);
    this.breathOn = this.chiffAmt > 0 || this.breathLvl > 0;
    if (this.breathOn) {
      this.breathG = Math.tan((Math.PI * Math.min(500 * Math.pow(16, cur[P.breathTone]), fs * 0.45)) / fs);
      this.chiffCoef = Math.exp(-4.6 / ((cur[P.chiffDecay] / 1000) * fs));
    }

    // Pre-filter drive.
    const drive = clamp(cur[P.drive] + dst[D.DRIVE], 0, 1);
    this.driveMix = Math.min(1, drive * 4);
    this.driveGain = 1 + 15 * drive * drive;
    this.driveComp = 1 / (1 + 0.6 * drive);

    // Filter.
    // 303-style accent: hard-played notes sweep further, resonate more and hit louder.
    this.accentAmt = cur[P.accent] * clamp((this.velocity - 0.6) / 0.4, 0, 1);
    const res = clamp(cur[P.res] + dst[D.RES] + 0.15 * this.accentAmt, 0, 1);
    const fsOs = fs * OS;
    let octs = (cur[P.keytrack] * (this.pitch + 12 * cur[P.octave] - KEYTRACK_CENTER)) / 12 +
      6 * cur[P.envAmt] * (1 + 1.5 * this.accentAmt) * this.modEnv.level + 6 * dst[D.CUTOFF] + 0.12 * this.analog * this.noteCutoffJitter;
    // Low-pass gate: the cutoff closes together with the amp envelope.
    if (this.filterType === FILTER_LPG) octs += 1.5 * Math.log2(Math.max(this.ampEnv.level, 0.002));
    const fc = clamp(cur[P.cutoff] * Math.pow(2, octs), 20, Math.min(20000, fs * 0.45));
    const gTarget = Math.tan((Math.PI * fc) / fsOs);
    this.fcNow = fc;
    this.resNow = res;
    // Fat: a low shelf below the cutoff that grows with the resonance (it gives back the body
    // the resonance takes) and saturation, both after the filter.
    this.fat = cur[P.fat];
    this.fMix = cur[P.fMix];
    if (this.fat > 0) {
      const shelf = clamp(0.5 * fc, 40, 400);
      const db = this.fat * (3 + 9 * res);
      this.fatL.setLowShelf(shelf, db, fsOs);
      this.fatR.setLowShelf(shelf, db, fsOs);
      this.fatDrive = 1 + 2 * this.fat;
    }
    if (this.gPrevTarget < 0) this.g = gTarget;
    this.gStep = (gTarget - this.g) / (CONTROL_BLOCK * OS);
    this.gPrevTarget = gTarget;
    if (this.filterType === FILTER_LP) {
      this.k = 3.85 * res;
    } else if (this.filterType === FILTER_BP) {
      this.k = 1.4 * (1 - res) + 0.08; // 1/Q
    } else if (this.filterType === FILTER_DIODE) {
      this.k = 7.2 * res;
    } else if (this.filterType === FILTER_NOTCH) {
      this.k = 2 * (1 - res) + 0.05;
    } else if (this.filterType === FILTER_COMB) {
      this.combDelay = fsOs / fc;
      this.combFb = 0.96 * res;
    } else if (this.filterType === FILTER_LPG) {
      this.k = 1.4 - 1.1 * res;
    } else {
      const v = clamp(cur[P.vowel] + dst[D.VOWEL], 0, 1) * 4;
      const vi = Math.min(3, Math.floor(v));
      const vf = v - vi;
      const shift = Math.sqrt(fc / 2000);
      for (let f = 0; f < 3; f++) {
        const hz = VOWELS[vi][f] * Math.pow(VOWELS[vi + 1][f] / VOWELS[vi][f], vf) * shift;
        this.fmtG[f] = Math.tan((Math.PI * clamp(hz, 40, fs * 0.45)) / fsOs);
      }
      this.fmtK = 1 / (3 + 15 * res);
    }

    // Distortion.
    const dDrive = clamp(cur[P.dDrive] + dst[D.DIST_DRIVE], 0, 1);
    const dMix = clamp(cur[P.dMix] + dst[D.DIST_MIX], 0, 1);
    this.distAmt = Math.min(1, dDrive * 5) * dMix;
    this.distGain = 1 + 49 * dDrive * dDrive;
    const dTone = clamp(cur[P.dTone] + dst[D.DIST_TONE], 0, 1);
    if (dTone !== this.lastTone) {
      const toneHz = 300 * Math.pow(20000 / 300, dTone);
      this.toneCoef = 1 - Math.exp((-TWO_PI * Math.min(toneHz, fs * 0.45)) / fsOs);
      this.lastTone = dTone;
    }
    if (cur[P.dSplit] !== this.lastSplit) {
      const split = cur[P.dSplit];
      this.splitG = split > 22 ? Math.tan((Math.PI * split) / fsOs) : 0;
      if (this.splitG > 0) for (const f of this.split) f.setCoefs(this.splitG, Math.SQRT2);
      this.lastSplit = split;
    }

    // Bitcrusher.
    this.crushMix = clamp(cur[P.crushMix] + dst[D.CRUSH], 0, 1);
    this.crushQ = Math.pow(2, cur[P.crushBits] - 1);
    this.crushRate = cur[P.crushRate];

    // Tape.
    this.tapeWow = clamp(cur[P.tapeWow] + dst[D.TAPE_WOW], 0, 1);
    this.tapeOn = cur[P.tapeDrive] > 0 || this.tapeWow > 0 || cur[P.tapeAge] > 0;
    if (cur[P.tapeAge] !== this.lastTapeAge) {
      const hz = 20000 * Math.pow(0.15, cur[P.tapeAge]);
      this.tapeLpCoef = 1 - Math.exp((-TWO_PI * Math.min(hz, fs * 0.45)) / fs);
      this.lastTapeAge = cur[P.tapeAge];
    }

    // Clippers: the drive (dB) lowers the knee; the curve above it is half as tall as the
    // distance from the knee to the nominal peak; an automatic level match keeps the loudness.
    this.subClip.setDrive(cur[P.subClip]);
    this.midClip.setDrive(cur[P.midClip]);

    // Amp.
    const ampTarget = clamp(1 + dst[D.AMP], 0, 2);
    this.ampModStep = (ampTarget - this.ampMod) / CONTROL_BLOCK;
    this.velGain = (1 - cur[P.velocity] * (1 - this.velocity)) * (1 + 0.4 * this.accentAmt);
  }

  // ------------------------------------------------------------ audio rate

  /** Read a mip-mapped single-cycle table at phase ph (no interpolation between frames). */
  private readTable(base: number, ph: number): number {
    const t = this.table;
    const pos = ph * TABLE_N;
    const i = pos | 0;
    const f = pos - i;
    const a = t[base + i];
    return a + (t[base + ((i + 1) & TABLE_M)] - a) * f;
  }

  /** Physical-model string or Shepard oscillator (single voice, centred). */
  private specialOsc(n: number, o: OscState): number {
    if (o.wave === WAVE_STRING) return this.strings[n].process(this.strPeriod[n], this.strTone, this.strGain[n]) * 1.4;
    return this.shepards[n].process(o.inc[0], this.shepRate);
  }

  private oscSample(o: OscState, ph: number): number {
    switch (o.wave) {
      case WAVE_PWMSAW: {
        // Rave "hoover": saw blended with a pulse whose width is modulated.
        let p2 = ph - o.pw;
        if (p2 < 0) p2 += 1;
        const saw = this.readTable(o.baseSaw, ph);
        return 0.6 * saw + 0.35 * (saw - this.readTable(o.baseSaw, p2));
      }
      case WAVE_SAW:
        // Band-limited saw from the mip-mapped table (no aliasing at any pitch).
        return this.readTable(o.baseSaw, ph);
      case WAVE_PULSE: {
        // Pulse = difference of two band-limited saws, offset by the pulse width.
        let p2 = ph - o.pw;
        if (p2 < 0) p2 += 1;
        return 0.5 * (this.readTable(o.baseSaw, ph) - this.readTable(o.baseSaw, p2));
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

  /** Pre-filter drive: tanh saturation with first-order ADAA (see shape()). */
  private driveShape(x: number, ch: number): number {
    const u = this.driveGain * x;
    const up = this.driveU[ch];
    const fu = tanhIntegral(u);
    const du = u - up;
    const y = Math.abs(du) > 1e-5 ? (fu - this.driveF[ch]) / du : tanh(0.5 * (u + up));
    this.driveU[ch] = u;
    this.driveF[ch] = fu;
    return y;
  }

  /** The waveshaper curve itself (used directly when ADAA is ill-conditioned). */
  private curve(u: number): number {
    switch (this.distType) {
      case DIST_SOFT: return tanh(u);
      case DIST_HARD: return u > 1 ? 1 : u < -1 ? -1 : u;
      case DIST_FOLD: return Math.sin(HALF_PI * u);
      default: return tanh(u + TUBE_BIAS) - TUBE_OFFSET; // tube: asymmetric, even harmonics
    }
  }

  /** Antiderivative of curve(). */
  private curveIntegral(u: number): number {
    switch (this.distType) {
      case DIST_SOFT: return tanhIntegral(u);
      case DIST_HARD: return u > 1 ? u - 0.5 : u < -1 ? -u - 0.5 : 0.5 * u * u;
      case DIST_FOLD: return -Math.cos(HALF_PI * u) / HALF_PI;
      default: return tanhIntegral(u + TUBE_BIAS) - TUBE_OFFSET * u;
    }
  }

  /**
   * First-order antiderivative anti-aliasing (ADAA): output the average of the
   * curve between consecutive inputs, (F(u) - F(u_prev)) / (u - u_prev). This
   * suppresses the harmonics a sharp curve would fold back, on top of the
   * oversampling. `ch` selects the left/right state.
   */
  private shape(x: number, ch: number): number {
    const u = this.distGain * x;
    const up = this.adaaU[ch];
    const fu = this.curveIntegral(u);
    const du = u - up;
    const y = Math.abs(du) > 1e-5 ? (fu - this.adaaF[ch]) / du : this.curve(0.5 * (u + up));
    this.adaaU[ch] = u;
    this.adaaF[ch] = fu;
    return y;
  }

  /** One oversampled stereo sample through drive → filter → distortion into osOut[slot], osOut[slot + 1]. */
  private nonlinear(l: number, r: number, slot: number, bl: number, br: number): void {
    // Pre-filter drive.
    if (this.driveMix > 0) {
      const dc = this.driveComp, dm = this.driveMix;
      l += (this.driveShape(l, 0) * dc - l) * dm;
      r += (this.driveShape(r, 1) * dc - r) * dm;
    }
    const dryL = l, dryR = r;

    // Filter (coefficients are for the oversampled rate).
    this.g += this.gStep;
    const g = this.g;
    if (this.filterType === FILTER_LP) {
      const G = g / (1 + g);
      l = this.ladL.processG(l, G, this.k);
      r = this.ladR.processG(r, G, this.k);
    } else if (this.filterType === FILTER_BP) {
      const k = this.k;
      this.bpL[0].process(l, g, k);
      this.bpL[1].process(this.bpL[0].bp * k, g, k);
      l = this.bpL[1].bp * k * 1.5;
      this.bpR[0].process(r, g, k);
      this.bpR[1].process(this.bpR[0].bp * k, g, k);
      r = this.bpR[1].bp * k * 1.5;
    } else if (this.filterType === FILTER_DIODE) {
      l = this.diodeL.process(l, g, this.k) * 1.4;
      r = this.diodeR.process(r, g, this.k) * 1.4;
    } else if (this.filterType === FILTER_NOTCH) {
      const k = this.k, nl = this.notchL, nr = this.notchR;
      nl[0].process(l, g, k);
      nl[1].process(nl[0].lp + nl[0].hp, g, k);
      l = nl[1].lp + nl[1].hp;
      nr[0].process(r, g, k);
      nr[1].process(nr[0].lp + nr[0].hp, g, k);
      r = nr[1].lp + nr[1].hp;
    } else if (this.filterType === FILTER_COMB) {
      l = this.combL.process(l, this.combDelay, this.combFb);
      r = this.combR.process(r, this.combDelay, this.combFb);
    } else if (this.filterType === FILTER_LPG) {
      this.lpgL.process(l, g, this.k);
      this.lpgR.process(r, g, this.k);
      l = this.lpgL.lp;
      r = this.lpgR.lp;
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
    // Mix (dry/filtered) and fat (body back below the cutoff, saturation).
    if (this.fMix < 1) {
      l = dryL + (l - dryL) * this.fMix;
      r = dryR + (r - dryR) * this.fMix;
    }
    if (this.fat > 0) {
      const d = this.fatDrive;
      l = Math.tanh(this.fatL.process(l) * d) / d;
      r = Math.tanh(this.fatR.process(r) * d) / d;
    }
    l *= POST_FILTER_GAIN;
    r *= POST_FILTER_GAIN;
    // Sources that skip the drive and filter rejoin here.
    if (this.bypassOn) {
      l += bl * POST_FILTER_GAIN;
      r += br * POST_FILTER_GAIN;
    }

    // Distortion, optionally on the mids only (below dist.clean_below stays clean).
    if (this.distAmt > 0) {
      let lowL = 0, lowR = 0, hl = l, hr = r;
      if (this.splitG > 0) {
        // Linkwitz-Riley 4th-order crossover: low = LP∘LP, high = HP∘HP (sum is allpass).
        const sp = this.split;
        sp[0].processFixed(l);
        sp[1].processFixed(sp[0].lp);
        sp[2].processFixed(sp[0].hp);
        lowL = sp[1].lp;
        hl = sp[2].hp;
        sp[3].processFixed(r);
        sp[4].processFixed(sp[3].lp);
        sp[5].processFixed(sp[3].hp);
        lowR = sp[4].lp;
        hr = sp[5].hp;
      }
      this.toneL += (this.shape(hl, 0) - this.toneL) * this.toneCoef;
      this.toneR += (this.shape(hr, 1) - this.toneR) * this.toneCoef;
      l = lowL + hl + (this.toneL - hl) * this.distAmt;
      r = lowR + hr + (this.toneR - hr) * this.distAmt;
    }
    this.osOut[slot] = l;
    this.osOut[slot + 1] = r;
  }

  /**
   * One stereo sample of this voice (voice + transient + sub) into out.
   * `duck` is the Synth's discrete-switch fade gain.
   */
  render(duck: number, out: Float64Array): void {
    let l = 0;
    let r = 0;
    this.ampMod += this.ampModStep;
    const os = this.osOut;
    const o1 = this.osc[0];
    const o2 = this.osc[1];
    const cur = this.cur;
    const tmp = this.tmp;

    if (this.ampEnv.stage !== 0) {
      const env = this.ampEnv.tick();
      this.modEnv.tick();

      // FM modulator.
      let dpm = 0;
      if (this.fmActive) {
        this.fmEnv *= this.fmEnvCoef;
        this.fm2Phase += this.fm2Inc;
        if (this.fm2Phase >= 1) this.fm2Phase -= 1;
        const op2 = this.fm2Index > 0 ? this.fm2Index * Math.sin(TWO_PI * this.fm2Phase) : 0;
        this.fmPhase += this.fmInc;
        if (this.fmPhase >= 1) this.fmPhase -= 1;
        const stack = this.fmAlgo === 0;
        const op1 = Math.sin(TWO_PI * (this.fmPhase + (stack ? op2 : 0) + this.fmFbAmt * this.fmPrevOut));
        this.fmPrevOut = op1;
        const pm = (this.fmIndex + this.fmPunchIdx * this.fmEnv) * op1 + (stack ? 0 : op2);
        dpm = pm - this.pmPrev;
        this.pmPrev = pm;
      } else if (this.pmPrev !== 0) {
        dpm = -this.pmPrev;
        this.pmPrev = 0;
      }

      // Oscillators (band-limited at the base rate).
      if (o1.gain > 0 && o1.wave >= WAVE_STRING) {
        const s = this.specialOsc(0, o1) * o1.gain;
        l += s;
        r += s;
      } else if (o1.gain > 0) {
        for (let j = 0; j < o1.voices; j++) {
          let ph = o1.phase[j] + o1.inc[j] + dpm;
          ph -= Math.floor(ph);
          o1.phase[j] = ph;
          const s = this.oscSample(o1, ph) * o1.gain;
          l += s * o1.panL[j];
          r += s * o1.panR[j];
        }
      } else if (dpm !== 0) {
        for (let j = 0; j < o1.voices; j++) {
          const ph = o1.phase[j] + o1.inc[j] + dpm;
          o1.phase[j] = ph - Math.floor(ph);
        }
      }
      if (this.oscF[0].active) {
        const f = this.oscF[0];
        l = f.process(l, 0);
        r = f.process(r, 1);
      }
      // Oscillator 2 sums on its own when it has a filter or a different routing (otherwise
      // straight into l/r).
      const sepB = this.oscF[1].active || this.routeA !== this.routeB;
      const preL = l, preR = r;
      if (sepB) l = r = 0;
      if (o2.gain > 0 && o2.wave >= WAVE_STRING) {
        const s = this.specialOsc(1, o2) * o2.gain;
        l += s;
        r += s;
      } else if (o2.gain > 0 && this.syncOn) {
        // Hard sync: a master at oscillator 1's pitch restarts every slave voice.
        // The jump at each restart is band-limited with a two-sample polyBLEP
        // (the slave runs one sample late so the sample before can be corrected).
        let mp = this.syncPhase + this.syncInc;
        const wrapped = mp >= 1;
        let x = 0;
        if (wrapped) {
          mp -= 1;
          x = mp / this.syncInc; // how far past the restart this sample is (0..1)
        }
        this.syncPhase = mp;
        for (let j = 0; j < o2.voices; j++) {
          const inc = o2.inc[j];
          let ph = o2.phase[j] + inc;
          let corr = 0;
          if (wrapped) {
            let at = ph - x * inc; // slave phase at the moment of the restart
            at -= Math.floor(at);
            const jump = this.oscSample(o2, 0) - this.oscSample(o2, at);
            o2.held[j] += 0.5 * jump * x * x;
            corr = -0.5 * jump * (1 - x) * (1 - x);
            ph = x * inc;
          }
          ph -= Math.floor(ph);
          o2.phase[j] = ph;
          const now = this.oscSample(o2, ph) + corr;
          const s = o2.held[j] * o2.gain;
          o2.held[j] = now;
          l += s * o2.panL[j];
          r += s * o2.panR[j];
        }
      } else if (o2.gain > 0) {
        for (let j = 0; j < o2.voices; j++) {
          let ph = o2.phase[j] + o2.inc[j];
          if (ph >= 1) ph -= 1;
          o2.phase[j] = ph;
          const s = this.oscSample(o2, ph) * o2.gain;
          l += s * o2.panL[j];
          r += s * o2.panR[j];
        }
      }
      // Routing: what goes through the drive and main filter, and what skips them.
      let byL = 0, byR = 0;
      if (sepB) {
        let bl = l, br = r;
        if (this.oscF[1].active) {
          const f = this.oscF[1];
          bl = f.process(bl, 0);
          br = f.process(br, 1);
        }
        if (this.routeA && this.routeB) {
          l = preL + bl;
          r = preR + br;
        } else {
          l = (this.routeA ? preL : 0) + (this.routeB ? bl : 0);
          r = (this.routeA ? preR : 0) + (this.routeB ? br : 0);
          byL = (this.routeA ? 0 : preL) + (this.routeB ? 0 : bl);
          byR = (this.routeA ? 0 : preR) + (this.routeB ? 0 : br);
        }
      } else if (!this.routeA) {
        // Neither oscillator goes into the filter.
        byL = l;
        byR = r;
        l = r = 0;
      }
      if (this.noiseLevel > 0) {
        const nz = this.rng.next() * this.noiseLevel;
        l += nz;
        r += nz;
      }
      if (this.breathOn) {
        this.chiffEnv *= this.chiffCoef;
        const ba = this.chiffAmt * this.chiffEnv + 0.5 * this.breathLvl;
        this.breathSvf.process(this.rng.next(), this.breathG, 1.1);
        const b = this.breathSvf.bp * ba * 1.6;
        if (this.routeBr) {
          l += b;
          r += b;
        } else {
          byL += b;
          byR += b;
        }
      }
      // Click into the filter (C): it joins the oscillators here, level-matched to its usual
      // place after the amp, and the amp envelope then shapes it like everything else.
      if (this.routeCl && this.clickLevel > 0) {
        const c = this.transient.process() * this.clickLevel * 1.5 / (PRE_FILTER_GAIN * POST_FILTER_GAIN);
        l += c;
        r += c;
      }
      // Sub: clean, mono, phase-stable (in poly mode only the lowest note carries it). Its own
      // filter and clip shape it; with "sub into filter" (S) it joins the oscillators instead.
      const amp = env * this.velGain * duck;
      let sub = 0;
      this.subMix += this.subMix < this.subOn ? this.subRamp : this.subMix > this.subOn ? -this.subRamp : 0;
      if (this.subMix < 0) this.subMix = 0;
      else if (this.subMix > 1) this.subMix = 1;
      if (this.subLevel > 0 && this.subMix > 0) {
        let sp = this.subPhase + this.subInc;
        if (sp >= 1) sp -= 1;
        this.subPhase = sp;
        if (this.subWave === 0) sub = Math.sin(TWO_PI * sp);
        else if (this.subWave === 1) sub = sp < 0.25 ? 4 * sp : sp < 0.75 ? 2 - 4 * sp : 4 * sp - 4;
        else {
          // Square, band-limited with polyBLEP at both edges.
          const dt = this.subInc;
          let sp2 = sp + 0.5;
          if (sp2 >= 1) sp2 -= 1;
          sub = (sp < 0.5 ? 1 : -1) + polyBlep(sp, dt) - polyBlep(sp2, dt);
        }
        if (this.subF.active) sub = this.subF.process(sub);
        if (this.routeS) {
          // Into the main filter at the level the clean path would have had.
          const s = sub * this.subLevel * this.subMix * SUB_ROUTE_GAIN;
          l += s;
          r += s;
          sub = 0;
        } else {
          sub *= this.subLevel * amp * this.subMix;
          // Sub clip, against the sub's nominal peak (its level at full envelope).
          if (this.subClip.knee > 0) {
            this.subClip.process(sub, 0, this.subLevel * this.velGain, this.clipOut);
            sub = this.clipOut[0];
          }
        }
      } else {
        this.subPhase += this.subInc;
        if (this.subPhase >= 1) this.subPhase -= 1;
      }

      l *= PRE_FILTER_GAIN;
      r *= PRE_FILTER_GAIN;

      // 2× oversampled nonlinear section.
      this.upL.process(l);
      this.upR.process(r);
      if (this.bypassOn) {
        this.upBL.process(byL * PRE_FILTER_GAIN);
        this.upBR.process(byR * PRE_FILTER_GAIN);
        this.nonlinear(this.upL.out0, this.upR.out0, 0, this.upBL.out0, this.upBR.out0);
        this.nonlinear(this.upL.out1, this.upR.out1, 2, this.upBL.out1, this.upBR.out1);
      } else {
        this.nonlinear(this.upL.out0, this.upR.out0, 0, 0, 0);
        this.nonlinear(this.upL.out1, this.upR.out1, 2, 0, 0);
      }
      l = this.dnL.process(os[0], os[2]);
      r = this.dnR.process(os[1], os[3]);

      // Bitcrusher / downsampler.
      if (this.crushMix > 0) {
        this.crusher.process(l, r, this.crushMix, this.crushQ, this.crushRate, tmp);
        l = tmp[0];
        r = tmp[1];
      }

      // Tape (voice only; the sub joins later and stays clean).
      if (this.tapeOn) {
        this.tape.process(l, r, cur[P.tapeDrive], this.tapeWow, cur[P.tapeAge], this.tapeLpCoef, env, tmp);
        l = tmp[0];
        r = tmp[1];
      }

      if (this.postCut.active) {
        l = this.postCut.process(l, 0);
        r = this.postCut.process(r, 1);
      }

      // Remove DC from asymmetric stages (tube, tape) before the envelope shapes it.
      l = this.voiceDcL.process(l);
      r = this.voiceDcR.process(r);

      // Amp.
      const va = amp * this.ampMod * VOICE_GAIN;
      l *= va;
      r *= va;

      // Mid clip (osc 1 + 2 only), against the voice's nominal peak (the dirt chain
      // typically peaks at 0.7-1 of the amp's gain, so 0.8 of it).
      if (this.midClip.knee > 0) {
        this.midClip.process(l, r, MID_CLIP_REF * this.ampMod * VOICE_GAIN * this.velGain, this.clipOut);
        l = this.clipOut[0];
        r = this.clipOut[1];
      }

      // Attack transient layer (bypasses the filter so it stays crisp).
      if (this.clickLevel > 0 && !this.routeCl) {
        const c = this.transient.process() * this.clickLevel * this.velGain * duck * VOICE_GAIN * 1.5;
        l += c;
        r += c;
      }

      this.subDelay[this.subDelayPos] = sub;
    } else {
      this.subDelay[this.subDelayPos] = 0;
      if (this.tail > 0) this.tail--;
    }
    let rp = this.subDelayPos - OVERSAMPLE_LATENCY;
    if (rp < 0) rp += 32;
    const sub = this.subDelay[rp];
    this.subDelayPos = (this.subDelayPos + 1) & 31;
    // The sub leaves on its own (out[2]) and the synth adds it after every effect; with
    // direct out off it joins the voice and goes through the dynamics, effects and EQ.
    if (this.subDirect) {
      out[0] = l;
      out[1] = r;
      out[2] = sub;
    } else {
      out[0] = l + sub;
      out[1] = r + sub;
      out[2] = 0;
    }
  }
}
