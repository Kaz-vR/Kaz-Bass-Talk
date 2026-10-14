// DEV ONLY. Rebuilds only the bank presets whose definition changed (or are
// new), so unchanged presets keep their check stamps:
//   npx tsx tools/build-changed.ts   → prints the changed files
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { categoryById } from '../src/quality/categories';
import { buildPreset, type CategoryDef } from './bank/common';
import { ROOT } from './lib/data';

const libDir = join(ROOT, 'data/library');
const changed: string[] = [];
for (const f of readdirSync(join(ROOT, 'tools/bank')).filter((f) => f.endsWith('.ts') && f !== 'common.ts').sort()) {
  const def = (await import(`./bank/${f}`)).default as CategoryDef;
  const cat = categoryById(def.category)!;
  for (const p of def.presets) {
    const file = join(libDir, `${def.category}-${p.id}.json`);
    const next = buildPreset(def, p, cat.audition) as Record<string, unknown> & { meta: Record<string, unknown> };
    if (existsSync(file)) {
      const old = JSON.parse(readFileSync(file, 'utf8'));
      // Parameters added to the schema after a file was written read as their defaults; output.gain is the levelling.
      const sameSound = Object.keys(next).every((k) => k === 'meta' || k === 'output.gain' || !(k in old) || JSON.stringify(old[k]) === JSON.stringify(next[k]));
      const metaKeys = ['name', 'description', 'tags', 'audition', 'allow'];
      const sameMeta = metaKeys.every((k) => JSON.stringify(old.meta?.[k]) === JSON.stringify(next.meta[k]));
      if (sameSound && sameMeta) continue;
      if (sameSound) {
        // Only the words changed (a tag, a description, a written exception): keep the check results.
        for (const k of metaKeys) if (next.meta[k] === undefined) delete old.meta[k]; else old.meta[k] = next.meta[k];
        writeFileSync(file, JSON.stringify(old, null, 2) + '\n');
        changed.push(`${def.category}-${p.id}.json (words only)`);
        continue;
      }
    }
    if (existsSync(file)) next['output.gain'] = JSON.parse(readFileSync(file, 'utf8'))['output.gain'];
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    changed.push(`${def.category}-${p.id}.json`);
  }
}
console.log(changed.join(','));
