// A short hash of a patch's parameter values (not its meta), used to stamp
// slow checks (earns-its-place) so they only re-run when the sound changes.

import { params, type Patch } from '../schema';

export function paramHash(p: Patch): string {
  let h = 0x811c9dc5;
  for (const def of params) {
    const s = `${def.id}=${String(p[def.id])};`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}
