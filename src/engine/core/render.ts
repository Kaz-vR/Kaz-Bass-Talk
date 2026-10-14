// Offline rendering (Node, tests, dev tools and — later — the listening check).

import { patchToArray, validatePatch } from '../../schema';
import { compileLoop, LoopPlayer, type Loop } from './sequencer';
import { Synth } from './synth';

export interface RenderOptions {
  sampleRate?: number;
  seconds?: number;
  /** Seconds of silence-tail after the loop is stopped (release, reverb). */
  tail?: number;
  /** Mod wheel position 0..1, held for the whole render. */
  modWheel?: number;
}

export interface RenderResult {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Lowest gain the output limiter applied (1 = never engaged). */
  limiterMinGain: number;
}

const BLOCK = 128;

/** Render a patch (any patch-like object; it is validated) playing a loop. */
export function renderPatch(patch: unknown, loop: Loop, opts: RenderOptions = {}): RenderResult {
  const sampleRate = opts.sampleRate ?? 48000;
  const seconds = opts.seconds ?? 2;
  const tail = opts.tail ?? 0;
  const synth = new Synth(sampleRate);
  synth.setParams(patchToArray(validatePatch(patch).patch), true);
  if (opts.modWheel) synth.setModWheel(opts.modWheel);
  const player = new LoopPlayer(synth);
  player.setLoop(compileLoop(loop));
  player.start();
  const total = Math.round((seconds + tail) * sampleRate);
  const playFrames = Math.round(seconds * sampleRate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  for (let pos = 0; pos < total; pos += BLOCK) {
    if (pos >= playFrames && player.playing) player.stop();
    player.render(left, right, pos, Math.min(BLOCK, total - pos));
  }
  return { left, right, sampleRate, limiterMinGain: synth.takeLimiterMinGain() };
}
