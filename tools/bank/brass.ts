// DEV ONLY. Brass / horns: heavy, menacing synth brass. The filter envelope
// swell, the scoop up into pitch and the breath at the start are what make
// a synth sound blown rather than played on a keyboard.
import { ALIVE, kit, type CategoryDef } from './common';

const base = {
  'voice.polyphony': 6,
  'osc1.wave': 'saw', 'osc1.unison_voices': 3, 'osc1.unison_detune': 10,
  'osc2.wave': 'saw', 'osc2.level': 0.4, 'osc2.fine': -7,
  'filter.cutoff': 700, 'filter.keytrack': 0.6, 'filter.env_amount': 0.35,
  'mod_env.attack': 120, 'mod_env.decay': 900, 'mod_env.sustain': 0.4, 'mod_env.release': 500,
  'amp_env.attack': 90, 'amp_env.decay': 1200, 'amp_env.sustain': 0.85, 'amp_env.release': 600,
  'pitch_env.amount': -1.5, 'pitch_env.decay': 90,
  'vibrato.depth': 10, 'vibrato.delay': 500, 'vibrato.fade': 600,
  'breath.chiff': 0.35, 'breath.decay': 100, 'breath.tone': 0.5, 'breath.level': 0.12,
  'dist.drive': 0.3, 'reverb.mix': 0.35, 'delay.mix': 0.1, 'eq.highcut': 6500, 'eq.mid_gain': -3, 'fx.lowcut': 250,
};

/** Brass breathes: the fast wander is breath pressure (level), not a filter flutter. */
const BREATH_KIT = kit(ALIVE, [['lfo1', 'filter_cutoff', 0.18]], { 'lfo2>filter_cutoff': ['lfo2', 'amp', -0.1] });

const def: CategoryDef = {
  category: 'brass',
  base,
  kit: BREATH_KIT,
  presets: [
    {
      id: 'doom-horns', name: 'Doom Horns',
      description: 'A heavy horn section swelling open with every chord, saturated and huge in a dark space.',
      tags: ['brass', 'horns', 'heavy', 'swell', 'cinematic', 'dark', 'lorn'],
      texture: ['dust', 0.45, 0.3, 1500],
      set: { 'dist.drive': 0.35 },
    },
    {
      id: 'rust-trumpets', name: 'Rust Trumpets',
      description: 'Narrow, biting trumpets through crushed, rusty speakers.',
      tags: ['brass', 'trumpet', 'bright', 'crushed', 'rusty', 'aggressive', 'lorn'],
      texture: ['dust', 0.45, 0.4, 1200],
      set: {
        'voice.octave': 1, 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.35, 'filter.cutoff': 1100, 'vibrato.depth': 14,
        'crush.mix': 0.25, 'crush.bits': 6, 'crush.rate': 8,
      },
    },
    {
      id: 'brass-fog', name: 'Brass Fog',
      description: 'Soft brass that never quite comes into focus: slow swells drifting in a wide fog.',
      tags: ['brass', 'soft', 'fog', 'slow', 'ambient', 'wide', 'lorn'],
      texture: ['air', 0.45, 0.3, 2000],
      set: { 'filter.env_amount': 0.2, 'amp_env.attack': 300, 'mod_env.attack': 400, 'reverb.mix': 0.45, 'chorus.mix': 0.3 },
    },
    {
      id: 'low-tubas', name: 'Low Tubas',
      description: 'Deep tubas and cimbassi pushing air from below, with a low rumble under them.',
      tags: ['brass', 'tuba', 'low', 'heavy', 'cimbasso', 'dark', 'lorn'],
      texture: ['rumble', 0.5, 0.3, 1500],
      set: { 'voice.octave': -1, 'voice.polyphony': 4, 'filter.cutoff': 500, 'sub.level': 0.25 },
    },
    {
      id: 'signal-horn', name: 'Signal Horn',
      description: 'A single horn calling across a ruined landscape: it scoops up into each note and glides between them.',
      tags: ['brass', 'horn', 'solo', 'glide', 'call', 'mono', 'lorn'],
      texture: ['air', 0.45, 0.3, 1500],
      set: { 'voice.polyphony': 1, 'voice.legato': true, 'voice.glide': 60, 'pitch_env.amount': -3, 'pitch_env.decay': 120, 'voice.octave': 1 },
    },
    {
      id: 'bent-brass', name: 'Bent Brass',
      description: 'A brass section that cannot hold its pitch: every note sags and drifts on worn tape.',
      tags: ['brass', 'detuned', 'drift', 'tape', 'wonky', 'unstable', 'lorn'],
      texture: ['crackle', 0.5, 0.3, 1500],
      set: { 'tape.wow': 0.45 },
      mods: kit(BREATH_KIT, [['drift', 'pitch', 0.004]]),
    },
    {
      id: 'warhorn', name: 'Warhorn',
      description: 'A colossal horn blast with an octave below and multiband grit: the call before the battle.',
      tags: ['brass', 'braam', 'huge', 'octave', 'aggressive', 'cinematic', 'lorn'],
      texture: ['rumble', 0.65, 0.35, 2000],
      set: {
        'osc1.unison_voices': 5, 'osc1.unison_detune': 18, 'osc2.semi': -12, 'dist.drive': 0.45, 'dist.clean_below': 120, 'ott.amount': 0.3, 'reverb.mix': 0.4,
        'eq.mid_gain': -5,
      },
    },
    {
      id: 'velvet-french', name: 'Velvet French',
      description: 'Warm, round French horns, soft at the edges and sad in the middle.',
      tags: ['brass', 'french-horn', 'soft', 'warm', 'round', 'melancholic', 'lorn'],
      texture: ['air', 0.45, 0.25, 1500],
      set: { 'filter.cutoff': 600, 'filter.env_amount': 0.2, 'osc2.wave': 'triangle', 'breath.chiff': 0.2 },
    },
    {
      id: 'rotting-fanfare', name: 'Rotting Fanfare',
      description: 'A victory fanfare played back decades later on ruined equipment.',
      tags: ['brass', 'fanfare', 'crushed', 'lo-fi', 'crackle', 'decayed', 'lorn'],
      texture: ['crackle', 0.6, 0.35, 1500],
      set: { 'crush.mix': 0.3, 'crush.bits': 6, 'crush.rate': 9, 'tape.age': 0.65, 'eq.highcut': 5000 },
    },
    {
      id: 'ghost-section', name: 'Ghost Section',
      description: 'Brass made mostly of breath: the players are there, but you can barely hear the notes.',
      tags: ['brass', 'breath', 'airy', 'ghostly', 'soft', 'eerie', 'lorn'],
      texture: ['air', 0.55, 0.35, 2000],
      set: { 'breath.level': 0.35, 'breath.chiff': 0.45, 'osc1.level': 0.45 },
    },
  ],
};

export default def;
