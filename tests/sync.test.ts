// Hard sync: oscillator 2 locks to oscillator 1's pitch (its harmonics, nothing
// between them), the restarts are band-limited, and off changes nothing.
import { describe, expect, it } from 'vitest';
import { bandPower, powerSpectrum } from '../src/analysis/spectrum';
import { renderPatch } from '../src/engine/core/render';
import { heldNote } from './helpers/audio';

const FS = 48000;
const base = {
  meta: { name: 't' }, 'osc1.level': 0, 'osc2.wave': 'saw', 'osc2.level': 0.8, 'osc2.semi': 7.3, 'filter.cutoff': 20000, 'sub.level': 0,
  'amp_env.sustain': 1, 'voice.analog': 0, 'eq.highcut': 20000, 'drive.amount': 0, 'dist.drive': 0,
};
/** Energy between the 220 Hz harmonics relative to on them, dB. */
function inharmonicDb(p: object): number {
  const r = renderPatch(p, heldNote(57, 4), { seconds: 1, sampleRate: FS });
  const sp = powerSpectrum(r.left, FS, 4800, FS, 16384);
  let h = 0, a = 0;
  for (let k = 1; k * 220 < 20000; k++) {
    h += bandPower(sp, k * 220 - 20, k * 220 + 20);
    a += bandPower(sp, k * 220 + 40, (k + 1) * 220 - 40);
  }
  return 10 * Math.log10(a / h);
}

describe('hard sync', () => {
  it('locks oscillator 2 to oscillator 1, band-limited', () => {
    expect(inharmonicDb(base)).toBeGreaterThan(0); // off: its own (unrelated) pitch
    expect(inharmonicDb({ ...base, 'osc2.sync': true })).toBeLessThan(-35); // on: oscillator 1's harmonics only
  });
  it('a high sweep stays clean', () => {
    expect(inharmonicDb({ ...base, 'osc2.sync': true, 'osc2.semi': 31 })).toBeLessThan(-30);
  });
});
