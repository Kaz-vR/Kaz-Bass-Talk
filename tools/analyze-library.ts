// DEV ONLY. Analyze every library patch: precompute its features (stored in
// meta.features), run the sound-design rules and the quality critic, and
// print a report. Bank presets (those with a meta.category) also get their
// vibe measurements (meta.vibe), the earns-its-place check and the bank
// consistency check. Results are stamped in meta.checks with an audio
// fingerprint and the judge hash: while both match, a preset is not
// re-analyzed (its sound and its judges are unchanged); --force re-runs all.
// Exits non-zero if any patch fails.
//   npm run analyze:library [-- <file filter>] [-- --no-write] [-- --force]
import { writeFileSync } from 'node:fs';
import { analyzePatch } from '../src/analysis';
import { earnsItsPlace } from '../src/quality/ablation';
import { analysisSetup } from '../src/quality/categories';
import { outliers, vibeOf, type Vibe } from '../src/quality/consistency';
import { judge } from '../src/quality/critic';
import { checkRules } from '../src/quality/rules';
import { audioFingerprint, paramHash } from '../src/quality/stamp';
import { validatePatch } from '../src/schema';
import { allowedOutlier, applyAllowances } from './lib/allow';
import { judgeHash } from './lib/codehash';
import { loadLibrary, loadLoops } from './lib/data';

/** Sample rate for the (slow) earns-its-place renders. */
export const ABLATION_RATE = 32000;

/** What every analyzed preset stores in meta.checks (see src/quality/stamp.ts). */
interface Stamp {
  hash: string;
  audio: string;
  judge: string;
  critic: boolean;
  issues: string[];
  earns: boolean;
  weakest: string;
  failing: string[];
}

const write = !process.argv.includes('--no-write');
const force = process.argv.includes('--force');
const loops = loadLoops();
let failures = 0;
// Optional file-name filter, e.g. `-- terror-` to only process the Terror presets.
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
// Or an exact list (used by tools/analyze-parallel.ts): --files=a.json,b.json
const fileList = process.argv.find((a) => a.startsWith('--files='))?.slice(8).split(',');
let reused = 0;
for (const entry of loadLibrary().filter((e) => (fileList ? fileList.includes(e.file) : !only || e.file.includes(only)))) {
  const patch = validatePatch(entry.json).patch;
  const meta = entry.json.meta;
  const family = meta.family as string | undefined;
  const category = meta.category as string | undefined;
  const setup = analysisSetup(meta);
  const loop = loops.get(setup.loop)!;
  const hash = paramHash(patch);
  const judgeH = judgeHash();
  const audio = audioFingerprint(patch, loop, setup.opts);
  const prev = meta.checks as Stamp | undefined;

  // Same sound, same judge: the stored results still hold, nothing to re-run.
  if (!force && prev && prev.audio === audio && prev.judge === judgeH && (!category || meta.vibe)) {
    reused++;
    const ok = prev.critic && (!category || prev.earns);
    if (!ok) failures++;
    console.log(`${ok ? '✓' : '✗'} ${meta.name.padEnd(16)} ${(category ?? family ?? '?').padEnd(10)}  (unchanged sound, results kept)` +
      (prev.issues.length ? `  critic: ${prev.issues.join('; ')}` : '') +
      (category && !prev.earns ? `  doesn't earn its place: ${prev.failing.join('; ')}` : ''));
    if (write && prev.hash !== hash) {
      prev.hash = hash;
      writeFileSync(entry.path, JSON.stringify(entry.json, null, 2) + '\n');
    }
    continue;
  }

  const a = analyzePatch(patch, loop, setup.opts);
  const verdict = applyAllowances(judge(a.raw, family, category), meta);
  const rules = checkRules(patch, family);
  const errors = rules.filter((r) => r.severity === 'error');
  let ok = verdict.pass && errors.length === 0;
  let earned = '';
  const stamp: Stamp = {
    hash, audio, judge: judgeH,
    critic: verdict.pass && errors.length === 0,
    issues: [...verdict.issues.map((i) => i.message), ...errors.map((e) => e.message)],
    earns: true, weakest: '', failing: [],
  };
  if (category) {
    meta.vibe = vibeOf(a.raw);
    const res = earnsItsPlace(patch, loop, { seconds: setup.opts.loopSeconds, sampleRate: ABLATION_RATE });
    const failing = res.filter((r) => !r.pass);
    const weakest = [...res].sort((x, y) => x.diffDb - y.diffDb)[0];
    stamp.earns = failing.length === 0;
    stamp.weakest = weakest ? `${weakest.ingredient.label} ${weakest.diffDb.toFixed(2)} dB` : '';
    stamp.failing = failing.map((r) => `${r.ingredient.label} ${r.diffDb.toFixed(2)} dB`);
    if (!stamp.earns) {
      ok = false;
      earned = `  doesn't earn its place: ${stamp.failing.join('; ')}`;
    }
  }
  meta.checks = stamp;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${meta.name.padEnd(16)} ${(category ?? family ?? '?').padEnd(10)}` +
    (verdict.issues.length ? `  critic: ${verdict.issues.map((i) => i.message).join('; ')}` : '') +
    (rules.length ? `  rules: ${rules.map((r) => `[${r.severity}] ${r.rule}`).join(', ')}` : '') + earned);
  if (write) {
    meta.features = a.features;
    writeFileSync(entry.path, JSON.stringify(entry.json, null, 2) + '\n');
  }
}
if (reused) console.log(`(${reused} with unchanged sound: results kept)`);

// Bank consistency (over the whole bank, from the stored vibe measurements).
if (!process.argv.includes('--no-consistency')) {
  const bank = loadLibrary().filter((e) => e.json.meta.category && e.json.meta.vibe);
  const metaByName = new Map(bank.map((e) => [e.json.meta.name, e.json.meta]));
  const odd = outliers(bank.map((e) => ({ name: e.json.meta.name, vibe: e.json.meta.vibe as Vibe }))).filter((o) => !allowedOutlier(metaByName.get(o.name), o.key));
  for (const o of odd) console.log(`✗ outlier: ${o.name} ${o.key} ${o.value} (bank median ${o.median}, z ${o.z.toFixed(1)})`);
  failures += odd.length;
}

console.log(failures ? `\n${failures} problem(s)` : '\nall patches pass');
process.exit(failures ? 1 : 0);
