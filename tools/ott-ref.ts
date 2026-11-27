// Dev only: runs our OTT (grind.ts) on a WAV, without the synth's bus offsets (detector and makeup at 0 dB), so its
// curves can be measured against a reference in dBFS.   npx tsx tools/ott-ref.ts in.wav out.wav [depth]
import { readFileSync, writeFileSync } from 'fs';
import { Ott, OTT_ABOVE, OTT_ATTACK, OTT_BAND_DB, OTT_BELOW, OTT_RELEASE } from '../src/engine/core/grind';
const [inp, outp, depthS = '1', tryS = ''] = process.argv.slice(2);
// (a trial set of thresholds and gains, for fitting: {"above":[..], "below":[..], "gain":[..]})
if (tryS) { const t = JSON.parse(tryS); for (let b = 0; b < 3; b++) { OTT_ABOVE[b] = t.above[b]; OTT_BELOW[b] = t.below[b]; OTT_BAND_DB[b] = t.gain[b]; if (t.attack) OTT_ATTACK[b] = t.attack[b]; if (t.release) OTT_RELEASE[b] = t.release[b]; } }
const b = readFileSync(inp), i = b.indexOf('data'), n = b.readUInt32LE(i + 4) / 8;
const o = new Ott(0, 0);
o.set(Number(depthS), 20, 48000);
const out = Buffer.alloc(44 + n * 8);
b.copy(out, 0, 0, 44);
for (let k = 0; k < n; k++) {
  o.process(b.readFloatLE(i + 8 + 8 * k), b.readFloatLE(i + 12 + 8 * k));
  out.writeFloatLE(o.l, 44 + 8 * k);
  out.writeFloatLE(o.r, 48 + 8 * k);
}
writeFileSync(outp, out);
