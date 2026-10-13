// DEV ONLY. Analyze every library patch: precompute its features (stored in
// meta.features), run the sound-design rules and the quality critic, and
// print a report. Exits non-zero if any patch fails the critic or breaks a rule.
//   npm run analyze:library [-- --no-write]
import { writeFileSync } from 'node:fs';
import { analyzePatch } from '../src/analysis';
import { judge } from '../src/quality/critic';
import { checkRules } from '../src/quality/rules';
import { validatePatch } from '../src/schema';
import { DEFAULT_LOOP, loadLibrary, loadLoops } from './lib/data';

const write = !process.argv.includes('--no-write');
const loop = loadLoops().get(DEFAULT_LOOP)!;
let failures = 0;
for (const entry of loadLibrary()) {
  const patch = validatePatch(entry.json).patch;
  const family = entry.json.meta.family as string | undefined;
  const a = analyzePatch(patch, loop);
  const verdict = judge(a.raw, family);
  const rules = checkRules(patch, family);
  const errors = rules.filter((r) => r.severity === 'error');
  const ok = verdict.pass && errors.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${entry.json.meta.name.padEnd(16)} ${(family ?? '?').padEnd(10)}` +
    (verdict.issues.length ? `  critic: ${verdict.issues.map((i) => i.message).join('; ')}` : '') +
    (rules.length ? `  rules: ${rules.map((r) => `[${r.severity}] ${r.rule}`).join(', ')}` : ''));
  if (write) {
    entry.json.meta.features = a.features;
    writeFileSync(entry.path, JSON.stringify(entry.json, null, 2) + '\n');
  }
}
console.log(failures ? `\n${failures} patch(es) failed` : '\nall patches pass');
process.exit(failures ? 1 : 0);
