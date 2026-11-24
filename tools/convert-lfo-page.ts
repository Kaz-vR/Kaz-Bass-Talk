// DEV ONLY. The LFO page without a matrix (owner's call, 24 Nov): LFO 1-4 each drive one target directly, set up the
// same way in every preset (LFO 1 cutoff, LFO 2 shape, LFO 3 pitch, LFO 4 noise), the custom LFO (the Wobbler)
// empty, velocity only through TOUCH. Rewrites every library preset: each target's strongest LFO route is kept (its
// LFO's settings copied into LFO n), everything else is dropped.   npx tsx tools/convert-lfo-page.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { validatePatch } from '../src/schema';

const DIR = 'data/library/';
const GROUPS: { n: number; dest: string; from: string[] }[] = [
  { n: 1, dest: 'filter_cutoff', from: ['filter_cutoff'] },
  { n: 2, dest: 'osc12_shape', from: ['osc12_shape', 'osc1_pw', 'osc2_pw', 'osc1_wt_pos', 'osc2_wt_pos'] },
  { n: 3, dest: 'osc_pitch', from: ['osc_pitch', 'pitch', 'osc1_pitch', 'osc2_pitch'] },
  { n: 4, dest: 'texture_level', from: ['texture_level', 'breath_level', 'noise_level'] },
];
const LFO_KEYS = ['on', 'shape', 'rate', 'sync', 'retrigger', 'fade'];
let changed = 0;
for (const file of readdirSync(DIR)) {
  const raw = JSON.parse(readFileSync(DIR + file, 'utf8')) as Record<string, unknown>;
  const p = validatePatch(raw).patch as Record<string, unknown>;
  const routes = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ src: String(p[`mod${i}.source`]), dest: String(p[`mod${i}.dest`]), amt: Number(p[`mod${i}.amount`]), on: p[`mod${i}.on`] !== false }))
    .filter((r) => /^lfo\d$/.test(r.src) && r.dest !== 'none' && r.amt !== 0 && r.on);
  const lfo = (src: string) => Object.fromEntries(LFO_KEYS.map((k) => [k, p[`${src}.${k}`]]));
  const out: Record<string, unknown> = {};
  for (const g of GROUPS) {
    const best = routes.filter((r) => g.from.includes(r.dest)).sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt))[0];
    // the shape group keeps the oscillator it moved (A / B / both); the rest take the group's target
    const dest = best && g.n === 2 ? (best.dest.startsWith('osc1') ? 'osc1_pw' : best.dest.startsWith('osc2') ? 'osc2_pw' : 'osc12_shape') : g.dest;
    Object.assign(out, { [`mod${g.n}.source`]: `lfo${g.n}`, [`mod${g.n}.dest`]: dest, [`mod${g.n}.amount`]: best ? best.amt : 0, [`mod${g.n}.on`]: true });
    if (best) for (const [k, v] of Object.entries(lfo(best.src))) out[`lfo${g.n}.${k}`] = v;
    else out[`lfo${g.n}.on`] = false;
  }
  for (let i = 5; i <= 9; i++) Object.assign(out, { [`mod${i}.source`]: 'none', [`mod${i}.dest`]: 'none', [`mod${i}.amount`]: 0 });
  out['lfo5.on'] = false;
  out['lfo6.on'] = false;
  out['wobble.on'] = false;
  Object.assign(raw, out);
  writeFileSync(DIR + file, JSON.stringify(raw, null, 2) + '\n');
  changed++;
}
console.log(`converted ${changed} presets`);
