// DEV ONLY. Check that every library patch and loop is valid.
import { validatePatch } from '../src/schema';
import { loadLibrary, loadLoops } from './lib/data';

let bad = 0;
for (const { file, json } of loadLibrary()) {
  const { issues } = validatePatch(json);
  const missing = ['description', 'tags'].filter((k) => !(k in json.meta));
  if (issues.length || missing.length) {
    bad++;
    console.log(`✗ ${file}`, issues, missing.length ? `missing meta: ${missing}` : '');
  }
}
const loops = loadLoops();
for (const [id, loop] of loops) {
  for (const n of loop.notes) {
    if (n.start < 0 || n.start >= loop.length_beats || n.dur <= 0 || n.vel <= 0 || n.vel > 1) {
      bad++;
      console.log(`✗ loop ${id}: bad note`, n);
    }
  }
}
console.log(bad ? `${bad} problem(s)` : `ok: ${loadLibrary().length} patches, ${loops.size} loops`);
process.exit(bad ? 1 : 0);
