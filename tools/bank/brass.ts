// DEV ONLY. Brass / horns: heavy, menacing synth brass. The filter envelope
// swell, the scoop up into pitch and the breath at the start are what make
// a synth sound blown rather than played on a keyboard.
import { ALIVE, kit, type CategoryDef } from './common';

const base = {
  // Touch: playing harder is clearly louder.
  'voice.velocity': 0.75,
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
      texture: ['air', 0.6, 0.3, 1500],
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
    // ------------------------------------------------ iconic (LORN versions)
    {
      id: 'rooftop-stab', name: 'Rooftop Stab', iconic: true,
      description: 'The big eighties poly brass stab: stacked saws punching open on every chord, short and proud, through worn tape.',
      tags: ['brass', 'stab', 'poly', 'eighties', 'synthwave', 'punchy', 'lorn'],
      texture: ['dust', 0.45, 0.35, 1200],
      set: {
        'osc1.unison_detune': 14, 'osc2.fine': -9, 'osc2.level': 0.45, 'filter.cutoff': 600, 'filter.env_amount': 0.55,
        'mod_env.attack': 20, 'mod_env.decay': 280, 'mod_env.sustain': 0.25, 'amp_env.attack': 5, 'amp_env.decay': 600,
        'amp_env.sustain': 0.7, 'amp_env.release': 160, 'chorus.mix': 0.3, 'chorus.mode': 'ensemble', 'reverb.mix': 0.3,
      },
    },
    {
      id: 'monolith', name: 'Monolith', iconic: true,
      description: 'A colossal, hard-clipped brass braam an octave down, hanging in a vast concrete space.',
      tags: ['brass', 'braam', 'huge', 'distorted', 'cyberpunk', 'cinematic', 'lorn'],
      texture: ['rumble', 0.75, 0.35, 3000],
      set: {
        'voice.polyphony': 4, 'voice.octave': -1, 'osc1.unison_voices': 5, 'osc1.unison_detune': 20, 'osc2.semi': -12, 'osc2.level': 0.5,
        'sub.level': 0.3, 'dist.type': 'hard', 'dist.drive': 0.45, 'dist.mix': 0.7, 'dist.clean_below': 120, 'filter.cutoff': 400,
        'filter.env_amount': 0.4, 'mod_env.attack': 300, 'mod_env.decay': 2000, 'mod_env.sustain': 0.6, 'amp_env.attack': 120,
        'amp_env.decay': 4000, 'amp_env.sustain': 0.9, 'amp_env.release': 2500, 'reverb.size': 0.95, 'reverb.mix': 0.45, 'ott.amount': 0.35,
      },
    },
    {
      id: 'rain-brass', name: 'Rain Brass', iconic: true,
      description: 'A singing brass lead that brightens the longer you hold it, with a slow vibrato and a glide: lonely, in the rain.',
      tags: ['brass', 'lead', 'expressive', 'vibrato', 'cinematic', 'eighties', 'lorn'],
      texture: ['air', 0.45, 0.35, 2000],
      set: {
        'voice.polyphony': 1, 'voice.legato': true, 'voice.glide': 90, 'osc1.unison_detune': 8, 'osc2.fine': 8, 'osc2.level': 0.45,
        'filter.cutoff': 500, 'filter.env_amount': 0.45, 'mod_env.attack': 900, 'mod_env.decay': 2500, 'mod_env.sustain': 0.8,
        'vibrato.depth': 22, 'vibrato.rate': 5.5, 'vibrato.delay': 600, 'vibrato.fade': 900, 'breath.level': 0.1,
        'reverb.size': 0.92, 'reverb.mix': 0.4,
      },
      // A legato line doesn't re-roll per-note random: its vibrato depth wanders instead.
      mods: kit(BREATH_KIT, [], { 'random>filter_cutoff': ['lfo3', 'vibrato_depth', 0.25] }),
    },
    {
      id: 'tower-swell', name: 'Tower Swell', iconic: true,
      description: 'Huge brass chords swelling up slowly and opening in a vast, smoky space over a burning city.',
      tags: ['brass', 'swell', 'pad', 'huge', 'cinematic', 'eighties', 'lorn'],
      texture: ['air', 0.45, 0.3, 3000],
      set: {
        'osc1.unison_voices': 4, 'osc1.unison_detune': 16, 'osc2.semi': -12, 'osc2.fine': -4, 'amp_env.attack': 1400, 'amp_env.decay': 5000,
        'amp_env.sustain': 0.9, 'amp_env.release': 3000, 'filter.cutoff': 450, 'filter.env_amount': 0.4, 'mod_env.attack': 1800,
        'mod_env.decay': 4000, 'mod_env.sustain': 0.7, 'reverb.size': 0.96, 'reverb.mix': 0.5, 'chorus.mix': 0.25, 'chorus.mode': 'ensemble',
      },
      mods: kit(BREATH_KIT, [], { 'lfo2>amp': ['lfo2', 'osc2_level', 0.2] }),
    },
    // ------------------------------------------------ filling the gaps
    {
      id: 'steel-section', name: 'Steel Section',
      description: 'An FM brass section with a vowel in its throat: bright, metallic and a little inhuman, worn down to grey.',
      tags: ['brass', 'fm', 'formant', 'metallic', 'eighties', 'section', 'lorn'],
      texture: ['dust', 0.6, 0.35, 1500],
      set: {
        'osc1.wave': 'sine', 'osc2.level': 0.2, 'fm.amount': 0.35, 'fm.ratio': 1, 'fm.punch': 0.4, 'fm.decay': 400, 'breath.level': 0.28,
        'filter.type': 'formant', 'filter.vowel': 0.45, 'filter.resonance': 0.35, 'filter.cutoff': 1200,
      },
      mods: kit(BREATH_KIT, [], { 'lfo1>filter_cutoff': ['lfo1', 'fm_amount', 0.1], 'random>filter_cutoff': ['random', 'filter_vowel', 0.08] }),
    },
    // ------------------------------------------------ producer range: the roles this category was missing
    {
      id: 'iron-stab', name: 'Iron Stab',
      description: "A hard, clipped brass hit: one bark, gone, leaving a dark ring behind.",
      tags: ['brass', 'stab', 'hard', 'short', 'clipped', 'aggressive', 'lorn', 'new'],
      texture: ['crackle', 0.45, 0.35, 1000],
      set: { 'dist.type': 'hard', 'dist.drive': 0.4, 'dist.mix': 0.6, 'amp_env.attack': 2, 'amp_env.decay': 300, 'amp_env.sustain': 0, 'amp_env.release': 150, 'filter.cutoff': 500, 'filter.env_amount': 0.65, 'mod_env.attack': 1, 'mod_env.decay': 180, 'mod_env.sustain': 0, 'vibrato.depth': 0 },
    },
    {
      id: 'bite-horn', name: 'Bite Horn',
      description: "A horn that bites into every note and then sings: a hard, bright start over a held, dark tone.",
      tags: ['brass', 'horn', 'hard-attack', 'bite', 'bold', 'lead', 'lorn', 'new'],
      texture: ['dust', 0.45, 0.35, 1200],
      set: { 'amp_env.attack': 10, 'mod_env.attack': 5, 'mod_env.decay': 300, 'filter.env_amount': 0.6, 'drive.amount': 0.7 },
    },
    {
      id: 'thin-trumpet', name: 'Thin Trumpet',
      description: "One muted trumpet far down the street: thin, breathy and alone.",
      tags: ['brass', 'trumpet', 'solo', 'thin', 'lonely', 'breathy', 'lorn', 'new'],
      texture: ['dust', 0.45, 0.3, 1500],
      set: { 'osc1.unison_voices': 1, 'osc2.level': 0, 'breath.level': 0.2, 'filter.cutoff': 900, 'vibrato.depth': 14 },
    },
    {
      id: 'muted-horn', name: 'Muted Horn',
      description: "Soft, short horn notes, muted and round: brass that supports without pushing.",
      tags: ['brass', 'muted', 'soft', 'short', 'round', 'support', 'lorn', 'new'],
      texture: ['dust', 0.45, 0.3, 1000],
      set: { 'amp_env.attack': 40, 'amp_env.decay': 600, 'amp_env.sustain': 0.3, 'amp_env.release': 200, 'filter.cutoff': 450, 'filter.env_amount': 0.2, 'drive.amount': 0.35, 'dist.drive': 0.12 },
    },
    {
      id: 'falling-brass', name: 'Falling Brass',
      description: "A brass stab that sags as it dies, the pitch dropping like a tired sigh.",
      tags: ['brass', 'fall', 'stab', 'pitch-drop', 'short', 'worn', 'lorn', 'new'],
      texture: ['crackle', 0.45, 0.35, 1200],
      set: { 'amp_env.attack': 5, 'amp_env.decay': 800, 'amp_env.sustain': 0, 'amp_env.release': 300, 'pitch_env.amount': -3, 'pitch_env.decay': 500, 'filter.env_amount': 0.45, 'mod_env.decay': 400 },
    },
  ],
};

export default def;
