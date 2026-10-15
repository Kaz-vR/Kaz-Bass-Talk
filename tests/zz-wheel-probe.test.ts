import { it } from 'vitest';
import { analyzePatch } from '../src/analysis';
import { analysisSetup } from '../src/quality/categories';
import { judge } from '../src/quality/critic';
import { libraryPatches, loop } from './helpers/audio';
const lib = libraryPatches().filter(({ json }) => json.meta.category);
const pick = (process.env.PROBE ?? '').split(',');
it('probe', () => {
  for (const { file, json } of lib.filter((e) => pick.some((p) => e.file.includes(p)))) {
    const setup = analysisSetup(json.meta);
    for (const m of (process.env.MOVES ?? 'choke,decay,bloom').split(',')) {
      const v = judge(analyzePatch({ ...json, 'wheel.move': m }, loop(setup.loop), { ...setup.opts, life: false, modWheel: 1 }).raw, json.meta.family, json.meta.category);
      console.log(file, m, v.issues.filter((x) => !/^(vibe|life)/.test(x.code)).map((i) => i.message).join('; ') || 'ok');
    }
  }
}, 600000);
