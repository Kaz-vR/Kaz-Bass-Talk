// One synth voice: everything that belongs to a single note, from the
// oscillators through the amp, plus its clean sub.
//
//   osc1 + osc2 + noise
//   → [2× oversampled: drive → filter → distortion (optionally mids only)]
//   → DC filter → amp (RUIN, DRIVE, the bitcrusher and tape run once on the summed voices: bus.ts)
//   + sub (clean, mono, phase-stable: bypasses everything above)
//
// The Synth owns up to 8 of these (polyphony) and everything shared: the
// parameters, LFOs and drift sources, the texture bed and the FX chain.
// Pure TypeScript, allocation-free after construction.

import { AUX_SLOT, Biquad, clamp, Clipper, Envelope, Ladder, OSC_SLOT, Rng, SlotFilter, Svf, TWO_PI } from './dsp';
import { Downsampler2x, OVERSAMPLE_LATENCY, Upsampler2x } from './oversample';
import * as K from './params';
import { Comb, DiodeLadder, KarplusString } from './voicefx';
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
const WAVE_STRING = K.WAVE_STRING;
const FILTER_LP = K.FILTER_LP, FILTER_BP = K.FILTER_BP, FILTER_DIODE = K.FILTER_DIODE, FILTER_NOTCH = K.FILTER_NOTCH;
const FILTER_COMB = K.FILTER_COMB, FILTER_LPG = K.FILTER_LPG, FILTER_HP = K.FILTER_HP, FILTER_SEM = K.FILTER_SEM;

const tanh = K.tanh, tanhIntegral = K.tanhIntegral;
const SLOT_COUNT = K.SLOT_COUNT, SRC_COUNT = K.SRC_COUNT, DEST_COUNT = K.DEST_COUNT;
const VOWELS = K.VOWELS, FORMANT_GAIN = K.FORMANT_GAIN;
const TABLE_N = TABLE_SIZE, TABLE_M = TABLE_MASK;
const D = {
  PITCH: K.D_PITCH, OSC_PITCH: K.D_OSC_PITCH, OSC1_PITCH: K.D_OSC1_PITCH, OSC2_PITCH: K.D_OSC2_PITCH, OSC1_WT: K.D_OSC1_WT, OSC2_WT: K.D_OSC2_WT,
  OSC1_PW: K.D_OSC1_PW, OSC2_PW: K.D_OSC2_PW, OSC1_LEVEL: K.D_OSC1_LEVEL, OSC2_LEVEL: K.D_OSC2_LEVEL, DETUNE: K.D_DETUNE, SHAPE: K.D_SHAPE, OSC1_DETUNE: K.D_OSC1_DETUNE, OSC2_DETUNE: K.D_OSC2_DETUNE,
  SUB: K.D_SUB, NOISE: K.D_NOISE, DRIVE: K.D_DRIVE, CUTOFF: K.D_CUTOFF, RES: K.D_RES, VOWEL: K.D_VOWEL,
  DIST_DRIVE: K.D_DIST_DRIVE, DIST_MIX: K.D_DIST_MIX, AMP: K.D_AMP, CRUSH: K.D_CRUSH, TAPE_WOW: K.D_TAPE_WOW,
  DIST_TONE: K.D_DIST_TONE, VIBRATO: K.D_VIBRATO, BREATH: K.D_BREATH, SUB_PITCH: K.D_SUB_PITCH,
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
  /** The bar position in beats (0..4), set by the synth before control(): GRIND's beat movement. */
  beatPos = 0;
  /** The tempo in beats per second (set with beatPos). */
  bps = 2;

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
  /** 1 when this voice carries the sub (poly: only the lowest note does); ramped per sample. */
  subOn = 1;
  private subMix = 1;
  private readonly subRamp: number;

  // Modulation.
  readonly ampEnv = new Envelope();
  private readonly modEnv = new Envelope();
  readonly src = new Float64Array(SRC_COUNT);
  // LFO fade-in per voice, from this note's start: a shared fade would restart on every new
  // note and, in a fast arp or a chord, never get to fade in.
  private readonly lfoFade = new Float64Array(K.LFO_COUNT).fill(1);
  // The per-note LFO shapes (bloom, drop, per note): how far through its cycle each is since this
  // note started (0..1, held at 1), and the note's random value; each voice runs its own.
  private readonly lfoProg = new Float64Array(K.LFO_COUNT);
  private readonly lfoRand = new Float64Array(K.LFO_COUNT);
  /** Mod matrix result for this voice (the Synth reads the newest voice's FX targets). */
  readonly dst = new Float64Array(DEST_COUNT);

  // Oscillators.
  private readonly osc: OscState[] = [makeOsc(), makeOsc()];
  private readonly strings: KarplusString[];
  private readonly strPeriod = new Float64Array(2);
  private readonly strGain = new Float64Array(2);
  private strTone = 0.5;
  // Delayed vibrato (per note: its own phase and a slightly different rate).
  private noteTime = 0;
  private vibPhase = 0;
  private vibRate = 5;
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
  private subDirect = true;
  /** Some source skips the drive and main filter: it gets its own oversampled path. */
  private bypassOn = false;
  private readonly upBL = new Upsampler2x();
  private readonly upBR = new Upsampler2x();
  // Filter mix (dry/filtered).
  private fMix = 1;
  private noiseLevel = 0;

  // Mixer drive (the oscillators' sum overdriving), then drive + filter.
  private mixGain = 1;
  private mixComp = 1;
  private readonly mixU = new Float64Array(2);
  private readonly mixF = new Float64Array(2).fill(tanhIntegral(0));
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
  private readonly hpL = [new Svf(), new Svf()];
  private readonly hpR = [new Svf(), new Svf()];
  private readonly notchL = [new Svf(), new Svf()];
  private readonly notchR = [new Svf(), new Svf()];
  private readonly lpgL = new Svf();
  private readonly lpgR = new Svf();
  /** The SEM-style 12 dB low-pass (a bending state-variable filter). */
  private readonly semL = new Svf();
  private readonly semR = new Svf();
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
  /** The saws' analog bow (a charging capacitor's ramp, not a straight line), from Analog. */
  private sawBow = 0;
  private noteCutoffJitter = 0;
  /**
   * This voice's own fixed character, its "voice card" (as each voice of a Prophet or Jupiter is a
   * little different): offsets in tuning, cutoff, envelope times and level, each -1..1, scaled by
   * Analog, in poly only (a mono patch keeps its one tuning against its sub).
   */
  private readonly cardTune: number;
  private readonly cardCut: number;
  private readonly cardEnv: number;
  private readonly cardLevel: number;
  /** This note's envelope timing, a touch different every note (analog envelopes never repeat exactly). */
  private noteEnvJitter = 1;

  private readonly driveU = new Float64Array(2);
  private readonly driveF = new Float64Array(2).fill(tanhIntegral(0));

  // Amp.
  private ampMod = 1;
  private ampModStep = 0;
  private velGain = 1;

  constructor(fs: number, cur: Float64Array, table: Float32Array, seed: number, private readonly dstMask?: Float64Array) {
    this.fs = fs;
    this.cur = cur;
    this.table = table;
    this.rng = new Rng(seed);
    const card = new Rng(seed ^ 0x6c8e9cf5);
    this.cardTune = card.next();
    this.cardCut = card.next();
    this.cardEnv = card.next();
    this.cardLevel = card.next();
    this.subRamp = 1 / (0.01 * fs);
    this.combL = new Comb(Math.ceil((fs * OS) / 20));
    this.combR = new Comb(Math.ceil((fs * OS) / 20));
    this.strings = [new KarplusString(Math.ceil(fs / 15)), new KarplusString(Math.ceil(fs / 15))];
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
      this.ladL.reset();
      this.ladR.reset();
      this.upL.reset();
      this.upR.reset();
      this.dnL.reset();
      this.dnR.reset();
      this.diodeL.reset();
      this.diodeR.reset();
    }
    this.noteCutoffJitter = this.rng.next();
    // (poly only, as the voice cards: a mono bass keeps the same punch on every note)
    this.noteEnvJitter = cur[P.poly] > 1.5 ? 1 + 0.12 * cur[P.analog] * this.rng.next() : 1;
    // Per-note excitations: the string pluck.
    const noteHz = 440 * Math.pow(2, (note + 12 * cur[P.octave] - 69) / 12);
    for (let n = 0; n < 2; n++) {
      if (cur[P.osc[n].wave] === WAVE_STRING) {
        const hz = noteHz * Math.pow(2, cur[P.osc[n].semi] / 12);
        this.strings[n].pluck(this.fs / hz);
      }
    }
    this.ampEnv.trigger();
    this.modEnv.trigger();
    for (let l = 0; l < K.LFO_COUNT; l++) {
      this.lfoFade[l] = cur[P.lfo[l].fade] > 0 ? 0 : 1;
      this.lfoProg[l] = 0;
      this.lfoRand[l] = this.rng.next();
    }
    this.noteTime = 0;
    this.vibPhase = 0.5 * (this.rng.next() + 1);
    this.vibRate = cur[P.vibRate] * (1 + 0.05 * this.rng.next());
  }

  release(): void {
    this.gate = false;
    this.ampEnv.release();
    this.modEnv.release();
  }

  /** Clear all DSP state (after a fault). */
  reset(): void {
    this.gate = false;
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
    }
    this.upL.reset();
    this.upR.reset();
    this.dnL.reset();
    this.dnR.reset();
    this.voiceDcL.reset();
    this.voiceDcR.reset();
    this.diodeL.reset();
    this.diodeR.reset();
    for (const f of [...this.notchL, ...this.notchR, ...this.hpL, ...this.hpR, this.lpgL, this.lpgR, this.semL, this.semR]) f.reset();
    this.combL.reset();
    this.combR.reset();
    for (const st of this.strings) st.reset();
    this.subClip.reset();
    this.midClip.reset();
    this.subDelay.fill(0);
    for (const f of this.oscF) f.reset();
    this.subF.reset();
    this.postCut.reset();
    this.upBL.reset();
    this.upBR.reset();
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

    // The voice card (poly only, scaled by Analog) and this note's jitter stretch the envelope times.
    const card = cur[P.poly] > 1.5 ? cur[P.analog] : 0;
    const et = (1 + 0.2 * card * this.cardEnv) * this.noteEnvJitter;
    this.ampEnv.set(cur[P.amp[0]] * et, cur[P.amp[1]] * et, cur[P.amp[2]], cur[P.amp[3]] * et, fs, cur[P.ampBend[0]], cur[P.ampBend[1]], cur[P.ampBend[2]]);
    this.modEnv.set(cur[P.mod[0]] * et, cur[P.mod[1]] * et, cur[P.mod[2]], cur[P.mod[3]] * et, fs, cur[P.modBend[0]], cur[P.modBend[1]], cur[P.modBend[2]]);

    // Glide.
    const glideMs = cur[P.glide];
    if (glideMs > 0.5) {
      const c = 1 - Math.exp((-CONTROL_BLOCK * 4.6) / ((glideMs / 1000) * fs));
      this.pitch += (this.note - this.pitch) * c;
    } else {
      this.pitch = this.note;
    }

    // Mod matrix: global sources plus this voice's own.
    const src = this.src;
    src.set(gsrc);
    for (let l = 0; l < K.LFO_COUNT; l++) {
      const lp = P.lfo[l];
      if (this.lfoFade[l] < 1) {
        const fadeMs = cur[lp.fade];
        this.lfoFade[l] = fadeMs > 0 ? Math.min(1, this.lfoFade[l] + (CONTROL_BLOCK * 1000) / (fadeMs * fs)) : 1;
      }
      const s = K.SRC_LFO[l];
      if (K.lfoPerNote(cur[lp.shape])) {
        // A per-note shape: one cycle from this note's start (Rate or the synced note value), then held.
        const sync = cur[lp.sync];
        let rate = sync > 0 ? this.bps / K.SYNC_BEATS[sync] : cur[lp.rate];
        const rm = this.dst[K.LFO_RATE_DEST[l]];
        if (rm !== 0) rate *= Math.pow(2, 3 * rm);
        this.lfoProg[l] = Math.min(1, this.lfoProg[l] + (rate * CONTROL_BLOCK) / fs);
        src[s] = this.lfoNow(l) * cur[P.lfoOn[l]] * this.lfoFade[l];
      } else {
        src[s] *= this.lfoFade[l];
      }
    }
    src[K.SRC_MOD_ENV] = this.modEnv.level * cur[P.modEnvOn];
    src[K.SRC_AMP_ENV] = this.ampEnv.level;
    src[K.SRC_VEL] = this.velocity;
    src[K.SRC_KEY] = clamp((this.pitch - KEYTRACK_CENTER) / 24, -1, 1);
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
    this.sawBow = this.analog;
    // Sync needs a table oscillator on osc 2 (not string).
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
    // Pitch moves the whole note (the sub too); Osc A+B pitch and vibrato only the two oscillators.
    const notePitch = this.pitch + 12 * cur[P.octave] + 2 * bend + 24 * dst[D.PITCH];
    const basePitch = notePitch + 24 * dst[D.OSC_PITCH] + vib + 0.1 * card * this.cardTune;

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
      const detune = clamp(cur[op.detune] + 100 * (dst[D.DETUNE] + dst[n === 0 ? D.OSC1_DETUNE : D.OSC2_DETUNE]), 0, 100);
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
          // ±2.5 → ±40 cents on the core, ±7 → ±60 on the copies, curved (owner's call: extreme at the top)
          const a = this.analog, a4 = a * a * a * a;
          const cents = (j === 0 ? 2.5 * a + 37.5 * a4 : 7 * a + 53 * a4) * o.drift[j];
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
      if (o.wave === WAVE_STRING) {
        // Single-voice oscillators: unison doesn't apply.
        o.gain = level;
        this.strPeriod[n] = 1 / center;
        // Loop gain per period for a T60 of 0.08 .. 8 s.
        const t60 = 0.08 * Math.pow(100, cur[P.strDecay]);
        this.strGain[n] = Math.pow(10, (-3 * this.strPeriod[n]) / (t60 * fs));
      } else {
        o.gain = level / Math.sqrt(voices);
      }
      // A / B shape (and A+B shape) move the Shape knob: pulse width, or the wavetable position below.
      const shape = dst[n === 0 ? D.OSC1_PW : D.OSC2_PW] + dst[D.SHAPE];
      // (an analog pulse's width drifts a little with its pitch, from Analog)
      o.pw = clamp(cur[op.pw] + 0.45 * shape + 0.04 * this.analog * o.drift[0], 0.05, 0.95);
      // Wavetable frame selection.
      let wt: number;
      if (o.wave === WAVE_SINE) wt = 0;
      else if (o.wave === WAVE_TRI) wt = FRAMES_PER_SEGMENT / (FRAME_COUNT - 1);
      else wt = clamp(cur[op.wt] + dst[n === 0 ? D.OSC1_WT : D.OSC2_WT] + shape, 0, 1);
      const fpos = wt * (FRAME_COUNT - 1);
      const fa = Math.min(FRAME_COUNT - 2, Math.floor(fpos));
      const mip = mipForIncrement(o.inc[voices - 1]);
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
    // Direct out wins: a sub on its own clean path never goes into the filter.
    this.routeS = cur[P.routeS] > 0.5 && cur[P.subDirect] < 0.5;
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
    const bypass = !this.routeA || !this.routeB;
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

    // Sub, folded up an octave at a time if it would fall below 20 Hz (inaudible, wastes headroom).
    // The sub follows the note: glide, bend and the matrix's Pitch (Env 3 → Pitch for an 808 drop).
    // Osc A+B pitch, vibrato and drift move only the two oscillators, so a preset keeps its sub
    // steady by sending its wobble there (as in Serum: the preset chooses, the engine doesn't);
    // Sub pitch moves the sub alone (±2 octaves at full amount, like Pitch): a drop or scoop on
    // the sub while the oscillators stay.
    let subInc = this.toInc(notePitch + 12 * cur[P.subOct] + 24 * dst[D.SUB_PITCH]);
    while (subInc < 20 / fs) subInc *= 2;
    // (and high up, at +4 on a high note, it stays well below Nyquist)
    while (subInc > 0.45) subInc *= 0.5;
    this.subInc = subInc;
    this.subLevel = clamp(cur[P.subLevel] + dst[D.SUB], 0, 1) * SUB_GAIN;
    this.noiseLevel = clamp(cur[P.noise] + dst[D.NOISE], 0, 1) * 0.5;

    // Mixer drive: the mix saturates harder the hotter it is; the make-up keeps a full mix near its level.
    const md = cur[P.mixDrive];
    this.mixGain = 1 + 8 * md;
    this.mixComp = 1 / Math.sqrt(this.mixGain);

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
      6 * cur[P.envAmt] * cur[P.modEnvOn] * (1 + 1.5 * this.accentAmt) * this.modEnv.level + 6 * dst[D.CUTOFF] + 0.12 * this.analog * this.noteCutoffJitter + 0.3 * card * this.cardCut;
    // Low-pass gate: the cutoff closes together with the amp envelope.
    if (this.filterType === FILTER_LPG) octs += 1.5 * Math.log2(Math.max(this.ampEnv.level, 0.002));
    const fc = clamp(cur[P.cutoff] * Math.pow(2, octs), 20, Math.min(20000, fs * 0.45));
    const gTarget = Math.tan((Math.PI * fc) / fsOs);
    this.fcNow = fc;
    this.resNow = res;
    this.fMix = cur[P.fMix];
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
    } else if (this.filterType === FILTER_HP) {
      // 4-pole high-pass: two 2-pole stages (Butterworth at res 0), the resonance on the sharper one
      this.k = 0.765 * (1 - res) + 0.05;
    } else if (this.filterType === FILTER_SEM) {
      // SEM: a 12 dB state-variable low-pass, gentle at res 0, singing but never self-oscillating at the top
      this.k = 1.9 * (1 - res) + 0.12;
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


    // Clippers: the drive (dB) lowers the knee; the curve above it is half as tall as the
    // distance from the knee to the nominal peak; an automatic level match keeps the loudness.
    this.subClip.setDrive(cur[P.subClip]);
    this.midClip.setDrive(cur[P.midClip]);

    // Amp.
    const ampTarget = clamp(1 + dst[D.AMP], 0, 2);
    this.ampModStep = (ampTarget - this.ampMod) / CONTROL_BLOCK;
    this.velGain = (1 - cur[P.velocity] * (1 - this.velocity)) * (1 + 0.4 * this.accentAmt) * (1 + 0.12 * card * this.cardLevel);
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

  /** How far a per-note LFO shape is through its cycle (0..1). */
  lfoProgress(l: number): number {
    return this.lfoProg[l];
  }

  /** A per-note LFO shape's value right now: bloom rises 0 → 1 (eased), drop falls 1 → 0 (fast first), per note holds its random value. */
  lfoNow(l: number): number {
    const x = this.lfoProg[l];
    switch (this.cur[P.lfo[l].shape]) {
      case K.LFO_BLOOM: return 0.5 - 0.5 * Math.cos(Math.PI * x);
      case K.LFO_DROP: return (1 - x) * (1 - x);
      default: return this.lfoRand[l];
    }
  }

  /** Physical-model string oscillator (single voice, centred). */
  private specialOsc(n: number): number {
    return this.strings[n].process(this.strPeriod[n], this.strTone, this.strGain[n]) * 1.4;
  }

  /**
   * The band-limited saw from the mip-mapped table (no aliasing at any pitch), bowed like an analog
   * saw: its ramp is a charging capacitor, rising a touch faster early and slower late, not a straight
   * line (a parabola across the ramp, zero at the reset so the jump stays band-limited). Pulses made
   * from two of them droop on their tops, as real pulses do.
   */
  private saw(base: number, ph: number): number {
    const s = this.readTable(base, ph);
    if (this.sawBow === 0) return s;
    let r = ph + 0.5; // the table's ramp restarts at phase 0.5
    if (r >= 1) r -= 1;
    return s + this.sawBow * r * (1 - r);
  }

  private oscSample(o: OscState, ph: number): number {
    switch (o.wave) {
      case WAVE_PWMSAW: {
        // Rave "hoover": saw blended with a pulse whose width is modulated.
        let p2 = ph - o.pw;
        if (p2 < 0) p2 += 1;
        const saw = this.saw(o.baseSaw, ph);
        return 0.6 * saw + 0.35 * (saw - this.saw(o.baseSaw, p2));
      }
      case WAVE_SAW:
        return this.saw(o.baseSaw, ph);
      case WAVE_PULSE: {
        // Pulse = difference of two band-limited saws, offset by the pulse width.
        let p2 = ph - o.pw;
        if (p2 < 0) p2 += 1;
        return 0.5 * (this.saw(o.baseSaw, ph) - this.saw(o.baseSaw, p2));
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

  /** Mixer drive: tanh saturation of the oscillators' sum, with first-order ADAA (see shape()). */
  private mixShape(x: number, ch: number): number {
    const u = this.mixGain * x;
    const up = this.mixU[ch];
    const fu = tanhIntegral(u);
    const du = u - up;
    const y = Math.abs(du) > 1e-5 ? (fu - this.mixF[ch]) / du : tanh(0.5 * (u + up));
    this.mixU[ch] = u;
    this.mixF[ch] = fu;
    return y * this.mixComp;
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

  /** One oversampled stereo sample through drive → filter → distortion into osOut[slot], osOut[slot + 1]. */
  private nonlinear(l: number, r: number, slot: number, bl: number, br: number): void {
    // Mixer drive: the oscillators' sum overdriving first, the Minimoog way.
    if (this.mixGain > 1) {
      l = this.mixShape(l, 0);
      r = this.mixShape(r, 1);
    }
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
      this.bpL[0].processSat(l, g, k);
      this.bpL[1].processSat(this.bpL[0].bp * k, g, k);
      l = this.bpL[1].bp * k * 1.5;
      this.bpR[0].processSat(r, g, k);
      this.bpR[1].processSat(this.bpR[0].bp * k, g, k);
      r = this.bpR[1].bp * k * 1.5;
    } else if (this.filterType === FILTER_DIODE) {
      l = this.diodeL.process(l, g, this.k) * 1.4;
      r = this.diodeR.process(r, g, this.k) * 1.4;
    } else if (this.filterType === FILTER_NOTCH) {
      const k = this.k, nl = this.notchL, nr = this.notchR;
      nl[0].processSat(l, g, k);
      nl[1].processSat(nl[0].lp + nl[0].hp, g, k);
      l = nl[1].lp + nl[1].hp;
      nr[0].processSat(r, g, k);
      nr[1].processSat(nr[0].lp + nr[0].hp, g, k);
      r = nr[1].lp + nr[1].hp;
    } else if (this.filterType === FILTER_COMB) {
      l = this.combL.process(l, this.combDelay, this.combFb);
      r = this.combR.process(r, this.combDelay, this.combFb);
    } else if (this.filterType === FILTER_HP) {
      const k = this.k, hl = this.hpL, hr = this.hpR;
      hl[0].processSat(l, g, 1.848);
      hl[1].processSat(hl[0].hp, g, k);
      l = hl[1].hp;
      hr[0].processSat(r, g, 1.848);
      hr[1].processSat(hr[0].hp, g, k);
      r = hr[1].hp;
    } else if (this.filterType === FILTER_SEM) {
      this.semL.processSat(l, g, this.k);
      this.semR.processSat(r, g, this.k);
      l = this.semL.lp;
      r = this.semR.lp;
    } else if (this.filterType === FILTER_LPG) {
      this.lpgL.processSat(l, g, this.k);
      this.lpgR.processSat(r, g, this.k);
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
    // Mix (dry/filtered).
    if (this.fMix < 1) {
      l = dryL + (l - dryL) * this.fMix;
      r = dryR + (r - dryR) * this.fMix;
    }
    l *= POST_FILTER_GAIN;
    r *= POST_FILTER_GAIN;
    // Sources that skip the drive and filter rejoin here.
    if (this.bypassOn) {
      l += bl * POST_FILTER_GAIN;
      r += br * POST_FILTER_GAIN;
    }

    this.osOut[slot] = l;
    this.osOut[slot + 1] = r;
  }

  /**
   * One stereo sample of this voice (voice + sub) into out.
   * `duck` is the Synth's discrete-switch fade gain.
   */
  render(duck: number, out: Float64Array): void {
    let l = 0;
    let r = 0;
    this.ampMod += this.ampModStep;
    const os = this.osOut;
    const o1 = this.osc[0];
    const o2 = this.osc[1];

    if (this.ampEnv.stage !== 0) {
      const env = this.ampEnv.tick();
      this.modEnv.tick();

      // Oscillators (band-limited at the base rate).
      if (o1.gain > 0 && o1.wave >= WAVE_STRING) {
        const s = this.specialOsc(0) * o1.gain;
        l += s;
        r += s;
      } else if (o1.gain > 0) {
        for (let j = 0; j < o1.voices; j++) {
          let ph = o1.phase[j] + o1.inc[j];
          ph -= Math.floor(ph);
          o1.phase[j] = ph;
          const s = this.oscSample(o1, ph) * o1.gain;
          l += s * o1.panL[j];
          r += s * o1.panR[j];
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
        const s = this.specialOsc(1) * o2.gain;
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
        // sine, warm sine, triangle, square, pulse (25%), saw; the edges band-limited with polyBLEP
        const sw = this.subWave;
        if (sw === 0) sub = Math.sin(TWO_PI * sp);
        else if (sw === 1) sub = 0.86 * (Math.sin(TWO_PI * sp) + 0.3 * Math.sin(2 * TWO_PI * sp));
        else if (sw === 2) sub = sp < 0.25 ? 4 * sp : sp < 0.75 ? 2 - 4 * sp : 4 * sp - 4;
        else if (sw === 5) sub = 0.8 * (1 - 2 * sp + polyBlep(sp, this.subInc));
        else {
          const dt = this.subInc, w = sw === 4 ? 0.25 : 0.5;
          let sp2 = sp + 1 - w;
          if (sp2 >= 1) sp2 -= 1;
          // (the pulse without its DC: centred on zero)
          sub = (sp < w ? 1 : -1) + polyBlep(sp, dt) - polyBlep(sp2, dt);
          if (sw === 4) sub = 0.8 * (sub + 0.5);
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
