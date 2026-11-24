// DEV ONLY. The LFO page's own filters (owner's call, 24 Nov): an LFO aimed at the OSC page's filter cutoff now aims at
// the LFO page's FILTER (the whole sound, apart from the OSC page's filter and its A / B / S / N lamps). The sound
// changes (the owner redoes the presets).   npx tsx tools/convert-lfo-filters.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'data/library/';
let changed = 0;
for (const file of readdirSync(DIR)) {
  const raw = JSON.parse(readFileSync(DIR + file, 'utf8')) as Record<string, unknown>;
  let hit = false;
  for (let i = 1; i <= 9; i++) {
    if (raw[`mod${i}.dest`] === 'filter_cutoff' && /^lfo\d$/.test(String(raw[`mod${i}.source`]))) {
      raw[`mod${i}.dest`] = 'lfo_filter';
      hit = true;
    }
  }
  if (!hit) continue;
  writeFileSync(DIR + file, JSON.stringify(raw, null, 2) + '\n');
  changed++;
}
console.log(`converted ${changed} presets`);
