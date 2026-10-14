// DEV ONLY. Bells / mallets: detuned, broken bells and mallets. FM with
// inharmonic ratios; the punch (bright partials) decays faster than the
// body, like a real bell; slight detune; worn tape; a dark room.
import { kit, type CategoryDef, type Mod } from './common';

const base = {
  'voice.polyphony': 8,
  'osc1.wave': 'sine', 'osc1.unison_voices': 1,
  'fm.amount': 0.15, 'fm.ratio': 3.5, 'fm.punch': 0.5, 'fm.decay': 600, 'lfo2.fade': 0,
  'amp_env.attack': 1, 'amp_env.decay': 3500, 'amp_env.sustain': 0, 'amp_env.release': 2500,
  'filter.cutoff': 5000, 'filter.keytrack': 0.3, 'filter.env_amount': 0,
  'drive.amount': 0.5, 'dist.drive': 0.25,
  'tape.wow': 0.3, 'reverb.mix': 0.4, 'delay.mix': 0.18, 'eq.highcut': 6000, 'chorus.mix': 0.25,
};

/** Bells move their FM (the partials), level, saturation and tape. */
const BELL_KIT: Mod[] = [
  ['lfo1', 'fm_amount', 0.1],
  ['lfo2', 'amp', -0.12],
  ['lfo3', 'fm_amount', 0.08],
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

const def: CategoryDef = {
  category: 'bells',
  base,
  kit: BELL_KIT,
  presets: [
    {
      id: 'rust-bell', name: 'Rust Bell',
      description: 'A rusted bell with an inharmonic clang that fades into a warm, dull hum.',
      tags: ['bells', 'bell', 'fm', 'inharmonic', 'rusty', 'dark', 'lorn'],
      texture: ['dust', 0.45, 0.3, 1500],
      set: {},
    },
    {
      id: 'broken-music-box', name: 'Broken Music Box',
      description: 'A music box with a failing motor: wobbling pitch, tinny tines and crackle.',
      tags: ['bells', 'music-box', 'warped', 'creepy', 'crackle', 'toy', 'lorn'],
      texture: ['crackle', 0.55, 0.4, 1200],
      set: { 'fm.ratio': 2, 'fm.amount': 0.15, 'fm.punch': 0.5, 'tape.wow': 0.55, 'amp_env.decay': 1800 },
    },
    {
      id: 'iron-chime', name: 'Iron Chime',
      description: 'A heavy iron chime with a sour, metallic strike.',
      tags: ['bells', 'chime', 'iron', 'metallic', 'sour', 'industrial', 'lorn'],
      texture: ['dust', 0.45, 0.35, 1500],
      set: { 'fm.ratio': 1.41, 'fm.punch': 0.7, 'fm.amount': 0.18 },
    },
    {
      id: 'funeral-bell', name: 'Funeral Bell',
      description: 'A low bell ringing for a long time across an empty town.',
      tags: ['bells', 'bell', 'low', 'funeral', 'long', 'cinematic', 'lorn'],
      texture: ['rumble', 0.5, 0.3, 3000],
      set: { 'voice.octave': -1, 'fm.ratio': 2.76, 'amp_env.decay': 8000, 'fm.decay': 1500, 'reverb.mix': 0.45 },
    },
    {
      id: 'glass-mallet', name: 'Glass Mallet',
      description: 'A short mallet struck on thick glass: a knock, a ring, then silence.',
      tags: ['bells', 'mallet', 'glass', 'marimba', 'short', 'percussive', 'lorn'],
      texture: ['air', 0.45, 0.4, 800],
      set: {
        'fm.ratio': 4, 'fm.amount': 0.1, 'fm.punch': 0.4, 'fm.decay': 150, 'amp_env.decay': 1200,
        'click.type': 'knock', 'click.level': 0.7, 'click.tone': 2500, 'click.decay': 10,
      },
    },
    {
      id: 'ice-gamelan', name: 'Ice Gamelan',
      description: 'Detuned gamelan bells beating against each other, cold and shimmering.',
      tags: ['bells', 'gamelan', 'detuned', 'beating', 'shimmer', 'cold', 'lorn'],
      texture: ['air', 0.45, 0.4, 1500],
      set: { 'fm.ratio': 2.76, 'osc1.unison_voices': 2, 'osc1.unison_detune': 14, 'eq.highcut': 5500 },
    },
    {
      id: 'toll', name: 'Toll',
      description: 'A huge, deep bell toll that shakes the floor and takes forever to die.',
      tags: ['bells', 'toll', 'huge', 'deep', 'long', 'ominous', 'lorn'],
      texture: ['rumble', 0.55, 0.3, 4000],
      set: { 'voice.octave': -2, 'fm.ratio': 2.4, 'fm.amount': 0.12, 'filter.cutoff': 2500, 'amp_env.decay': 10000, 'fm.decay': 2500, 'reverb.mix': 0.45, 'dist.drive': 0.3 },
    },
    {
      id: 'dust-celeste', name: 'Dust Celeste',
      description: 'A soft celeste found in a dusty attic: gentle bell tones and a little grit.',
      tags: ['bells', 'celeste', 'soft', 'gentle', 'dust', 'nostalgic', 'lorn'],
      texture: ['dust', 0.5, 0.3, 1500],
      set: { 'osc1.wave': 'triangle', 'fm.ratio': 4, 'fm.amount': 0.1, 'fm.punch': 0.35, 'amp_env.decay': 2500 },
    },
    {
      id: 'clock-tower', name: 'Clock Tower',
      description: 'Bells inside a hollow tower: a resonant metallic ring around every strike.',
      tags: ['bells', 'tower', 'comb', 'resonant', 'metallic', 'hollow', 'lorn'],
      texture: ['dust', 0.45, 0.35, 2000],
      set: { 'filter.type': 'comb', 'filter.cutoff': 300, 'filter.resonance': 0.3, 'filter.keytrack': 1, 'eq.highcut': 5000 },
    },
    {
      id: 'ghost-vibraphone', name: 'Ghost Vibraphone',
      description: 'A vibraphone with a slow, uneven tremolo, playing alone in a dark club.',
      tags: ['bells', 'vibraphone', 'tremolo', 'soft', 'jazz', 'noir', 'lorn'],
      texture: ['air', 0.45, 0.3, 1500],
      set: { 'fm.ratio': 4, 'fm.amount': 0.08, 'fm.punch': 0.3, 'amp_env.decay': 2500, 'lfo2.rate': 5 },
      mods: kit(BELL_KIT, [['lfo2', 'amp', -0.25]]),
    },
    // ------------------------------------------------ iconic (LORN versions)
    {
      id: 'glass-rain', name: 'Glass Rain', iconic: true,
      description: 'Clear, glistening crystal bells ringing long into a vast space, like light catching rain at night.',
      tags: ['bells', 'crystal', 'fm', 'glistening', 'cinematic', 'eighties', 'lorn'],
      texture: ['air', 0.35, 0.4, 3000],
      set: {
        'fm.amount': 0.3, 'fm2.amount': 0.12, 'fm2.ratio': 7, 'fm.feedback': 0.1, 'reverb.size': 0.95, 'reverb.mix': 0.5,
        'eq.highcut': 9000, 'chorus.mix': 0.3, 'chorus.mode': 'ensemble', 'voice.velocity': 0.85,
      },
    },
    {
      id: 'bicycle-lights', name: 'Bicycle Lights', iconic: true,
      description: 'Small glassy plinks echoing in dotted time: nostalgic, sparkling, a little too quiet for comfort.',
      tags: ['bells', 'plink', 'glassy', 'nostalgic', 'eighties', 'echo', 'lorn'],
      texture: ['dust', 0.35, 0.35, 1200],
      set: {
        'amp_env.decay': 600, 'amp_env.release': 400, 'fm.amount': 0.1, 'fm.ratio': 2, 'osc2.wave': 'triangle', 'osc2.semi': 12,
        'osc2.level': 0.2, 'delay.mix': 0.3, 'delay.time': '1/8D', 'reverb.mix': 0.35, 'reverb.size': 0.8,
      },
    },
    // ------------------------------------------------ filling the gaps
    {
      id: 'rust-kalimba', name: 'Rust Kalimba',
      description: 'A rusty plucked-tine kalimba, crushed and slightly out of tune, each note bending as it rings.',
      tags: ['bells', 'kalimba', 'plucked', 'crushed', 'detuned', 'rusty', 'lorn'],
      texture: ['dust', 0.35, 0.35, 1200],
      set: {
        'voice.octave': -1, 'osc1.wave': 'string', 'string.tone': 0.45, 'string.decay': 0.6, 'fm.amount': 0, 'fm.punch': 0, 'crush.mix': 0.25, 'crush.bits': 6, 'crush.rate': 6,
        'amp_env.decay': 1500,
      },
      // No FM here: the life is in the pitch, the grit and the level. High tines ring out faster: the key lifts their level.
      mods: BELL_KIT.map((m) => (m[1] === 'fm_amount' ? (m[0] === 'random' ? (['random', 'pitch', 0.006] as Mod) : m[0] === 'velocity' ? (['velocity', 'crush_mix', 0.15] as Mod) : m[0] === 'lfo1' ? (['lfo1', 'crush_mix', 0.25] as Mod) : (['keytrack', 'amp', 0.8] as Mod)) : m)),
    },
  ],
};

export default def;
