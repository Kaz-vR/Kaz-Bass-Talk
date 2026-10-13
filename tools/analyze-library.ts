// DEV ONLY. Analyze every library patch: precompute its features (stored in
// meta.features), run the sound-design rules and the quality critic, and
// print a report. Bank presets (those with a meta.category) also get their
// vibe measurements (meta.vibe), the earns-its-place check (stamped in
// meta.checks with a hash of the parameters, so it only re-runs when the
// sound changes) and the bank consistency check.
// Exits non-zero if any patch fails.
//   npm run analyze:library [-- <file filter>] [-- --no-write] [-- --force]
import { writeFileSync } from 'node:fs';
import { analyzePatch } from '../src/analysis';
import { earnsItsPlace } from '../src/quality/ablation';
import { analysisSetup } from '../src/quality/categories';
import { outliers, vibeOf, type Vibe } from '../src/quality/consistency';
import { judge } from '../src/quality/critic';
import { checkRules } from '../src/quality/rules';
import { paramHash } from '../src/quality/stamp';
import { validatePatch } from '../src/schema';
import { loadLibrary, loadLoops } from './lib/data';

/** Sample rate for the (slow) earns-its-place renders. */
export const ABLATION_RATE = 32000;

const write = !process.argv.includes('--no-write');
const force = process.argv.includes('--force');
const loops = loadLoops();
let failures = 0;
// Optional file-name filter, e.g. `-- terror-` to only process the Terror presets.
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
for (const entry of loadLibrary().filter((e) => !only || e.file.includes(only))) {
  const patch = validatePatch(entry.json).patch;
  const meta = entry.json.meta;
  const family = meta.family as string | undefined;
  const category = meta.category as string | undefined;
  const setup = analysisSetup(meta);
  const loop = loops.get(setup.loop)!;
  const a = analyzePatch(patch, loop, setup.opts);
  const verdict = judge(a.raw, family, category);
  const rules = checkRules(patch, family);
  const errors = rules.filter((r) => r.severity === 'error');
  let ok = verdict.pass && errors.length === 0;
  let earned = '';
  if (category) {
    meta.vibe = vibeOf(a.raw);
    const hash = paramHash(patch);
    const prev = meta.checks as { hash?: string; earns?: boolean; weakest?: string } | undefined;
    if (force || !prev || prev.hash !== hash) {
      const res = earnsItsPlace(patch, loop, { seconds: setup.opts.loopSeconds, sampleRate: ABLATION_RATE });
      const failing = res.filter((r) => !r.pass);
      const weakest = [...res].sort((x, y) => x.diffDb - y.diffDb)[0];
      meta.checks = {
        hash,
        earns: failing.length === 0,
        weakest: weakest ? `${weakest.ingredient.label} ${weakest.diffDb.toFixed(2)} dB` : '',
        failing: failing.map((r) => `${r.ingredient.label} ${r.diffDb.toFixed(2)} dB`),
      };
    }
    const checks = meta.checks as { earns: boolean; failing: string[] };
    if (!checks.earns) {
      ok = false;
      earned = `  doesn't earn its place: ${checks.failing.join('; ')}`;
    }
  }
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${meta.name.padEnd(16)} ${(category ?? family ?? '?').padEnd(10)}` +
    (verdict.issues.length ? `  critic: ${verdict.issues.map((i) => i.message).join('; ')}` : '') +
    (rules.length ? `  rules: ${rules.map((r) => `[${r.severity}] ${r.rule}`).join(', ')}` : '') + earned);
  if (write) {
    meta.features = a.features;
    writeFileSync(entry.path, JSON.stringify(entry.json, null, 2) + '\n');
  }
}

// Bank consistency (over the whole bank, from the stored vibe measurements).
const bank = loadLibrary().filter((e) => e.json.meta.category && e.json.meta.vibe);
const odd = outliers(bank.map((e) => ({ name: e.json.meta.name, vibe: e.json.meta.vibe as Vibe })));
for (const o of odd) console.log(`✗ outlier: ${o.name} ${o.key} ${o.value} (bank median ${o.median}, z ${o.z.toFixed(1)})`);
failures += odd.length;

console.log(failures ? `\n${failures} problem(s)` : '\nall patches pass');
process.exit(failures ? 1 : 0);
