// DEV ONLY. Writes each library preset's designed mod wheel move
// (wheel.preset) from its category, without rebuilding it (keeps its level).
// The builders set it for new presets; this brings existing files in line.
import { writeFileSync } from 'node:fs';
import { wheelDefault } from '../src/quality/categories';
import { loadLibrary } from './lib/data';

let n = 0;
for (const e of loadLibrary()) {
  const want = wheelDefault(e.json.meta.category as string | undefined);
  if (e.json['wheel.preset'] === want) continue;
  e.json['wheel.preset'] = want;
  writeFileSync(e.path, JSON.stringify(e.json, null, 2) + '\n');
  n++;
}
console.log(`set the mod wheel move on ${n} preset(s)`);
