// DEV ONLY. Builds the preset bank: every category file in tools/bank/
// writes its presets to data/library/<category>-<id>.json (the bass
// category is the Terror presets, built by tools/build-terror.ts).
//
//   npm run build:bank [-- <category> [<preset id>]]
//   then: npm run level:patches -- <category>- && npm run analyze:library -- <category>-

import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { categoryById } from '../src/quality/categories';
import { buildPreset, type CategoryDef } from './bank/common';
import { ROOT } from './lib/data';

const files = readdirSync(join(ROOT, 'tools/bank')).filter((f) => f.endsWith('.ts') && f !== 'common.ts');
const [onlyCat, onlyId] = process.argv.slice(2);
const libDir = join(ROOT, 'data/library');
let n = 0;
for (const f of files.sort()) {
  const def = (await import(`./bank/${f}`)).default as CategoryDef;
  if (onlyCat && def.category !== onlyCat) continue;
  const cat = categoryById(def.category);
  if (!cat) throw new Error(`unknown category ${def.category}`);
  if (!onlyId) for (const g of readdirSync(libDir)) if (g.startsWith(`${def.category}-`)) unlinkSync(join(libDir, g));
  const seen = new Set<string>();
  for (const p of def.presets) {
    if (seen.has(p.id)) throw new Error(`duplicate ${def.category}/${p.id}`);
    seen.add(p.id);
    if (onlyId && p.id !== onlyId) continue;
    writeFileSync(join(libDir, `${def.category}-${p.id}.json`), JSON.stringify(buildPreset(def, p, cat.audition), null, 2) + '\n');
    n++;
  }
}
console.log(`built ${n} bank preset(s)`);
