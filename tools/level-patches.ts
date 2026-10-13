// DEV ONLY. Loudness-match the library: render each patch on the default
// loop and set output.gain so the RMS lands on TARGET_DB, without letting
// peaks go above PEAK_LIMIT (so the limiter stays a safety net, not a sound).
import { writeFileSync } from 'node:fs';
import { analyzePatch } from '../src/analysis';
import { renderPatch } from '../src/engine/core/render';
import { analysisSetup } from '../src/quality/categories';
import { loadLibrary, loadLoops } from './lib/data';
import { quickStats } from './lib/measure';

const TARGET_DB = -16;
const MAX_LIMITER_DB = 1.5; // never lean on the limiter for loudness
const PEAK_LIMIT = 0.85; // just under the -1 dBFS limiter ceiling: it only ever touches stray transients
const loops = loadLoops();

// Optional file-name filter, e.g. `-- terror-` to only process the Terror presets.
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
for (const entry of loadLibrary().filter((e) => !only || e.file.includes(only))) {
  const patch = entry.json;
  // Level on the loop the patch is measured with (its category's, else the default bass groove).
  const setup = analysisSetup(patch.meta);
  const loop = loops.get(setup.loop)!;
  const seconds = Math.max(4, setup.opts.loopSeconds);
  for (let pass = 0; pass < 4; pass++) {
    const r = renderPatch(patch, loop, { seconds });
    const s = quickStats(r.left, r.right, r.sampleRate);
    // Back off if the limiter is doing real work (transients above the ceiling).
    const limDb = -20 * Math.log10(r.limiterMinGain);
    const delta = Math.min(TARGET_DB - s.rmsDb, 20 * Math.log10(PEAK_LIMIT / s.peak), MAX_LIMITER_DB - limDb);
    if (Math.abs(delta) < 0.25) break;
    const gain = Math.max(-24, Math.min(12, (patch['output.gain'] as number) + delta));
    patch['output.gain'] = Math.round(gain * 10) / 10;
  }
  // The critic also plays held notes in the patch's register (low notes can hit the
  // limiter harder than the loop): back off until its limiter measure is comfortable too.
  for (let pass = 0; pass < 3; pass++) {
    const lim = analyzePatch(patch, loop, { ...setup.opts, life: false }).raw.limiterDb;
    if (lim <= MAX_LIMITER_DB + 0.5) break;
    patch['output.gain'] = Math.round(((patch['output.gain'] as number) - (lim - MAX_LIMITER_DB)) * 10) / 10;
  }
  const r = renderPatch(patch, loop, { seconds });
  const s = quickStats(r.left, r.right, r.sampleRate);
  console.log(`${patch.meta.name.padEnd(16)} gain ${String(patch['output.gain']).padStart(5)} dB → rms ${s.rmsDb.toFixed(1)} dB, peak ${s.peak.toFixed(2)}`);
  writeFileSync(entry.path, JSON.stringify(patch, null, 2) + '\n');
}
