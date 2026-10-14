// DEV ONLY. Keys: worn electric and toy keys, soft tines and felt hammers
// through tape and a dark room. Velocity is brightness (FM depth).
import { kit, type CategoryDef, type Mod } from './common';

const base = {
  'voice.polyphony': 8,
  // Three unison voices: two beat at one fixed rate (a clock); three beat irregularly.
  'osc1.wave': 'triangle', 'osc1.unison_voices': 3, 'osc1.unison_detune': 8,
  'fm.amount': 0.12, 'fm.ratio': 1, 'fm.punch': 0.35, 'fm.decay': 250,
  'amp_env.attack': 3, 'amp_env.decay': 3500, 'amp_env.sustain': 0.25, 'amp_env.release': 900,
  'filter.cutoff': 2400, 'filter.keytrack': 0.5, 'filter.env_amount': 0,
  'lfo2.fade': 0, 'osc1.unison_spread': 0.5,
  'tape.wow': 0.25, 'tape.age': 0.45, 'drive.amount': 0.5, 'dist.drive': 0.25,
  'chorus.mix': 0.22, 'reverb.mix': 0.3, 'reverb.size': 0.7, 'delay.mix': 0.1, 'eq.highcut': 6500, 'fx.lowcut': 250,
};

/** Keys move their FM (the tine's bark), level, saturation and tape, not a filter far above them. */
const KEYS_KIT: Mod[] = [
  ['lfo1', 'fm_amount', 0.1],
  ['lfo2', 'amp', -0.12],
  ['env2', 'drive', 0.2],
  ['drift_slow', 'drive', 0.2],
  ['lfo3', 'tape_wow', 0.3],
  ['lfo4', 'width', 0.25],
  ['drift', 'pitch', 0.0015],
  ['lfo1', 'delay_time', 0.04],
  ['drift_slow', 'reverb_mix', 0.2],
  ['lfo4', 'chorus_depth', 0.25],
  ['velocity', 'fm_amount', 0.2],
  ['random', 'fm_amount', 0.06],
];

/** For keys without FM: the same motion on the filter. */
const FILTER_KEYS_KIT = kit(KEYS_KIT, [], {
  'lfo1>fm_amount': ['lfo1', 'filter_cutoff', 0.2],
  'velocity>fm_amount': ['velocity', 'filter_cutoff', 0.2],
  'random>fm_amount': ['random', 'filter_cutoff', 0.1],
  'env2>drive': ['env2', 'filter_cutoff', 0.15],
  'drift_slow>drive': ['drift_slow', 'filter_cutoff', 0.12],
});

const def: CategoryDef = {
  category: 'keys',
  base,
  kit: KEYS_KIT,
  presets: [
    {
      id: 'burnt-rhodes', name: 'Burnt Rhodes',
      description: 'A worn electric piano: soft tines that bark when hit hard, wobbling on old tape.',
      tags: ['keys', 'electric-piano', 'rhodes', 'fm', 'tape', 'warm', 'lorn'],
      texture: ['dust', 0.45, 0.3, 1200],
      set: { 'fm.amount': 0.15, 'fm.punch': 0.5 },
    },
    {
      id: 'toy-box', name: 'Toy Box',
      description: 'A child\'s toy piano left in an attic for decades: thin, bell-like, warped and crackling.',
      tags: ['keys', 'toy-piano', 'bell', 'warped', 'creepy', 'crackle', 'lorn'],
      texture: ['crackle', 0.55, 0.4, 1000],
      set: { 'voice.octave': 1, 'fm.ratio': 3.5, 'fm.amount': 0.2, 'fm.punch': 0.4, 'tape.wow': 0.5, 'amp_env.decay': 2000 },
    },
    {
      id: 'felt-piano', name: 'Felt Piano',
      description: 'A muted upright with felt on the hammers: soft, intimate and slightly out of tune.',
      tags: ['keys', 'piano', 'felt', 'soft', 'intimate', 'muted', 'lorn'],
      texture: ['dust', 0.45, 0.25, 1500],
      set: {
        'fm.amount': 0, 'fm.punch': 0, 'breath.chiff': 0.3, 'breath.tone': 0.3, 'breath.decay': 60, 'filter.cutoff': 1200,
        'amp_env.decay': 4000, 'osc2.wave': 'saw', 'osc2.level': 0.15,
      },
      mods: kit(FILTER_KEYS_KIT, [['drift_slow', 'filter_cutoff', 0.2], ['random', 'filter_cutoff', 0.2]]),
    },
    {
      id: 'wurly-rot', name: 'Wurly Rot',
      description: 'A reedy, overdriven electric piano with a wandering tremolo, rotting in a damp room.',
      tags: ['keys', 'wurlitzer', 'reedy', 'overdriven', 'tremolo', 'vintage', 'lorn'],
      texture: ['dust', 0.45, 0.35, 1000],
      set: {
        'osc1.wave': 'pulse', 'osc1.pulse_width': 0.45, 'fm.amount': 0, 'fm.punch': 0, 'filter.cutoff': 1500, 'filter.env_amount': 0.3,
        'mod_env.decay': 600, 'mod_env.sustain': 0.1, 'drive.amount': 0.6, 'chorus.mix': 0.12,
      },
      mods: kit(FILTER_KEYS_KIT, [['lfo2', 'amp', -0.22], ['drift_slow', 'filter_cutoff', 0.2]]),
    },
    {
      id: 'dust-organ', name: 'Dust Organ',
      description: 'An old drawbar organ with a key click, slowly spinning speaker and dust in its pipes.',
      tags: ['keys', 'organ', 'drawbar', 'click', 'vintage', 'dust', 'lorn'],
      texture: ['dust', 0.5, 0.35, 800],
      set: {
        'osc1.wave': 'sine', 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.level': 0.4, 'fm.amount': 0, 'fm.punch': 0,
        'amp_env.sustain': 0.9, 'amp_env.release': 300, 'click.type': 'click', 'click.level': 0.8, 'click.tone': 2000, 'click.decay': 12,
        'chorus.mix': 0.45, 'drive.amount': 0.6, 'dist.drive': 0.3,
      },
      mods: kit(KEYS_KIT, [], {
        'lfo1>fm_amount': ['lfo1', 'osc2_level', 0.2],
        'velocity>fm_amount': ['velocity', 'osc2_level', 0.2],
        'random>fm_amount': ['random', 'osc2_level', 0.1],
        'drift_slow>drive': ['drift_slow', 'osc2_level', 0.15],
      }),
    },
    {
      id: 'glass-harp', name: 'Glass Harp',
      description: 'Bright, glassy FM keys like wet fingers on crystal, ringing into a cold room.',
      tags: ['keys', 'fm', 'glass', 'crystal', 'bright', 'cold', 'lorn'],
      texture: ['air', 0.45, 0.4, 1500],
      set: { 'osc1.wave': 'sine', 'fm.ratio': 2, 'fm.amount': 0.25, 'fm.punch': 0.3, 'reverb.mix': 0.38 },
    },
    {
      id: 'clav-ghost', name: 'Clav Ghost',
      description: 'A short, snappy clavinet played through broken digital speakers.',
      tags: ['keys', 'clavinet', 'funky', 'snappy', 'crushed', 'dark', 'lorn'],
      texture: ['dust', 0.45, 0.4, 600],
      set: {
        'osc1.wave': 'pulse', 'osc1.pulse_width': 0.2, 'fm.amount': 0, 'fm.punch': 0, 'filter.cutoff': 600, 'filter.env_amount': 0.6,
        'mod_env.decay': 200, 'mod_env.sustain': 0, 'amp_env.decay': 900, 'amp_env.sustain': 0.1,
        'crush.mix': 0.2, 'crush.bits': 6, 'crush.rate': 7,
      },
      mods: FILTER_KEYS_KIT,
    },
    {
      id: 'midnight-upright', name: 'Midnight Upright',
      description: 'A plucked-string piano in an empty bar after closing: woody, ringing and a little sour.',
      tags: ['keys', 'piano', 'string', 'woody', 'ringing', 'late-night', 'lorn'],
      texture: ['crackle', 0.45, 0.3, 1200],
      set: {
        'osc1.wave': 'string', 'string.tone': 0.45, 'string.decay': 0.75, 'osc2.wave': 'triangle', 'osc2.level': 0.2,
        'fm.amount': 0, 'fm.punch': 0, 'filter.cutoff': 3000, 'chorus.mix': 0.45, 'delay.mix': 0.2,
        'osc2.unison_voices': 3, 'osc2.unison_detune': 8, 'osc2.unison_spread': 1,
      },
      mods: kit(KEYS_KIT, [], {
        'lfo1>fm_amount': ['lfo1', 'osc2_level', 0.2],
        'velocity>fm_amount': ['velocity', 'drive', 0.2],
        'random>fm_amount': ['random', 'osc2_level', 0.1],
      }),
    },
    {
      id: 'lofi-grand', name: 'Lo-Fi Grand',
      description: 'A grand piano sampled from a cassette: soft, wide, warbling and dull.',
      tags: ['keys', 'piano', 'lo-fi', 'cassette', 'warble', 'soft', 'lorn'],
      texture: ['crackle', 0.5, 0.3, 1500],
      set: {
        'osc2.wave': 'saw', 'osc2.level': 0.25, 'fm.amount': 0.08, 'amp_env.decay': 4500, 'tape.wow': 0.45, 'tape.age': 0.65, 'eq.highcut': 5000,
      },
    },
    {
      id: 'moth-keys', name: 'Moth Keys',
      description: 'Soft FM keys that flutter into each note and hang in the air like dust in lamplight.',
      tags: ['keys', 'fm', 'soft', 'airy', 'dreamy', 'ambient', 'lorn'],
      texture: ['air', 0.45, 0.3, 2000],
      set: { 'amp_env.attack': 30, 'fm.amount': 0.1, 'fm.punch': 0.2, 'chorus.mix': 0.45, 'reverb.mix': 0.4 },
    },
  ],
};

export default def;
