// The plugin's generated data (plugin/engine/generated, plugin/resources/presets.json) must match
// data/schema.json: a stale copy plays the wrong parameter behind every control.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { params } from '../src/schema';

describe('plugin data', () => {
  const schemaH = readFileSync('plugin/engine/generated/Schema.h', 'utf8');
  it('Schema.h has every parameter, in schema order', () => {
    expect(schemaH).toContain(`PARAM_COUNT = ${params.length};`);
    const ids = [...schemaH.matchAll(/^ {2}\{ "([^"]+)"/gm)].map((m) => m[1]);
    expect(ids).toEqual(params.map((p) => p.id));
  });
  it('presets.json carries a value for every parameter', () => {
    const presets = JSON.parse(readFileSync('plugin/resources/presets.json', 'utf8')) as { values: number[] }[];
    expect(presets.length).toBeGreaterThan(0);
    for (const p of presets) expect(p.values.length).toBe(params.length);
  });
});
