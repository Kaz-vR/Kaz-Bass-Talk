import { readFileSync, writeFileSync } from 'fs';
import { Ott } from '../src/engine/core/grind';
const [inp, outp] = process.argv.slice(2);
const b = readFileSync(inp), i = b.indexOf('data'), n = b.readUInt32LE(i + 4) / 8;
const o = new Ott(0, 0); o.set(1, 20, 48000);
const out = Buffer.alloc(44 + n * 8); b.copy(out, 0, 0, 44);
for (let k = 0; k < n; k++) { o.process(b.readFloatLE(i + 8 + 8 * k), b.readFloatLE(i + 12 + 8 * k)); out.writeFloatLE(o.l, 44 + 8 * k); out.writeFloatLE(o.r, 48 + 8 * k); }
writeFileSync(outp, out);
