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
// Signal path (fixed order):
//   up to 8 voices (see voice.ts: oscillators → drive → filter → distortion
//   → bitcrusher → tape → amp), summed
//   + texture bed
//   → chorus → flanger → phaser → delay → reverb (each only above its own low cut)
//   → EQ → high cut
//   + the clean mono sub (its own path: only the Sub box touches it)
//   → subsonic/DC filter → mono below crossover
//   → output gain → look-ahead limiter (always on) → side high-pass again (mono below crossover)
//
// voice.polyphony = 1 is monophonic (note stack, legato, glide: the bass
// default); 2-8 plays chords, stealing the oldest note when all are busy.
// LFOs, drift sources, the texture bed and the FX are shared by all voices;
// the mod matrix runs per voice, and FX targets follow the newest voice.

import { WOB_MAX_POINTS, WOB_RANDOM_STEPS, WOB_TABLE, WOB_TEMPLATES, wobShapeAt, wobSmoothRadius, wobSmoothTable, wobTableAt } from './wobshape';
import { PARAM_COUNT, params } from '../../schema';
import { AUX_SLOT, Biquad, clamp, Rng, SlotFilter, Svf, TWO_PI } from './dsp';
import { Chorus, Delay, Flanger, Limiter, OctaveDown, Phaser, Reverb } from './fx';
import { Grind } from './grind';
import { OVERSAMPLE_LATENCY } from './oversample';
import * as K from './params';
import { Voice } from './voice';
import { Texture } from './voicefx';
import { getWavetable } from './wavetable';

export const CONTROL_BLOCK = K.CONTROL_BLOCK;
/** Most voices a patch can ask for. */
export const MAX_VOICES = 8;

// Module-local bindings: avoids live-binding getter overhead on hot paths in
// some module transforms (tsx / vite-node).
const P = K.P;
const BLOCK = K.CONTROL_BLOCK;
/** The wobbler's preset shapes as typed arrays, by wobble.shape option (made once, not on the audio thread). */
const WOB_TEMPLATE_ARRAYS = K.WOB_SHAPES.map((name) => {
  const pts = WOB_TEMPLATES[name] ?? WOB_TEMPLATES.sine;
  return { n: pts.length, xs: Float64Array.from(pts, (q) => q.x), ys: Float64Array.from(pts, (q) => q.y), ss: Float64Array.from(pts, (q) => (q.s ? 1 : 0)) };
});
const N_PARAMS = PARAM_COUNT;
const LFO_COUNT = K.LFO_COUNT, SRC_COUNT = K.SRC_COUNT;
const SYNC_BEATS = K.SYNC_BEATS, DELAY_BEATS = K.DELAY_BEATS, LFO_RATE_DEST = K.LFO_RATE_DEST;
const XO_Q = K.XO_Q, SUBSONIC_Q = K.SUBSONIC_Q, TEXTURE_GAIN = K.TEXTURE_GAIN;

export class Synth {
  readonly sampleRate: number;

  // Parameters: target (from patch), current (smoothed / applied).
  private readonly target = new Float64Array(PARAM_COUNT);
  private readonly cur = new Float64Array(PARAM_COUNT);
  /** The patch as set; `target` is it after the power switches and solo/mute (see resolve()). */
  private readonly raw = new Float64Array(PARAM_COUNT);
  /** Mod destinations a switched-off block or a muted layer ignores (0 = blocked), shared with the voices. */
  private readonly dstMask = new Float64Array(K.DEST_COUNT).fill(1);
  private monitorSolo: readonly string[] = [];
  private monitorMute: readonly string[] = [];
  private readonly isLog = new Uint8Array(PARAM_COUNT);
  private readonly isDiscrete = new Uint8Array(PARAM_COUNT);
  private readonly smoothCoef: number;
  private duckGain = 1;
  private duckDir = 0; // -1 fading out, +1 fading in
  private duckHold = 0; // samples to stay silent after a switch (oversampler latency)
  private readonly duckStep: number;

  // Voices and notes.
  private readonly voices: Voice[] = [];
  private poly = 1;
  private order = 0;
  private readonly stack = new Int32Array(16); // mono note stack
  private stackLen = 0;
  private bend = 0;
  private modWheel = 0;
  /** The mod wheel, smoothed (~20 ms) so a fast move never zips. */
  private wheel = 0;
  // Texture bed solo / mute (a listening aid, not part of the patch), faded over ~5 ms.
  private texMon = 1;
  private texMonTarget = 1;
  /** Analysis only: the wheel's move without its moving/noisy parts (see WHEEL_MOVING_DESTS). */
  wheelFrozen = false;
  /** Extra modulation shared by every voice: the wheel move and the wobble. */
  private readonly xdst = new Float64Array(K.DEST_COUNT);
  // Wobble: its own random source, so switching it on doesn't change anything else.
  private readonly wobRng = new Rng(0x60bb1e);
  private wobCycle = -1;
  private wobScale = 1;
  private wobScaleTarget = 1;
  private wobBright = 0;
  private wobBrightTarget = 0;
  /** The custom shape's points (filled per block, no allocation) and its smoothed value. */
  private readonly wobXs = new Float64Array(WOB_MAX_POINTS);
  private readonly wobYs = new Float64Array(WOB_MAX_POINTS);
  private readonly wobSs = new Float64Array(WOB_MAX_POINTS);
  private wobV = 0;
  private wobShapeNow = 0;
  private wobPtsNow = 0;
  private wobSig = NaN;
  private readonly wobTable = new Float64Array(WOB_TABLE);
  private readonly wobTmp = new Float64Array(WOB_TABLE);
  /** The current shape, unsmoothed, at q (made once, so the table rebuild never allocates). */
  private readonly wobRawFn = (q: number): number => this.wobRaw(q);
  /** Random's steps for the current cycle. */
  private readonly wobRand = new Float64Array(WOB_RANDOM_STEPS);
  private wobRandCycle = -1;
  /** The volume shape's crossover (two one-poles per side): below the low cut the gate leaves the sound alone. */
  /** The Wobbler's low cut split (per side: LP ×2, HP ×2: a Linkwitz-Riley pair). */
  private readonly wobBand = [0, 1].map(() => Array.from({ length: 4 }, () => new Biquad()));
  private wobBandLc = -1;
  /** The Wobbler's own filter (Cutoff target): two SVFs per side, its g (stepped per sample) and damping. */
  private readonly wobSvf = [0, 1].map(() => [new Svf(), new Svf()]);
  private wobFiltOn = false;
  private wobFiltWas = false;
  private wobG = 0;
  private wobGStep = 0;
  private wobK = 1.3;
  /** The Wobbler filter's cutoff right now (Hz), -1 when it is not working; read by the page. */
  liveWobFc = -1;
  /** The volume target's gain, ramped per sample towards its target so the gate never clicks. */
  private wobGate = 1;
  private wobGateTarget = 1;
  /** Where the wobble is in its cycle (0..1) for the LFO page's dot; -1 when it is off. */
  liveWob = -1;
  private tempo = 120;

  // Shared modulation.
  /** Where each LFO is in its cycle (0..1) and its value (-1..1); also read by the page's dots. */
  readonly lfoPhase = new Float64Array(LFO_COUNT);
  readonly lfoValue = new Float64Array(LFO_COUNT);
  private readonly lfoHold = new Float64Array(LFO_COUNT); // current random value (S&H; wander end point)
  private readonly lfoPrev = new Float64Array(LFO_COUNT); // previous random value (wander start point)
  private readonly gsrc = new Float64Array(SRC_COUNT);
  private readonly rng = new Rng(0x1234567);
  /** The texture bed's own GRIND chain (the bed is shared, so it follows the newest note), when not on Direct out. */
  private readonly texGrind = new Grind(new Rng(0x6a1d));
  private texGrindOn = false;
  // Slow random 'drift' modulation source.
  private driftVal = 0;
  private driftTarget = 0;
  private driftCount = 0;
  // Slower, smoother wanderer ('drift_slow'): cosine steps between random points every 2-6 s.
  private slowA = 0;
  private slowB = 0;
  private slowPos = 1;
  private slowStep = 0;

  // Texture bed: follows the notes with its own tail; added after the voices so it can outlast them.
  private readonly texture = new Texture();
  // The bed's own filter, its copy of the main filter (N), pan and direct out.
  private readonly texF = new SlotFilter(2);
  private readonly texNL = new Svf();
  private readonly texNR = new Svf();
  private texRouteN = false;
  private texNG = 0.1;
  private texNK = 1.4;
  private texNMode = 0; // 0 low, 1 band, 2 notch
  private texPanOn = false;
  private texPanL = 1;
  private texPanR = 1;
  private texDirect = false;
  private texEnv = 0;
  private texGain = 0;
  private texType = 0;
  private texTone = 0.4;
  private texDensity = 0.5;
  /** The bed's playback rate (2^octave, like tape run slower or faster) and its resampler: the last two frames and the position between them. */
  private texRate = 1;
  private texPos = 1;
  private readonly texPrev = new Float64Array(2);
  private readonly texCur = new Float64Array(2);
  private texAtk = 0.001;
  private texRel = 0.999;
  private texLpL = 0;
  private texLpR = 0;
  private texLpCoef = 1;
  private anyGate = false;
  /** The newest sounding voice's filter, for the UI's moving filter print: cutoff in Hz (0 = no voice sounding), resonance. */
  liveCutoff = 0;
  /** Each GRIND stage's filter frequency right now (Hz, the newest voice's), -1 when off or silent. */
  readonly liveGrind = new Float64Array(4).fill(-1);
  liveRes = 0;

  /** Position in the bar, in beats [0, 4): the wobble's clock. */
  private beatPos = 0;

  // FX + output.
  private readonly flanger: Flanger;
  private readonly delay: Delay;
  private delaySeconds = 0.375;
  private delayToneCoef = 0.5;
  // Modulated FX amounts (base value + the newest voice's mod matrix), set at control rate.
  private chorusDepth = 0;
  private phaserMix = 0;
  private delayMix = 0;
  private reverbMix = 0;
  private width = 1;
  private widthStep = 0;
  private widthTarget = 1;
  private readonly hcL = new Biquad();
  private readonly hcR = new Biquad();
  private highcutOn = false;
  private readonly eqOn = new Uint8Array(4);
  /** Each EQ band's settings as last set (type, freq, gain × scale, q), to skip unchanged ones. */
  private readonly eqLast = new Float64Array(16).fill(NaN);
  // Each modulation / space effect's own low cut (chorus, flanger, phaser, delay, reverb).
  private readonly hpL = [new Biquad(), new Biquad(), new Biquad(), new Biquad(), new Biquad()];
  private readonly hpR = [new Biquad(), new Biquad(), new Biquad(), new Biquad(), new Biquad()];
  private readonly lastLowcut = new Float64Array(5);
  private readonly chorus: Chorus;
  private readonly phaser: Phaser;
  private readonly reverb: Reverb;
  /** The reverb's -1 octave: its input shifted down before its Lo cut. */
  private readonly verbOct: OctaveDown;
  private readonly eqL = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
  private readonly eqR = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
  private readonly dcL = [new Biquad(), new Biquad()];
  private readonly dcR = [new Biquad(), new Biquad()];
  private readonly xo = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
  // Side high-pass again after the limiter: its fast gain changes modulate the side and
  // would otherwise splash a little stereo content back below the crossover.
  private readonly xoPost = [new Biquad(), new Biquad()];
  private readonly limiter: Limiter;
  private outGain = 1;
  private outGainStep = 0;
  private postDcXL = 0;
  private postDcYL = 0;
  private postDcXR = 0;
  private postDcYR = 0;
  private readonly postDcR: number;
  private outTarget = 1;
  private lastOutDb = NaN;
  private readonly lastFx = new Float64Array(8); // (unused), eqLow, eqMid, eqMidFreq, eqHigh, crossover, highcut
  private readonly tmp = new Float64Array(2);
  private readonly vout = new Float64Array(3);
  private ctrlCount = 0;

  /** Peak of the last rendered output (for metering). */
  peak = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.smoothCoef = 1 - Math.exp(-BLOCK / ((K.SMOOTH_MS / 1000) * sampleRate));
    this.duckStep = 1 / ((K.DUCK_MS / 1000) * sampleRate);
    this.postDcR = 1 - (2 * Math.PI * 5) / sampleRate;
    params.forEach((p, i) => {
      this.isLog[i] = p.curve === 'log' ? 1 : 0;
      this.isDiscrete[i] = p.type === 'float' ? 0 : 1;
      const d = p.default;
      const v = p.type === 'enum' ? p.options!.indexOf(d as string) : p.type === 'bool' ? (d ? 1 : 0) : (d as number);
      this.raw[i] = this.target[i] = this.cur[i] = v;
    });
    const table = getWavetable().data;
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice(sampleRate, this.cur, table, 0x2468ace + 0x9e3779b * i, this.dstMask));
    this.chorus = new Chorus(sampleRate);
    this.phaser = new Phaser(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.verbOct = new OctaveDown(sampleRate);
    this.flanger = new Flanger(sampleRate);
    this.delay = new Delay(sampleRate);
    this.limiter = new Limiter(sampleRate, K.LIMITER_CEILING_DB);
    // Subsonic + DC filter: 15 Hz 4th-order high-pass (−0.4 dB at 20 Hz, flat by 30 Hz).
    for (let i = 0; i < 2; i++) {
      this.dcL[i].setHighpass(K.SUBSONIC_HZ, SUBSONIC_Q[i], sampleRate);
      this.dcR[i].setHighpass(K.SUBSONIC_HZ, SUBSONIC_Q[i], sampleRate);
    }
    this.lastFx.fill(NaN);
    this.eqLast.fill(NaN);
    // Random LFO shapes (sample & hold, wander) start from random points, not flat at 0.
    for (let l = 0; l < LFO_COUNT; l++) {
      this.lfoPrev[l] = this.rng.next();
      this.lfoHold[l] = this.rng.next();
    }
    this.applyDiscrete();
    this.control();
  }

  get limiterCeiling(): number {
    return this.limiter.ceiling;
  }

  /** Lowest limiter gain since the last call (1 = no limiting); resets the meter. */
  takeLimiterMinGain(): number {
    const g = this.limiter.minGain;
    this.limiter.minGain = 1;
    return g;
  }

  /** Latency of the output limiter, in samples. */
  get latency(): number {
    return this.limiter.lookahead - 1 + OVERSAMPLE_LATENCY;
  }

  private anyActive(): boolean {
    for (const v of this.voices) if (v.active) return true;
    return false;
  }

  // ---------------------------------------------------------------- input

  /**
   * Set all parameters from a flat array in schema order (see patchToArray).
   * Values must already be validated/clamped. `immediate` skips smoothing
   * (use when loading while silent).
   */
  setParams(values: ArrayLike<number>, immediate = false): void {
    for (let i = 0; i < N_PARAMS; i++) this.raw[i] = values[i];
    this.resolve();
    if (immediate || !this.anyActive()) {
      for (let i = 0; i < N_PARAMS; i++) this.cur[i] = this.target[i];
      this.applyDiscrete();
    }
  }

  setParam(index: number, value: number): void {
    this.raw[index] = value;
    this.resolve();
  }

  setTempo(bpm: number): void {
    this.tempo = clamp(bpm, 20, 400);
  }

  /** Align the internal beat clock (used by the wobble) to a song position in beats. */
  syncBeat(beat: number): void {
    this.beatPos = beat - 4 * Math.floor(beat / 4);
  }

  pitchBend(v: number): void {
    this.bend = clamp(v, -1, 1);
  }

  /**
   * Solo / mute sound layers (osc1, osc2, sub, noise, breath, texture):
   * a listening aid, not part of the patch. With any solo, only soloed layers play.
   */
  setMonitor(solo: readonly string[], mute: readonly string[]): void {
    this.monitorSolo = solo;
    this.monitorMute = mute;
    this.resolve();
    if (!this.anyActive()) {
      // Nothing sounding: apply at once (no fade needed).
      this.cur.set(this.target);
      this.applyDiscrete();
      this.texMon = this.texMonTarget;
    }
  }

  /**
   * Target values = the patch, with switched-off blocks zeroed (and their mod
   * destinations blocked) and silenced layers turned down. Everything goes
   * through the usual smoothing, so switching never clicks.
   */
  private resolve(): void {
    const r = this.raw, t = this.target, m = this.dstMask;
    t.set(r);
    m.fill(1);
    const off = (flag: number) => r[flag] < 0.5;
    const zero = (...ix: number[]) => { for (const i of ix) t[i] = 0; };
    const block = (...ds: number[]) => { for (const d of ds) m[d] = 0; };
    if (off(P.fmOn)) { zero(P.fmAmount, P.fm2Amount); block(K.D_FM, K.D_FM2); }
    if (off(P.driveOn)) { zero(P.drive); block(K.D_DRIVE); }
    if (off(P.filterOn)) {
      // Wide open: a plain low-pass at the top of the range.
      t[P.cutoff] = 20000;
      t[P.fType] = K.FILTER_LP;
      zero(P.res, P.envAmt, P.keytrack, P.accent, P.vowel);
      block(K.D_CUTOFF, K.D_RES, K.D_VOWEL);
    }
    if (off(P.distOn)) { zero(P.dMix); block(K.D_DIST_MIX, K.D_DIST_DRIVE, K.D_DIST_TONE); }
    if (off(P.crushOn)) { zero(P.crushMix); block(K.D_CRUSH); }
    if (off(P.tapeOn)) { zero(P.tapeDrive, P.tapeWow, P.tapeAge); block(K.D_TAPE_WOW); }
    if (off(P.vibOn)) { zero(P.vibDepth); block(K.D_VIBRATO); }
    if (off(P.wobOn)) zero(P.wobDepth);
    for (const s of P.slots) if (off(P.modOn) || off(s.on)) t[s.amt] = 0;
    if (off(P.eqOn)) { zero(P.eqScale, ...P.eq.map((b) => b.type)); t[P.eqHighcut] = 20000; }
    if (off(P.chorusOn)) { zero(P.chorusMix); block(K.D_CHORUS_DEPTH); }
    if (off(P.flangerOn)) zero(P.flangerMix);
    if (off(P.phaserOn)) { zero(P.phaserMix); block(K.D_PHASER_MIX); }
    if (off(P.delayOn)) { zero(P.delayMix); block(K.D_DELAY_MIX, K.D_DELAY_TIME); }
    if (off(P.reverbOn)) { zero(P.reverbMix); block(K.D_REVERB_MIX); }

    const solo = this.monitorSolo, mute = this.monitorMute;
    const hear = (layer: string) => !mute.includes(layer) && (solo.length === 0 || solo.includes(layer));
    if (!hear('osc1')) { zero(P.osc[0].level); block(K.D_OSC1_LEVEL); }
    if (!hear('osc2')) { zero(P.osc[1].level); block(K.D_OSC2_LEVEL); }
    if (!hear('sub')) { zero(P.subLevel); block(K.D_SUB); }
    if (!hear('noise')) { zero(P.noise); block(K.D_NOISE); }
    // Tape age hisses on its own: with every layer of the oscillator path silent (e.g. the sub
    // soloed), the tape goes quiet too, so a solo only plays what it names.
    if (!hear('osc1') && !hear('osc2') && !hear('noise') && !hear('breath')) {
      zero(P.tapeDrive, P.tapeWow, P.tapeAge);
      block(K.D_TAPE_WOW);
    }
    this.texMonTarget = hear('texture') ? 1 : 0;
  }

  setModWheel(v: number): void {
    this.modWheel = clamp(v, 0, 1);
  }

  noteOn(note: number, velocity = 0.8): void {
    if (velocity <= 0) {
      this.noteOff(note);
      return;
    }
    if (this.poly <= 1) {
      this.removeFromStack(note);
      if (this.stackLen < this.stack.length) this.stack[this.stackLen++] = note;
      const v = this.voices[0];
      this.monoStart(note, velocity, v.gate);
      return;
    }
    // Poly: the same note again retriggers its voice; else a free voice; else steal
    // the oldest released voice, else the oldest held one.
    let pick: Voice | null = null;
    for (let i = 0; i < this.poly; i++) {
      const v = this.voices[i];
      if (v.gate && v.note === note) { pick = v; break; }
    }
    if (!pick) {
      for (let i = 0; i < this.poly; i++) {
        const v = this.voices[i];
        if (!v.active && v.tail === 0) { pick = v; break; }
      }
    }
    if (!pick) {
      let best: Voice | null = null;
      for (let i = 0; i < this.poly; i++) {
        const v = this.voices[i];
        if (!v.gate && (!best || v.order < best.order)) best = v;
      }
      if (!best) for (let i = 0; i < this.poly; i++) {
        const v = this.voices[i];
        if (!best || v.order < best.order) best = v;
      }
      pick = best;
    }
    if (!pick) return;
    const fresh = !pick.active;
    pick.start(note, velocity, false, true, ++this.order);
    this.onTrigger(velocity);
    if (fresh) {
      pick.beatPos = this.beatPos;
      pick.control(this.gsrc, this.bend, this.xdst);
    }
  }

  noteOff(note: number): void {
    if (this.poly <= 1) {
      const wasCurrent = this.stackLen > 0 && this.stack[this.stackLen - 1] === note;
      this.removeFromStack(note);
      if (!wasCurrent) return;
      if (this.stackLen > 0) this.monoStart(this.stack[this.stackLen - 1], this.voices[0].velocity, true);
      else this.voices[0].release();
      return;
    }
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = this.voices[i];
      if (v.gate && v.note === note) v.release();
    }
  }

  /** Mono note start: legato keeps the envelopes running; glide slides from the previous pitch. */
  private monoStart(note: number, velocity: number, overlapping: boolean): void {
    const legato = this.cur[P.legato] > 0.5;
    const glide = this.cur[P.glide] > 0.5;
    const v = this.voices[0];
    const retrigger = !(legato && overlapping);
    const fresh = !v.active;
    v.start(note, velocity, glide && !(legato && !overlapping), retrigger, ++this.order);
    if (retrigger) this.onTrigger(velocity);
    // A voice waking from silence gets its coefficients now, not at the next block.
    if (fresh) {
      v.beatPos = this.beatPos;
      v.control(this.gsrc, this.bend, this.xdst);
    }
  }

  /** A note (re)started its envelopes: retrigger LFOs that ask for it (fade-ins are per voice, see Voice). */
  private onTrigger(velocity = 1): void {
    this.texture.trigger(velocity);
    this.texGrind.noteOn();
    for (let l = 0; l < LFO_COUNT; l++) {
      if (this.cur[P.lfo[l].retrig] > 0.5) {
        this.lfoPhase[l] = 0;
        this.lfoPrev[l] = this.lfoHold[l];
        this.lfoHold[l] = this.rng.next();
      }
    }
  }

  allNotesOff(): void {
    this.stackLen = 0;
    for (const v of this.voices) v.release();
  }

  /** Stop everything and clear all DSP state (used after a fault). */
  panic(): void {
    this.allNotesOff();
    for (const v of this.voices) v.reset();
    for (let i = 0; i < 4; i++) {
      this.eqL[i].reset();
      this.eqR[i].reset();
    }
    for (let k = 0; k < 5; k++) {
      this.hpL[k].reset();
      this.hpR[k].reset();
    }
    for (let i = 0; i < 4; i++) this.xo[i].reset();
    for (let i = 0; i < 2; i++) this.xoPost[i].reset();
    this.chorus.reset();
    this.phaser.reset();
    this.reverb.reset();
    this.verbOct.reset();
    this.limiter.reset();
    this.postDcXL = this.postDcYL = this.postDcXR = this.postDcYR = 0;
    for (let i = 0; i < 2; i++) {
      this.dcL[i].reset();
      this.dcR[i].reset();
    }
    this.texture.reset();
    this.texEnv = this.texLpL = this.texLpR = 0;
    this.wobCycle = -1;
    this.wobGate = this.wobGateTarget = 1;
    for (const f of this.wobBand) for (const b of f) b.reset();
    this.wobScale = this.wobScaleTarget = 1;
    this.wobBright = this.wobBrightTarget = 0;
    this.hcL.reset();
    this.hcR.reset();
    this.flanger.reset();
    this.delay.reset();
  }

  private removeFromStack(note: number): void {
    let w = 0;
    for (let r = 0; r < this.stackLen; r++) if (this.stack[r] !== note) this.stack[w++] = this.stack[r];
    this.stackLen = w;
  }

  // ---------------------------------------------------------- control rate

  private applyDiscrete(): void {
    const poly = Math.max(1, Math.min(MAX_VOICES, Math.round(this.cur[P.poly])));
    if (poly !== this.poly) {
      // Switching modes: release everything that no longer belongs to the new mode.
      for (let i = poly <= 1 ? 1 : poly; i < MAX_VOICES; i++) this.voices[i].release();
      if (poly > 1) this.stackLen = 0;
      this.poly = poly;
    }
    for (const v of this.voices) v.applyDiscrete();
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
      if (!this.anyActive()) {
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

  /**
   * Next wander point: a real step (0.6-1.2 of the range) up or down from the
   * last one, reflected off ±1. Uniform random points often land close
   * together and the LFO hovers near the middle; this keeps it travelling
   * while never repeating.
   */
  private wanderStep(prev: number): number {
    let v = prev + (this.rng.next() < 0 ? -1 : 1) * (0.6 + 0.3 * (this.rng.next() + 1));
    if (v > 1) v = 2 - v;
    else if (v < -1) v = -2 - v;
    return v;
  }

  private lfoShape(shape: number, p: number, hold: number, prev: number): number {
    switch (shape) {
      case K.LFO_SINE: return Math.sin(TWO_PI * p);
      case K.LFO_TRI: return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
      case K.LFO_SAW_UP: return 2 * p - 1;
      case K.LFO_SAW_DOWN: return 1 - 2 * p;
      case K.LFO_SQUARE: return p < 0.5 ? 1 : -1;
      case K.LFO_SH: return hold;
      case K.LFO_WANDER: return prev + (hold - prev) * p * p * (3 - 2 * p); // smooth random: never repeats
      default: return 0;
    }
  }

  /** The mod wheel's move and the wobble, as offsets every voice adds to its mod matrix. */
  private extraModulation(): void {
    const cur = this.cur;
    const x = this.xdst;
    x.fill(0);
    const w = this.wheel;
    if (w > 1e-4) {
      const sel = Math.round(cur[P.wheelMove]);
      const move = K.WHEEL_MOVES[sel > 0 ? sel - 1 : Math.round(cur[P.wheelPreset])];
      for (const [d, a] of move) if (!this.wheelFrozen || !K.WHEEL_MOVING_DESTS.has(d)) x[d] += a * w;
    }
    const depth = cur[P.wobDepth];
    this.liveWob = -1;
    this.wobGateTarget = 1;
    this.wobFiltWas = this.wobFiltOn;
    this.wobFiltOn = false;
    this.liveWobFc = -1;
    if (depth > 1e-4) {
      // Locked to the bar.
      const cycle = K.WOBBLE_BEATS[Math.round(cur[P.wobRate])] ?? 0.5;
      const n = Math.floor(this.beatPos / cycle);
      const p = (this.beatPos - n * cycle) / cycle;
      this.liveWob = p;
      if (n !== this.wobCycle) {
        // Life: every cycle swings a little deeper or shallower and sits a little brighter or darker.
        this.wobCycle = n;
        const life = cur[P.wobLife];
        this.wobScaleTarget = 1 + 0.45 * life * this.wobRng.next();
        this.wobBrightTarget = 0.05 * life * this.wobRng.next();
      }
      // Glide to the new cycle's depth and brightness (~30 ms) so the change never steps.
      this.wobScale += (this.wobScaleTarget - this.wobScale) * 0.1;
      this.wobBright += (this.wobBrightTarget - this.wobBright) * 0.05;
      // The shape, shifted later in the cycle by the shift setting.
      let q = p - cur[P.wobPhase];
      q -= Math.floor(q);
      const shape = Math.round(cur[P.wobShape]);
      if (shape === K.WOB_RANDOM && this.wobRandCycle !== n) {
        // New steps every cycle, never repeating.
        this.wobRandCycle = n;
        for (let k = 0; k < WOB_RANDOM_STEPS; k++) this.wobRand[k] = 0.5 + 0.5 * this.wobRng.next();
      }
      let m = 0;
      if (shape === K.WOB_CUSTOM) {
        // Your own shape (points from the Wobbler page).
        m = Math.max(2, Math.min(WOB_MAX_POINTS, Math.round(cur[P.wobPts])));
        for (let k = 0; k < m; k++) {
          this.wobXs[k] = cur[P.wobX[k]];
          this.wobYs[k] = cur[P.wobY[k]];
          this.wobSs[k] = cur[P.wobS[k]] > 0.5 ? 1 : 0;
        }
      }
      this.wobShapeNow = shape;
      this.wobPtsNow = m;
      // Smooth (as in ShaperBox): the corners rounded in place, from a table rebuilt only when the
      // shape or the amount changes. Even at 0 a few ms of glide, so a jump never clicks.
      const r = wobSmoothRadius(cur[P.wobSmooth]);
      let target: number;
      if (r === 0) target = this.wobRaw(q);
      else {
        let sig = shape * 7919 + r * 104729 + m * 13;
        if (shape === K.WOB_RANDOM) sig += n * 1.618;
        for (let k = 0; k < m; k++) sig += this.wobXs[k] * (k + 1.31) * 3.7 + this.wobYs[k] * (k + 2.17) * 5.3 + this.wobSs[k] * (k + 3.1);
        if (sig !== this.wobSig) {
          this.wobSig = sig;
          wobSmoothTable(this.wobRawFn, r, this.wobTable, this.wobTmp);
        }
        target = wobTableAt(this.wobTable, q);
      }
      this.wobV += (target - this.wobV) * 0.35;
      const v = this.wobV;
      // Cutoff and volume, either or both: the Wobbler's own filter opens and shuts, the volume
      // only ducks (never louder).
      if (cur[P.wobCutoff] > 0.5) {
        // The classic wub, on the Wobbler's own filter (the main filter is never touched): a
        // 24 dB low-pass that opens wide where the shape is up and shuts towards the low cut
        // where it is down, with a resonant peak that grows with depth.
        const lc = cur[P.wobLowcut];
        const lo = lc > 21 ? lc : 60, hi = Math.min(18000, this.sampleRate * 0.45);
        const d = Math.min(1, depth * this.wobScale);
        const fc = Math.max(20, Math.min(hi, hi * Math.pow(lo / hi, d * (1 - v)) * Math.pow(2, 6 * this.wobBright)));
        const gT = Math.tan((Math.PI * fc) / this.sampleRate);
        if (!this.wobFiltWas) {
          this.wobG = gT;
          for (const sv of this.wobSvf) for (const f of sv) f.reset();
        }
        this.wobFiltOn = true;
        this.wobGStep = (gT - this.wobG) / BLOCK;
        this.wobK = 1.3 - 0.75 * d;
        this.liveWobFc = fc;
      }
      if (cur[P.wobVolume] > 0.5) {
        // A tempo-locked gate on the whole sound (sub, effects and tails too, as in ShaperBox):
        // full level where the shape is up, down to silence at full depth.
        this.wobGateTarget = 1 - Math.min(1, depth * this.wobScale) * (1 - v);
      }
    }
  }

  /**
   * One side through the Wobbler: what is above its low cut (all of it when the cut is off) goes
   * through its own low-pass (the Cutoff target) and its gate (the Volume target); below the cut
   * the sound passes as it is.
   */
  private wobSide(x: number, c: number, loOn: boolean, g: number, filt: boolean): number {
    const f = this.wobBand[c];
    let low = 0, mid = x;
    if (loOn) {
      low = f[1].process(f[0].process(x));
      mid = f[3].process(f[2].process(x));
    }
    if (filt) {
      const sv = this.wobSvf[c];
      sv[0].process(mid, this.wobG, this.wobK);
      sv[1].process(sv[0].lp, this.wobG, Math.SQRT2);
      mid = sv[1].lp;
    }
    return low + mid * g;
  }

  /** The wobble shape set up for this block, unsmoothed, at q (0..1). */
  private wobRaw(q: number): number {
    const shape = this.wobShapeNow;
    if (shape === K.WOB_RANDOM) return this.wobRand[Math.min(WOB_RANDOM_STEPS - 1, Math.floor(q * WOB_RANDOM_STEPS))];
    if (shape === K.WOB_CUSTOM) return wobShapeAt(this.wobXs, this.wobYs, this.wobSs, this.wobPtsNow, q);
    const t = WOB_TEMPLATE_ARRAYS[shape] ?? WOB_TEMPLATE_ARRAYS[0];
    return wobShapeAt(t.xs, t.ys, t.ss, t.n, q);
  }

  private control(): void {
    const fs = this.sampleRate;
    const cur = this.cur;
    this.smoothParams();

    // Shared mod sources (per-voice ones are filled in by each voice).
    const src = this.gsrc;
    src[0] = 0;
    // A switched-off LFO outputs nothing, wherever it's routed.
    src[K.SRC_LFO1] = this.lfoValue[0] * cur[P.lfoOn[0]];
    src[K.SRC_LFO2] = this.lfoValue[1] * cur[P.lfoOn[1]];
    src[K.SRC_LFO3] = this.lfoValue[2] * cur[P.lfoOn[2]];
    src[K.SRC_LFO4] = this.lfoValue[3] * cur[P.lfoOn[3]];
    this.wheel += (this.modWheel - this.wheel) * (1 - Math.exp(-BLOCK / (0.02 * fs)));
    src[K.SRC_MODWHEEL] = this.wheel;
    this.extraModulation();
    if (--this.driftCount <= 0) {
      this.driftTarget = this.rng.next();
      this.driftCount = Math.round(((0.4 + 1.2 * (0.5 + 0.5 * this.rng.next())) * fs) / BLOCK);
    }
    this.driftVal += (this.driftTarget - this.driftVal) * 0.004;
    src[K.SRC_DRIFT] = this.driftVal;
    src[K.SRC_PRODUCT] = src[K.SRC_LFO1] * src[K.SRC_LFO2];
    if (this.slowPos >= 1) {
      this.slowA = this.slowB;
      this.slowB = this.wanderStep(this.slowA);
      this.slowPos = 0;
      this.slowStep = BLOCK / ((2 + 4 * (0.5 + 0.5 * this.rng.next())) * fs);
    }
    this.slowPos += this.slowStep;
    {
      const t = this.slowPos > 1 ? 1 : this.slowPos;
      src[K.SRC_DRIFT_SLOW] = this.slowA + (this.slowB - this.slowA) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    }

    // Voices; find the newest one (its mod matrix drives the shared FX targets)
    // and, in poly mode, the lowest held note (only it carries the sub).
    let lead = this.voices[0];
    let lowest: Voice | null = null;
    let anyGate = false;
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = this.voices[i];
      if (v.order > lead.order) lead = v;
      if (v.gate) {
        anyGate = true;
        if (!lowest || v.note < lowest.note) lowest = v;
      }
      if (v.active || v.gate) {
        v.beatPos = this.beatPos;
        v.control(src, this.bend, this.xdst);
      }
    }
    this.anyGate = anyGate;
    this.liveCutoff = lead.active ? lead.fcNow : 0;
    for (let i = 0; i < 4; i++) this.liveGrind[i] = lead.active ? lead.grindFc(i) : -1;
    this.liveRes = lead.resNow;
    if (this.poly > 1) {
      for (let i = 0; i < MAX_VOICES; i++) {
        const v = this.voices[i];
        // Released voices keep their sub only if no held note is lower.
        v.subOn = lowest ? (v === lowest ? 1 : 0) : 1;
      }
    } else {
      this.voices[0].subOn = 1;
    }
    const dst = lead.dst;

    // LFOs (advance one control block).
    for (let l = 0; l < LFO_COUNT; l++) {
      const lp = P.lfo[l];
      const sync = cur[lp.sync];
      let rate = sync > 0 ? this.tempo / 60 / SYNC_BEATS[sync] : cur[lp.rate];
      const rm = dst[LFO_RATE_DEST[l]];
      if (rm !== 0) rate *= Math.pow(2, 3 * rm);
      let ph = this.lfoPhase[l] + (rate * BLOCK) / fs;
      if (ph >= 1) {
        ph -= Math.floor(ph);
        this.lfoPrev[l] = this.lfoHold[l];
        this.lfoHold[l] = cur[lp.shape] === K.LFO_WANDER ? this.wanderStep(this.lfoHold[l]) : this.rng.next();
      }
      this.lfoPhase[l] = ph;
      this.lfoValue[l] = this.lfoShape(cur[lp.shape], ph, this.lfoHold[l], this.lfoPrev[l]);
    }

    // Texture bed.
    // (breath is one of the bed's types; the matrix's Breath destination moves it like Texture)
    const tex = clamp(cur[P.texLevel] + dst[K.D_TEXTURE] + (cur[P.texType] === K.TEX_BREATH ? dst[K.D_BREATH] : 0), 0, 1);
    this.texGain = tex * tex * TEXTURE_GAIN;
    this.texType = cur[P.texType];
    this.texTone = clamp(cur[P.texTone], 0, 1);
    this.texDensity = clamp(cur[P.texDensity], 0, 1);
    // Its speed (octaves): OCT, plus with KEY on the newest note's glided pitch and the bend from
    // middle C, as a sample played across the keyboard, plus the matrix's Noise pitch (±6 octaves
    // at full amount: Env 3 for a tape stop on every note, an LFO for a roar-to-fizz swing); always within -6..+2.
    const texOct = Math.round(cur[P.texOct]) + (cur[P.texKey] > 0.5 ? (lead.pitch + 12 * cur[P.octave] + 2 * this.bend - 60) / 12 : 0) + 6 * dst[K.D_NOISE_PITCH];
    this.texRate = Math.pow(2, clamp(texOct, -6, 2));
    // The bed swells in with the note: never faster than ~a third of the amp attack.
    this.texAtk = 1 - Math.exp(-1 / (Math.max(0.03, cur[P.amp[0]] / 3000) * fs));
    this.texRel = Math.exp(-4.6 / ((cur[P.texTail] / 1000) * fs));
    // breath is a puff per note: Tail is how long it lasts
    this.texture.puffLen = cur[P.texTail] / 1000;
    this.texLpCoef = lead.tapeLpCoef;
    {
      const [kind, p24] = AUX_SLOT[cur[P.texFType]] ?? AUX_SLOT[0];
      let hz = cur[P.texFCut];
      if (cur[P.texFKey] > 0.5) hz *= Math.pow(2, (lead.pitch + 12 * cur[P.octave] - K.KEYTRACK_CENTER) / 12);
      this.texF.set(kind, p24, hz, fs);
    }
    // Direct out wins: a bed on its own clean path never goes through the filter copy.
    const routeN = cur[P.routeN] > 0.5 && cur[P.texDirect] < 0.5;
    if (routeN && !this.texRouteN) {
      this.texNL.reset();
      this.texNR.reset();
    }
    this.texRouteN = routeN;
    if (routeN) {
      // A copy of the main filter that follows the newest note (the bed is shared by all voices).
      this.texNG = Math.tan((Math.PI * Math.min(lead.fcNow, fs * 0.45)) / fs);
      this.texNK = 2 - 1.85 * lead.resNow;
      const t = Math.round(cur[P.fType]);
      this.texNMode = t === K.FILTER_BP || t === 2 ? 1 : t === K.FILTER_NOTCH ? 2 : 0;
    }
    const pan = cur[P.texPan];
    this.texPanOn = pan !== 0;
    if (this.texPanOn) {
      const a = ((pan + 1) * Math.PI) / 4;
      this.texPanL = Math.cos(a) * Math.SQRT2;
      this.texPanR = Math.sin(a) * Math.SQRT2;
    }
    this.texDirect = cur[P.texDirect] > 0.5;
    // the bed goes through GRIND too, unless it is on its own clean path
    const tg = cur[P.grindOn] > 0.5 && !this.texDirect;
    if (tg && !this.texGrindOn) this.texGrind.reset();
    this.texGrindOn = tg;
    if (tg) this.texGrind.control(cur, this.beatPos, fs, fs, BLOCK, this.rng);

    // The bar clock (the wobble locks to it).
    this.beatPos += (this.tempo / 60) * (BLOCK / fs);
    if (this.beatPos >= 4) this.beatPos -= 4;

    // Delay. Modulating the delay time glides the read head (tape-style pitch smear on the repeats).
    this.delaySeconds = Math.min(3, ((DELAY_BEATS[cur[P.delayTime]] * 60) / this.tempo) * Math.pow(2, clamp(dst[K.D_DELAY_TIME], -1, 1)));
    this.delayToneCoef = 1 - Math.exp((-TWO_PI * Math.min(800 * Math.pow(20, cur[P.delayTone]), fs * 0.45)) / fs);

    // Modulated FX amounts.
    this.chorusDepth = clamp(cur[P.chorusDepth] + dst[K.D_CHORUS_DEPTH], 0, 1);
    this.phaserMix = clamp(cur[P.phaserMix] + dst[K.D_PHASER_MIX], 0, 1);
    this.delayMix = clamp(cur[P.delayMix] + dst[K.D_DELAY_MIX], 0, 1);
    this.reverbMix = clamp(cur[P.reverbMix] + dst[K.D_REVERB_MIX], 0, 1);
    this.widthTarget = clamp(1 + dst[K.D_WIDTH], 0, 2);
    this.widthStep = (this.widthTarget - this.width) / BLOCK;

    // FX filters: only recompute coefficients when values move.
    const lf = this.lastFx;
    for (let k = 0; k < 5; k++) {
      const lowcut = cur[P.fxLowcut[k]];
      if (lowcut !== this.lastLowcut[k]) {
        this.hpL[k].setHighpass(lowcut, Math.SQRT1_2, fs);
        this.hpR[k].setHighpass(lowcut, Math.SQRT1_2, fs);
        this.lastLowcut[k] = lowcut;
      }
    }
    // EQ: four bands (type 0 = shelf / bell, 1 = pass / notch), every gain scaled by eq.scale
    for (let b = 0; b < 4; b++) {
      const e = P.eq[b], el = this.eqLast, o = 4 * b;
      const type = cur[e.type], hz = Math.min(cur[e.freq], fs * 0.45), db = cur[e.gain] * cur[P.eqScale], q = cur[e.q];
      this.eqOn[b] = type > 0.5 || Math.abs(db) > 0.01 ? 1 : 0;
      if (!this.eqOn[b] || (el[o] === type && el[o + 1] === hz && el[o + 2] === db && el[o + 3] === q)) continue;
      el[o] = type;
      el[o + 1] = hz;
      el[o + 2] = db;
      el[o + 3] = q;
      for (const f of [this.eqL[b], this.eqR[b]]) {
        if (b === 0) type > 0.5 ? f.setHighpass(hz, q, fs) : f.setLowShelf(hz, db, fs, q);
        else if (b === 3) type > 0.5 ? f.setLowpass(hz, q, fs) : f.setHighShelf(hz, db, fs, q);
        else type > 0.5 ? f.setNotch(hz, q, fs) : f.setPeak(hz, db, q, fs);
      }
    }
    if (cur[P.crossover] !== lf[5]) {
      // 8th-order Butterworth high-pass on the side channel (48 dB/oct).
      for (let i = 0; i < 4; i++) this.xo[i].setHighpass(cur[P.crossover], XO_Q[i], fs);
      for (let i = 0; i < 2; i++) this.xoPost[i].setHighpass(cur[P.crossover], SUBSONIC_Q[i], fs);
      lf[5] = cur[P.crossover];
    }
    if (cur[P.eqHighcut] !== lf[6]) {
      const hc = cur[P.eqHighcut];
      this.highcutOn = hc < 19500;
      if (this.highcutOn) {
        this.hcL.setLowpass(Math.min(hc, fs * 0.45), Math.SQRT1_2, fs);
        this.hcR.setLowpass(Math.min(hc, fs * 0.45), Math.SQRT1_2, fs);
      }
      lf[6] = hc;
    }
    if (cur[P.outGain] !== this.lastOutDb) {
      this.outTarget = Math.pow(10, cur[P.outGain] / 20);
      this.lastOutDb = cur[P.outGain];
    }
    this.outGainStep = (this.outTarget - this.outGain) / BLOCK;
  }

  // ------------------------------------------------------------ audio rate

  /**
   * Render `frames` samples into outL/outR starting at `offset`.
   * Allocation-free; safe to call from the audio thread.
   */
  render(outL: Float32Array, outR: Float32Array, offset: number, frames: number): void {
    const end = offset + frames;
    const out = this.tmp;
    const vout = this.vout;
    const cur = this.cur;
    const voices = this.voices;
    let peak = this.peak;

    for (let n = offset; n < end; n++) {
      if (this.ctrlCount === 0) {
        this.control();
        this.ctrlCount = BLOCK;
      }
      this.ctrlCount--;

      // Discrete-parameter duck (fade out → switch → fade in).
      if (this.duckDir < 0) {
        this.duckGain -= this.duckStep;
        if (this.duckGain <= 0) {
          this.duckGain = 0;
          this.copyDiscrete();
          this.duckDir = 1;
          this.duckHold = 2 * OVERSAMPLE_LATENCY + 8;
        }
      } else if (this.duckHold > 0) {
        this.duckHold--;
      } else if (this.duckDir > 0) {
        this.duckGain += this.duckStep;
        if (this.duckGain >= 1) {
          this.duckGain = 1;
          this.duckDir = 0;
        }
      }

      let l = 0;
      let r = 0;
      // The sub's own path: only what's in the Sub box touches it (no dynamics, effects or EQ).
      let sub = 0;
      this.outGain += this.outGainStep;
      for (let i = 0; i < MAX_VOICES; i++) {
        const v = voices[i];
        if (v.ampEnv.stage !== 0 || v.tail > 0) {
          v.render(this.duckGain, vout);
          l += vout[0];
          r += vout[1];
          sub += vout[2];
        }
      }

      if (this.texMon !== this.texMonTarget) {
        const k = 1 / (0.005 * this.sampleRate);
        this.texMon += Math.max(-k, Math.min(k, this.texMonTarget - this.texMon));
      }
      let texL = 0, texR = 0;
      // Texture bed (swells in with the notes, lingers for its tail, silent otherwise).
      if (this.texGain > 0 && (this.anyGate || this.texEnv > 1e-5)) {
        this.texEnv = this.anyGate ? this.texEnv + (1 - this.texEnv) * this.texAtk : this.texEnv * this.texRel;
        // Octave: run the bed at 2^oct of the sample rate (its filters and pulses scale with it, as on
        // tape) and read it back with linear interpolation (slower also loses a little top: darker).
        this.texPos += this.texRate;
        while (this.texPos >= 1) {
          this.texPos -= 1;
          this.texture.process(this.texType, this.texTone, this.texDensity, this.sampleRate, out);
          this.texPrev[0] = this.texCur[0];
          this.texPrev[1] = this.texCur[1];
          this.texCur[0] = out[0];
          this.texCur[1] = out[1];
        }
        const tf = this.texPos;
        let tl = this.texPrev[0] + (this.texCur[0] - this.texPrev[0]) * tf, tr = this.texPrev[1] + (this.texCur[1] - this.texPrev[1]) * tf;
        if (cur[P.tapeAge] > 0) {
          // Worn tape dulls the texture the same way it dulls the voice.
          this.texLpL += (tl - this.texLpL) * this.texLpCoef;
          this.texLpR += (tr - this.texLpR) * this.texLpCoef;
          tl = this.texLpL;
          tr = this.texLpR;
        }
        if (this.texF.active) {
          tl = this.texF.process(tl, 0);
          tr = this.texF.process(tr, 1);
        }
        if (this.texRouteN) {
          const g = this.texNG, k = this.texNK;
          this.texNL.process(tl, g, k);
          this.texNR.process(tr, g, k);
          const m = this.texNMode;
          tl = m === 1 ? this.texNL.bp : m === 2 ? this.texNL.lp + this.texNL.hp : this.texNL.lp;
          tr = m === 1 ? this.texNR.bp : m === 2 ? this.texNR.lp + this.texNR.hp : this.texNR.lp;
        }
        if (this.texPanOn) {
          tl *= this.texPanL;
          tr *= this.texPanR;
        }
        const tg = this.texGain * this.texEnv * this.duckGain * this.texMon;
        texL = tl * tg;
        texR = tr * tg;
      } else if (!this.anyGate) {
        this.texEnv = 0;
      }
      // Direct out: the bed joins the clean sub after every effect.
      const texDirect = this.texDirect;
      if (!texDirect) {
        if (this.texGrindOn) {
          this.texGrind.process(texL, texR);
          texL = this.texGrind.l;
          texR = this.texGrind.r;
        }
        l += texL;
        r += texR;
      }

      // Effects, each only on what is above its own low cut (the part below passes dry).
      const hpL = this.hpL, hpR = this.hpR;
      const cMix = cur[P.chorusMix];
      if (cMix > 1e-4) {
        const hl = hpL[0].process(l), hr = hpR[0].process(r);
        this.chorus.process(hl, hr, cMix, this.chorusDepth, out, cur[P.chorusMode] > 0.5);
        l += out[0] - hl;
        r += out[1] - hr;
      }
      const fMix = cur[P.flangerMix];
      if (fMix > 1e-4) {
        const hl = hpL[1].process(l), hr = hpR[1].process(r);
        this.flanger.process(hl, hr, fMix, cur[P.flangerRate], cur[P.flangerFb], out);
        l += out[0] - hl;
        r += out[1] - hr;
      }
      const pMix = this.phaserMix;
      if (pMix > 1e-4) {
        const hl = hpL[2].process(l), hr = hpR[2].process(r);
        this.phaser.process(hl, hr, pMix, cur[P.phaserRate], out);
        l += out[0] - hl;
        r += out[1] - hr;
      }
      const dMix = this.delayMix;
      if (dMix > 1e-4) {
        this.delay.process(hpL[3].process(l), hpR[3].process(r), this.delaySeconds, cur[P.delayFb], this.delayToneCoef, out);
        l += out[0] * dMix;
        r += out[1] * dMix;
      }
      const rMix = this.reverbMix;
      if (rMix > 1e-4) {
        let vin: number;
        if (cur[P.reverbOct] < -0.5) {
          // an octave down first, then the Lo cut, so the deeper cloud still stays off the low end
          const sh = this.verbOct.process(0.5 * (l + r));
          vin = 0.5 * (hpL[4].process(sh) + hpR[4].process(sh));
        } else vin = 0.5 * (hpL[4].process(l) + hpR[4].process(r));
        this.reverb.process(vin, cur[P.reverbType], cur[P.reverbDecay], cur[P.reverbPre], out);
        l += out[0] * rMix;
        r += out[1] * rMix;
      }

      // EQ (bands at 0 dB are skipped) and high cut.
      for (let b = 0; b < 4; b++) {
        if (this.eqOn[b]) {
          l = this.eqL[b].process(l);
          r = this.eqR[b].process(r);
        }
      }
      if (this.highcutOn) {
        l = this.hcL.process(l);
        r = this.hcR.process(r);
      }

      // The clean sub joins here, after every effect, before the output's safety stages.
      l += sub;
      r += sub;
      if (texDirect) {
        l += texL;
        r += texR;
      }

      // LFO 5 on the volume: the gate, ~2 ms per step.
      if (this.wobFiltOn || this.wobGate !== 1 || this.wobGateTarget !== 1) {
        this.wobGate += (this.wobGateTarget - this.wobGate) * 0.02;
        this.wobG += this.wobGStep;
        if (Math.abs(this.wobGate - 1) < 1e-6 && this.wobGateTarget === 1) this.wobGate = 1;
        // Only what is above the low cut is wobbled: below it the sound stays steady. A 24 dB/oct
        // Linkwitz-Riley split (as in multiband plugins), so the cut is clean.
        const lc = cur[P.wobLowcut], loOn = lc > 21;
        if (lc !== this.wobBandLc) {
          this.wobBandLc = lc;
          const fs = this.sampleRate, q = Math.SQRT1_2;
          if (loOn) for (const f of this.wobBand) for (let k = 0; k < 2; k++) {
            f[k].setLowpass(lc, q, fs);
            f[2 + k].setHighpass(lc, q, fs);
          }
        }
        l = this.wobSide(l, 0, loOn, this.wobGate, this.wobFiltOn);
        r = this.wobSide(r, 1, loOn, this.wobGate, this.wobFiltOn);
      }

      // Subsonic / DC filter.
      l = this.dcL[1].process(this.dcL[0].process(l));
      r = this.dcR[1].process(this.dcR[0].process(r));

      // Mono below the crossover: keep the mid intact, high-pass the side.
      const m = 0.5 * (l + r);
      const xo = this.xo;
      // Stereo width (mod target) scales the side, which is already above the crossover.
      this.width += this.widthStep;
      const s = this.width * xo[3].process(xo[2].process(xo[1].process(xo[0].process(0.5 * (l - r)))));
      l = (m + s) * this.outGain;
      r = (m - s) * this.outGain;

      // Fault guard: never let NaN/Inf reach the output.
      if (!(Math.abs(l) < 1e6) || !(Math.abs(r) < 1e6)) {
        this.panic();
        l = r = 0;
      }

      this.limiter.process(l, r, out);
      {
        const pm = 0.5 * (out[0] + out[1]);
        const ps = this.xoPost[1].process(this.xoPost[0].process(0.5 * (out[0] - out[1])));
        out[0] = pm + ps;
        out[1] = pm - ps;
      }
      // Final DC filter (5 Hz one-pole): removes the near-DC intermodulation a
      // limiter produces under heavy gain reduction. It shifts peaks by well
      // under 0.1%; the clamp keeps the ceiling an absolute guarantee.
      const c = this.limiter.ceiling;
      let yl = out[0] - this.postDcXL + this.postDcR * this.postDcYL;
      this.postDcXL = out[0];
      this.postDcYL = yl;
      let yr = out[1] - this.postDcXR + this.postDcR * this.postDcYR;
      this.postDcXR = out[1];
      this.postDcYR = yr;
      yl = yl > c ? c : yl < -c ? -c : yl;
      yr = yr > c ? c : yr < -c ? -c : yr;
      outL[n] = yl;
      outR[n] = yr;
      const a = Math.abs(yl) > Math.abs(yr) ? Math.abs(yl) : Math.abs(yr);
      if (a > peak) peak = a;
    }
    this.peak = peak;
  }

  /** True when every voice is silent. */
  get idle(): boolean {
    return !this.anyActive();
  }

  /** Number of held notes (for UI). */
  get heldNotes(): number {
    if (this.poly <= 1) return this.stackLen;
    let n = 0;
    for (const v of this.voices) if (v.gate) n++;
    return n;
  }
}
