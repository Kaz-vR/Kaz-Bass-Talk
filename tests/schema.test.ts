import { describe, expect, it } from 'vitest';
import {
  defaultPatch, fromNormalized, params, patchToArray, schema, toNormalized, validatePatch,
} from '../src/schema';

describe('schema', () => {
  it('has around 80-100 parameters with unique ids', () => {
    expect(params.length).toBeGreaterThanOrEqual(75);
    expect(params.length).toBeLessThanOrEqual(100);
    expect(new Set(params.map((p) => p.id)).size).toBe(params.length);
  });

  it('every parameter is fully described', () => {
    for (const p of params) {
      expect(p.id, p.id).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/);
      expect(p.label, p.id).toBeTruthy();
      expect(p.group, p.id).toBeTruthy();
      expect(p.describes.length, p.id).toBeGreaterThan(10);
      expect(['float', 'int', 'enum', 'bool']).toContain(p.type);
      if (p.type === 'float' || p.type === 'int') {
        expect(p.min, p.id).toBeTypeOf('number');
        expect(p.max, p.id).toBeGreaterThan(p.min!);
        expect(p.default, p.id).toBeGreaterThanOrEqual(p.min!);
        expect(p.default, p.id).toBeLessThanOrEqual(p.max!);
        if (p.type === 'int') expect(Number.isInteger(p.default), p.id).toBe(true);
      }
      if (p.type === 'float') {
        expect(['linear', 'log', 'pow'], p.id).toContain(p.curve);
        if (p.curve === 'log') expect(p.min!, p.id).toBeGreaterThan(0);
      }
      if (p.type === 'enum') {
        expect(p.options!.length, p.id).toBeGreaterThan(1);
        expect(p.options, p.id).toContain(p.default);
      }
      if (p.type === 'bool') expect(typeof p.default, p.id).toBe('boolean');
    }
  });

  it('covers the required signal path', () => {
    const groups = new Set(params.map((p) => p.group));
    for (const g of ['osc1', 'osc2', 'sub', 'noise', 'drive', 'filter', 'dist', 'amp_env', 'mod_env', 'lfo1', 'lfo2', 'mod', 'fx', 'eq', 'output']) {
      expect(groups, g).toContain(g);
    }
    expect(params.filter((p) => p.id.endsWith('.source')).length).toBe(8);
    expect(schema.version).toBe(1);
  });

  it('validation fills defaults, clamps and reports problems', () => {
    const { patch, issues } = validatePatch({
      meta: { name: 'x' },
      'filter.cutoff': 99999,
      'osc1.unison_voices': 3.6,
      'osc1.wave': 'banana',
      'voice.legato': 'yes',
      'not.a_param': 1,
    });
    expect(patch['filter.cutoff']).toBe(20000);
    expect(patch['osc1.unison_voices']).toBe(4);
    expect(patch['osc1.wave']).toBe('saw');
    expect(patch['voice.legato']).toBe(false);
    expect(patch['amp_env.attack']).toBe(2);
    expect(issues.map((i) => i.param).sort()).toEqual(['filter.cutoff', 'not.a_param', 'osc1.unison_voices', 'osc1.wave', 'voice.legato'].sort());
  });

  it('survives garbage input', () => {
    for (const junk of [null, undefined, 42, 'str', [], { meta: 5 }, { 'filter.cutoff': NaN }]) {
      const { patch } = validatePatch(junk);
      expect(patch.meta.name).toBeTruthy();
      expect(Array.from(patchToArray(patch)).every(Number.isFinite)).toBe(true);
    }
  });

  it('normalised knob mapping round-trips through every curve', () => {
    for (const p of params.filter((p) => p.type === 'float')) {
      for (const t of [0, 0.1, 0.5, 0.9, 1]) {
        const v = fromNormalized(p, t);
        expect(toNormalized(p, v), p.id).toBeCloseTo(t, 6);
      }
    }
  });

  it('flattens to engine numbers in schema order', () => {
    const arr = patchToArray(defaultPatch());
    expect(arr.length).toBe(params.length);
    const i = params.findIndex((p) => p.id === 'filter.type');
    expect(arr[i]).toBe(0);
  });
});
