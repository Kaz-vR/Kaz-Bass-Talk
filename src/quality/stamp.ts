// Stamps for the slow checks. A preset's check results stay valid while the
// sound itself is unchanged: the audio fingerprint (a hash of a short,
// deterministic render) proves that, whatever code or parameters changed
// around it. The param hash is kept for reference.

import { renderPatch } from '../engine/core/render';
import type { Loop } from '../engine/core/sequencer';
import { params, type Patch } from '../schema';

function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function paramHash(p: Patch): string {
  let h = 0x811c9dc5;
  for (const def of params) h = fnv(h, `${def.id}=${String(p[def.id])};`);
  return h.toString(16).padStart(8, '0');
}

const FP_RATE = 24000;

/**
 * Fingerprint of what a patch sounds like where the checks listen: its
 * audition loop (with tail) and a low and a high held note. Samples are
 * quantized (~-84 dBFS steps), so only a real change in the sound changes it;
 * a change right at a step boundary only costs an unneeded re-check.
 */
export function audioFingerprint(
  patch: unknown,
  loop: Loop,
  opts: { loopSeconds: number; holdSeconds: number; probes: { low: number; high: number } },
): string {
  const held = (note: number): Loop => {
    const beats = opts.holdSeconds * 2; // 120 BPM
    return { id: 'fp', name: 'fp', description: '', bpm: 120, length_beats: beats * 2, notes: [{ start: 0, dur: beats, note, vel: 0.9 }] };
  };
  const renders = [
    renderPatch(patch, loop, { sampleRate: FP_RATE, seconds: opts.loopSeconds, tail: 1 }),
    renderPatch(patch, held(opts.probes.low), { sampleRate: FP_RATE, seconds: opts.holdSeconds, tail: 0.5 }),
    renderPatch(patch, held(opts.probes.high), { sampleRate: FP_RATE, seconds: opts.holdSeconds, tail: 0.5 }),
  ];
  let h = 0x811c9dc5;
  for (const r of renders) {
    for (const ch of [r.left, r.right]) {
      for (let i = 0; i < ch.length; i++) {
        const q = Math.round(ch[i] * 16384);
        h ^= q & 0xffff;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    }
  }
  return h.toString(16).padStart(8, '0');
}
