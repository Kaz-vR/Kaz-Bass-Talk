// DEV ONLY. Texture: noise, dust, air and hum shaped into playable beds, the
// grain under everything. The texture bed and breath are the main voice; a
// faint tonal body underneath keeps them playable.
import { type CategoryDef, type Mod } from './common';

const base = {
  'voice.polyphony': 4,
  'osc1.wave': 'triangle', 'osc1.level': 0.25, 'osc1.unison_voices': 3, 'osc1.unison_detune': 12,
  'amp_env.attack': 400, 'amp_env.decay': 5000, 'amp_env.sustain': 1, 'amp_env.release': 2500,
  'filter.cutoff': 1500, 'filter.env_amount': 0,
  'breath.level': 0.15, 'breath.tone': 0.5, 'drive.amount': 0.5,
  'reverb.mix': 0.4, 'reverb.size': 0.9, 'delay.mix': 0.15, 'eq.highcut': 5500, 'lfo2.fade': 0,
};

/** Textures move their bed, breath and grain more than any pitch. */
const TEXTURE_KIT: Mod[] = [
  ['lfo1', 'texture_level', 0.4],
  ['lfo2', 'breath_level', 0.25],
  ['drift_slow', 'filter_cutoff', 0.35],
  ['lfo3', 'tape_wow', 0.3],
  ['lfo4', 'width', 0.3],
  ['env2', 'texture_level', 0.15],
  ['random', 'breath_level', 0.1],
  ['drift', 'pitch', 0.0015],
  ['lfo1', 'delay_time', 0.04],
  ['drift_slow', 'reverb_mix', 0.2],
  ['lfo4', 'chorus_depth', 0.25],
  ['velocity', 'texture_level', 0.15],
];

/** Band-passed beds: the band itself is the tone, so it drifts less. */
const BANDPASS_KIT: Mod[] = TEXTURE_KIT.map((m) => (m[1] === 'filter_cutoff' ? (['drift_slow', 'filter_cutoff', 0.2] as Mod) : m));

const def: CategoryDef = {
  category: 'texture',
  base,
  kit: TEXTURE_KIT,
  presets: [
    {
      id: 'vinyl-night', name: 'Vinyl Night',
      description: 'The run-out groove of an old record at 3 a.m.: crackle and pops over a faint warm tone.',
      tags: ['texture', 'vinyl', 'crackle', 'pops', 'lo-fi', 'night', 'lorn'],
      texture: ['crackle', 0.7, 0.4, 3000],
      set: {},
    },
    {
      id: 'dust-field', name: 'Dust Field',
      description: 'A field of fine dust and grit, glittering in the stereo field.',
      tags: ['texture', 'dust', 'grit', 'grain', 'wide', 'lo-fi', 'lorn'],
      texture: ['dust', 0.7, 0.35, 3000],
      set: {},
    },
    {
      id: 'breath-room', name: 'Breath Room',
      description: 'A room full of breathing: soft air swelling and fading around a quiet tone.',
      tags: ['texture', 'air', 'breath', 'soft', 'room', 'intimate', 'lorn'],
      texture: ['air', 0.7, 0.15, 3000],
      set: { 'breath.level': 0.3, 'breath.tone': 0.2, 'chorus.mix': 0.1, 'eq.highcut': 4000 },
      mods: TEXTURE_KIT.map((m) => (m[1] === 'chorus_depth' ? (['lfo4', 'delay_mix', 0.22] as Mod) : m)),
    },
    {
      id: 'deep-hum', name: 'Deep Hum',
      description: 'A low electrical hum you feel more than hear, shifting slowly under a layer of fine dust.',
      tags: ['texture', 'hum', 'dust', 'low', 'deep', 'pressure', 'lorn'],
      texture: ['dust', 0.6, 0.3, 3500],
      set: {
        'osc1.wave': 'saw', 'osc1.level': 0.3, 'filter.cutoff': 900, 'noise.level': 0.3, 'drive.amount': 0.9, 'dist.type': 'tube', 'dist.drive': 0.5,
        'dist.mix': 0.8, 'dist.clean_below': 100,
      },
      // A hum, not a breath: the motion is in the tube grit and the noise floor.
      mods: TEXTURE_KIT.map((m) => (m[0] === 'lfo2' ? (['lfo2', 'dist_drive', 0.25] as Mod) : m[0] === 'random' ? (['random', 'noise_level', 0.12] as Mod) : m)),
    },
    {
      id: 'rain-static', name: 'Rain Static',
      description: 'Busy, bright crackle like rain on a tin roof heard through a broken speaker.',
      tags: ['texture', 'crackle', 'rain', 'static', 'busy', 'noise', 'lorn'],
      texture: ['crackle', 0.55, 0.4, 2500],
      set: { 'eq.highcut': 5000, 'drive.amount': 0.7 },
      mods: TEXTURE_KIT.map((m) => (m[1] === 'width' ? (['lfo4', 'width', 0.5] as Mod) : m)),
    },
    {
      id: 'ash-wind', name: 'Ash Wind',
      description: 'Ash blowing in the wind: air and noise moving through a wandering band.',
      tags: ['texture', 'wind', 'air', 'noise', 'ash', 'atmosphere', 'lorn'],
      texture: ['air', 0.7, 0.25, 3000],
      set: { 'noise.level': 0.12, 'filter.type': 'bandpass', 'filter.cutoff': 600, 'filter.resonance': 0.3, 'eq.highcut': 3800 },
      mods: BANDPASS_KIT,
    },
    {
      id: 'pressure-hiss', name: 'Pressure Hiss',
      description: 'A pressurised hiss leaking from a pipe, dusty and slowly changing.',
      tags: ['texture', 'hiss', 'noise', 'pressure', 'dust', 'industrial', 'lorn'],
      texture: ['dust', 0.6, 0.35, 2500],
      set: { 'noise.level': 0.3, 'filter.cutoff': 1200, 'filter.resonance': 0.3, 'breath.level': 0.3 },
      mods: TEXTURE_KIT.map((m) => (m[0] === 'lfo2' ? (['lfo2', 'noise_level', 0.15] as Mod) : m[0] === 'env2' ? (['drift_slow', 'noise_level', 0.2] as Mod) : m[0] === 'random' ? (['random', 'breath_level', 0.25] as Mod) : m[1] === 'delay_time' ? (['lfo1', 'filter_cutoff', 0.2] as Mod) : m)),
    },
    {
      id: 'grit-bed', name: 'Grit Bed',
      description: 'Crushed grit and grain, the sound of a recording falling apart.',
      tags: ['texture', 'grit', 'crushed', 'grain', 'broken', 'lo-fi', 'lorn'],
      texture: ['dust', 0.7, 0.45, 2500],
      set: { 'crush.mix': 0.35, 'crush.bits': 5, 'crush.rate': 9 },
    },
    {
      id: 'old-house', name: 'Old House',
      description: 'An old house at night: a low rumble and creaking resonances in the walls.',
      tags: ['texture', 'rumble', 'creak', 'comb', 'house', 'haunted', 'lorn'],
      texture: ['rumble', 0.7, 0.4, 3000],
      set: { 'filter.type': 'comb', 'filter.cutoff': 250, 'filter.resonance': 0.4, 'breath.level': 0.25, 'eq.highcut': 4500 },
    },
    {
      id: 'radio-floor', name: 'Radio Floor',
      description: 'The noise floor of a radio between stations: dusty, band-limited and crushed.',
      tags: ['texture', 'radio', 'static', 'band-limited', 'crushed', 'dust', 'lorn'],
      texture: ['dust', 0.7, 0.5, 2500],
      set: { 'filter.type': 'bandpass', 'filter.cutoff': 1000, 'filter.resonance': 0.3, 'crush.mix': 0.3, 'crush.bits': 6, 'crush.rate': 8, 'eq.highcut': 4500 },
      mods: BANDPASS_KIT.map((m) => (m[1] === 'filter_cutoff' ? (['drift_slow', 'filter_cutoff', 0.12] as Mod) : m)),
    },
  ],
};

export default def;
