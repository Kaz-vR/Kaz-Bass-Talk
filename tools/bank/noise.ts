// DEV ONLY. The Noise shelf: the noise strip is the instrument (no oscillators,
// no sub), the Wobbler shapes it in time, filter / tape / dirt / chorus colour it,
// some follow the keys (KEY) with glide. Run: npx tsx tools/bank/noise.ts
import { writeFileSync } from 'node:fs';
import { defaultPatch, sortModSlots, switchOffUnused } from '../../src/schema';

interface N {
  name: string; desc: string; tags: string[];
  tex: [type: string, tone: number, density: number, octave: number, tail: number];
  wob: [shape: string, rate: string, depth: number, cutoff: boolean, volume: boolean, smooth: number];
  cut: number; res?: number; key?: boolean; glide?: number; wheel?: string;
  set?: Record<string, number | string | boolean>;
}

const P: N[] = [
  { name: 'Tape Gate', desc: 'Worn tape hiss chopped into tight sixteenths, the gaps breathing with the wow.', tags: ['gate', '16ths', 'hiss', 'rhythmic'],
    tex: ['tape hiss', 0.45, 0.55, 0, 120], wob: ['square', '1/16', 1, false, true, 0.12], cut: 3500, set: { 'tape.on': true, 'tape.wow': 0.3 } },
  { name: 'Dust Swing', desc: 'Dust and ticks in a lazy long-short swing, like a loop off an old sampler.', tags: ['swing', 'dust', 'groove', 'soft'],
    tex: ['dust', 0.4, 0.6, 0, 200], wob: ['swing gate', '1/2', 1, false, true, 0.2], cut: 5200, set: { } },
  { name: 'Static Triplets', desc: 'Grainy static fizz gated in even triplets across the bar.', tags: ['triplet', 'static', 'gate'],
    tex: ['static', 0.5, 0.5, 0, 150], wob: ['triplet gate', '1 Bar', 1, false, true, 0.1], cut: 7000, set: { } },
  { name: 'Crackle Ratchet', desc: 'Vinyl crackle that plucks once, twice, then rolls into four.', tags: ['ratchet', 'crackle', 'roll', 'vinyl'],
    tex: ['crackle', 0.45, 0.7, 0, 160], wob: ['ratchet', '1 Bar', 1, false, true, 0.08], cut: 6000, set: { } },
  { name: 'Hiss Brake', desc: 'Hiss pulsing slower and slower as if the reel is running down.', tags: ['brake', 'tape stop', 'hiss', 'slowing'],
    tex: ['tape hiss', 0.5, 0.6, 0, 300], wob: ['brake', '2 Bars', 0.95, true, true, 0.25], cut: 5000, res: 0.25, set: { 'tape.wow': 0.45, } },
  { name: 'Air Pulse', desc: 'Breathy air in four soft plucks per bar, widened by the ensemble.', tags: ['pulse', 'air', 'breath', 'soft', 'wide'],
    tex: ['air', 0.4, 0.5, 0, 400], wob: ['pulse decay', '1 Bar', 1, false, true, 0.3], cut: 4500, set: { 'chorus.on': true, 'chorus.mode': 'ensemble', 'chorus.mix': 0.45 } },
  { name: 'Rumble Wub', desc: 'Low rumble through a resonant low-pass, wubbing in quarters.', tags: ['wub', 'rumble', 'filter', 'dark', 'heavy'],
    tex: ['rumble', 0.6, 0.6, 0, 300], wob: ['sine', '1/4', 0.9, true, false, 0.2], cut: 900, res: 0.55, set: { 'dist.on': true, 'dist.type': 'tube', 'dist.drive': 0.35 } },
  { name: 'White Sweep', desc: 'Plain white noise swept shut every eighth, a clean riser-snare grain.', tags: ['sweep', 'white', 'filter', '8ths', 'bright'],
    tex: ['white noise', 0.55, 0.6, 0, 120], wob: ['saw down', '1/8', 0.9, true, false, 0.1], cut: 3500, res: 0.4, wheel: 'choke' },
  { name: 'Sync Static', desc: 'Fuzzed static on a 3-3-2 gate, the push of a broken drum machine.', tags: ['3-3-2', 'static', 'fuzz', 'hard', 'menacing'],
    tex: ['static', 0.55, 0.6, 0, 120], wob: ['sync gate', '1/2', 1, false, true, 0.1], cut: 5500, wheel: 'snarl', set: { 'dist.on': true, 'dist.type': 'fuzz', 'dist.drive': 0.5, 'dist.mix': 0.7 } },
  { name: 'Stair Dust', desc: 'Dust stepping its filter down a staircase over two bars.', tags: ['staircase', 'dust', 'filter', 'steps'],
    tex: ['dust', 0.55, 0.65, 0, 250], wob: ['staircase', '2 Bars', 0.85, true, false, 0.15], cut: 3000, res: 0.35 },
  { name: 'Random Grain', desc: 'Crackle gated and filtered by new random steps every cycle: never the same bar twice.', tags: ['random', 'crackle', 'glitch', 'moving'],
    tex: ['crackle', 0.5, 0.75, 0, 140], wob: ['random', '1/2', 0.9, true, true, 0.1], cut: 4000, res: 0.3, wheel: 'decay', set: { 'crush.on': true, 'crush.mix': 0.25, 'crush.bits': 9 } },
  { name: 'Breath Duck', desc: 'Air ducking on every beat, a breathing sidechain of pure breath.', tags: ['duck', 'air', 'breath', 'pump'],
    tex: ['air', 0.45, 0.55, 0, 350], wob: ['duck', '1/4', 1, false, true, 0.25], cut: 5000 },
  { name: 'Yoyo Hiss', desc: 'Hiss opening in two humps per bar, small then big.', tags: ['yoyo', 'hiss', 'filter', 'swell'],
    tex: ['tape hiss', 0.55, 0.6, 0, 400], wob: ['yoyo', '1 Bar', 0.85, true, false, 0.3], cut: 4000, res: 0.3, set: { } },
  { name: 'Slow Tide', desc: 'Rumble an octave and more down, rising and falling over four bars like a tide.', tags: ['slow', 'rumble', 'tide', 'bed', 'dark'],
    tex: ['rumble', 0.5, 0.7, -2, 1500], wob: ['triangle', '4 Bars', 0.8, true, true, 0.4], cut: 1800, res: 0.2, wheel: 'open' },
  { name: 'Tape Stop Lead', desc: 'Hiss played across the keys, gliding between notes like a reel speeding up and stopping.', tags: ['key', 'glide', 'tape stop', 'hiss', 'playable', 'lead'],
    tex: ['tape hiss', 0.55, 0.45, 0, 200], key: true, glide: 450, wob: ['square', '1/16', 0.85, false, true, 0.15], cut: 3500, set: { 'voice.legato': true, 'tape.wow': 0.25 } },
  { name: 'Static Line', desc: 'Static played across the keys an octave down, its filter sweeping shut every eighth.', tags: ['key', 'static', 'playable', 'sweep'],
    tex: ['static', 0.5, 0.5, -1, 180], key: true, glide: 80, wob: ['saw down', '1/8', 0.8, true, false, 0.1], cut: 3000, res: 0.45 },
  { name: 'Crackle Kit', desc: 'Crackle hits across the keys: low notes thump, high notes tick, ducked into the beat.', tags: ['key', 'kit', 'crackle hit', 'percussive'],
    tex: ['crackle hit', 0.5, 0.6, 0, 250], key: true, wob: ['duck', '1/16', 0.6, false, true, 0.2], cut: 7000 },
  { name: 'Static Roll', desc: 'A burst of static hit on every note, rolled into a ratchet.', tags: ['ratchet', 'static hit', 'percussive', 'hard'],
    tex: ['static hit', 0.55, 0.6, 0, 600], wob: ['ratchet', '1/2', 1, false, true, 0.08], cut: 6500, wheel: 'snarl', set: { 'dist.on': true, 'dist.type': 'hard', 'dist.drive': 0.3 } },
  { name: 'Snare Swing', desc: 'White noise hits across the keys in a swung sixteenth gate, tuned like a noise snare.', tags: ['key', 'white noise hit', 'swing', 'snare'],
    tex: ['white noise hit', 0.5, 0.55, 0, 350], key: true, wob: ['swing gate', '1/8', 1, false, true, 0.12], cut: 8000, wheel: 'choke' },
  { name: 'Sunk Hiss', desc: 'Hiss slowed four octaves into a dark roar, swelling up each bar and snapping shut.', tags: ['saw up', 'hiss', 'swell', 'dark', 'slow'],
    tex: ['tape hiss', 0.6, 0.7, -4, 800], wob: ['saw up', '1 Bar', 1, false, true, 0.2], cut: 3500, set: { } },
  { name: 'Dust Triplets', desc: 'A dust hit on each note, gated into triplets and smeared with a little wow.', tags: ['triplet', 'dust hit', 'soft'],
    tex: ['dust hit', 0.45, 0.6, 0, 900], wob: ['triplet gate', '1/2', 1, false, true, 0.15], cut: 5500, set: { 'tape.wow': 0.3 } },
  { name: 'Air Fall', desc: 'Air played across the keys, gliding slowly and braking over four bars.', tags: ['key', 'glide', 'air', 'brake', 'fall'],
    tex: ['air', 0.5, 0.5, 0, 1200], key: true, glide: 1200, wob: ['brake', '4 Bars', 0.85, true, true, 0.3], cut: 3500, res: 0.3, set: { 'voice.legato': true } },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
for (const n of P) {
  const p: Record<string, unknown> = defaultPatch(n.name) as never;
  const [type, tone, density, octave, tail] = n.tex;
  const [shape, rate, depth, cutoff, volume, smooth] = n.wob;
  Object.assign(p, {
    'voice.polyphony': 1, 'voice.glide': n.glide ?? 0, 'voice.octave': 0,
    'osc1.level': 0, 'osc2.level': 0, 'sub.level': 0, 'drive.amount': 0,
    'texture.type': type, 'texture.level': 1, 'texture.tone': tone, 'texture.density': density,
    'texture.octave': octave, 'texture.key': !!n.key, 'texture.tail': tail, 'texture.direct': false,
    'filter.on': true, 'filter.type': 'lowpass', 'filter.cutoff': n.cut, 'filter.resonance': n.res ?? 0.15,
    'filter.keytrack': 0, 'filter.route_a': false, 'filter.route_b': false, 'filter.route_n': true, 'filter.route_s': false,
    'wobble.on': true, 'wobble.shape': shape, 'wobble.rate': rate, 'wobble.depth': depth,
    'wobble.cutoff': cutoff, 'wobble.volume': volume, 'wobble.smooth': smooth, 'wobble.life': 0.35, 'wobble.lowcut': 20,
    'tape.on': true, 'tape.wow': 0.15,
    // Life: two wanders at unrelated rates on the cutoff and the noise level.
    'lfo1.on': true, 'lfo1.shape': 'wander', 'lfo1.rate': 0.13, 'lfo2.on': true, 'lfo2.shape': 'wander', 'lfo2.rate': 0.37,
    'mod1.on': true, 'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.06,
    'mod2.on': true, 'mod2.source': 'lfo2', 'mod2.dest': 'texture_level', 'mod2.amount': 0.08,
    'wheel.preset': n.wheel ?? 'open',
    ...n.set,
  });
  p.meta = { name: n.name, description: n.desc, tags: ['lorn', 'noise', ...n.tags], category: 'noise', family: 'noise', collection: 'bank', audition: 'noise' };
  switchOffUnused(p as never);
  sortModSlots(p as never);
  writeFileSync(`data/library/noise-${slug(n.name)}.json`, JSON.stringify(p, null, 2) + '\n');
}
console.log(P.length, 'noise presets');
