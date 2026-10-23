// DEV ONLY. Builds the patch library: one production-ready patch for each of
// the 51 bass types in data/directory.json. Every patch is written out
// complete (every schema parameter) to data/library/<directory-id>.json.
//
// Design rules applied to every patch:
//   - layers: a clean mono sub (or a sine body) + a character layer + controlled top
//   - velocity always does something musical (filter, FM depth, drive, level)
//   - purposeful movement: filter envelope, LFO, drift or modulation FX
//   - attack definition: fast envelopes and, where the type calls for it, a transient
//   - polish: saturation, compression, EQ (mud cut, high cut), FX above the low cut
//
//   npm run build:library   (then: npm run level:patches && npm run analyze:library)

import { foldOctave } from './lib/octave';
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { params, validatePatch } from '../src/schema';
import { wheelDefault } from '../src/quality/categories';
import { ROOT } from './lib/data';

type Mod = [source: string, dest: string, amount: number];
interface Def {
  dir: string;
  family: string;
  name: string;
  description: string;
  tags: string[];
  set: Record<string, number | string | boolean>;
  mods: Mod[];
}

/** Shared polish every patch starts from (each patch overrides what it needs). */
const BASE: Record<string, number | string | boolean> = {
  'voice.analog': 0.25, 'voice.velocity': 0.35,
  'filter.keytrack': 0.5, 'filter.resonance': 0.1,
  'amp_env.attack': 2, 'amp_env.decay': 400, 'amp_env.sustain': 0.9, 'amp_env.release': 90,
  'mod_env.attack': 1, 'mod_env.decay': 300, 'mod_env.sustain': 0.2, 'mod_env.release': 150,
  'comp.amount': 0.3, 'comp.speed': 0.5,
  'fx.lowcut': 220, 'eq.highcut': 12000,
  'osc2.level': 0, 'sub.level': 0.5,
};

const D: Def[] = [
  // ------------------------------------------------- Group 1: analog & vintage
  {
    dir: 'moog', family: 'analog', name: 'Ladder Moog',
    description: 'Fat saw-plus-square ladder bass with a punchy filter envelope, warm drive and tape glue.',
    tags: ['moog', 'analog', 'warm', 'fat', 'funk', 'disco', 'classic', '70s'],
    set: {
      'osc1.wave': 'saw', 'osc1.level': 0.75, 'osc1.fine': 3, 'osc2.wave': 'pulse', 'osc2.pulse_width': 0.5, 'osc2.semi': -12, 'osc2.fine': -3, 'osc2.level': 0.45,
      'drive.amount': 0.35, 'filter.cutoff': 340, 'filter.resonance': 0.32, 'filter.env_amount': 0.36,
      'mod_env.decay': 360, 'mod_env.sustain': 0.18, 'mod_env.release': 140,
      'amp_env.attack': 2, 'amp_env.decay': 700, 'amp_env.sustain': 0.85, 'amp_env.release': 110,
      'sub.level': 0.35, 'voice.analog': 0.4, 'tape.drive': 0.25, 'comp.amount': 0.32, 'comp.speed': 0.45,
      'eq.mid_gain': -2, 'eq.mid_freq': 320, 'eq.highcut': 9500,
    },
    mods: [['velocity', 'filter_cutoff', 0.18], ['drift', 'filter_cutoff', 0.05]],
  },
  {
    dir: 'acid-303', family: 'acid', name: 'Diode Acid',
    description: 'Squelching 303 line through an 18 dB diode filter: accents bite harder, overlapping notes slide.',
    tags: ['acid', '303', 'squelchy', 'resonant', 'techno', 'house', 'rave', 'acid-house'],
    set: {
      'osc1.wave': 'saw', 'osc1.level': 0.85, 'filter.type': 'diode', 'filter.cutoff': 230, 'filter.resonance': 0.78,
      'filter.env_amount': 0.5, 'filter.keytrack': 0.25, 'filter.accent': 0.85,
      'mod_env.attack': 0.5, 'mod_env.decay': 210, 'mod_env.sustain': 0, 'mod_env.release': 90,
      'amp_env.attack': 1, 'amp_env.decay': 500, 'amp_env.sustain': 0.85, 'amp_env.release': 40,
      'voice.legato': true, 'voice.glide': 55, 'voice.velocity': 0.45, 'voice.analog': 0.15,
      'sub.level': 0.2, 'dist.type': 'soft', 'dist.drive': 0.32, 'dist.mix': 0.6, 'dist.post_tone': 0.45, 'dist.clean_below': 90, 'eq.highcut': 8500,
      'comp.amount': 0.38, 'comp.speed': 0.65, 'delay.mix': 0.12, 'delay.time': '1/8D', 'delay.feedback': 0.3, 'delay.tone': 0.35,
      'lfo2.shape': 'sine', 'lfo2.rate': 0.07, 'lfo2.retrigger': false,
    },
    mods: [['velocity', 'filter_cutoff', 0.12], ['lfo2', 'filter_cutoff', 0.1]],
  },
  {
    dir: 'reese', family: 'reese', name: 'Phase Reese',
    description: 'Detuned saw stack beating against an octave-down saw: dark, wide and slowly churning over a clean sub.',
    tags: ['reese', 'dnb', 'jungle', 'dark', 'wide', 'detuned', 'moving', 'neurofunk'],
    set: {
      'osc1.wave': 'saw', 'osc1.level': 0.7, 'osc1.unison_voices': 4, 'osc1.unison_detune': 16, 'osc1.unison_spread': 0.7,
      'osc2.wave': 'saw', 'osc2.level': 0.55, 'osc2.semi': -12, 'osc2.fine': -11, 'osc2.unison_voices': 2, 'osc2.unison_detune': 9, 'osc2.unison_spread': 0.5,
      'drive.amount': 0.32, 'filter.cutoff': 620, 'filter.resonance': 0.2, 'filter.keytrack': 0.35, 'filter.env_amount': 0.08,
      'lfo1.shape': 'sine', 'lfo1.rate': 0.16, 'lfo1.retrigger': false, 'lfo2.shape': 'triangle', 'lfo2.rate': 0.09, 'lfo2.retrigger': false,
      'dist.type': 'tube', 'dist.drive': 0.33, 'dist.mix': 0.65, 'dist.post_tone': 0.45, 'dist.clean_below': 140,
      'sub.level': 0.55, 'voice.analog': 0.35, 'comp.amount': 0.35, 'comp.speed': 0.45, 'ott.amount': 0.18,
      'chorus.mix': 0.12, 'chorus.depth': 0.3, 'eq.mid_gain': -3, 'eq.mid_freq': 380, 'eq.highcut': 10500,
      'amp_env.attack': 5, 'amp_env.sustain': 1, 'amp_env.release': 160,
    },
    mods: [['lfo1', 'filter_cutoff', 0.11], ['lfo2', 'unison_detune', 0.07], ['velocity', 'filter_cutoff', 0.1]],
  },
  {
    dir: 'hoover', family: 'hoover', name: 'Juno Hoover',
    description: 'Rave hoover: swirling PWM saws gliding through a lush three-voice ensemble chorus.',
    tags: ['hoover', 'rave', 'alpha-juno', 'hardcore', '90s', 'wide', 'swirling', 'techno'],
    set: {
      'osc1.wave': 'pwm_saw', 'osc1.pulse_width': 0.35, 'osc1.unison_voices': 5, 'osc1.unison_detune': 28, 'osc1.unison_spread': 0.85, 'osc1.level': 0.75,
      'osc2.wave': 'pwm_saw', 'osc2.pulse_width': 0.6, 'osc2.semi': -12, 'osc2.level': 0.4, 'osc2.unison_voices': 2, 'osc2.unison_detune': 14,
      'lfo1.shape': 'triangle', 'lfo1.rate': 0.6, 'lfo1.retrigger': false, 'lfo2.shape': 'sine', 'lfo2.rate': 0.45, 'lfo2.retrigger': false,
      'voice.legato': true, 'voice.glide': 120, 'filter.cutoff': 2600, 'filter.resonance': 0.15, 'filter.env_amount': 0.12, 'filter.keytrack': 0.4,
      'chorus.mix': 0.55, 'chorus.depth': 0.6, 'chorus.mode': 'ensemble', 'sub.level': 0.5, 'drive.amount': 0.25,
      'comp.amount': 0.35, 'reverb.mix': 0.1, 'reverb.size': 0.35, 'reverb.tone': 0.6, 'eq.mid_gain': -2.5, 'eq.mid_freq': 450, 'eq.highcut': 12500,
      'amp_env.attack': 8, 'amp_env.sustain': 0.95, 'amp_env.release': 220, 'voice.analog': 0.3,
    },
    mods: [['lfo1', 'osc1_pw', 0.3], ['lfo2', 'osc2_pw', -0.25], ['velocity', 'filter_cutoff', 0.12]],
  },
  {
    dir: 'synthwave-outrun', family: 'synthwave', name: 'Outrun Drive',
    description: 'Snappy, tightly compressed Juno/Prophet saw bass with a short filter blip and chorus shine.',
    tags: ['synthwave', 'outrun', '80s', 'retro', 'driving', 'snappy', 'retrowave'],
    set: {
      'osc1.wave': 'saw', 'osc1.unison_voices': 3, 'osc1.unison_detune': 12, 'osc1.unison_spread': 0.55, 'osc1.level': 0.75,
      'osc2.wave': 'saw', 'osc2.semi': -12, 'osc2.level': 0.35,
      'filter.cutoff': 900, 'filter.resonance': 0.25, 'filter.env_amount': 0.32, 'mod_env.decay': 260, 'mod_env.sustain': 0.35,
      'amp_env.attack': 2, 'amp_env.decay': 300, 'amp_env.sustain': 0.8, 'amp_env.release': 90,
      'comp.amount': 0.5, 'comp.speed': 0.7, 'chorus.mix': 0.25, 'chorus.depth': 0.35,
      'delay.mix': 0.08, 'delay.time': '1/16', 'delay.feedback': 0.2, 'delay.tone': 0.4,
      'sub.level': 0.45, 'drive.amount': 0.22, 'tape.drive': 0.15, 'eq.highcut': 11500, 'voice.analog': 0.3,
    },
    mods: [['velocity', 'filter_cutoff', 0.15], ['drift', 'filter_cutoff', 0.04]],
  },
  {
    dir: 'darkwave-gated', family: 'synthwave', name: 'Cold Wave',
    description: 'Cold, rigid post-punk bass: hollow pulse and saw, hard compression, heavy chorus and a dark room.',
    tags: ['darkwave', 'goth', 'post-punk', 'coldwave', 'cold', 'chorus', '80s'],
    set: {
      'osc1.wave': 'pulse', 'osc1.pulse_width': 0.42, 'osc1.level': 0.7, 'osc2.wave': 'saw', 'osc2.fine': 8, 'osc2.level': 0.4,
      'filter.cutoff': 1300, 'filter.resonance': 0.18, 'filter.env_amount': 0.2, 'filter.keytrack': 0.6,
      'amp_env.attack': 1, 'amp_env.decay': 180, 'amp_env.sustain': 0.55, 'amp_env.release': 60,
      'comp.amount': 0.65, 'comp.speed': 0.85, 'chorus.mix': 0.6, 'chorus.depth': 0.7,
      'reverb.mix': 0.12, 'reverb.size': 0.5, 'reverb.tone': 0.7, 'sub.level': 0.35, 'drive.amount': 0.2,
      'eq.low_gain': -1, 'eq.mid_gain': 2, 'eq.mid_freq': 900, 'eq.highcut': 9000, 'voice.analog': 0.15,
      'lfo1.shape': 'triangle', 'lfo1.rate': 0.25, 'lfo1.retrigger': false,
    },
    mods: [['velocity', 'filter_cutoff', 0.12], ['lfo1', 'osc1_pw', 0.15]],
  },
  {
    dir: 'moroder-octave', family: 'analog', name: 'Munich Octave',
    description: 'Tight, clicky sequencer bass made for octave-jumping disco lines, with a short filter snap and echo.',
    tags: ['disco', 'moroder', 'italo', 'sequencer', 'octave', 'tight', '70s', 'hi-nrg'],
    set: {
      'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'osc1.level': 0.65, 'osc2.wave': 'saw', 'osc2.fine': 6, 'osc2.level': 0.35,
      'filter.cutoff': 520, 'filter.resonance': 0.35, 'filter.env_amount': 0.42, 'filter.keytrack': 0.7,
      'mod_env.decay': 150, 'mod_env.sustain': 0.1, 'amp_env.attack': 1, 'amp_env.decay': 250, 'amp_env.sustain': 0.5, 'amp_env.release': 50,
      'sub.level': 0.4, 'comp.amount': 0.45, 'comp.speed': 0.7, 'delay.mix': 0.1, 'delay.time': '1/16D', 'delay.feedback': 0.25, 'delay.tone': 0.45,
      'voice.velocity': 0.4, 'eq.highcut': 11000, 'voice.analog': 0.35,
    },
    mods: [['velocity', 'filter_cutoff', 0.2], ['drift', 'filter_cutoff', 0.04]],
  },
  {
    dir: 'taurus', family: 'analog', name: 'Taurus Pedal',
    description: 'Room-shaking pedal-synth bass: low saw and square, huge sustain and a deep, slow-closing filter.',
    tags: ['taurus', 'pedal', 'analog', 'deep', 'huge', 'prog', 'rock', '70s'],
    set: {
      'voice.octave': -1, 'osc1.wave': 'saw', 'osc1.level': 0.55, 'osc2.wave': 'pulse', 'osc2.pulse_width': 0.5, 'osc2.semi': -12, 'osc2.level': 0.6,
      'sub.level': 0.25, 'filter.cutoff': 260, 'filter.resonance': 0.22, 'filter.env_amount': 0.25, 'filter.keytrack': 0.6,
      'mod_env.decay': 500, 'mod_env.sustain': 0.3, 'amp_env.attack': 6, 'amp_env.decay': 1500, 'amp_env.sustain': 0.9, 'amp_env.release': 600,
      'voice.glide': 40, 'drive.amount': 0.3, 'tape.drive': 0.3, 'comp.amount': 0.3,
      'eq.low_gain': 2.5, 'eq.mid_gain': 1, 'eq.mid_freq': 160, 'eq.highcut': 6500, 'voice.analog': 0.45,
    },
    mods: [['velocity', 'filter_cutoff', 0.12], ['drift', 'filter_cutoff', 0.06]],
  },

  // ------------------------------------------------- Group 2: digital, FM & plucks
  {
    dir: 'fm-lately', family: 'fm', name: 'Lately Plunk',
    description: 'Solid four-operator FM bass: a metallic plunk on every note that settles into a round, punchy body.',
    tags: ['fm', 'dx7', 'lately-bass', 'tx81z', 'punchy', 'metallic', 'r&b', 'funk', '80s'],
    set: {
      'osc1.wave': 'sine', 'osc1.level': 0.85, 'fm.amount': 0.25, 'fm.ratio': 1, 'fm.punch': 0.7, 'fm.decay': 160, 'fm.feedback': 0.2,
      'fm2.amount': 0.35, 'fm2.ratio': 2, 'fm.algorithm': 'stack',
      'filter.cutoff': 6000, 'filter.keytrack': 0.6, 'amp_env.attack': 1, 'amp_env.decay': 600, 'amp_env.sustain': 0.55, 'amp_env.release': 100,
      'sub.level': 0.35, 'comp.amount': 0.45, 'comp.speed': 0.6, 'eq.mid_gain': -4.5, 'eq.mid_freq': 280, 'eq.high_gain': 1.5, 'eq.highcut': 14000,
      'dist.type': 'tube', 'dist.drive': 0.15, 'dist.mix': 0.5, 'dist.post_tone': 0.6, 'dist.clean_below': 120, 'voice.analog': 0.15,
    },
    mods: [['velocity', 'fm_amount', 0.25], ['velocity', 'filter_cutoff', 0.1], ['drift', 'fm_amount', 0.03]],
  },
  {
    dir: 'm1-eurodance', family: 'organ', name: 'M1 Plastic',
    description: '90s Eurodance bass: a bright plastic click on top of a hollow, rubbery square-and-sine body.',
    tags: ['eurodance', 'm1', 'korg', '90s', 'house', 'rubbery', 'hollow', 'click'],
    set: {
      'osc1.wave': 'wavetable', 'osc1.wt_pos': 0.78, 'osc1.level': 0.65, 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.level': 0.25,
      'filter.cutoff': 1500, 'filter.resonance': 0.12, 'filter.keytrack': 0.7, 'filter.env_amount': 0.15, 'mod_env.decay': 120, 'mod_env.sustain': 0,
      'amp_env.attack': 1, 'amp_env.decay': 320, 'amp_env.sustain': 0.6, 'amp_env.release': 80,
      'sub.level': 0.45, 'chorus.mix': 0.15, 'chorus.depth': 0.3, 'comp.amount': 0.4, 'eq.mid_gain': -2, 'eq.mid_freq': 350, 'eq.highcut': 12000,
      'voice.analog': 0.15, 'lfo1.shape': 'sine', 'lfo1.rate': 0.3, 'lfo1.retrigger': false,
    },
    mods: [['velocity', 'filter_cutoff', 0.15], ['lfo1', 'osc1_wt_pos', 0.05]],
  },
  {
    dir: 'dx7-slap', family: 'fm', name: 'Glass Slap',
    description: 'Hyper-percussive DX7 slap: a glassy, high-ratio FM snap that drops away into a short, round thump.',
    tags: ['fm', 'dx7', 'slap', 'glassy', 'percussive', '80s', 'funk', 'pop'],
    set: {
      'osc1.wave': 'sine', 'osc1.level': 0.85, 'fm.amount': 0.15, 'fm.ratio': 1, 'fm.punch': 1, 'fm.decay': 90, 'fm.feedback': 0.1,
      'fm2.amount': 0.45, 'fm2.ratio': 5, 'fm.algorithm': 'stack',
      'amp_env.attack': 0.5, 'amp_env.decay': 450, 'amp_env.sustain': 0.25, 'amp_env.release': 90, 'voice.velocity': 0.5,
      'filter.cutoff': 9000, 'sub.level': 0.3, 'comp.amount': 0.5, 'comp.speed': 0.75,
      'eq.high_gain': 2, 'eq.highcut': 15000, 'voice.analog': 0.1,
    },
    mods: [['velocity', 'fm_amount', 0.3], ['drift', 'fm2_amount', 0.03]],
  },
  {
    dir: 'amapiano-log', family: 'fm', name: 'Log Drum',
    description: 'Amapiano log drum: a hollow, woody FM thud with a pitch bend and a deep rubbery sub that slides.',
    tags: ['amapiano', 'log-drum', 'south-africa', 'percussive', 'woody', 'hollow', 'deep'],
    set: {
      'osc1.wave': 'sine', 'osc1.level': 0.8, 'fm.amount': 0.1, 'fm.ratio': 2, 'fm.punch': 0.55, 'fm.decay': 70, 'fm2.amount': 0.25, 'fm2.ratio': 3, 'fm.algorithm': 'parallel',
      'pitch_env.amount': 7, 'pitch_env.decay': 40, 'amp_env.attack': 0.5, 'amp_env.decay': 380, 'amp_env.sustain': 0, 'amp_env.release': 180,
      'filter.cutoff': 2500, 'filter.resonance': 0.3,
      'sub.level': 0.55, 'voice.legato': true, 'voice.glide': 30, 'comp.amount': 0.45, 'comp.speed': 0.4,
      'reverb.mix': 0.06, 'reverb.size': 0.2, 'reverb.tone': 0.6, 'eq.mid_gain': 2, 'eq.mid_freq': 500, 'eq.highcut': 9000, 'voice.analog': 0.1,
    },
    mods: [['velocity', 'fm_amount', 0.25], ['drift', 'fm2_amount', 0.02]],
  },
  {
    dir: 'fm-slap-pluck', family: 'fm', name: 'Snap FM',
    description: 'Bright metallic FM pluck: a high-index snap with feedback grit and a touch of flanged shimmer.',
    tags: ['fm', 'metallic', 'pluck', 'bright', 'snappy', 'digital', 'dubstep'],
    set: {
      'osc1.wave': 'sine', 'osc1.level': 0.85, 'fm.amount': 0.3, 'fm.ratio': 3, 'fm.punch': 0.75, 'fm.decay': 140, 'fm.feedback': 0.35,
      'fm2.amount': 0.2, 'fm2.ratio': 1, 'fm.algorithm': 'stack',
      'amp_env.attack': 1, 'amp_env.decay': 480, 'amp_env.sustain': 0.35, 'amp_env.release': 90,
      'filter.cutoff': 4500, 'filter.keytrack': 0.6, 'filter.resonance': 0.12, 'sub.level': 0.45,
      'dist.type': 'fold', 'dist.drive': 0.15, 'dist.mix': 0.35, 'dist.post_tone': 0.55, 'dist.clean_below': 150,
      'flanger.mix': 0.12, 'flanger.rate': 0.15, 'flanger.feedback': 0.35, 'comp.amount': 0.4, 'ott.amount': 0.2, 'eq.highcut': 13000,
      'voice.analog': 0.15,
    },
    mods: [['velocity', 'fm_amount', 0.3]],
  },
  {
    dir: 'organ-bass', family: 'organ', name: 'Filtered Drawbar',
    description: 'Overdriven drawbar organ bass filtered down to its warm lows, with key click and a gentle rotary shimmer.',
    tags: ['organ', 'drawbar', 'garage', 'house', 'gospel', 'warm', 'hammond'],
    set: {
      'osc1.wave': 'sine', 'osc1.level': 0.6, 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.level': 0.3, 'sub.wave': 'triangle', 'sub.level': 0.6,
      'filter.cutoff': 700, 'filter.resonance': 0.05, 'filter.keytrack': 0.8, 'drive.amount': 0.3,
      'amp_env.attack': 3, 'amp_env.decay': 200, 'amp_env.sustain': 0.9, 'amp_env.release': 60,
      'chorus.mix': 0.25, 'chorus.depth': 0.35, 'chorus.mode': 'ensemble', 'comp.amount': 0.3, 'eq.highcut': 7000, 'voice.analog': 0.15,
      'lfo1.shape': 'sine', 'lfo1.rate': 5.5, 'lfo1.retrigger': false,
    },
    mods: [['lfo1', 'amp', 0.04], ['velocity', 'filter_cutoff', 0.1]],
  },
  {
    dir: 'nu-disco-rubber', family: 'funk', name: 'Rubber Disco',
    description: 'Elastic nu-disco bass: a resonant filter envelope gives every note a vocal "oww-waw" bounce.',
    tags: ['nu-disco', 'disco', 'funk', 'rubbery', 'bouncy', 'house', 'elastic'],
    set: {
      'osc1.wave': 'saw', 'osc1.level': 0.7, 'osc2.wave': 'wavetable', 'osc2.wt_pos': 0.7, 'osc2.semi': -12, 'osc2.level': 0.45,
      'filter.cutoff': 300, 'filter.resonance': 0.45, 'filter.env_amount': 0.55, 'mod_env.attack': 2, 'mod_env.decay': 190, 'mod_env.sustain': 0.12, 'mod_env.release': 90,
      'amp_env.attack': 1.5, 'amp_env.decay': 420, 'amp_env.sustain': 0.5, 'amp_env.release': 100,
      'sub.level': 0.4, 'drive.amount': 0.3, 'dist.type': 'tube', 'dist.drive': 0.22, 'dist.mix': 0.45, 'dist.clean_below': 120,
      'comp.amount': 0.45, 'chorus.mix': 0.12, 'chorus.depth': 0.3, 'voice.velocity': 0.5, 'eq.highcut': 11000,
    },
    mods: [['velocity', 'filter_cutoff', 0.18], ['drift', 'filter_cutoff', 0.04]],
  },
  {
    dir: 'rnb-pluck', family: 'pluck', name: 'Silk Pluck',
    description: 'Minimal 2000s R&B pluck: a clean triangle-and-sine tick that decays fast and leaves the mix wide open.',
    tags: ['r&b', 'pluck', 'minimal', 'clean', '2000s', 'timbaland', 'neptunes', 'short'],
    set: {
      'osc1.wave': 'triangle', 'osc1.level': 0.75, 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.level': 0.12,
      'filter.cutoff': 1800, 'filter.env_amount': 0.2, 'filter.keytrack': 0.7, 'mod_env.decay': 90, 'mod_env.sustain': 0,
      'amp_env.attack': 1, 'amp_env.decay': 260, 'amp_env.sustain': 0, 'amp_env.release': 120,
      'sub.level': 0.5, 'voice.velocity': 0.55, 'comp.amount': 0.3, 'comp.speed': 0.4,
      'reverb.mix': 0.05, 'reverb.size': 0.25, 'reverb.tone': 0.5, 'eq.highcut': 10000, 'voice.analog': 0.1,
    },
    mods: [['velocity', 'filter_cutoff', 0.2], ['drift', 'filter_cutoff', 0.03]],
  },
  {
    dir: 'donk', family: 'fm', name: 'Pipe Donk',
    description: 'Hard-dance donk: a pitch-bent, metallic FM clack like a struck plastic pipe, with a short body.',
    tags: ['donk', 'scouse-house', 'bounce', 'hard-dance', 'metallic', 'percussive', 'uk'],
    set: {
      'osc1.wave': 'sine', 'osc1.level': 0.8, 'fm.amount': 0.1, 'fm.ratio': 3.5, 'fm.punch': 0.9, 'fm.decay': 50, 'fm2.amount': 0.3, 'fm2.ratio': 7, 'fm.algorithm': 'parallel',
      'pitch_env.amount': 18, 'pitch_env.decay': 25, 'amp_env.attack': 0.5, 'amp_env.decay': 300, 'amp_env.sustain': 0.15, 'amp_env.release': 80,
      'filter.cutoff': 7000,
      'sub.level': 0.35, 'comp.amount': 0.5, 'comp.speed': 0.8, 'dist.type': 'hard', 'dist.drive': 0.15, 'dist.mix': 0.3, 'dist.clean_below': 150,
      'eq.mid_gain': 2, 'eq.mid_freq': 1000, 'eq.highcut': 13000, 'voice.analog': 0.05,
    },
    mods: [['velocity', 'fm_amount', 0.25], ['velocity', 'filter_cutoff', 0.08]],
  },

  // ------------------------------------------------- Group 3: modulated & distorted
  {
    dir: 'wobble', family: 'wobble', name: 'Brostep Wobble',
    description: 'Tempo-synced 1/8 filter wobble on stacked saws and a soft square, with tube grit and a solid sub.',
    tags: ['wobble', 'dubstep', 'brostep', 'wub', 'moving', 'rhythmic', 'heavy'],
    set: {
      'osc1.wave': 'saw', 'osc1.level': 0.7, 'osc1.unison_voices': 3, 'osc1.unison_detune': 14, 'osc1.unison_spread': 0.6,
      'osc2.wave': 'wavetable', 'osc2.wt_pos': 0.66, 'osc2.semi': -12, 'osc2.level': 0.5,
      'drive.amount': 0.32, 'filter.cutoff': 460, 'filter.resonance': 0.48, 'filter.keytrack': 0.3,
      'lfo1.shape': 'sine', 'lfo1.sync': '1/8', 'lfo1.retrigger': true,
      'dist.type': 'tube', 'dist.drive': 0.42, 'dist.mix': 0.75, 'dist.post_tone': 0.5, 'dist.clean_below': 150,
      'sub.level': 0.6, 'comp.amount': 0.42, 'ott.amount': 0.3, 'eq.highcut': 12000, 'amp_env.attack': 2, 'amp_env.release': 80,
    },
    mods: [['lfo1', 'filter_cutoff', 0.44], ['lfo1', 'osc2_wt_pos', 0.15], ['velocity', 'filter_cutoff', 0.12]],
  },
  {
    dir: 'growl-yoi', family: 'growl', name: 'Yoi Growl',
    description: 'Talking yoi growl: a morphing wavetable through a vowel filter that says "yoi" on every beat.',
    tags: ['growl', 'yoi', 'riddim', 'dubstep', 'vocal', 'talking', 'aggressive'],
    set: {
      'osc1.wave': 'wavetable', 'osc1.wt_pos': 0.62, 'osc1.unison_voices': 3, 'osc1.unison_detune': 10, 'osc1.unison_spread': 0.4, 'osc1.level': 0.75,
      'osc2.wave': 'saw', 'osc2.semi': -12, 'osc2.level': 0.4,
      'filter.type': 'formant', 'filter.cutoff': 1400, 'filter.resonance': 0.6, 'filter.vowel': 0.25, 'filter.keytrack': 0.3,
      'lfo1.shape': 'triangle', 'lfo1.sync': '1/8', 'lfo1.retrigger': true, 'lfo2.shape': 'sine', 'lfo2.sync': '1/16', 'lfo2.retrigger': true,
      'drive.amount': 0.35, 'dist.type': 'fold', 'dist.drive': 0.36, 'dist.mix': 0.6, 'dist.post_tone': 0.45, 'dist.clean_below': 160,
      'sub.level': 0.6, 'comp.amount': 0.45, 'comp.speed': 0.6, 'ott.amount': 0.42, 'eq.mid_gain': -2, 'eq.mid_freq': 400, 'eq.highcut': 12000,
    },
    mods: [['lfo1', 'filter_vowel', 0.55], ['lfo1', 'osc1_wt_pos', 0.2], ['lfo2', 'filter_cutoff', 0.1], ['velocity', 'dist_drive', 0.15]],
  },
  {
    dir: 'neuro', family: 'growl', name: 'Neuro Machine',
    description: 'Hyper-complex neuro bass: a pitch-tracked comb filter, random wavetable jumps, phasing and multiband dirt.',
    tags: ['neuro', 'neurofunk', 'dnb', 'complex', 'morphing', 'aggressive', 'tech'],
    set: {
      'osc1.wave': 'wavetable', 'osc1.wt_pos': 0.48, 'osc1.unison_voices': 3, 'osc1.unison_detune': 14, 'osc1.level': 0.75,
      'osc2.wave': 'saw', 'osc2.fine': 7, 'osc2.level': 0.45,
      'filter.type': 'comb', 'filter.cutoff': 400, 'filter.resonance': 0.55, 'filter.keytrack': 0.8,
      'lfo1.shape': 'saw_down', 'lfo1.sync': '1/16', 'lfo1.retrigger': true, 'lfo2.shape': 'sample_hold', 'lfo2.sync': '1/8', 'lfo2.retrigger': true,
      'phaser.mix': 0.3, 'phaser.rate': 0.8, 'dist.type': 'fold', 'dist.drive': 0.45, 'dist.mix': 0.7, 'dist.post_tone': 0.5, 'dist.clean_below': 160,
      'ott.amount': 0.5, 'comp.amount': 0.45, 'sub.level': 0.6, 'eq.mid_gain': -2.5, 'eq.mid_freq': 420, 'eq.highcut': 12500, 'drive.amount': 0.3,
    },
    mods: [['lfo1', 'filter_cutoff', 0.25], ['lfo2', 'osc1_wt_pos', 0.3], ['velocity', 'dist_drive', 0.15]],
  },
  {
    dir: 'cyberpunk-midtempo', family: 'growl', name: 'Gear Grinder',
    description: 'Mid-tempo cyberpunk bass: a crushing square through a sweeping notch filter, like grinding machine gears.',
    tags: ['cyberpunk', 'midtempo', 'industrial', 'mechanical', 'gritty', 'dark', 'electro'],
    set: {
      'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'osc1.level': 0.75, 'osc2.wave': 'saw', 'osc2.semi': -12, 'osc2.level': 0.4,
      'filter.type': 'notch', 'filter.cutoff': 900, 'filter.resonance': 0.55, 'filter.keytrack': 0.3,
      'lfo1.shape': 'triangle', 'lfo1.sync': '1/4', 'lfo1.retrigger': true, 'lfo2.shape': 'sample_hold', 'lfo2.sync': '1/16', 'lfo2.retrigger': false,
      'drive.amount': 0.4, 'dist.type': 'hard', 'dist.drive': 0.35, 'dist.mix': 0.6, 'dist.post_tone': 0.5, 'dist.clean_below': 140,
      'crush.mix': 0.12, 'crush.bits': 10, 'crush.rate': 1.5, 'sub.level': 0.55, 'comp.amount': 0.5, 'ott.amount': 0.35, 'eq.highcut': 11000,
    },
    mods: [['lfo1', 'filter_cutoff', 0.35], ['lfo2', 'filter_cutoff', 0.08], ['velocity', 'dist_drive', 0.15]],
  },
  {
    dir: 'phonk-cowbass', family: 'distorted', name: 'Drift Phonk',
    description: 'Blown-out drift-phonk bass: low, detuned squares smashed into clipping, gliding hard between notes.',
    tags: ['phonk', 'drift-phonk', 'memphis', 'blown-out', 'distorted', 'lo-fi', 'glide'],
    set: {
      'voice.octave': -1, 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'osc1.level': 0.75, 'osc2.wave': 'pulse', 'osc2.fine': 14, 'osc2.level': 0.5,
      'voice.legato': true, 'voice.glide': 140, 'drive.amount': 0.4, 'filter.cutoff': 2200, 'filter.resonance': 0.1,
      'dist.type': 'hard', 'dist.drive': 0.6, 'dist.mix': 0.9, 'dist.post_tone': 0.45, 'dist.clean_below': 20,
      'sub.level': 0.3, 'comp.amount': 0.55, 'comp.speed': 0.6, 'crush.mix': 0.08, 'crush.bits': 9, 'crush.rate': 2, 'tape.drive': 0.35,
      'eq.low_gain': 2, 'eq.highcut': 8000, 'lfo1.shape': 'sine', 'lfo1.rate': 0.2, 'lfo1.retrigger': false,
    },
    mods: [['velocity', 'filter_cutoff', 0.12], ['lfo1', 'osc2_pitch', 0.004]],
  },
  {
    dir: 'rage-808', family: '808', name: 'Rage Fuzz 808',
    description: 'Rage/hyperpop 808 pushed far past clipping into square-wave fuzz, with a tuned kick punch on top.',
    tags: ['rage', 'hyperpop', '808', 'trap', 'distorted', 'fuzz', 'blown-out'],
    set: {
      'voice.octave': -1, 'osc1.wave': 'sine', 'osc1.level': 0.9, 'sub.level': 0, 'pitch_env.amount': 12, 'pitch_env.decay': 60,
      'drive.amount': 0.5, 'dist.type': 'hard', 'dist.drive': 0.75, 'dist.mix': 1, 'dist.post_tone': 0.55, 'dist.clean_below': 20,
      'amp_env.attack': 1, 'amp_env.decay': 1500, 'amp_env.sustain': 0, 'amp_env.release': 250, 'filter.cutoff': 9000, 'filter.keytrack': 0,
      'voice.legato': true, 'voice.glide': 60, 'comp.amount': 0.4, 'tape.drive': 0.2, 'eq.low_gain': 2, 'eq.highcut': 11000, 'voice.analog': 0.05,
    },
    mods: [['velocity', 'dist_drive', 0.15], ['drift', 'dist_drive', 0.03]],
  },
  {
    dir: 'hardstyle-reverse', family: '808', name: 'Reverse Kick',
    description: 'Hardstyle reverse bass: a distorted, tuned kick hit followed by a backwards-swelling, rising sub that cuts dead.',
    tags: ['hardstyle', 'reverse-bass', 'rawstyle', 'kick', 'distorted', 'euphoric'],
    set: {
      'osc1.wave': 'sine', 'osc1.level': 0.85, 'osc2.wave': 'saw', 'osc2.level': 0.25, 'filter.cutoff': 900, 'filter.keytrack': 0.4,
      'eq.mid_gain': -3.5, 'eq.mid_freq': 300,
      'amp_env.attack': 220, 'amp_env.attack_curve': 1, 'amp_env.decay': 50, 'amp_env.sustain': 1, 'amp_env.release': 25,
      'pitch_env.amount': -7, 'pitch_env.decay': 180,
      'dist.type': 'hard', 'dist.drive': 0.5, 'dist.mix': 0.8, 'dist.post_tone': 0.55, 'dist.clean_below': 20,
      'sub.level': 0.3, 'comp.amount': 0.4, 'eq.highcut': 11000, 'voice.analog': 0.05,
    },
    mods: [['velocity', 'dist_drive', 0.1], ['velocity', 'filter_cutoff', 0.1]],
  },
  {
    dir: 'ebm-industrial', family: 'distorted', name: 'Machine EBM',
    description: 'Driving EBM bass: overdriven saw and square with a hard filter snap and a mechanical 16th-note pulse.',
    tags: ['ebm', 'industrial', 'body-music', 'driving', 'harsh', 'mechanical', '80s'],
    set: {
      'osc1.wave': 'saw', 'osc1.level': 0.7, 'osc2.wave': 'pulse', 'osc2.pulse_width': 0.45, 'osc2.semi': -12, 'osc2.level': 0.5,
      'filter.cutoff': 1100, 'filter.resonance': 0.35, 'filter.env_amount': 0.3, 'mod_env.decay': 140, 'mod_env.sustain': 0.2,
      'amp_env.attack': 1, 'amp_env.decay': 240, 'amp_env.sustain': 0.6, 'amp_env.release': 50,
      'drive.amount': 0.55, 'dist.type': 'hard', 'dist.drive': 0.5, 'dist.mix': 0.75, 'dist.post_tone': 0.55, 'dist.clean_below': 110,
      'sub.level': 0.45, 'comp.amount': 0.55, 'comp.speed': 0.8, 'eq.mid_gain': 2, 'eq.mid_freq': 1200, 'eq.highcut': 10000,
      'lfo1.shape': 'square', 'lfo1.sync': '1/16', 'lfo1.retrigger': true,
    },
    mods: [['velocity', 'filter_cutoff', 0.18], ['lfo1', 'amp', -0.15], ['drift', 'filter_cutoff', 0.03]],
  },
  {
    dir: 'nin-industrial-rock', family: 'distorted', name: 'Toxic Fuzz',
    description: 'Industrial-rock fuzz bass: raw clipping, fuzz and white noise built to tear through a wall of guitars.',
    tags: ['industrial-rock', 'nin', 'fuzz', 'noise', 'aggressive', '90s', 'rock'],
    set: {
      'osc1.wave': 'saw', 'osc1.unison_voices': 2, 'osc1.unison_detune': 10, 'osc1.level': 0.7, 'osc2.wave': 'pulse', 'osc2.semi': -12, 'osc2.level': 0.5,
      'noise.level': 0.18, 'drive.amount': 0.6, 'filter.cutoff': 1800, 'filter.resonance': 0.2, 'filter.keytrack': 0.4,
      'dist.type': 'tube', 'dist.drive': 0.65, 'dist.mix': 0.85, 'dist.post_tone': 0.5, 'dist.clean_below': 20,
      'crush.mix': 0.05, 'crush.bits': 12, 'sub.level': 0.4, 'comp.amount': 0.6, 'tape.drive': 0.3,
      'eq.low_gain': 1, 'eq.mid_gain': 2.5, 'eq.mid_freq': 1600, 'eq.highcut': 9500,
    },
    mods: [['velocity', 'dist_drive', 0.15], ['drift', 'filter_cutoff', 0.05]],
  },
  {
    dir: 'synth-metal-doom', family: 'distorted', name: 'Drop-G Doom',
    description: 'Ultra-low synth-metal bass: fuzzed saw and square like a five-string tuned to drop G, scooped and huge.',
    tags: ['metal', 'doom', 'djent', 'drop-tuned', 'fuzz', 'heavy', 'low'],
    set: {
      'voice.octave': -1, 'osc1.wave': 'saw', 'osc1.level': 0.7, 'osc2.wave': 'pulse', 'osc2.pulse_width': 0.5, 'osc2.fine': -9, 'osc2.level': 0.6,
      'sub.level': 0.35, 'drive.amount': 0.6, 'filter.cutoff': 1500, 'filter.resonance': 0.15, 'filter.keytrack': 0.4,
      'dist.type': 'hard', 'dist.drive': 0.55, 'dist.mix': 0.8, 'dist.post_tone': 0.42, 'dist.clean_below': 70,
      'amp_env.attack': 3, 'amp_env.decay': 900, 'amp_env.sustain': 0.85, 'amp_env.release': 200,
      'comp.amount': 0.5, 'tape.drive': 0.2, 'eq.low_gain': 1.5, 'eq.mid_gain': -3, 'eq.mid_freq': 500, 'eq.high_gain': 1, 'eq.highcut': 8500,
      'lfo1.shape': 'sine', 'lfo1.rate': 0.12, 'lfo1.retrigger': false,
    },
    mods: [['velocity', 'filter_cutoff', 0.15], ['lfo1', 'filter_cutoff', 0.06]],
  },

  // ------------------------------------------------- Group 4: minimal, functional & global
  {
    dir: 'pure-sub', family: 'sub', name: 'Pure Sine Sub',
    description: 'Clean, unmodulated sine sub living below 60 Hz: pure weight, felt rather than heard.',
    tags: ['sub', 'sine', 'clean', 'utility', 'deep', 'minimal', 'any-genre'],
    set: {
      'osc1.wave': 'triangle', 'osc1.level': 0.05, 'sub.level': 1, 'filter.cutoff': 400, 'drive.amount': 0.08, 'tape.drive': 0.12,
      'amp_env.attack': 4, 'amp_env.decay': 300, 'amp_env.sustain': 1, 'amp_env.release': 90,
      'comp.amount': 0.25, 'comp.speed': 0.35, 'voice.velocity': 0.15, 'eq.highcut': 3000, 'voice.analog': 0.05,
    },
    mods: [['velocity', 'sub_level', 0.08]],
  },
  {
    dir: 'reggaeton-sub', family: 'sub', name: 'Dembow Sub',
    description: 'Round, heavily compressed reggaeton sub with warm tape saturation for weight under the dembow.',
    tags: ['reggaeton', 'dembow', 'latin', 'sub', 'round', 'compressed', 'warm'],
    set: {
      'osc1.wave': 'triangle', 'osc1.level': 0.28, 'sub.level': 0.95, 'drive.amount': 0.2, 'tape.drive': 0.35,
      'comp.amount': 0.6, 'comp.speed': 0.5, 'amp_env.attack': 2, 'amp_env.decay': 400, 'amp_env.sustain': 0.85, 'amp_env.release': 110,
      'filter.cutoff': 600, 'filter.keytrack': 0.6,
      'eq.low_gain': 1.5, 'eq.highcut': 4500, 'voice.analog': 0.1,
    },
    mods: [['velocity', 'sub_level', 0.1], ['drift', 'filter_cutoff', 0.03]],
  },
  {
    dir: 'baile-funk', family: '808', name: 'Baile Knock',
    description: 'Raw baile-funk sub pluck: a sharp downbeat thump with a lo-fi, crunchy mid-range knock on top.',
    tags: ['baile-funk', 'funk-carioca', 'brazil', 'raw', 'lo-fi', 'sub', 'knock'],
    set: {
      'osc1.wave': 'sine', 'osc1.level': 0.8, 'pitch_env.amount': 5, 'pitch_env.decay': 30,
      'amp_env.attack': 0.5, 'amp_env.decay': 420, 'amp_env.sustain': 0, 'amp_env.release': 120,
      'crush.mix': 0.15, 'crush.bits': 10, 'crush.rate': 2, 'sub.level': 0.4,
      'dist.type': 'tube', 'dist.drive': 0.3, 'dist.mix': 0.6, 'dist.clean_below': 20, 'comp.amount': 0.5,
      'filter.cutoff': 8000, 'eq.mid_gain': 2, 'eq.mid_freq': 700, 'eq.highcut': 8000, 'voice.analog': 0.05,
    },
    mods: [['velocity', 'dist_drive', 0.12], ['velocity', 'amp', 0.1]],
  },
  {
    dir: 'dub-rubber', family: 'sub', name: 'Sound System Dub',
    description: 'King Tubby-style dub bass: all highs filtered away, leaving a warm, heavy sound-system thud.',
    tags: ['dub', 'reggae', 'roots', 'sound-system', 'deep', 'warm', 'king-tubby'],
    set: {
      'osc1.wave': 'triangle', 'osc1.level': 0.6, 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.level': 0.08,
      'filter.cutoff': 320, 'filter.resonance': 0.08, 'filter.keytrack': 0.4, 'sub.level': 0.85, 'drive.amount': 0.2,
      'tape.drive': 0.35, 'tape.wow': 0.1, 'amp_env.attack': 5, 'amp_env.decay': 800, 'amp_env.sustain': 0.9, 'amp_env.release': 160,
      'comp.amount': 0.3, 'eq.low_gain': 2.5, 'eq.highcut': 2500, 'voice.analog': 0.3,
    },
    mods: [['velocity', 'filter_cutoff', 0.1], ['drift', 'filter_cutoff', 0.04]],
  },
  {
    dir: 'psy-offbeat', family: 'pluck', name: 'Psy Rolling',
    description: 'Short, hyper-compressed psytrance saw pluck shaped to bounce tightly between the kicks.',
    tags: ['psytrance', 'psy', 'offbeat', 'rolling', 'goa', 'tight', 'short'],
    set: {
      'osc1.wave': 'saw', 'osc1.unison_voices': 2, 'osc1.unison_detune': 6, 'osc1.level': 0.8,
      'filter.cutoff': 380, 'filter.resonance': 0.32, 'filter.env_amount': 0.5, 'mod_env.decay': 110, 'mod_env.sustain': 0,
      'amp_env.attack': 0.5, 'amp_env.decay': 210, 'amp_env.sustain': 0.1, 'amp_env.release': 40,
      'comp.amount': 0.45, 'comp.speed': 0.6, 'sub.level': 0.45, 'drive.amount': 0.35,
      'dist.type': 'soft', 'dist.drive': 0.25, 'dist.mix': 0.5, 'dist.clean_below': 110, 'eq.highcut': 12000,
    },
    mods: [['velocity', 'filter_cutoff', 0.15], ['drift', 'filter_cutoff', 0.03]],
  },
  {
    dir: 'sine-drop-808', family: '808', name: 'Classic 808',
    description: 'Long, saturated sine 808 with a tuned kick punch, a pitch drop and slides between overlapping notes.',
    tags: ['808', 'trap', 'hip-hop', 'drill', 'boomy', 'sub', 'saturated'],
    set: {
      'voice.octave': -1, 'osc1.wave': 'sine', 'osc1.level': 0.9, 'sub.level': 0, 'pitch_env.amount': 12, 'pitch_env.decay': 55,
      'amp_env.attack': 1.5, 'amp_env.decay': 1900, 'amp_env.sustain': 0, 'amp_env.release': 260,
      'dist.type': 'tube', 'dist.drive': 0.42, 'dist.mix': 1, 'dist.post_tone': 0.5, 'dist.clean_below': 20,
      'tape.drive': 0.3, 'comp.amount': 0.3, 'comp.speed': 0.35, 'filter.cutoff': 9000, 'filter.keytrack': 0,
      'voice.legato': true, 'voice.glide': 70, 'voice.velocity': 0.2, 'eq.highcut': 9000, 'voice.analog': 0.05,
    },
    mods: [['velocity', 'dist_drive', 0.1]],
  },
  {
    dir: 'gfunk-low', family: 'analog', name: 'G-Funk Whine',
    description: 'West Coast G-funk bass: a deep, smooth triangle sub under a singing, gliding high sine whine.',
    tags: ['g-funk', 'west-coast', 'hip-hop', '90s', 'smooth', 'whine', 'funk'],
    set: {
      'osc1.wave': 'triangle', 'osc1.level': 0.45, 'osc2.wave': 'sine', 'osc2.semi': 24, 'osc2.level': 0.18, 'sub.wave': 'triangle', 'sub.level': 0.8,
      'voice.legato': true, 'voice.glide': 120, 'filter.cutoff': 900, 'amp_env.attack': 6, 'amp_env.decay': 700, 'amp_env.sustain': 0.85, 'amp_env.release': 160,
      'lfo1.shape': 'sine', 'lfo1.rate': 5.2, 'lfo1.retrigger': false, 'comp.amount': 0.3, 'chorus.mix': 0.1, 'chorus.depth': 0.3, 'eq.highcut': 9000,
    },
    mods: [['lfo1', 'osc2_pitch', 0.006], ['velocity', 'filter_cutoff', 0.1]],
  },
  {
    dir: 'indie-chunky-square', family: 'analog', name: 'Chunky Square',
    description: 'Clean, mid-heavy, slightly overdriven square bass with clockwork precision, like a picked indie bass.',
    tags: ['indie', 'indie-pop', 'square', 'chunky', 'clean', 'mid-heavy', 'bass-guitar'],
    set: {
      'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'osc1.level': 0.75, 'osc2.wave': 'pulse', 'osc2.pulse_width': 0.38, 'osc2.fine': 5, 'osc2.level': 0.3,
      'filter.cutoff': 1600, 'filter.resonance': 0.12, 'filter.env_amount': 0.15, 'filter.keytrack': 0.7, 'mod_env.decay': 200, 'mod_env.sustain': 0.4,
      'amp_env.attack': 1, 'amp_env.decay': 500, 'amp_env.sustain': 0.75, 'amp_env.release': 70,
      'drive.amount': 0.4, 'sub.level': 0.3, 'comp.amount': 0.45, 'comp.speed': 0.6, 'eq.mid_gain': 2, 'eq.mid_freq': 800, 'eq.highcut': 9000,
    },
    mods: [['velocity', 'filter_cutoff', 0.15], ['drift', 'filter_cutoff', 0.03]],
  },

  // ------------------------------------------------- Group 5: cinematic, avant-garde & unstable
  {
    dir: 'braam', family: 'cinematic', name: 'Brass Braam',
    description: 'Colossal cinematic braam: a wall of detuned saws swelling open like a low brass section, saturated and huge.',
    tags: ['braam', 'cinematic', 'trailer', 'zimmer', 'brass', 'huge', 'epic', 'film'],
    set: {
      'voice.octave': -1, 'osc1.wave': 'saw', 'osc1.unison_voices': 5, 'osc1.unison_detune': 20, 'osc1.unison_spread': 0.7, 'osc1.level': 0.7,
      'osc2.wave': 'saw', 'osc2.semi': -12, 'osc2.unison_voices': 3, 'osc2.unison_detune': 12, 'osc2.level': 0.6,
      'filter.cutoff': 380, 'filter.resonance': 0.25, 'filter.env_amount': 0.5, 'mod_env.attack': 250, 'mod_env.decay': 1200, 'mod_env.sustain': 0.6,
      'amp_env.attack': 60, 'amp_env.decay': 2000, 'amp_env.sustain': 0.9, 'amp_env.release': 900,
      'drive.amount': 0.5, 'dist.type': 'tube', 'dist.drive': 0.4, 'dist.mix': 0.6, 'dist.post_tone': 0.45, 'dist.clean_below': 120,
      'ott.amount': 0.3, 'reverb.mix': 0.25, 'reverb.size': 0.75, 'reverb.tone': 0.65, 'fx.lowcut': 250, 'sub.level': 0.5,
      'eq.mid_gain': -2, 'eq.mid_freq': 400, 'eq.highcut': 9000, 'voice.analog': 0.35,
    },
    mods: [['velocity', 'filter_cutoff', 0.2], ['drift', 'filter_cutoff', 0.05]],
  },
  {
    dir: 'lorn-tape-flutter', family: 'terror', name: 'Broken Tape',
    description: 'LORN-style decayed bass: saturated and worn, with unstable random pitch flutter, dark echoes and a haunted room.',
    tags: ['lorn', 'tape', 'lo-fi', 'dark', 'haunted', 'cinematic', 'unstable', 'wonky'],
    set: {
      'osc1.wave': 'saw', 'osc1.unison_voices': 3, 'osc1.unison_detune': 10, 'osc1.level': 0.65, 'osc2.wave': 'wavetable', 'osc2.wt_pos': 0.5, 'osc2.semi': -12, 'osc2.level': 0.5,
      'filter.cutoff': 700, 'filter.resonance': 0.2, 'filter.env_amount': 0.2, 'drive.amount': 0.45,
      'dist.type': 'tube', 'dist.drive': 0.35, 'dist.mix': 0.6, 'dist.post_tone': 0.4, 'dist.clean_below': 120,
      'tape.drive': 0.55, 'tape.wow': 0.55, 'tape.age': 0.55, 'crush.mix': 0.06, 'crush.bits': 12,
      'reverb.mix': 0.18, 'reverb.size': 0.6, 'reverb.tone': 0.8, 'delay.mix': 0.1, 'delay.time': '1/4', 'delay.feedback': 0.4, 'delay.tone': 0.25,
      'comp.amount': 0.4, 'sub.level': 0.55, 'eq.highcut': 7000, 'voice.analog': 0.6,
      // Smooth random flutter: a fixed-rate sample & hold would tick like a clock.
      'lfo2.shape': 'wander', 'lfo2.rate': 7, 'lfo2.retrigger': false,
    },
    mods: [['drift', 'pitch', 0.006], ['lfo2', 'pitch', 0.003], ['velocity', 'filter_cutoff', 0.15]],
  },
  {
    dir: 'lorn-infra', family: 'sub', name: 'Infra Rumble',
    description: 'LORN-style ghost sub: a sine at the threshold of hearing, made audible by saturation, slowly breathing.',
    tags: ['lorn', 'infra', 'sub', 'ghostly', 'dark', 'cinematic', 'rumble', 'ambient'],
    set: {
      'voice.octave': -1, 'osc1.wave': 'sine', 'osc1.level': 0.7, 'sub.level': 0.8, 'drive.amount': 0.35, 'tape.drive': 0.5,
      'dist.type': 'soft', 'dist.drive': 0.3, 'dist.mix': 0.6, 'dist.clean_below': 20,
      'amp_env.attack': 40, 'amp_env.decay': 2000, 'amp_env.sustain': 0.9, 'amp_env.release': 1200,
      'reverb.mix': 0.1, 'reverb.size': 0.7, 'reverb.tone': 0.9, 'filter.cutoff': 500, 'comp.amount': 0.3, 'eq.highcut': 5000,
      'lfo1.shape': 'sine', 'lfo1.rate': 0.07, 'lfo1.retrigger': false, 'voice.analog': 0.2,
    },
    mods: [['lfo1', 'amp', 0.15], ['velocity', 'filter_cutoff', 0.1]],
  },
  {
    dir: 'clockwork', family: 'pluck', name: 'Tick-Tock Pluck',
    description: 'Cinematic tension pluck: a tight bass pluck with a ticking transient and clockwork echoes.',
    tags: ['clockwork', 'tension', 'cinematic', 'pluck', 'ticking', 'thriller', 'film'],
    set: {
      'osc1.wave': 'triangle', 'osc1.level': 0.7, 'osc2.wave': 'saw', 'osc2.semi': 12, 'osc2.level': 0.12,
      'filter.cutoff': 1500, 'filter.resonance': 0.25, 'filter.env_amount': 0.35, 'mod_env.decay': 70, 'mod_env.sustain': 0,
      'amp_env.attack': 0.5, 'amp_env.decay': 220, 'amp_env.sustain': 0, 'amp_env.release': 90,
      'delay.mix': 0.15, 'delay.time': '1/16', 'delay.feedback': 0.35, 'delay.tone': 0.6,
      'sub.level': 0.45, 'comp.amount': 0.35, 'reverb.mix': 0.06, 'reverb.size': 0.3, 'eq.highcut': 13000, 'voice.analog': 0.1,
    },
    mods: [['velocity', 'filter_cutoff', 0.15], ['drift', 'filter_cutoff', 0.02]],
  },
  {
    dir: 'organic-hybrid-sub', family: 'cinematic', name: 'Bowed Hybrid',
    description: 'Organic hybrid bass: a dark physical-model string layered on a pure sine sub, with gentle chorus and space.',
    tags: ['hybrid', 'organic', 'string', 'cinematic', 'cello', 'double-bass', 'film', 'emotional'],
    set: {
      'osc1.wave': 'string', 'osc1.level': 0.75, 'string.tone': 0.35, 'string.decay': 0.85, 'sub.level': 0.8,
      'filter.cutoff': 1400, 'filter.resonance': 0.1, 'filter.keytrack': 0.6,
      'amp_env.attack': 20, 'amp_env.decay': 2000, 'amp_env.sustain': 0.85, 'amp_env.release': 700,
      'tape.drive': 0.2, 'chorus.mix': 0.15, 'chorus.depth': 0.3, 'reverb.mix': 0.15, 'reverb.size': 0.6, 'reverb.tone': 0.6,
      'comp.amount': 0.3, 'eq.mid_gain': -1.5, 'eq.mid_freq': 350, 'eq.highcut': 9000, 'voice.analog': 0.3,
    },
    mods: [['velocity', 'filter_cutoff', 0.15], ['drift', 'filter_cutoff', 0.04]],
  },
  {
    dir: 'drone-brass', family: 'cinematic', name: 'Apocalypse Horn',
    description: 'Sci-fi drone horn: massive detuned saws and pulse opening very slowly into an apocalyptic brass roar.',
    tags: ['drone', 'brass', 'horn', 'sci-fi', 'cinematic', 'apocalyptic', 'slow', 'huge'],
    set: {
      'osc1.wave': 'saw', 'osc1.unison_voices': 4, 'osc1.unison_detune': 22, 'osc1.level': 0.7, 'osc2.wave': 'pulse', 'osc2.pulse_width': 0.4, 'osc2.semi': -12, 'osc2.level': 0.5,
      'filter.cutoff': 280, 'filter.resonance': 0.3, 'filter.env_amount': 0.45, 'mod_env.attack': 900, 'mod_env.decay': 2500, 'mod_env.sustain': 0.7,
      'amp_env.attack': 400, 'amp_env.decay': 2000, 'amp_env.sustain': 0.95, 'amp_env.release': 1500,
      'dist.type': 'tube', 'dist.drive': 0.35, 'dist.mix': 0.6, 'dist.clean_below': 120,
      'reverb.mix': 0.25, 'reverb.size': 0.8, 'reverb.tone': 0.7, 'sub.level': 0.5, 'ott.amount': 0.2, 'eq.highcut': 8000,
      'eq.mid_freq': 300, 'eq.mid_gain': -2.5,
      'lfo1.shape': 'triangle', 'lfo1.rate': 0.11, 'lfo1.retrigger': false, 'voice.analog': 0.4,
    },
    mods: [['lfo1', 'filter_cutoff', 0.1], ['drift', 'osc2_pw', 0.2], ['velocity', 'filter_cutoff', 0.15]],
  },
  {
    dir: 'shoegaze-fog', family: 'cinematic', name: 'Floor Fog',
    description: 'Shoegaze wall of low fog: a seven-voice saw cloud soaked in ensemble chorus, long reverb and echoes.',
    tags: ['shoegaze', 'drone', 'ambient', 'wide', 'wall-of-sound', 'dreamy', 'reverb'],
    set: {
      'osc1.wave': 'saw', 'osc1.unison_voices': 7, 'osc1.unison_detune': 30, 'osc1.unison_spread': 1, 'osc1.level': 0.6,
      'osc2.wave': 'triangle', 'osc2.semi': 12, 'osc2.level': 0.3, 'filter.cutoff': 900,
      'amp_env.attack': 250, 'amp_env.decay': 2000, 'amp_env.sustain': 1, 'amp_env.release': 2500,
      'chorus.mix': 0.6, 'chorus.depth': 0.7, 'chorus.mode': 'ensemble', 'reverb.mix': 0.45, 'reverb.size': 0.9, 'reverb.tone': 0.55,
      'delay.mix': 0.2, 'delay.time': '1/4D', 'delay.feedback': 0.55, 'delay.tone': 0.3, 'fx.lowcut': 220,
      'sub.level': 0.55, 'tape.wow': 0.2, 'tape.drive': 0.25, 'comp.amount': 0.25, 'eq.highcut': 9000, 'voice.analog': 0.4,
      'eq.mid_freq': 300, 'eq.mid_gain': -2.5,
    },
    mods: [['velocity', 'filter_cutoff', 0.1], ['drift', 'filter_cutoff', 0.06]],
  },
  {
    dir: 'popunk-subdrop', family: 'sub', name: 'Breakdown Drop',
    description: 'Pop-punk sub drop: one clean sine sweeping dramatically down two octaves into the breakdown.',
    tags: ['sub-drop', 'pop-punk', 'metalcore', 'breakdown', 'impact', 'sine', 'utility'],
    set: {
      'osc1.wave': 'sine', 'osc1.level': 0.8, 'pitch_env.amount': 24, 'pitch_env.decay': 1500, 'sub.level': 0.5,
      'amp_env.attack': 2, 'amp_env.decay': 2500, 'amp_env.sustain': 0.6, 'amp_env.release': 900,
      'dist.type': 'soft', 'dist.drive': 0.2, 'dist.mix': 0.5, 'dist.clean_below': 20, 'tape.drive': 0.2,
      'reverb.mix': 0.08, 'reverb.size': 0.5, 'filter.cutoff': 4000, 'comp.amount': 0.3, 'eq.highcut': 8000, 'voice.analog': 0.05,
      'eq.mid_freq': 300, 'eq.mid_gain': -1.5,
    },
    mods: [['velocity', 'sub_level', 0.1]],
  },
  {
    dir: 'buchla-west-coast', family: 'experimental', name: 'West Coast Bongo',
    description: 'West Coast bass: a wavefolded triangle through a low-pass gate, woody and acoustic, brighter the harder you play.',
    tags: ['west-coast', 'buchla', 'wavefolder', 'lpg', 'modular', 'woody', 'experimental'],
    set: {
      'osc1.wave': 'triangle', 'osc1.level': 0.8, 'filter.type': 'lpg', 'filter.cutoff': 5000, 'filter.resonance': 0.2,
      'amp_env.attack': 0.5, 'amp_env.decay': 450, 'amp_env.sustain': 0, 'amp_env.release': 250,
      'dist.type': 'fold', 'dist.drive': 0.55, 'dist.mix': 0.9, 'dist.post_tone': 0.65, 'dist.clean_below': 90,
      'sub.level': 0.4, 'comp.amount': 0.4, 'reverb.mix': 0.08, 'reverb.size': 0.3, 'eq.highcut': 12000, 'voice.velocity': 0.5,
      'lfo1.shape': 'sample_hold', 'lfo1.rate': 0.5, 'lfo1.retrigger': false,
    },
    mods: [['velocity', 'dist_drive', 0.2], ['lfo1', 'dist_drive', 0.08]],
  },
  {
    dir: 'physical-model', family: 'experimental', name: 'Plucked Tube',
    description: 'Physical-model bass: a modelled plucked string over a sine body, eerily real with a faint flanged air.',
    tags: ['physical-modeling', 'string', 'acoustic', 'eerie', 'hybrid', 'experimental'],
    set: {
      'osc1.wave': 'string', 'osc1.level': 0.8, 'string.tone': 0.45, 'string.decay': 0.45, 'osc2.wave': 'sine', 'osc2.semi': -12, 'osc2.level': 0.25,
      'filter.cutoff': 2500, 'filter.resonance': 0.15, 'filter.keytrack': 0.6,
      'amp_env.attack': 0.5, 'amp_env.decay': 1200, 'amp_env.sustain': 0.3, 'amp_env.release': 300,
      'sub.level': 0.4, 'chorus.mix': 0.1, 'chorus.depth': 0.25, 'reverb.mix': 0.1, 'reverb.size': 0.4,
      'flanger.mix': 0.1, 'flanger.rate': 0.1, 'flanger.feedback': 0.5, 'comp.amount': 0.35, 'eq.highcut': 9000,
    },
    mods: [['velocity', 'filter_cutoff', 0.25], ['drift', 'filter_cutoff', 0.04]],
  },
  {
    dir: 'glitch-micro', family: 'experimental', name: 'Micro Glitch',
    description: 'Glitch micro-bass: stuttering 1/32 gates, random filter and bitcrush bursts over a steady sub.',
    tags: ['glitch', 'idm', 'micro', 'stutter', 'experimental', 'digital', 'broken'],
    set: {
      'osc1.wave': 'pulse', 'osc1.pulse_width': 0.3, 'osc1.level': 0.7, 'osc2.wave': 'sine', 'osc2.semi': -12, 'osc2.level': 0.4,
      'lfo1.shape': 'square', 'lfo1.sync': '1/32', 'lfo1.retrigger': true, 'lfo2.shape': 'sample_hold', 'lfo2.sync': '1/16', 'lfo2.retrigger': true,
      'crush.mix': 0.25, 'crush.bits': 6, 'crush.rate': 4, 'filter.cutoff': 2400, 'filter.resonance': 0.3,
      'amp_env.attack': 0.5, 'amp_env.decay': 300, 'amp_env.sustain': 0.7, 'amp_env.release': 40,
      'sub.level': 0.5, 'comp.amount': 0.45, 'eq.highcut': 12000, 'voice.analog': 0.1,
    },
    mods: [['lfo1', 'amp', -0.6], ['lfo2', 'filter_cutoff', 0.35], ['lfo2', 'crush_mix', 0.5], ['velocity', 'filter_cutoff', 0.15]],
  },
  {
    dir: 'chiptune-8bit', family: 'experimental', name: '8-Bit Pulse',
    description: 'Deliberately lo-fi chiptune bass: a 25% NES pulse and triangle, bit-crushed, with a duty-cycle wobble.',
    tags: ['chiptune', '8-bit', 'nes', 'game', 'retro', 'lo-fi', 'pulse'],
    set: {
      'osc1.wave': 'pulse', 'osc1.pulse_width': 0.25, 'osc1.level': 0.7, 'osc2.wave': 'triangle', 'osc2.semi': -12, 'osc2.level': 0.4,
      'crush.mix': 0.45, 'crush.bits': 7, 'crush.rate': 3, 'filter.cutoff': 20000, 'filter.keytrack': 0,
      'amp_env.attack': 0.5, 'amp_env.decay': 200, 'amp_env.sustain': 0.75, 'amp_env.release': 30,
      'sub.level': 0.3, 'comp.amount': 0.3, 'eq.highcut': 12000, 'voice.analog': 0,
      'lfo1.shape': 'triangle', 'lfo1.rate': 6, 'lfo1.retrigger': true,
    },
    mods: [['lfo1', 'osc1_pw', 0.08], ['velocity', 'crush_mix', 0.15]],
  },
  {
    dir: 'shepard', family: 'experimental', name: 'Endless Fall',
    description: 'Shepard-tone bass: octave-spaced sines that seem to fall forever, anchored by a steady sub.',
    tags: ['shepard', 'illusion', 'tension', 'cinematic', 'experimental', 'endless', 'falling'],
    set: {
      'osc1.wave': 'shepard', 'osc1.level': 0.75, 'shepard.rate': -0.35, 'sub.level': 0.5, 'filter.cutoff': 3000,
      'amp_env.attack': 30, 'amp_env.decay': 2000, 'amp_env.sustain': 0.9, 'amp_env.release': 800,
      'chorus.mix': 0.2, 'chorus.depth': 0.3, 'reverb.mix': 0.15, 'reverb.size': 0.6, 'reverb.tone': 0.6, 'comp.amount': 0.3, 'eq.highcut': 9000,
    },
    mods: [['velocity', 'filter_cutoff', 0.12], ['drift', 'filter_cutoff', 0.03]],
  },
  {
    dir: 'generative-drone', family: 'cinematic', name: 'Modular Drift',
    description: 'Generative modular drone: two wavetables and FM cross-modulated by random sample-and-hold and drifting sources.',
    tags: ['generative', 'modular', 'drone', 'evolving', 'ambient', 'random', 'experimental'],
    set: {
      'osc1.wave': 'wavetable', 'osc1.wt_pos': 0.4, 'osc1.level': 0.6, 'osc2.wave': 'wavetable', 'osc2.wt_pos': 0.7, 'osc2.semi': 7, 'osc2.level': 0.35,
      'fm.amount': 0.12, 'fm.ratio': 2, 'filter.cutoff': 900, 'filter.resonance': 0.4, 'filter.keytrack': 0.4,
      'lfo1.shape': 'triangle', 'lfo1.rate': 0.07, 'lfo1.retrigger': false, 'lfo2.shape': 'sample_hold', 'lfo2.rate': 0.3, 'lfo2.retrigger': false,
      'amp_env.attack': 600, 'amp_env.decay': 2000, 'amp_env.sustain': 1, 'amp_env.release': 2500,
      'reverb.mix': 0.3, 'reverb.size': 0.8, 'reverb.tone': 0.6, 'delay.mix': 0.15, 'delay.time': '1/2', 'delay.feedback': 0.5, 'delay.tone': 0.3,
      'sub.level': 0.45, 'comp.amount': 0.25, 'eq.highcut': 9000, 'voice.analog': 0.5,
    },
    mods: [['drift', 'osc1_wt_pos', 0.3], ['lfo2', 'filter_cutoff', 0.25], ['lfo_product', 'osc2_wt_pos', 0.3], ['drift', 'fm_amount', 0.15], ['lfo1', 'lfo2_rate', 0.3], ['velocity', 'filter_cutoff', 0.1]],
  },
  {
    dir: 'bootsy-envelope', family: 'funk', name: 'Auto-Wah Funk',
    description: 'Bootsy-style envelope-filter funk: a resonant filter that quacks open with every note, wider the harder you play.',
    tags: ['funk', 'bootsy', 'envelope-filter', 'auto-wah', 'p-funk', '70s', 'squelch'],
    set: {
      'osc1.wave': 'saw', 'osc1.level': 0.7, 'osc2.wave': 'pulse', 'osc2.pulse_width': 0.4, 'osc2.semi': -12, 'osc2.level': 0.4,
      'filter.type': 'lowpass', 'filter.cutoff': 250, 'filter.resonance': 0.62, 'filter.env_amount': 0.5, 'filter.keytrack': 0.4,
      'mod_env.attack': 3, 'mod_env.decay': 260, 'mod_env.sustain': 0.15, 'mod_env.release': 120,
      'amp_env.attack': 1.5, 'amp_env.decay': 500, 'amp_env.sustain': 0.7, 'amp_env.release': 100,
      'sub.level': 0.55, 'drive.amount': 0.3, 'dist.type': 'tube', 'dist.drive': 0.15, 'dist.mix': 0.5, 'dist.clean_below': 120,
      'comp.amount': 0.45, 'phaser.mix': 0.12, 'phaser.rate': 0.4, 'eq.highcut': 6000, 'voice.velocity': 0.5,
    },
    mods: [['velocity', 'filter_cutoff', 0.3]],
  },
  {
    dir: 'talkbox-zapp', family: 'funk', name: 'Talkbox Zapp',
    description: 'Zapp-style talkbox bass: a gliding saw shaped by a mouth-like vowel filter that says "wow" on every note.',
    tags: ['talkbox', 'zapp', 'roger-troutman', 'funk', 'vocal', 'vowel', 'electro-funk'],
    set: {
      'osc1.wave': 'saw', 'osc1.unison_voices': 2, 'osc1.unison_detune': 6, 'osc1.level': 0.75,
      'filter.type': 'formant', 'filter.cutoff': 1800, 'filter.resonance': 0.55, 'filter.vowel': 0.1,
      'mod_env.attack': 5, 'mod_env.decay': 300, 'mod_env.sustain': 0.4, 'mod_env.release': 150,
      'voice.legato': true, 'voice.glide': 80, 'sub.level': 0.55, 'drive.amount': 0.3, 'comp.amount': 0.45,
      'chorus.mix': 0.1, 'chorus.depth': 0.3, 'eq.highcut': 11000,
      'lfo1.shape': 'sine', 'lfo1.rate': 0.4, 'lfo1.retrigger': false,
    },
    mods: [['mod_env', 'filter_vowel', 0.5], ['modwheel', 'filter_vowel', 0.6], ['lfo1', 'filter_vowel', 0.1], ['velocity', 'filter_cutoff', 0.15]],
  },
];

// ------------------------------------------------------------------ build

function build(def: Def): Record<string, unknown> {
  if (def.mods.length > 12) throw new Error(`${def.dir}: more than 12 mod slots`);
  const raw: Record<string, unknown> = {
    meta: { name: def.name, description: def.description, tags: def.tags, directory: def.dir, family: def.family },
    'wheel.preset': wheelDefault(undefined),
    ...BASE,
    ...def.set,
  };
  def.mods.forEach(([src, dst, amt], i) => {
    raw[`mod${i + 1}.source`] = src;
    raw[`mod${i + 1}.dest`] = dst;
    raw[`mod${i + 1}.amount`] = amt;
  });
  foldOctave(raw, def.dir);
  const { patch, issues } = validatePatch(raw);
  if (issues.length) throw new Error(`${def.dir}: ${JSON.stringify(issues)}`);
  const out: Record<string, unknown> = { meta: patch.meta };
  for (const p of params) out[p.id] = patch[p.id];
  return out;
}

const libDir = join(ROOT, 'data/library');
mkdirSync(libDir, { recursive: true });
// Only replace this builder's own files (one per directory entry); the Terror
// presets and the bank are built by their own tools.
const own = new Set(D.map((d) => `${d.dir}.json`));
for (const f of readdirSync(libDir)) if (own.has(f)) unlinkSync(join(libDir, f));
const seen = new Set<string>();
for (const def of D) {
  if (seen.has(def.dir)) throw new Error(`duplicate ${def.dir}`);
  seen.add(def.dir);
  writeFileSync(join(libDir, `${def.dir}.json`), JSON.stringify(build(def), null, 2) + '\n');
}
console.log(`built ${D.length} patches`);
