// DEV ONLY. Arps / sequences: short gated notes driving through a slowly
// changing filter and echo, breathing with a pump.
import { ALIVE, kit, type CategoryDef, type Mod } from './common';

const base = {
  // Touch: playing harder is clearly louder.
  'voice.velocity': 0.75,
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
      id: 'pulse-engine', name: 'Pulse Engine',
      description: 'A driving saw sequence pumping against the beat as its filter slowly opens and closes.',
      tags: ['arp', 'sequence', 'saw', 'pump', 'driving', 'dark', 'lorn'],
      texture: ['dust', 0.28, 0.35, 400],
      set: { 'comp.pump': 0.45 },
    },
    {
      id: 'night-drive', name: 'Night Drive',
      description: 'Octave-stacked saws racing through a wide chorus and a heavy pump: headlights in the rain.',
      tags: ['arp', 'sequence', 'saw', 'octave', 'synthwave', 'pump', 'lorn'],
      texture: ['air', 0.28, 0.35, 400],
      set: { 'osc2.wave': 'saw', 'osc2.semi': 12, 'osc2.level': 0.3, 'chorus.mix': 0.3, 'comp.pump': 0.5 },
    },
    {
      id: 'static-ladder', name: 'Static Ladder',
      description: 'A dark, squelching diode-filter sequence, its accents biting through the haze.',
      tags: ['arp', 'sequence', 'acid', 'diode', 'squelch', 'dark', 'lorn'],
      texture: ['dust', 0.28, 0.35, 400],
      set: { 'filter.type': 'diode', 'filter.resonance': 0.6, 'filter.accent': 0.5, 'filter.cutoff': 500, 'filter.env_amount': 0.45 },
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
    // ------------------------------------------------ iconic II (LORN versions)
    {
      id: 'love-machine', name: 'Love Machine', iconic: 2,
      description: "A driving low sequence, octaves pulsing in sixteenths with a snappy filter: the machine that started it all, rusted.",
      tags: ['arp', 'sequence', 'driving', 'disco', 'octave', 'machine', 'lorn'],
      texture: ['dust', 0.3, 0.35, 600],
      set: { 'voice.octave': -1, 'sub.level': 0.3, 'amp_env.decay': 150, 'filter.cutoff': 600, 'filter.env_amount': 0.4, 'mod_env.decay': 100 },
    },
    {
      id: 'cold-monday', name: 'Cold Monday', iconic: 2,
      description: "A cold, stuttering square sequence chopping in sixteenths, mechanical and lonely.",
      tags: ['arp', 'stutter', 'cold', 'mechanical', 'eighties', 'square', 'lorn'],
      texture: ['dust', 0.3, 0.35, 600],
      set: { 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'chorus.mix': 0, 'lfo2.sync': '1/16', 'lfo2.shape': 'square' },
      mods: kit(ARP_KIT, [], { 'lfo2>filter_cutoff': ['lfo2', 'amp', -0.4], 'lfo4>chorus_depth': ['lfo4', 'tape_wow', 0.3] }),
    },
    {
      id: 'field-organ', name: 'Field Organ', iconic: 2,
      description: "A hypnotic organ pattern repeating over a field at dusk, trembling with a fast tremolo.",
      tags: ['arp', 'organ', 'hypnotic', 'tremolo', 'seventies', 'repeating', 'lorn'],
      texture: ['dust', 0.3, 0.35, 600],
      set: { 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'osc2.wave': 'saw', 'osc2.semi': 12, 'osc2.level': 0.3, 'amp_env.attack': 3, 'amp_env.decay': 100, 'amp_env.sustain': 0.8, 'amp_env.release': 60, 'filter.env_amount': 0.1, 'chorus.mix': 0.3, 'lfo2.rate': 6, 'lfo2.shape': 'sine' },
      mods: kit(ARP_KIT, [], { 'lfo2>filter_cutoff': ['lfo2', 'amp', -0.15] }),
    },
    {
      id: 'dream-children', name: 'Dream Children', iconic: 2,
      description: "A dreamy, piano-like arpeggio echoing into a huge space: nineties euphoria remembered through fog.",
      tags: ['arp', 'dreamy', 'piano-like', 'fm', 'echo', 'nineties', 'lorn'],
      texture: ['air', 0.3, 0.35, 900],
      set: { 'osc1.wave': 'triangle', 'fm.amount': 0.2, 'fm.ratio': 1, 'fm.punch': 0.4, 'amp_env.decay': 500, 'delay.time': '1/4D', 'delay.mix': 0.4, 'reverb.size': 0.93, 'reverb.mix': 0.4 },
      mods: SOFT_ARP_KIT,
    },
    {
      id: 'squelch-line', name: 'Squelch Line', iconic: 2,
      description: "A squelching acid sequence: every accent bites through a screaming diode filter.",
      tags: ['arp', 'acid', 'squelch', 'diode', 'accent', 'resonant', 'lorn'],
      texture: ['dust', 0.3, 0.35, 600],
      set: { 'osc1.unison_voices': 1, 'filter.type': 'diode', 'filter.cutoff': 500, 'filter.resonance': 0.7, 'filter.env_amount': 0.6, 'filter.accent': 0.7, 'mod_env.decay': 180, 'eq.highcut': 4000 },
    },
    {
      id: 'random-bleeps', name: 'Random Bleeps', iconic: 2,
      description: "Random stepped bleeps: a resonant filter jumping on every sixteenth, like an old computer thinking aloud.",
      tags: ['arp', 'sample-hold', 'random', 'bleeps', 'computer', 'resonant', 'lorn'],
      texture: ['dust', 0.3, 0.35, 600],
      set: { 'filter.resonance': 0.5, 'lfo1.sync': '1/16', 'lfo1.shape': 'sample_hold' },
      mods: kit(ARP_KIT, [['lfo1', 'filter_cutoff', 0.4]]),
    },
    // ------------------------------------------------ iconic II: missing keys and soft sounds
    {
      id: 'cradle-arp', name: 'Cradle Arp', iconic: 2,
      description: "A slow, soft sine-bell arpeggio rocking back and forth like a cradle.",
      tags: ['arp', 'soft', 'lullaby', 'bell', 'gentle', 'sine', 'lorn'],
      texture: ['air', 0.3, 0.35, 1000],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'comp.pump': 0.12, 'amp_env.attack': 8, 'mod_env.attack': 5, 'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'fm.amount': 0.1, 'fm.ratio': 3, 'fm.punch': 0.3, 'fm.decay': 200, 'amp_env.decay': 500, 'amp_env.release': 500, 'filter.cutoff': 1500, 'filter.env_amount': 0, 'eq.highcut': 4500 },
      mods: SOFT_ARP_KIT,
    },
    {
      id: 'glass-lullaby', name: 'Glass Lullaby', iconic: 2,
      description: "A glassy music-box arpeggio, small and sweet, ringing in a big quiet room.",
      tags: ['arp', 'glass', 'music-box', 'lullaby', 'soft', 'sweet', 'lorn'],
      texture: ['air', 0.3, 0.35, 1200],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'comp.pump': 0.12, 'amp_env.attack': 8, 'mod_env.attack': 5, 'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'voice.octave': 1, 'fm.amount': 0.12, 'fm.ratio': 4, 'fm.punch': 0.4, 'fm.decay': 120, 'amp_env.decay': 600, 'amp_env.release': 700, 'filter.cutoff': 1600, 'filter.env_amount': 0, 'reverb.size': 0.9, 'reverb.mix': 0.4, 'eq.highcut': 4500 },
      mods: SOFT_ARP_KIT,
    },
    {
      id: 'breathing-arp', name: 'Breathing Arp', iconic: 2,
      description: "A soft arpeggio with air in every note, rising and falling like slow breathing.",
      tags: ['arp', 'soft', 'breathy', 'airy', 'calm', 'triangle', 'lorn'],
      texture: ['air', 0.25, 0.35, 900],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'comp.pump': 0.12, 'amp_env.attack': 8, 'mod_env.attack': 5, 'osc1.wave': 'triangle', 'breath.level': 0.24, 'breath.tone': 0.35, 'filter.cutoff': 1200, 'filter.env_amount': 0.15, 'lfo2.rate': 0.25, 'eq.mid_freq': 300, 'eq.mid_gain': -4.5 },
      mods: kit(SOFT_ARP_KIT, [], { 'lfo2>amp': ['lfo2', 'breath_level', 0.3] }),
    },
    {
      id: 'slow-tide', name: 'Slow Tide', iconic: 2,
      description: "A soft saw arpeggio whose filter rises and falls over the bars like a slow tide.",
      tags: ['arp', 'soft', 'tide', 'slow-sweep', 'saw', 'dreamy', 'lorn'],
      texture: ['air', 0.3, 0.35, 900],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'comp.pump': 0.12, 'amp_env.attack': 8, 'mod_env.attack': 5, 'filter.cutoff': 450, 'filter.env_amount': 0.2, 'lfo1.rate': 0.08 },
      mods: kit(ARP_KIT, [['lfo1', 'filter_cutoff', 0.35]]),
    },
    // ------------------------------------------------ producer range: the roles this category was missing
    {
      id: 'clean-glass-seq', name: 'Clean Glass Sequence',
      description: "A clean, glassy sequence: pure FM notes with no grit, just tape age and air around them.",
      tags: ['arp', 'sequence', 'clean', 'glassy', 'fm', 'pure', 'lorn', 'new'],
      texture: ['air', 0.2, 0.35, 900],
      set: { 'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'fm.amount': 0.12, 'fm.ratio': 2, 'fm.punch': 0.3, 'fm.decay': 150, 'drive.amount': 0.3, 'dist.drive': 0.08, 'filter.cutoff': 1500, 'filter.env_amount': 0, 'eq.highcut': 4500, 'comp.pump': 0.15 },
      mods: SOFT_ARP_KIT,
    },
  ],
};

export default def;
