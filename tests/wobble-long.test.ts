// The Wobbler's cycles longer than a bar run their full length (the bar clock wraps every 4 beats).
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { heldNote, rms } from './helpers/audio';

const FS = 48000;
const base = {
  meta: { name: 't' }, 'voice.analog': 0, 'amp_env.attack': 1, 'amp_env.sustain': 1, 'amp_env.release': 30, 'osc1.wave': 'saw', 'osc1.level': 0.8,
  'osc2.level': 0, 'sub.level': 0, 'texture.level': 0, 'chorus.on': false, 'delay.on': false, 'reverb.on': false, 'tape.on': false,
  'wobble.on': true, 'wobble.depth': 1, 'wobble.volume': true, 'wobble.cutoff': false, 'wobble.shape': 'saw down', 'wobble.life': 0, 'wobble.lowcut': 20,
};

describe('wobbler long rates', () => {
  it('2 bars: the second bar keeps falling instead of starting over', () => {
    // 120 bpm: a bar is 2 s; saw down over 2 bars is loud at 0.1 s and quiet near 3.9 s, with no restart at 2 s
    const a = renderPatch({ ...base, 'wobble.rate': '2 Bars' }, heldNote(36, 5), { seconds: 4.2 });
    const lvl = (t: number) => rms(a.left, t * FS, (t + 0.05) * FS);
    expect(lvl(2.1)).toBeLessThan(lvl(0.3) * 0.8);
    expect(lvl(3.7)).toBeLessThan(lvl(2.1));
  });
});
