// Power switches (saved in the preset) and layer solo / mute (listening aids):
// a switched-off block sounds like the block not being there; solo / mute
// match turning the layers' levels down.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { heldNote } from './helpers/audio';

const FS = 24000;
const busy = {
  meta: { name: 't' }, 'osc1.wave': 'saw', 'osc2.wave': 'pulse', 'osc2.level': 0.4, 'sub.level': 0.4, 'noise.level': 0.1, 'click.level': 0.5,
  'breath.level': 0.2, 'fm.amount': 0.3, 'drive.amount': 0.5, 'filter.cutoff': 900, 'filter.resonance': 0.3, 'dist.drive': 0.4, 'dist.mix': 0.6,
  'crush.mix': 0.6, 'crush.bits': 4, 'crush.rate': 6, 'tape.drive': 0.4, 'tape.wow': 0.3, 'tape.age': 0.4, 'vibrato.depth': 30, 'vibrato.delay': 0,
  'wobble.depth': 0.6, 'comp.amount': 0.5, 'comp.pump': 0.4, 'ott.amount': 0.3, 'eq.highcut': 5000, 'eq.low_gain': 3,
  'chorus.mix': 0.4, 'flanger.mix': 0.3, 'phaser.mix': 0.3, 'delay.mix': 0.3, 'reverb.mix': 0.3, 'texture.level': 0.4,
  'amp_env.sustain': 1, 'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.3, 'lfo1.rate': 3,
};
const render = (p: object, monitor?: { solo?: string[]; mute?: string[] }) =>
  renderPatch(p, heldNote(45, 4), { seconds: 1.5, sampleRate: FS, monitor }).left;
const diffDb = (a: Float32Array, b: Float32Array) => {
  let d = 0, e = 0;
  for (let i = 0.3 * FS; i < a.length; i++) {
    d += (a[i] - b[i]) ** 2;
    e += a[i] ** 2;
  }
  return 10 * Math.log10(d / e + 1e-30);
};

describe('power switches', () => {
  const on = render(busy);
  it.each([
    ['fm.on', { 'fm.amount': 0 }], ['drive.on', { 'drive.amount': 0 }], ['dist.on', { 'dist.mix': 0 }], ['crush.on', { 'crush.mix': 0 }],
    ['tape.on', { 'tape.drive': 0, 'tape.wow': 0, 'tape.age': 0 }], ['vibrato.on', { 'vibrato.depth': 0 }], ['wobble.on', { 'wobble.depth': 0 }],
    ['mod.on', { 'mod1.amount': 0 }], ['lfo1.on', { 'mod1.amount': 0 }], ['dynamics.on', { 'comp.amount': 0, 'comp.pump': 0, 'ott.amount': 0 }],
    ['eq.on', { 'eq.highcut': 20000, 'eq.low_gain': 0 }], ['chorus.on', { 'chorus.mix': 0 }], ['flanger.on', { 'flanger.mix': 0 }],
    ['phaser.on', { 'phaser.mix': 0 }], ['delay.on', { 'delay.mix': 0 }], ['reverb.on', { 'reverb.mix': 0 }],
  ] as const)('%s off = the block not being there', (flag, without) => {
    const off = render({ ...busy, [flag]: false });
    expect(diffDb(on, off), 'switching off changes the sound').toBeGreaterThan(-40);
    expect(diffDb(render({ ...busy, ...without }), off), 'and matches the block at zero').toBeLessThan(-60);
  });

  it('filter off opens the filter fully', () => {
    const off = render({ ...busy, 'filter.on': false });
    const open = render({ ...busy, 'filter.cutoff': 20000, 'filter.resonance': 0, 'mod1.amount': 0, 'wobble.depth': 0 });
    expect(diffDb(open, off)).toBeLessThan(-60);
  });
});

describe('solo / mute', () => {
  it('mute matches the layer turned down', () => {
    expect(diffDb(render({ ...busy, 'osc2.level': 0 }), render(busy, { mute: ['osc2'] }))).toBeLessThan(-60);
  });
  it('solo plays only the soloed layers', () => {
    const silent = { 'osc1.level': 0, 'osc2.level': 0, 'noise.level': 0, 'click.level': 0, 'breath.level': 0, 'texture.level': 0 };
    expect(diffDb(render({ ...busy, ...silent }), render(busy, { solo: ['sub'] }))).toBeLessThan(-60);
  });
});
