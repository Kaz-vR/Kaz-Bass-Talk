// DEV ONLY. One-off: the pitch envelope became Env 3 (a matrix source) and the matrix's Pitch now
// moves the whole note, sub included. For every library preset: its Pitch rows become Osc A+B
// pitch (same sound: the sub stays steady), and a pitch envelope becomes Env 3 → Pitch in a free
// slot or, when all 12 are used, in place of its weakest mod slot (by the earns-its-place check).
//   npx tsx tools/migrate-env3.ts
import { writeFileSync } from 'node:fs';
import { earnsItsPlace } from '../src/quality/ablation';
import { analysisSetup } from '../src/quality/categories';
import { validatePatch } from '../src/schema';
const ABLATION_RATE = 32000; // as tools/analyze-library.ts (importing it would run it)
import { loadLibrary, loadLoops } from './lib/data';

const loops = loadLoops();
const touched: string[] = [];
for (const entry of loadLibrary()) {
  const j = entry.json as Record<string, unknown> & { meta: Record<string, unknown> };
  if (!('pitch_env.amount' in j)) continue;
  for (let n = 1; n <= 12; n++) if (j[`mod${n}.dest`] === 'pitch') j[`mod${n}.dest`] = 'osc_pitch';
  const amount = Number(j['pitch_env.amount']) || 0, decay = Number(j['pitch_env.decay']) || 60;
  delete j['pitch_env.amount'];
  delete j['pitch_env.decay'];
  if (Math.abs(amount) > 1e-6) {
    const amt = (n: number) => Math.abs(Number(j[`mod${n}.amount`]) || 0);
    const free = (n: number) => (j[`mod${n}.source`] ?? 'none') === 'none' || (j[`mod${n}.dest`] ?? 'none') === 'none' || amt(n) === 0;
    let slot = 0;
    for (let n = 1; n <= 12 && !slot; n++) if (free(n)) slot = n;
    let note = 'free slot';
    if (!slot) {
      // all 12 used: drop the one the ear misses least
      const setup = analysisSetup(j.meta);
      const res = earnsItsPlace(validatePatch(j).patch, loops.get(setup.loop)!, { seconds: setup.opts.loopSeconds, sampleRate: ABLATION_RATE })
        .filter((r) => /^mod\d+$/.test(r.ingredient.id))
        .sort((a, b) => a.diffDb - b.diffDb);
      slot = Number(res[0].ingredient.id.slice(3));
      note = `replaced ${res[0].ingredient.label} (${res[0].diffDb.toFixed(2)} dB)`;
    }
    j['env3.attack'] = 0;
    j['env3.decay'] = decay;
    j['env3.sustain'] = 0;
    j['env3.release'] = decay;
    j[`mod${slot}.source`] = 'env3';
    j[`mod${slot}.dest`] = 'pitch';
    j[`mod${slot}.amount`] = Math.max(-1, Math.min(1, amount / 24));
    j[`mod${slot}.on`] = true;
    touched.push(entry.file);
    console.log(`${String(j.meta.name).padEnd(20)} ${amount > 0 ? '+' : ''}${amount} st / ${decay} ms → mod ${slot}: ${note}${Math.abs(amount) > 24 ? ' (clamped to 24 st)' : ''}`);
  }
  writeFileSync(entry.path, JSON.stringify(j, null, 2) + '\n');
}
writeFileSync('/tmp/claude-0/-home-user-Kaz-Bass-Talk/84df0583-931a-583f-a1f2-752f7859a924/scratchpad/env3-touched.txt', touched.join(','));
console.log(`${touched.length} presets got Env 3 → Pitch`);
