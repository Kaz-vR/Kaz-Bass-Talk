// DEV ONLY. Drone / FX: endless dark beds and strange machines; slow,
// unstable, always evolving.
import { ALIVE, kit, type CategoryDef } from './common';

const base = {
  'voice.polyphony': 4,
  'osc1.wave': 'saw', 'osc1.unison_voices': 4, 'osc1.unison_detune': 14,
  'osc2.wave': 'saw', 'osc2.semi': -12, 'osc2.level': 0.35, 'osc2.fine': -6,
  'amp_env.attack': 1500, 'amp_env.decay': 5000, 'amp_env.sustain': 1, 'amp_env.release': 3000,
  'filter.cutoff': 500, 'filter.keytrack': 0.3, 'filter.env_amount': 0,
  'drive.amount': 0.55, 'dist.drive': 0.3, 'tape.wow': 0.3, 'tape.age': 0.55,
  'reverb.mix': 0.45, 'reverb.size': 0.95, 'delay.mix': 0.2, 'delay.time': '1/2', 'delay.feedback': 0.55,
  'eq.highcut': 6000, 'fx.lowcut': 220,
  'lfo1.rate': 0.12, 'lfo2.rate': 0.9, 'lfo4.rate': 0.3,
};

/** Drones move slowly and deeply. */
const DRONE_KIT = kit(ALIVE, [['lfo1', 'filter_cutoff', 0.22], ['env2', 'filter_cutoff', 0.2], ['lfo2', 'filter_cutoff', 0.1]]);

const def: CategoryDef = {
  category: 'drone',
  base,
  kit: DRONE_KIT,
  presets: [
    {
      id: 'undercity', name: 'Undercity',
      description: 'A drone from the tunnels under a city: a comb resonance groaning and drifting in the dark.',
      tags: ['drone', 'comb', 'tunnels', 'metallic', 'dark', 'ambient', 'lorn'],
      texture: ['rumble', 0.5, 0.35, 3000],
      set: { 'filter.type': 'comb', 'filter.cutoff': 150, 'filter.resonance': 0.5, 'filter.keytrack': 0.5 },
      mods: kit(DRONE_KIT, [['lfo1', 'filter_cutoff', 0.12], ['lfo2', 'filter_cutoff', 0.03], ['env2', 'filter_cutoff', 0.08]]),
    },
    {
      id: 'reactor', name: 'Reactor',
      description: 'An inharmonic FM hum, like a reactor core breathing behind thick walls.',
      tags: ['drone', 'fm', 'inharmonic', 'reactor', 'hum', 'sci-fi', 'lorn'],
      texture: ['rumble', 0.5, 0.35, 3000],
      set: { 'fm.amount': 0.3, 'fm.ratio': 1.41, 'filter.cutoff': 900 },
      mods: kit(DRONE_KIT, [], { 'lfo2>filter_cutoff': ['lfo2', 'fm_amount', 0.1], 'random>filter_cutoff': ['lfo3', 'fm_amount', 0.12] }),
    },
    {
      id: 'haunted-machine', name: 'Haunted Machine',
      description: 'A broken machine twitching on its own: a jittery filter and crushed grain over a low hum.',
      tags: ['drone', 'machine', 'glitch', 'crushed', 'unstable', 'horror', 'lorn'],
      texture: ['dust', 0.5, 0.4, 2500],
      set: { 'lfo2.rate': 4, 'crush.mix': 0.25, 'crush.bits': 6, 'crush.rate': 8 },
      mods: kit(DRONE_KIT, [['lfo2', 'filter_cutoff', 0.2]]),
    },
    {
      id: 'long-dark', name: 'Long Dark',
      description: 'The sound of a long night: a deep, slowly blooming bed that never quite settles.',
      tags: ['drone', 'dark', 'bloom', 'slow', 'night', 'ambient', 'lorn'],
      texture: ['dust', 0.45, 0.3, 3500],
      set: { 'env2.attack': 6000, 'env2.sustain': 1 },
      mods: kit(DRONE_KIT, [['env2', 'filter_cutoff', 0.3]]),
    },
    {
      id: 'wind-tunnel', name: 'Wind Tunnel',
      description: 'Wind howling through a concrete tunnel: breath and noise through a wandering band.',
      tags: ['drone', 'wind', 'noise', 'breath', 'howl', 'atmosphere', 'lorn'],
      texture: ['air', 0.55, 0.4, 3000],
      set: {
        'noise.level': 0.08, 'breath.level': 0.12, 'breath.tone': 0.2, 'osc1.level': 0.7, 'filter.type': 'bandpass', 'filter.cutoff': 250,
        'filter.resonance': 0.4, 'eq.highcut': 2000,
      },
    },
    {
      id: 'mains-hum', name: 'Mains Hum',
      description: 'A dirty electrical hum and buzz, like a broken amplifier left on in an empty room.',
      tags: ['drone', 'hum', 'buzz', 'electrical', 'amp', 'noise', 'lorn'],
      texture: ['rumble', 0.55, 0.4, 2500],
      set: {
        'osc1.wave': 'sine', 'osc1.unison_voices': 3, 'osc2.wave': 'pulse', 'osc2.pulse_width': 0.1, 'osc2.level': 0.35, 'dist.type': 'tube',
        'dist.drive': 0.35, 'eq.highcut': 4500, 'filter.cutoff': 2500, 'noise.level': 0.05,
      },
      // A buzz, not a filter sweep: the motion is in the distortion and the level.
      mods: kit(DRONE_KIT, [], {
        'lfo1>filter_cutoff': ['lfo1', 'dist_drive', 0.3],
        'lfo2>filter_cutoff': ['lfo2', 'amp', -0.15],
        'random>filter_cutoff': ['random', 'osc2_level', 0.12],
        'velocity>filter_cutoff': ['velocity', 'dist_drive', 0.2],
      }),
    },
    {
      id: 'abyss', name: 'Abyss',
      description: 'The bottom of something very deep: a sub-heavy drone with a slow pulse of pressure.',
      tags: ['drone', 'sub', 'deep', 'abyss', 'pressure', 'dark', 'lorn'],
      texture: ['dust', 0.45, 0.3, 3500],
      set: { 'voice.octave': -1, 'sub.level': 0.4, 'filter.cutoff': 400, 'dist.clean_below': 100, 'dist.drive': 0.45 },
    },
    {
      id: 'signal-ghost', name: 'Signal Ghost',
      description: 'A transmission from nowhere: crushed, band-limited and buried in dust.',
      tags: ['drone', 'radio', 'signal', 'crushed', 'lo-fi', 'ghost', 'lorn'],
      texture: ['dust', 0.55, 0.45, 2500],
      set: {
        'filter.type': 'bandpass', 'filter.cutoff': 300, 'filter.resonance': 0.35, 'crush.mix': 0.3, 'crush.bits': 5, 'crush.rate': 10,
        'eq.highcut': 2500, 'drive.amount': 0.7,
      },
    },
    {
      id: 'iron-lung', name: 'Iron Lung',
      description: 'A machine breathing for someone: a drone that inhales and exhales with the beat.',
      tags: ['drone', 'pump', 'breathing', 'machine', 'rhythmic', 'dark', 'lorn'],
      texture: ['air', 0.5, 0.35, 2500],
      set: { 'comp.amount': 0.6, 'comp.pump': 0.6, 'breath.level': 0.2 },
    },
    {
      id: 'dust-storm', name: 'Dust Storm',
      description: 'A wide, grainy storm of detuned saws and dust, shifting endlessly.',
      tags: ['drone', 'dust', 'storm', 'wide', 'grainy', 'evolving', 'lorn'],
      texture: ['dust', 0.65, 0.4, 3000],
      set: { 'noise.level': 0.1, 'osc1.unison_voices': 6, 'osc1.unison_detune': 22 },
    },
  ],
};

export default def;
