// DEV ONLY. Coverage: which ingredients a preset uses (each a small test on its
// parameters), and which of its category's sensible ingredients no preset uses
// yet. The sensible ingredients per category and the must-have iconic sounds
// live in data/coverage.json.
import type { Patch } from '../../src/schema';

const num = (p: Patch, id: string) => Number(p[id] ?? 0);
const used = (p: Patch, osc: 1 | 2) => osc === 1 ? num(p, 'osc1.level') > 0.05 : num(p, 'osc2.level') > 0.05;
const waveUsed = (p: Patch, w: string) => ([1, 2] as const).some((o) => used(p, o) && p[`osc${o}.wave`] === w);
const slots = (p: Patch) =>
  Array.from({ length: 12 }, (_, i) => ({ src: String(p[`mod${i + 1}.source`]), dst: String(p[`mod${i + 1}.dest`]), amt: num(p, `mod${i + 1}.amount`) }))
    .filter((s) => s.amt !== 0 && s.src !== 'none' && s.dst !== 'none');
const lfoUsed = (p: Patch, test: (n: number) => boolean) => slots(p).some((s) => /^lfo\d$/.test(s.src) && test(Number(s.src[3])));
const destUsed = (p: Patch, re: RegExp) => slots(p).some((s) => re.test(s.dst));
const distOn = (p: Patch) => num(p, 'dist.mix') > 0 && num(p, 'dist.drive') > 0.05;

/** Every ingredient the coverage lists can name. */
export const INGREDIENTS: Record<string, (p: Patch) => boolean> = {
  'wave:saw': (p) => waveUsed(p, 'saw'),
  'wave:pulse': (p) => waveUsed(p, 'pulse'),
  'wave:pwm': (p) => waveUsed(p, 'pwm_saw') || (waveUsed(p, 'pulse') && destUsed(p, /^osc[12]_pw$/)),
  'wave:triangle': (p) => waveUsed(p, 'triangle'),
  'wave:sine': (p) => waveUsed(p, 'sine'),
  'wave:wavetable': (p) => waveUsed(p, 'wavetable') && (destUsed(p, /_wt_pos$/) || num(p, 'osc1.wt_pos') > 0 || num(p, 'osc2.wt_pos') > 0),
  'wave:string': (p) => waveUsed(p, 'string'),
  'osc2-layer': (p) => used(p, 2),
  sync: (p) => used(p, 2) && p['osc2.sync'] === true,
  fm: (p) => num(p, 'fm.amount') > 0.05,
  'fm:operator2': (p) => num(p, 'fm2.amount') > 0.05,
  'fm:feedback': (p) => num(p, 'fm.amount') > 0.05 && num(p, 'fm.feedback') > 0.05,
  'sub:triangle': (p) => num(p, 'sub.level') > 0.05 && p['sub.wave'] === 'triangle',
  'sub:2oct': (p) => num(p, 'sub.level') > 0.05 && num(p, 'sub.octave') === -2,
  'layer:noise': (p) => num(p, 'noise.level') > 0.03,
  'layer:breath': (p) => p['texture.type'] === 'breath' && (num(p, 'breath.level') > 0.05 || num(p, 'breath.chiff') > 0.1),
  'filter:lowpass': (p) => p['filter.type'] === 'lowpass',
  'filter:bandpass': (p) => p['filter.type'] === 'bandpass',
  'filter:formant': (p) => p['filter.type'] === 'formant',
  'filter:diode': (p) => p['filter.type'] === 'diode',
  'filter:comb': (p) => p['filter.type'] === 'comb',
  'filter:lpg': (p) => p['filter.type'] === 'lpg',
  'filter-env:strong': (p) => num(p, 'filter.env_amount') >= 0.3,
  'res:high': (p) => num(p, 'filter.resonance') >= 0.4,
  'dist:soft': (p) => distOn(p) && p['dist.type'] === 'soft',
  'dist:hard': (p) => distOn(p) && p['dist.type'] === 'hard',
  'dist:fold': (p) => distOn(p) && p['dist.type'] === 'fold',
  'dist:mids-only': (p) => distOn(p) && num(p, 'dist.clean_below') >= 80,
  crush: (p) => num(p, 'crush.mix') > 0.1,
  'tape:heavy': (p) => num(p, 'tape.wow') >= 0.35 || num(p, 'tape.age') >= 0.65,
  'amp:pluck': (p) => num(p, 'amp_env.sustain') <= 0.2 && num(p, 'amp_env.decay') <= 900 && num(p, 'amp_env.attack') < 20,
  'amp:short-sustain': (p) => num(p, 'amp_env.sustain') >= 0.5 && num(p, 'amp_env.release') <= 200 && num(p, 'amp_env.attack') < 30,
  'amp:swell': (p) => num(p, 'amp_env.attack') >= 500,
  'modenv:snappy': (p) => num(p, 'filter.env_amount') >= 0.2 && num(p, 'mod_env.decay') <= 300,
  'modenv:slow': (p) => num(p, 'filter.env_amount') >= 0.15 && num(p, 'mod_env.attack') >= 300,
  'pitch-env': (p) => Math.abs(num(p, 'pitch_env.amount')) >= 2,
  'move:synced': (p) => lfoUsed(p, (n) => p[`lfo${n}.sync`] !== 'free'),
  'move:retrigger': (p) => lfoUsed(p, (n) => p[`lfo${n}.retrigger`] === true),
  'move:fade-in': (p) => lfoUsed(p, (n) => num(p, `lfo${n}.fade`) > 0),
  'move:fast': (p) => lfoUsed(p, (n) => p[`lfo${n}.sync`] === 'free' && num(p, `lfo${n}.rate`) >= 4),
  'move:pitch': (p) => destUsed(p, /pitch$/) && slots(p).some((s) => /pitch$/.test(s.dst) && Math.abs(s.amt) >= 0.004),
  'move:wavetable': (p) => destUsed(p, /_wt_pos$/),
  'move:bloom': (p) => slots(p).some((s) => s.src === 'env2'),
  vibrato: (p) => num(p, 'vibrato.depth') > 5,
  wobble: (p) => num(p, 'wobble.depth') > 0.05,
  glide: (p) => num(p, 'voice.polyphony') === 1 && num(p, 'voice.glide') > 10,
  'reverb:small': (p) => num(p, 'reverb.mix') > 0.05 && num(p, 'reverb.size') <= 0.6,
  'reverb:huge': (p) => num(p, 'reverb.mix') > 0.05 && num(p, 'reverb.size') >= 0.9,
  'delay:dotted': (p) => num(p, 'delay.mix') > 0.05 && String(p['delay.time']).endsWith('D'),
  'delay:triplet': (p) => num(p, 'delay.mix') > 0.05 && String(p['delay.time']).endsWith('T'),
  'delay:straight': (p) => num(p, 'delay.mix') > 0.05 && /^\d+\/\d+$/.test(String(p['delay.time'])),
  'chorus:ensemble': (p) => num(p, 'chorus.mix') > 0.05 && p['chorus.mode'] === 'ensemble',
  'chorus:classic': (p) => num(p, 'chorus.mix') > 0.05 && p['chorus.mode'] === 'classic',
  phaser: (p) => num(p, 'phaser.mix') > 0.05,
  flanger: (p) => num(p, 'flanger.mix') > 0.05,
  'pump:strong': (p) => num(p, 'comp.pump') >= 0.4,
  'pump:other-rate': (p) => num(p, 'comp.pump') > 0.1 && p['comp.pump_rate'] !== '1/4',
  'velocity:strong': (p) => num(p, 'voice.velocity') >= 0.75,
  supersaw: (p) => used(p, 1) && p['osc1.wave'] === 'saw' && num(p, 'osc1.unison_voices') >= 6 && num(p, 'osc1.unison_detune') >= 20,
  'delay:feedback': (p) => num(p, 'delay.mix') > 0.05 && num(p, 'delay.feedback') >= 0.65,
  'release:long': (p) => num(p, 'amp_env.release') >= 1800,
  'texture:crackle': (p) => num(p, 'texture.level') > 0.05 && p['texture.type'] === 'crackle',
  'texture:dust': (p) => num(p, 'texture.level') > 0.05 && p['texture.type'] === 'dust',
  'texture:rumble': (p) => num(p, 'texture.level') > 0.05 && p['texture.type'] === 'rumble',
  'texture:air': (p) => num(p, 'texture.level') > 0.05 && p['texture.type'] === 'air',
  'texture:after-dynamics': (p) => num(p, 'texture.level') > 0.05 && p['texture.position'] === 'after dynamics' };

export interface Iconic { id: string; name: string; category: string; preset: string; identity: string; requires: string[] }

export interface Coverage {
  categories: Record<string, string[]>;
  iconic: Iconic[];
  targets: Iconic[];
  /** The second wave of must-have sounds (keys, plucks, leads, arps): tagged "Iconic II". */
  iconic2: Iconic[];
}

/** Categories shown and capped as one shelf: plucks and sequences are the same short sounds, played differently. */
export const SHELVES: Record<string, string> = { arp: 'pluck' };
export const shelfOf = (category: string) => SHELVES[category] ?? category;

/** Ingredients a category should use that no preset in it uses yet. */
export function missing(cov: Coverage, category: string, presets: Patch[]): string[] {
  return (cov.categories[category] ?? []).filter((ing) => {
    const test = INGREDIENTS[ing];
    if (!test) throw new Error(`unknown ingredient ${ing}`);
    return !presets.some(test);
  });
}
