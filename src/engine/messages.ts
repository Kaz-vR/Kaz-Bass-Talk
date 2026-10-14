// Messages from the main thread to the synth AudioWorklet. Everything heavy
// (validation, loop compilation) happens on the main thread before posting.

import type { CompiledLoop } from './core/sequencer';

export type EngineMessage =
  | { type: 'params'; values: Float64Array; immediate: boolean }
  | { type: 'param'; index: number; value: number }
  | { type: 'noteOn'; note: number; velocity: number }
  | { type: 'noteOff'; note: number }
  | { type: 'bend'; value: number }
  | { type: 'modwheel'; value: number }
  | { type: 'monitor'; solo: string[]; mute: string[] }
  | { type: 'loop'; loop: CompiledLoop | null }
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'panic' };

export const PROCESSOR_NAME = 'low-talk-synth';
