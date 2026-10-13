// Bundled data (patch library + audition loops). Everything ships inside the
// build; nothing is fetched at runtime.
import type { Loop } from '../engine/core/sequencer';
import { validatePatch, type Patch } from '../schema';

const libraryFiles = import.meta.glob('../../data/library/*.json', { eager: true, import: 'default' });
const loopFiles = import.meta.glob('../../data/loops/*.json', { eager: true, import: 'default' });

export const DEFAULT_LOOP_ID = 'groove';

export const library: Patch[] = Object.keys(libraryFiles)
  .sort()
  .map((k) => validatePatch(libraryFiles[k]).patch)
  .sort((a, b) => a.meta.name.localeCompare(b.meta.name));

export const loops: Loop[] = Object.values(loopFiles as Record<string, Loop>).sort((a, b) =>
  a.id === DEFAULT_LOOP_ID ? -1 : b.id === DEFAULT_LOOP_ID ? 1 : a.name.localeCompare(b.name),
);
