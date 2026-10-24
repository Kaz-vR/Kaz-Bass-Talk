// Engine constants shared by the voice and the synth: parameter indices,
// enum option indices, mod matrix sources/destinations, gain staging.
// Enum indices must match the option order in data/schema.json.

import { getParam, paramIndex } from '../../schema';
import { fastTanh } from './dsp';
import { FRAMES_PER_SEGMENT } from './wavetable';

/** Samples per control-rate update (modulation, smoothing, coefficients). */
export const CONTROL_BLOCK = 16;
export const MAX_UNISON = 7;
export const DUCK_MS = 3;
export const SMOOTH_MS = 15;
export const LIMITER_CEILING_DB = -1;
export const SUBSONIC_HZ = 15;
export const SUBSONIC_Q = [0.5412, 1.3066]; // 4th-order Butterworth
export const VOICE_DC_HZ = 8;
export const OS = 2; // oversampling factor of the nonlinear section
// Section Qs of an 8th-order Butterworth filter.
export const XO_Q = [0.5098, 0.6013, 0.9000, 2.5629];
export const SAW_FRAME = 2 * FRAMES_PER_SEGMENT; // keyframe 2 of the morph table is a pure saw
/** texture.type option index of breath (the Noise strip's per-note breath instead of a bed). */
export const TEX_BREATH = 4;
export const KEYTRACK_CENTER = 48; // C3: filter.cutoff is the actual cutoff at this note

// Gain staging.
export const PRE_FILTER_GAIN = 0.5;
export const POST_FILTER_GAIN = 1.6;
export const VOICE_GAIN = 0.55;
export const SUB_GAIN = 0.55;

// Enum option indices (must match data/schema.json order).
export const WAVE_SINE = 0, WAVE_TRI = 1, WAVE_SAW = 2, WAVE_PULSE = 3, WAVE_PWMSAW = 5, WAVE_STRING = 6, WAVE_SHEPARD = 7; // 4 = wavetable
export const FILTER_LP = 0, FILTER_BP = 1, FILTER_DIODE = 3, FILTER_NOTCH = 4, FILTER_COMB = 5, FILTER_LPG = 6; // 2 = formant
export const DIST_SOFT = 0, DIST_HARD = 1, DIST_FOLD = 2; // 3 = tube
export const TUBE_BIAS = 0.4;
export const TUBE_OFFSET = Math.tanh(TUBE_BIAS);
export const HALF_PI = Math.PI / 2;

/** Antiderivative of fastTanh: x²/18 + (4/3)·ln(x² + 3) inside ±3, linear outside. */
export const TANH_INT_3 = 9 / 18 + (4 / 3) * Math.log(12);
export function tanhIntegral(x: number): number {
  if (x > 3) return TANH_INT_3 + (x - 3);
  if (x < -3) return TANH_INT_3 + (-x - 3);
  const x2 = x * x;
  return x2 / 18 + (4 / 3) * Math.log(x2 + 3);
}
export const LFO_SINE = 0, LFO_TRI = 1, LFO_SAW_UP = 2, LFO_SAW_DOWN = 3, LFO_SQUARE = 4, LFO_SH = 5, LFO_WANDER = 6;
export const LFO_COUNT = 4;
export const SLOT_COUNT = 12;
export const SYNC_BEATS = [0, 16, 8, 4, 2, 3, 1, 1.5, 2 / 3, 0.5, 0.75, 1 / 3, 0.25, 0.375, 1 / 6, 0.125];
export const DELAY_BEATS = [0.125, 1 / 6, 0.25, 0.375, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2, 3, 4];

// Mod matrix sources / destinations (schema option order).
export const SRC_LFO1 = 1, SRC_LFO2 = 2, SRC_MOD_ENV = 3, SRC_AMP_ENV = 4, SRC_VEL = 5, SRC_KEY = 6, SRC_MODWHEEL = 7, SRC_RANDOM = 8,
  SRC_DRIFT = 9, SRC_PRODUCT = 10, SRC_LFO3 = 11, SRC_LFO4 = 12, SRC_DRIFT_SLOW = 13, SRC_ENV2 = 14, SRC_ENV3 = 15;
export const SRC_COUNT = 16;
export const D_PITCH = 1, D_OSC1_PITCH = 2, D_OSC2_PITCH = 3, D_OSC1_WT = 4, D_OSC2_WT = 5, D_OSC1_PW = 6, D_OSC2_PW = 7,
  D_OSC1_LEVEL = 8, D_OSC2_LEVEL = 9, D_DETUNE = 10, D_FM = 11, D_SUB = 12, D_NOISE = 13, D_DRIVE = 14,
  D_CUTOFF = 15, D_RES = 16, D_VOWEL = 17, D_DIST_DRIVE = 18, D_DIST_MIX = 19, D_AMP = 20, D_LFO1_RATE = 21, D_LFO2_RATE = 22,
  D_FM2 = 23, D_CRUSH = 24, D_LFO3_RATE = 25, D_LFO4_RATE = 26, D_CHORUS_DEPTH = 27, D_PHASER_MIX = 28,
  D_DELAY_TIME = 29, D_DELAY_MIX = 30, D_REVERB_MIX = 31, D_WIDTH = 32, D_TAPE_WOW = 33, D_DIST_TONE = 34, D_TEXTURE = 35,
  D_VIBRATO = 36, D_BREATH = 37, D_OSC_PITCH = 38;
export const DEST_COUNT = 39;
export const TEXTURE_GAIN = 0.5;

/** Beats in a wobble.rate option: 1/8, 1/8T (triplet), 1/8d (dotted), 3/4, 1 Bar, 1.5 Bars … (a bar = 4 beats). */
export function wobRateBeats(v: string): number {
  const bars = /^([\d.]+) Bars?$/.exec(v);
  if (bars) return 4 * Number(bars[1]);
  const m = /^(\d+)\/(\d+)([dT]?)$/.exec(v);
  if (!m) return 0.5;
  const b = (4 * Number(m[1])) / Number(m[2]);
  return m[3] === 'd' ? b * 1.5 : m[3] === 'T' ? (b * 2) / 3 : b;
}
/** Beats per wobble cycle, by wobble.rate option. */
export const WOBBLE_BEATS = getParam('wobble.rate')!.options!.map(wobRateBeats);
/** The wobbler's shapes, by wobble.shape option. */
export const WOB_SHAPES = ['saw down', 'sine', 'duck', 'square', 'sync gate', 'staircase', 'random', 'custom'];
export const WOB_RANDOM = 6, WOB_CUSTOM = 7;

/**
 * Mod wheel moves (wheel.preset option order): what a fully raised wheel adds
 * to each mod destination, in mod-matrix units (cutoff 1 = 6 octaves, pitch
 * 1 = 24 semitones, amp 1 = double level, the rest 0..1 of their range).
 * Several connected things move together, like an instrument played harder.
 */
/**
 * Wheel-move destinations that add motion, noise or space rather than a
 * static change of tone. The analysis's frozen probe (aliasing, whistle)
 * leaves them out, the same way it switches off vibrato, breath and texture.
 */
export const WHEEL_MOVING_DESTS = new Set([
  D_NOISE, D_BREATH, D_VIBRATO, D_TAPE_WOW, D_DETUNE, D_TEXTURE, D_CRUSH, D_PITCH, D_OSC_PITCH, D_LFO2_RATE, D_CHORUS_DEPTH, D_REVERB_MIX,
  D_DELAY_MIX, D_WIDTH,
]);

export const WHEEL_MOVES: [dest: number, amount: number][][] = [
  // pressure: louder, brighter, grittier, a little breath and sharpness
  [[D_AMP, 0.2], [D_CUTOFF, 0.22], [D_DRIVE, 0.25], [D_NOISE, 0.04], [D_BREATH, 0.12], [D_OSC_PITCH, 0.0008]],
  // snarl: distortion, resonance and bite
  [[D_DIST_DRIVE, 0.4], [D_DRIVE, 0.3], [D_RES, 0.22], [D_DIST_TONE, 0.15], [D_CUTOFF, 0.08], [D_AMP, -0.15]],
  // open: light comes in
  [[D_CUTOFF, 0.42], [D_DIST_TONE, 0.15], [D_RES, 0.05], [D_WIDTH, 0.15]],
  // choke: darker, tighter, drier, narrower
  [[D_CUTOFF, -0.26], [D_WIDTH, -0.5], [D_REVERB_MIX, -0.2], [D_DELAY_MIX, -0.15], [D_RES, 0.1], [D_AMP, -0.1]],
  // vibrato: a human vibrato, with a breath of air
  [[D_VIBRATO, 0.4], [D_BREATH, 0.05], [D_CUTOFF, 0.03]],
  // unstable: a dying machine
  [[D_TAPE_WOW, 0.6], [D_DETUNE, 0.15], [D_CHORUS_DEPTH, 0.3], [D_OSC_PITCH, -0.002], [D_LFO2_RATE, 0.3]],
  // decay: the sound falls apart
  [[D_TAPE_WOW, 0.3], [D_CRUSH, 0.35], [D_DIST_TONE, -0.15], [D_CUTOFF, -0.12]],
  // bloom: it drifts away
  [[D_REVERB_MIX, 0.45], [D_DELAY_MIX, 0.3], [D_WIDTH, 0.45], [D_CHORUS_DEPTH, 0.3], [D_AMP, -0.2]],
];
export const LFO_RATE_DEST = [D_LFO1_RATE, D_LFO2_RATE, D_LFO3_RATE, D_LFO4_RATE];

// Formant table (Hz) for vowels A E I O U: F1, F2, F3.
export const VOWELS = [
  [730, 1090, 2440],
  [530, 1840, 2480],
  [270, 2290, 3010],
  [570, 840, 2410],
  [300, 870, 2240],
];
export const FORMANT_GAIN = [1, 0.5, 0.25];

// Module-local bindings: avoids live-binding getter overhead on hot paths in
// some module transforms (tsx / vite-node).
export const tanh = fastTanh;

export const ix = paramIndex;
export const P = {
  legato: ix('voice.legato'), glide: ix('voice.glide'), octave: ix('voice.octave'), velocity: ix('voice.velocity'), analog: ix('voice.analog'),
  osc: [1, 2].map((n) => ({
    wave: ix(`osc${n}.wave`), semi: ix(`osc${n}.semi`), fine: ix(`osc${n}.fine`), pw: ix(`osc${n}.pulse_width`),
    wt: ix(`osc${n}.wt_pos`), voices: ix(`osc${n}.unison_voices`), detune: ix(`osc${n}.unison_detune`),
    spread: ix(`osc${n}.unison_spread`), level: ix(`osc${n}.level`), hp: ix(`osc${n}.highpass`),
    fType: ix(`osc${n}.filter_type`), fKey: ix(`osc${n}.filter_key`),
  })),
  fmAmount: ix('fm.amount'), fmRatio: ix('fm.ratio'), fmPunch: ix('fm.punch'), fmDecay: ix('fm.decay'), fmFb: ix('fm.feedback'),
  fm2Amount: ix('fm2.amount'), fm2Ratio: ix('fm2.ratio'), fmAlgo: ix('fm.algorithm'),
  strTone: ix('string.tone'), strDecay: ix('string.decay'), shepRate: ix('shepard.rate'),
  accent: ix('filter.accent'), ampCurve: ix('amp_env.attack_curve'), chorusMode: ix('chorus.mode'),
  subWave: ix('sub.wave'), subOct: ix('sub.octave'), subLevel: ix('sub.level'), subClip: ix('sub.clip'), midClip: ix('clip.mid'),
  subFType: ix('sub.filter_type'), subFCut: ix('sub.filter_cutoff'), subFKey: ix('sub.filter_key'), subDirect: ix('sub.direct'),
  texPan: ix('texture.pan'), texDirect: ix('texture.direct'), texFType: ix('texture.filter_type'), texFCut: ix('texture.filter_cutoff'), texFKey: ix('texture.filter_key'),
  routeA: ix('filter.route_a'), routeB: ix('filter.route_b'), routeN: ix('filter.route_n'), routeS: ix('filter.route_s'), postCut: ix('clip.low_cut'), fMix: ix('filter.mix'),
  noise: ix('noise.level'), drive: ix('drive.amount'),
  texType: ix('texture.type'), texLevel: ix('texture.level'), texTone: ix('texture.tone'), texChar: ix('texture.character'), texTail: ix('texture.tail'),
  fType: ix('filter.type'), cutoff: ix('filter.cutoff'), res: ix('filter.resonance'), keytrack: ix('filter.keytrack'),
  envAmt: ix('filter.env_amount'), modEnvOn: ix('mod_env.on'), vowel: ix('filter.vowel'),
  dType: ix('dist.type'), dDrive: ix('dist.drive'), dMix: ix('dist.mix'), dTone: ix('dist.post_tone'), dSplit: ix('dist.clean_below'),
  crushMix: ix('crush.mix'), crushBits: ix('crush.bits'), crushRate: ix('crush.rate'), crushLowcut: ix('crush.lowcut'), tapeLowcut: ix('tape.lowcut'),
  tapeDrive: ix('tape.drive'), tapeWow: ix('tape.wow'), tapeAge: ix('tape.age'),
  osc2Sync: ix('osc2.sync'),
  fmOn: ix('fm.on'), driveOn: ix('drive.on'), filterOn: ix('filter.on'), distOn: ix('dist.on'), crushOn: ix('crush.on'),
  tapeOn: ix('tape.on'), vibOn: ix('vibrato.on'), lfoOn: [1, 2, 3, 4].map((n) => ix(`lfo${n}.on`)), env2On: ix('env2.on'), env3On: ix('env3.on'), wobOn: ix('wobble.on'),
  modOn: ix('mod.on'), eqOn: ix('eq.on'), chorusOn: ix('chorus.on'), flangerOn: ix('flanger.on'),
  phaserOn: ix('phaser.on'), delayOn: ix('delay.on'), reverbOn: ix('reverb.on'),
  wheelMove: ix('wheel.move'), wheelPreset: ix('wheel.preset'),
  wobDepth: ix('wobble.depth'), wobRate: ix('wobble.rate'), wobCutoff: ix('wobble.cutoff'), wobVolume: ix('wobble.volume'), wobShape: ix('wobble.shape'), wobLife: ix('wobble.life'), wobPts: ix('wobble.points'), wobPhase: ix('wobble.phase'), wobSmooth: ix('wobble.smooth'), wobLowcut: ix('wobble.lowcut'),
  wobX: Array.from({ length: 12 }, (_, i) => ix(`wobble.x${i + 1}`)), wobY: Array.from({ length: 12 }, (_, i) => ix(`wobble.y${i + 1}`)), wobS: Array.from({ length: 12 }, (_, i) => ix(`wobble.s${i + 1}`)),
  flangerMix: ix('flanger.mix'), flangerRate: ix('flanger.rate'), flangerFb: ix('flanger.feedback'),
  delayMix: ix('delay.mix'), delayTime: ix('delay.time'), delayFb: ix('delay.feedback'), delayTone: ix('delay.tone'),
  reverbTone: ix('reverb.tone'), eqHighcut: ix('eq.highcut'),
  amp: [ix('amp_env.attack'), ix('amp_env.decay'), ix('amp_env.sustain'), ix('amp_env.release')],
  mod: [ix('mod_env.attack'), ix('mod_env.decay'), ix('mod_env.sustain'), ix('mod_env.release')],
  env3: ['attack', 'decay', 'sustain', 'release'].map((s) => ix(`env3.${s}`)),
  vibDepth: ix('vibrato.depth'), vibRate: ix('vibrato.rate'), vibDelay: ix('vibrato.delay'), vibFade: ix('vibrato.fade'),

  lfo: [1, 2, 3, 4].map((n) => ({
    shape: ix(`lfo${n}.shape`), rate: ix(`lfo${n}.rate`), sync: ix(`lfo${n}.sync`), retrig: ix(`lfo${n}.retrigger`), fade: ix(`lfo${n}.fade`),
  })),
  env2: [ix('env2.attack'), ix('env2.decay'), ix('env2.sustain'), ix('env2.release')],
  slots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => ({ src: ix(`mod${n}.source`), dst: ix(`mod${n}.dest`), amt: ix(`mod${n}.amount`), on: ix(`mod${n}.on`) })),
  chorusMix: ix('chorus.mix'), chorusDepth: ix('chorus.depth'), phaserMix: ix('phaser.mix'), phaserRate: ix('phaser.rate'),
  reverbMix: ix('reverb.mix'), reverbSize: ix('reverb.size'),
  /** Each modulation / space effect's own low cut: it only works above it. */
  fxLowcut: ['chorus', 'flanger', 'phaser', 'delay', 'reverb'].map((f) => ix(`${f}.lowcut`)),
  eqLow: ix('eq.low_gain'), eqMid: ix('eq.mid_gain'), eqMidFreq: ix('eq.mid_freq'), eqHigh: ix('eq.high_gain'),
  outGain: ix('output.gain'), crossover: ix('output.crossover'), poly: ix('voice.polyphony'),
};

