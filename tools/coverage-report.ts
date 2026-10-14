// DEV ONLY. What's missing: per category, the sensible ingredients no preset
// uses yet; and which must-have sounds have no preset (or lost their identity).
//   npx tsx tools/coverage-report.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePatch } from '../src/schema';
import { INGREDIENTS, missing, type Coverage } from './lib/coverage';
import { loadLibrary, ROOT } from './lib/data';

const cov = JSON.parse(readFileSync(join(ROOT, 'data/coverage.json'), 'utf8')) as Coverage;
const lib = loadLibrary().map((e) => ({ file: e.file.replace(/\.json$/, ''), patch: validatePatch(e.json).patch }));
const bank = lib.filter((e) => e.patch.meta.category);
let holes = 0;
console.log('Ingredients no preset uses yet:');
for (const c of Object.keys(cov.categories)) {
  const m = missing(cov, c, bank.filter((e) => e.patch.meta.category === c).map((e) => e.patch));
  holes += m.length;
  console.log(`  ${c.padEnd(8)} ${m.length ? m.join(', ') : '-'}`);
}
console.log('\nMust-have sounds:');
for (const s of [...cov.iconic, ...cov.targets, ...(cov.iconic2 ?? [])]) {
  const e = lib.find((x) => x.file === s.preset);
  const lost = e ? s.requires.filter((r) => !INGREDIENTS[r](e.patch)) : [];
  const state = !e ? 'not built' : lost.length ? `identity missing: ${lost.join(', ')}` : 'ok';
  if (state !== 'ok') holes++;
  console.log(`  ${state === 'ok' ? '✓' : '✗'} ${s.name} (${s.preset}): ${state}`);
}
console.log(holes ? `\n${holes} hole(s)` : '\ncomplete');
