// DEV ONLY. Strings: dark string machines and ensembles, slow bows, worn tape.
import { ALIVE, kit, type CategoryDef } from './common';

const base = {
  'voice.polyphony': 8,
  'osc1.wave': 'saw', 'osc1.unison_voices': 3, 'osc1.unison_detune': 12, 'osc1.unison_spread': 0.9,
  'amp_env.attack': 700, 'amp_env.decay': 3000, 'amp_env.sustain': 0.9, 'amp_env.release': 1500,
  'filter.cutoff': 1400, 'filter.keytrack': 0.7, 'filter.env_amount': 0,
  // Played, not static: a delayed vibrato and the bow's scrape at the start of each note.
  'vibrato.depth': 14, 'vibrato.rate': 5.2, 'vibrato.delay': 600, 'vibrato.fade': 800,
  'breath.chiff': 0.25, 'breath.decay': 200, 'breath.tone': 0.6,
  'chorus.mix': 0.35, 'chorus.depth': 0.5, 'chorus.mode': 'ensemble',
  'reverb.mix': 0.32, 'reverb.size': 0.85, 'eq.highcut': 7000, 'eq.low_gain': -2, 'fx.lowcut': 250,
};

/** Strings move with the bow: deeper slow filter wander, and bow pressure (level) instead of a fast filter flutter. */
const BOW_KIT = kit(ALIVE, [['lfo1', 'filter_cutoff', 0.2], ['env2', 'filter_cutoff', 0.15], ['random', 'filter_cutoff', 0.1]], {
  'lfo2>filter_cutoff': ['lfo2', 'amp', -0.12],
});

const def: CategoryDef = {
  category: 'strings',
  base,
  kit: BOW_KIT,
  presets: [
    {
      id: 'black-ensemble', name: 'Black Ensemble',
      description: 'A dark string section of saws and PWM through a wide ensemble, bowing slowly into a worn hall.',
      tags: ['strings', 'ensemble', 'pwm', 'dark', 'section', 'cinematic', 'lorn'],
      texture: ['dust', 0.45, 0.3, 2000],
      set: { 'osc2.wave': 'pwm_saw', 'osc2.level': 0.35, 'osc2.fine': 7, 'osc2.pulse_width': 0.4 },
    },
    {
      id: 'funeral-section', name: 'Funeral Section',
      description: 'Heavy, slow bows that take their time to arrive and linger in a long dark room.',
      tags: ['strings', 'slow', 'funeral', 'dark', 'reverb', 'cinematic', 'lorn'],
      texture: ['dust', 0.45, 0.25, 2500],
      set: { 'amp_env.attack': 1400, 'amp_env.release': 2200, 'filter.cutoff': 1200, 'reverb.mix': 0.4 },
    },
    {
      id: 'worn-cellos', name: 'Worn Cellos',
      description: 'Low cellos on a stretched tape: rough bows, a slow singing vibrato and crackle around them.',
      tags: ['strings', 'cello', 'low', 'tape', 'crackle', 'vibrato', 'lorn'],
      texture: ['crackle', 0.55, 0.3, 1800],
      set: {
        'voice.polyphony': 6, 'voice.octave': -1, 'osc1.unison_voices': 2, 'osc1.unison_detune': 8, 'vibrato.depth': 18,
        'breath.chiff': 0.4, 'filter.cutoff': 1400, 'tape.wow': 0.3,
      },
    },
    {
      id: 'frost-violins', name: 'Frost Violins',
      description: 'High violins, cold and thin, shivering in the air above everything else.',
      tags: ['strings', 'violin', 'high', 'cold', 'air', 'tension', 'lorn'],
      texture: ['air', 0.45, 0.4, 2000],
      set: { 'voice.octave': 1, 'filter.cutoff': 1700, 'eq.highcut': 7500, 'vibrato.depth': 12, 'vibrato.rate': 5.8 },
    },
    {
      id: 'rotten-orchestra', name: 'Rotten Orchestra',
      description: 'An orchestra rotting on old tape: seasick pitch, crushed grain and crackle.',
      tags: ['strings', 'tape', 'wow', 'crushed', 'lo-fi', 'decayed', 'lorn'],
      texture: ['crackle', 0.6, 0.35, 2000],
      set: { 'tape.wow': 0.55, 'tape.age': 0.7, 'crush.mix': 0.2, 'crush.bits': 7, 'crush.rate': 8, 'eq.highcut': 5500 },
    },
    {
      id: 'distant-hall', name: 'Distant Hall',
      description: 'Strings heard from the far end of a vast empty hall, mostly echo and air.',
      tags: ['strings', 'distant', 'reverb', 'echo', 'air', 'ambient', 'lorn'],
      texture: ['air', 0.45, 0.3, 3000],
      set: { 'reverb.mix': 0.5, 'reverb.size': 0.95, 'delay.mix': 0.2, 'filter.cutoff': 1500 },
    },
    {
      id: 'tremolo-dread', name: 'Tremolo Dread',
      description: 'Nervous tremolo bowing that never settles into a pattern: tension under a horror scene.',
      tags: ['strings', 'tremolo', 'tension', 'horror', 'nervous', 'dark', 'lorn'],
      texture: ['dust', 0.45, 0.3, 1500],
      set: { 'lfo2.rate': 6.5, 'lfo2.fade': 300, 'breath.chiff': 0.3 },
      mods: kit(BOW_KIT, [['lfo2', 'amp', -0.35]]),
    },
    {
      id: 'glass-strings', name: 'Glass Strings',
      description: 'Strings with a glassy FM edge, as if bowed on frozen wire.',
      tags: ['strings', 'fm', 'glass', 'cold', 'metallic', 'eerie', 'lorn'],
      texture: ['air', 0.45, 0.45, 2000],
      set: { 'fm.amount': 0.15, 'fm.ratio': 3, 'filter.cutoff': 2400 },
      mods: kit(BOW_KIT, [['lfo1', 'filter_cutoff', 0.28]], { 'random>filter_cutoff': ['random', 'fm_amount', 0.06] }),
    },
    {
      id: 'solina-ghost', name: 'Solina Ghost',
      description: 'The ghost of a 70s string machine: PWM through a lush ensemble, tape-warped and dusty.',
      tags: ['strings', 'string-machine', 'solina', 'pwm', 'ensemble', 'vintage', 'lorn'],
      texture: ['dust', 0.5, 0.3, 2000],
      set: {
        'osc1.wave': 'pwm_saw', 'osc1.unison_voices': 2, 'osc1.pulse_width': 0.35, 'vibrato.depth': 0, 'breath.chiff': 0,
        'chorus.mix': 0.3, 'osc1.unison_spread': 0.6, 'filter.cutoff': 1700, 'tape.wow': 0.3, 'tape.drive': 0.5,
      },
      mods: kit(BOW_KIT, [['drift_slow', 'drive', 0.22]], { 'random>filter_cutoff': ['random', 'osc1_pw', 0.12] }),
    },
    {
      id: 'sul-ponticello', name: 'Sul Ponticello',
      description: 'Bowed close to the bridge: hollowed out in the middle, thin, airy and scratchy.',
      tags: ['strings', 'ponticello', 'thin', 'hollow', 'scratchy', 'tension', 'lorn'],
      texture: ['air', 0.4, 0.35, 1800],
      set: {
        'filter.type': 'notch', 'filter.cutoff': 700, 'filter.resonance': 0.5, 'breath.level': 0.15, 'breath.tone': 0.55,
        'vibrato.depth': 10, 'eq.highcut': 5500,
      },
    },
    // ------------------------------------------------ iconic (LORN versions)
    {
      id: 'machine-strings', name: 'Machine Strings', iconic: true,
      description: 'The seventies string machine: thin bright saws made lush by an ensemble chorus and a slow phaser, gone soft with age.',
      tags: ['strings', 'string-machine', 'ensemble', 'phaser', 'vintage', 'lush', 'lorn'],
      texture: ['dust', 0.4, 0.35, 1500],
      set: {
        'osc1.unison_detune': 14, 'amp_env.attack': 300, 'amp_env.release': 1200, 'filter.cutoff': 2000, 'filter.resonance': 0,
        'chorus.mix': 0.55, 'chorus.depth': 0.7, 'phaser.mix': 0.25, 'phaser.rate': 0.2, 'vibrato.depth': 6,
      },
    },
  ],
};

export default def;
