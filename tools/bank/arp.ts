// DEV ONLY. Arps / sequences: short gated notes driving through a slowly
// changing filter and echo, breathing with a pump.
import { ALIVE, kit, type CategoryDef, type Mod } from './common';

const base = {
  'voice.polyphony': 4,
  'osc1.wave': 'saw', 'osc1.unison_voices': 2, 'osc1.unison_detune': 8,
  'amp_env.attack': 1, 'amp_env.decay': 180, 'amp_env.sustain': 0.15, 'amp_env.release': 120,
  'filter.cutoff': 900, 'filter.keytrack': 0.4, 'filter.env_amount': 0.35,
  'mod_env.attack': 1, 'mod_env.decay': 150, 'mod_env.sustain': 0, 'mod_env.release': 120,
  'drive.amount': 0.5, 'dist.drive': 0.25, 'comp.pump': 0.35, 'comp.amount': 0.4, 'osc1.unison_spread': 0.5, 'lfo2.fade': 0,
  'delay.mix': 0.25, 'delay.time': '1/8D', 'delay.feedback': 0.45, 'reverb.mix': 0.22, 'reverb.size': 0.6, 'eq.highcut': 7000,
  // The sweep across the pattern: a slower wander than the other categories.
  'lfo1.rate': 0.2,
};

/** Arps: a deep slow sweep across the pattern plus per-note variety. */
const ARP_KIT = kit(ALIVE, [['lfo1', 'filter_cutoff', 0.28], ['random', 'filter_cutoff', 0.15], ['velocity', 'filter_cutoff', 0.2], ['lfo2', 'filter_cutoff', 0.12], ['lfo4', 'width', 0.25]], {
  'env2>filter_cutoff': ['random', 'drive', 0.12],
});

/** Soft arps (FM, string, triangle). */
const SOFT_ARP_KIT: Mod[] = [
  ['lfo1', 'tape_wow', 0.35],
  ['lfo2', 'amp', -0.12],
  // Per-note detune: every note lands a few cents differently, like an old synth.
  ['random', 'pitch', 0.0025],
  ['drift_slow', 'drive', 0.2],
  ['lfo3', 'delay_mix', 0.1],
  ['lfo4', 'width', 0.25],
  ['drift', 'pitch', 0.0015],
  ['lfo1', 'delay_time', 0.04],
  ['drift_slow', 'reverb_mix', 0.2],
  ['lfo4', 'chorus_depth', 0.25],
  ['velocity', 'drive', 0.2],
  ['random', 'amp', -0.1],
];

const def: CategoryDef = {
  category: 'arp',
  base,
  kit: ARP_KIT,
  presets: [
    {
      id: 'pulse-engine', name: 'Pulse Engine',
      description: 'A driving saw sequence pumping against the beat as its filter slowly opens and closes.',
      tags: ['arp', 'sequence', 'saw', 'pump', 'driving', 'dark', 'lorn'],
      texture: ['dust', 0.28, 0.35, 400],
      set: { 'comp.pump': 0.45 },
    },
    {
      id: 'clockwork-dread', name: 'Clockwork Dread',
      description: 'A ticking, hollow pulse sequence through a resonant band, echoing like a clock in an empty house.',
      tags: ['arp', 'sequence', 'pulse', 'clockwork', 'tension', 'echo', 'lorn'],
      texture: ['dust', 0.28, 0.4, 400],
      set: {
        'osc1.wave': 'pulse', 'osc1.pulse_width': 0.35, 'filter.type': 'bandpass', 'filter.cutoff': 600, 'filter.resonance': 0.25,
        'delay.mix': 0.3, 'sub.level': 0.15, 'eq.highcut': 4000,
      },
    },
    {
      id: 'signal-loss', name: 'Signal Loss',
      description: 'A square-wave sequence breaking up in a failing transmission: crushed, grainy and dusty.',
      tags: ['arp', 'sequence', 'square', 'crushed', 'glitch', 'lo-fi', 'lorn'],
      texture: ['dust', 0.28, 0.4, 400],
      set: { 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'crush.mix': 0.3, 'crush.bits': 5, 'crush.rate': 10 },
    },
    {
      id: 'night-drive', name: 'Night Drive',
      description: 'Octave-stacked saws racing through a wide chorus and a heavy pump: headlights in the rain.',
      tags: ['arp', 'sequence', 'saw', 'octave', 'synthwave', 'pump', 'lorn'],
      texture: ['air', 0.28, 0.35, 400],
      set: { 'osc2.wave': 'saw', 'osc2.semi': 12, 'osc2.level': 0.3, 'chorus.mix': 0.3, 'comp.pump': 0.5 },
    },
    {
      id: 'cell', name: 'Cell',
      description: 'A short FM sequence like a signal from inside a cell: clicky, metallic, smeared by echo.',
      tags: ['arp', 'sequence', 'fm', 'metallic', 'clicky', 'echo', 'lorn'],
      texture: ['dust', 0.28, 0.4, 400],
      set: {
        'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'fm.amount': 0.25, 'fm.ratio': 2, 'fm.punch': 0.4, 'fm.decay': 60,
        'filter.cutoff': 4000, 'filter.env_amount': 0, 'drive.amount': 0.6, 'dist.drive': 0.3, 'chorus.mix': 0.25,
      },
      mods: kit(SOFT_ARP_KIT, [], {
        'random>amp': ['random', 'fm_amount', 0.08],
        'lfo3>delay_mix': ['lfo3', 'fm_amount', 0.1],
        'drift_slow>drive': ['drift_slow', 'fm_amount', 0.1],
      }),
    },
    {
      id: 'static-ladder', name: 'Static Ladder',
      description: 'A dark, squelching diode-filter sequence, its accents biting through the haze.',
      tags: ['arp', 'sequence', 'acid', 'diode', 'squelch', 'dark', 'lorn'],
      texture: ['dust', 0.28, 0.35, 400],
      set: { 'filter.type': 'diode', 'filter.resonance': 0.6, 'filter.accent': 0.5, 'filter.cutoff': 500, 'filter.env_amount': 0.45 },
    },
    {
      id: 'pendulum', name: 'Pendulum',
      description: 'Short plucked strings swinging back and forth in a dark, ticking echo.',
      tags: ['arp', 'sequence', 'string', 'pluck', 'organic', 'echo', 'lorn'],
      texture: ['crackle', 0.28, 0.3, 500],
      set: {
        'osc1.wave': 'string', 'string.tone': 0.45, 'string.decay': 0.35, 'osc2.wave': 'triangle', 'osc2.level': 0.25, 'filter.cutoff': 2500,
        'filter.env_amount': 0, 'chorus.mix': 0.25,
      },
      mods: SOFT_ARP_KIT,
    },
    {
      id: 'machinery', name: 'Machinery',
      description: 'A metallic comb sequence like gears and pistons in a dark factory.',
      tags: ['arp', 'sequence', 'comb', 'metallic', 'industrial', 'mechanical', 'lorn'],
      texture: ['rumble', 0.28, 0.4, 400],
      set: { 'filter.type': 'comb', 'filter.cutoff': 700, 'filter.resonance': 0.45, 'filter.keytrack': 1, 'filter.env_amount': 0.2 },
    },
    {
      id: 'fever', name: 'Fever',
      description: 'A hot, compressed PWM-saw sequence pushing hard against the multiband compressor.',
      tags: ['arp', 'sequence', 'pwm', 'aggressive', 'ott', 'hot', 'lorn'],
      texture: ['dust', 0.28, 0.4, 400],
      set: { 'osc1.wave': 'pwm_saw', 'osc1.pulse_width': 0.4, 'ott.amount': 0.35 },
    },
    {
      id: 'sleepwalker', name: 'Sleepwalker',
      description: 'A soft triangle sequence drifting through a long, dreamy echo.',
      tags: ['arp', 'sequence', 'triangle', 'soft', 'dreamy', 'echo', 'lorn'],
      texture: ['air', 0.28, 0.3, 600],
      set: {
        'osc1.wave': 'triangle', 'filter.cutoff': 2000, 'filter.env_amount': 0, 'delay.mix': 0.4, 'drive.amount': 0.6, 'dist.drive': 0.3,
        'comp.pump': 0.25, 'chorus.mix': 0.25,
      },
      mods: SOFT_ARP_KIT,
    },
    // ------------------------------------------------ iconic (LORN versions)
    {
      id: 'gridlock', name: 'Gridlock', iconic: true,
      description: 'A tempo-locked synthwave arpeggio: a resonant diode filter sweeping in time, pumping on the eighths, echoing into the dark.',
      tags: ['arp', 'synced', 'synthwave', 'diode', 'pumping', 'driving', 'lorn'],
      texture: ['dust', 0.3, 0.35, 600],
      set: {
        'filter.type': 'diode', 'filter.resonance': 0.4, 'filter.cutoff': 800, 'lfo1.sync': '1/2', 'lfo1.shape': 'triangle',
        'comp.pump': 0.4, 'comp.pump_rate': '1/8', 'delay.time': '1/8D',
      },
    },
    {
      id: 'chapter-one', name: 'Chapter One', iconic: true,
      description: 'A warm analog arpeggio whose filter opens slowly over the bars, glowing and ominous: an eighties mystery beginning.',
      tags: ['arp', 'analog', 'warm', 'slow-open', 'eighties', 'mystery', 'lorn'],
      texture: ['dust', 0.3, 0.3, 600],
      set: {
        'osc1.unison_voices': 3, 'osc1.unison_detune': 9, 'filter.cutoff': 350, 'filter.env_amount': 0.25, 'amp_env.decay': 250,
        'env2.attack': 8000, 'env2.sustain': 1, 'delay.time': '1/4', 'delay.mix': 0.2, 'phaser.mix': 0.15, 'phaser.rate': 0.12,
      },
      // The slow opening is the identity: the bloom envelope takes back the per-note drive slot.
      mods: kit(ARP_KIT, [], { 'random>drive': ['env2', 'filter_cutoff', 0.45] }),
    },
    // ------------------------------------------------ filling the gaps
    {
      id: 'triplet-machine', name: 'Triplet Machine',
      description: 'A hard-clipped arp through a low-pass gate, a twitch on every note, falling into triplet echoes.',
      tags: ['arp', 'lpg', 'hard-clip', 'triplet', 'machine', 'twitchy', 'lorn'],
      texture: ['dust', 0.3, 0.35, 600],
      set: {
        'filter.type': 'lpg', 'filter.cutoff': 900, 'dist.type': 'hard', 'dist.drive': 0.3, 'lfo2.retrigger': true, 'lfo2.rate': 6,
        'lfo2.shape': 'sine', 'delay.time': '1/8T', 'delay.feedback': 0.55, 'reverb.mix': 0.3,
      },
    },
  ],
};

export default def;
