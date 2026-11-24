// DEV ONLY. The RUIN filter is only ever the four bands (owner's call, 24 Nov): rewrites every library preset whose
// RUIN filter still uses an old type (notch, peak, band, comb, phaser) as the four bands (bellsFromOld), and drops
// ONE SHOT (gone from the engine).   npx tsx tools/convert-ruin-filters.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { bellsFromOld } from '../src/ui/ruin-recipes';

const DIR = 'data/library/';
for (const file of readdirSync(DIR)) {
  const raw = readFileSync(DIR + file, 'utf8'), p = JSON.parse(raw) as Record<string, unknown>;
  let changed = false;
  for (let n = 1; n <= 8; n++) {
    const g = `grind${n}`, t = p[`${g}.filter`];
    if (typeof t !== 'string' || t === 'bells' || p[`${g}.on`] !== true) continue;
    Object.assign(p, bellsFromOld(g, t, Number(p[`${g}.freq`] ?? 936), Number(p[`${g}.width`] ?? 0.37), Number(p[`${g}.range`] ?? 2.5), Number(p[`${g}.depth`] ?? 1)));
    changed = true;
  }
  if (p['grind.oneshot'] === true) {
    p['grind.oneshot'] = false;
    changed = true;
  }
  if (!changed) continue;
  writeFileSync(DIR + file, JSON.stringify(p, null, 2) + '\n');
  console.log('converted', file);
}
