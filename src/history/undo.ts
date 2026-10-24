// Undo / redo for the sound on screen: a list of patch snapshots. An edit
// gesture (a dial drag, a run of quick clicks) becomes one step: a snapshot
// is taken before the first change of a burst, not on every value. Loading
// a preset or roll is a step too, so undo also brings back what you had.
//
// Plain TypeScript, no browser APIs (the plugin reuses it).

import type { Patch } from '../schema';

export class UndoHistory {
  private back: Patch[] = [];
  private fwd: Patch[] = [];
  private lastEdit = -Infinity;

  constructor(private readonly limit = 200, private readonly burstMs = 600) {}

  /** Call before applying an edit to `before`; edits closer together than burstMs are one step. */
  edit(before: Patch, now: number): void {
    if (now - this.lastEdit > this.burstMs) this.push(before);
    this.lastEdit = now;
  }

  /** Call before replacing the whole sound (a preset, a roll): always its own step. */
  replace(before: Patch): void {
    this.push(before);
    this.lastEdit = -Infinity;
  }

  /** The snapshot to go back to (`current` is kept for redo), or null. */
  undo(current: Patch): Patch | null {
    const p = this.back.pop();
    if (!p) return null;
    this.fwd.push(structuredClone(current));
    this.lastEdit = -Infinity;
    return p;
  }

  redo(current: Patch): Patch | null {
    const p = this.fwd.pop();
    if (!p) return null;
    this.back.push(structuredClone(current));
    this.lastEdit = -Infinity;
    return p;
  }

  get canUndo(): boolean {
    return this.back.length > 0;
  }

  get canRedo(): boolean {
    return this.fwd.length > 0;
  }

  private push(p: Patch): void {
    this.back.push(structuredClone(p));
    if (this.back.length > this.limit) this.back.shift();
    this.fwd = [];
  }
}
