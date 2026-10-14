// DEV ONLY. Hits / impacts: a heavy transient, a pitch-dropped distorted body
// and a long dark tail. Every hit a little different (per-hit random).
import { type CategoryDef, type Mod } from './common';

const base = {
  'voice.polyphony': 4,
  'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'osc1.level': 0.7,
  'pitch_env.amount': 24, 'pitch_env.decay': 120,
  'amp_env.attack': 1, 'amp_env.decay': 1800, 'amp_env.sustain': 0, 'amp_env.release': 1500,
  'click.type': 'kick', 'click.level': 0.6, 'click.tone': 180, 'click.decay': 60,
  'drive.amount': 0.65, 'dist.type': 'tube', 'dist.drive': 0.4, 'dist.mix': 0.7, 'dist.clean_below': 60,
  'noise.level': 0.15,
  'filter.cutoff': 3000, 'filter.keytrack': 0.3, 'filter.env_amount': 0, 'mod_env.decay': 300, 'mod_env.sustain': 0,
  'reverb.mix': 0.45, 'reverb.size': 0.9, 'reverb.tone': 0.85, 'delay.mix': 0,
  'comp.amount': 0.5, 'ott.amount': 0.25, 'eq.highcut': 6500, 'lfo2.fade': 0, 'chorus.mix': 0.2,
};

/** Every hit lands a little differently; the room and the grit wander slowly between hits. */
const HIT_KIT: Mod[] = [
  ['random', 'drive', 0.15],
  ['random', 'pitch', 0.004],
  ['velocity', 'drive', 0.2],
  ['drift_slow', 'reverb_mix', 0.2],
  ['lfo1', 'filter_cutoff', 0.2],
  ['lfo4', 'width', 0.25],
  ['drift', 'pitch', 0.0015],
  ['lfo3', 'tape_wow', 0.3],
  ['random', 'noise_level', 0.15],
  ['velocity', 'filter_cutoff', 0.2],
];

const def: CategoryDef = {
  category: 'hits',
  base,
  kit: HIT_KIT,
  presets: [
    {
      id: 'collapse', name: 'Collapse',
      description: 'A building coming down: a folded, distorted boom that drops in pitch into a vast dark room.',
      tags: ['hit', 'impact', 'boom', 'fold', 'cinematic', 'trailer', 'lorn'],
      texture: ['rumble', 0.3, 0.3, 2500],
      set: { 'dist.type': 'fold', 'dist.drive': 0.3 },
    },
    {
      id: 'iron-door', name: 'Iron Door',
      description: 'A heavy iron door slammed in a bunker: a metallic ring over a dull thud.',
      tags: ['hit', 'impact', 'metallic', 'comb', 'door', 'industrial', 'lorn'],
      texture: ['rumble', 0.3, 0.4, 2000],
      set: { 'filter.type': 'comb', 'filter.cutoff': 200, 'filter.resonance': 0.45, 'filter.keytrack': 0, 'noise.level': 0.2, 'click.type': 'knock', 'click.tone': 400 },
    },
    {
      id: 'blackout', name: 'Blackout',
      description: 'A deep sub boom that hits the chest and leaves the room ringing in the dark.',
      tags: ['hit', 'impact', 'sub', 'boom', 'deep', 'cinematic', 'lorn'],
      texture: ['rumble', 0.3, 0.3, 3000],
      set: { 'pitch_env.amount': 12, 'pitch_env.decay': 300, 'sub.level': 0.5, 'dist.drive': 0.3, 'dist.clean_below': 90, 'reverb.mix': 0.35 },
    },
    {
      id: 'shatter', name: 'Shatter',
      description: 'Something breaks: a crushed burst of noise and debris raining into the reverb.',
      tags: ['hit', 'impact', 'noise', 'crushed', 'shatter', 'glitch', 'lorn'],
      texture: ['crackle', 0.3, 0.45, 2000],
      set: { 'noise.level': 0.45, 'osc1.level': 0.3, 'crush.mix': 0.4, 'crush.bits': 5, 'crush.rate': 9, 'eq.highcut': 3000 },
    },
    {
      id: 'thunder-slam', name: 'Thunder Slam',
      description: 'A slam with thunder behind it: noise and saws tearing open, then rolling away.',
      tags: ['hit', 'impact', 'thunder', 'noise', 'slam', 'huge', 'lorn'],
      texture: ['rumble', 0.3, 0.35, 3000],
      set: {
        'noise.level': 0.35, 'osc1.wave': 'saw', 'osc1.unison_voices': 3, 'osc1.unison_detune': 15, 'filter.cutoff': 1200,
        'filter.env_amount': 0.45, 'reverb.mix': 0.55,
      },
    },
    {
      id: 'braam-hit', name: 'Braam Hit',
      description: 'A short, brassy braam: a wall of detuned saws with an octave below, blasting and decaying.',
      tags: ['hit', 'braam', 'brass', 'trailer', 'huge', 'cinematic', 'lorn'],
      texture: ['rumble', 0.3, 0.35, 2500],
      set: {
        'osc1.wave': 'saw', 'osc1.unison_voices': 5, 'osc1.unison_detune': 18, 'osc2.wave': 'saw', 'osc2.semi': -12, 'osc2.level': 0.4,
        'pitch_env.amount': 2, 'filter.cutoff': 600, 'filter.env_amount': 0.5, 'mod_env.decay': 900, 'dist.drive': 0.35, 'dist.clean_below': 120,
        'click.level': 0.3, 'noise.level': 0.12,
      },
    },
    {
      id: 'dead-impact', name: 'Dead Impact',
      description: 'A tight, heavy, compressed impact with a short dark tail: no wasted space.',
      tags: ['hit', 'impact', 'tight', 'punchy', 'compressed', 'short', 'lorn'],
      texture: ['dust', 0.3, 0.35, 1000],
      set: { 'amp_env.decay': 600, 'reverb.mix': 0.55, 'reverb.size': 0.82, 'comp.amount': 0.6, 'eq.highcut': 5500 },
    },
    {
      id: 'grave-drop', name: 'Grave Drop',
      description: 'A long downward dive into the ground, distorted all the way down.',
      tags: ['hit', 'drop', 'dive', 'pitch', 'distorted', 'falling', 'lorn'],
      texture: ['rumble', 0.3, 0.3, 2500],
      set: { 'pitch_env.amount': 36, 'pitch_env.decay': 1500, 'amp_env.decay': 2500, 'dist.drive': 0.45 },
    },
    {
      id: 'glass-crash', name: 'Glass Crash',
      description: 'A metallic FM crash with shards of crushed noise: a hit that rings like broken glass.',
      tags: ['hit', 'impact', 'fm', 'glass', 'metallic', 'crash', 'lorn'],
      texture: ['crackle', 0.3, 0.4, 2000],
      set: { 'fm.amount': 0.3, 'fm.ratio': 3.7, 'fm.punch': 0.8, 'fm.decay': 400, 'noise.level': 0.2, 'crush.mix': 0.25, 'crush.bits': 6, 'crush.rate': 7 },
      mods: HIT_KIT.map((m) => (m[0] === 'lfo1' ? (['lfo1', 'fm_amount', 0.12] as Mod) : m)),
    },
    {
      id: 'engine-stop', name: 'Engine Stop',
      description: 'A machine dying mid-hit: the pitch sags and collapses like a tape stopping.',
      tags: ['hit', 'tape-stop', 'pitch', 'collapse', 'machine', 'dying', 'lorn'],
      texture: ['dust', 0.3, 0.3, 2000],
      set: {
        'osc1.wave': 'saw', 'osc1.unison_voices': 2, 'osc1.unison_spread': 0.5, 'chorus.mix': 0.1, 'filter.cutoff': 1500, 'pitch_env.amount': 0,
        'env2.attack': 800, 'env2.sustain': 1,
        'amp_env.decay': 1500,
      },
      mods: [...HIT_KIT, ['env2', 'pitch', -0.5]],
    },
  ],
};

export default def;
