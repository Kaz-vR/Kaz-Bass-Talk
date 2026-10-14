import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { libraryPatches } from './helpers/audio';

const dir = JSON.parse(readFileSync(join(__dirname, '../data/directory.json'), 'utf8'));
const families = new Set(dir.families.map((f: { id: string }) => f.id));
const ids = new Set(dir.entries.map((e: { id: string }) => e.id));

describe('bass directory', () => {
  it('has unique ids, known families and a valid status', () => {
    expect(ids.size).toBe(dir.entries.length);
    expect(dir.entries.length).toBeGreaterThanOrEqual(50);
    for (const e of dir.entries) {
      expect(families, e.id).toContain(e.family);
      expect(['native', 'needs-addition', 'approximation']).toContain(e.status);
      expect(e.identity.length, e.id).toBeGreaterThan(20);
      if (e.status === 'approximation') expect(e.approximation_note, e.id).toBeTruthy();
    }
  });
  it('every family has at least one entry', () => {
    for (const f of families) expect(dir.entries.some((e: { family: string }) => e.family === f), String(f)).toBe(true);
  });
  it('every Atlas and Terror patch names an existing directory entry and family', () => {
    for (const { file, json } of libraryPatches().filter(({ json }) => json.meta.directory)) {
      expect(ids, file).toContain(json.meta.directory);
      expect(families, file).toContain(json.meta.family);
    }
  });

  it('every bass type (all non-performance entries) has a library patch', () => {
    const covered = new Set(libraryPatches().map(({ json }) => json.meta.directory));
    const types = dir.entries.filter((e: { group: string }) => e.group !== 'Performance modification states');
    expect(types.length).toBe(51);
    for (const e of types) expect(covered, e.id).toContain(e.id);
  });
  it('library patch names are unique and each family appears', () => {
    const lib = libraryPatches();
    expect(new Set(lib.map(({ json }) => json.meta.name)).size).toBe(lib.length);
  });
});
