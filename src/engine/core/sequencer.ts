// Audition-loop sequencer. Loops are compiled to a flat event array on the
// main thread (or in Node); playback is sample-accurate and allocation-free.

import type { Synth } from './synth';

export interface LoopNote {
  /** Start, in beats from the loop start. */
  start: number;
  /** Length in beats. Overlapping the next note makes a legato slide. */
  dur: number;
  /** MIDI note number. */
  note: number;
  /** Velocity 0..1. */
  vel: number;
}

export interface Loop {
  id: string;
  name: string;
  description: string;
  bpm: number;
  length_beats: number;
  notes: LoopNote[];
}

export interface CompiledLoop {
  /** Repeating [beat, type (1 = on, 0 = off), note, velocity]. */
  events: Float64Array;
  count: number;
  lengthBeats: number;
  bpm: number;
}

export function compileLoop(loop: Loop): CompiledLoop {
  const L = loop.length_beats;
  const ev: [number, number, number, number][] = [];
  for (const n of loop.notes) {
    const start = ((n.start % L) + L) % L;
    let end = Math.min(n.start + n.dur, L + start);
    if (end >= L) end -= L;
    ev.push([start, 1, n.note, n.vel]);
    ev.push([end, 0, n.note, 0]);
  }
  // Time order; at equal times note-offs come first so repeated notes retrigger.
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const events = new Float64Array(ev.length * 4);
  ev.forEach((e, i) => events.set(e, i * 4));
  return { events, count: ev.length, lengthBeats: L, bpm: loop.bpm };
}

export class LoopPlayer {
  private loop: CompiledLoop | null = null;
  private beat = 0;
  private next = 0;
  playing = false;

  constructor(private synth: Synth) {}

  setLoop(loop: CompiledLoop | null): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.stop();
    this.loop = loop;
    if (loop) this.synth.setTempo(loop.bpm);
    if (wasPlaying && loop) this.start();
  }

  start(): void {
    if (!this.loop) return;
    this.beat = 0;
    this.next = 0;
    this.playing = true;
  }

  stop(): void {
    if (this.playing) this.synth.allNotesOff();
    this.playing = false;
  }

  /** Current position in beats (for UI). */
  get position(): number {
    return this.beat;
  }

  /** Render `frames` samples, firing loop events at their exact sample. */
  render(outL: Float32Array, outR: Float32Array, offset: number, frames: number): void {
    const loop = this.loop;
    if (!this.playing || !loop || loop.count === 0) {
      this.synth.render(outL, outR, offset, frames);
      return;
    }
    const beatsPerSample = loop.bpm / 60 / this.synth.sampleRate;
    const ev = loop.events;
    let pos = offset;
    const end = offset + frames;
    while (pos < end) {
      // Fire every event that is due at the current position.
      while (this.next < loop.count && ev[this.next * 4] <= this.beat + 1e-9) {
        const i = this.next * 4;
        if (ev[i + 1] === 1) this.synth.noteOn(ev[i + 2], ev[i + 3]);
        else this.synth.noteOff(ev[i + 2]);
        this.next++;
      }
      const nextBeat = this.next < loop.count ? ev[this.next * 4] : loop.lengthBeats;
      let n = Math.ceil((nextBeat - this.beat) / beatsPerSample - 1e-9);
      if (n < 1) n = 1;
      if (n > end - pos) n = end - pos;
      this.synth.render(outL, outR, pos, n);
      pos += n;
      this.beat += n * beatsPerSample;
      if (this.beat >= loop.lengthBeats - 1e-9 && this.next >= loop.count) {
        this.beat -= loop.lengthBeats;
        if (this.beat < 0) this.beat = 0;
        this.next = 0;
      }
    }
  }
}
