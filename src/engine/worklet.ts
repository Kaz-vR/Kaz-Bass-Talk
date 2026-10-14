// AudioWorklet processor: a thin real-time shell around the pure-TS engine.
// The message handler only copies numbers into preallocated engine state;
// process() never allocates.

import { LoopPlayer } from './core/sequencer';
import { Synth } from './core/synth';
import { PROCESSOR_NAME, type EngineMessage } from './messages';

class LowTalkProcessor extends AudioWorkletProcessor {
  private synth = new Synth(sampleRate);
  private player = new LoopPlayer(this.synth);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<EngineMessage>) => this.handle(e.data);
  }

  private handle(m: EngineMessage): void {
    switch (m.type) {
      case 'params': this.synth.setParams(m.values, m.immediate); break;
      case 'param': this.synth.setParam(m.index, m.value); break;
      case 'noteOn': this.synth.noteOn(m.note, m.velocity); break;
      case 'noteOff': this.synth.noteOff(m.note); break;
      case 'bend': this.synth.pitchBend(m.value); break;
      case 'modwheel': this.synth.setModWheel(m.value); break;
      case 'textureMonitor': this.synth.setTextureMonitor(m.mode); break;
      case 'loop': this.player.setLoop(m.loop); break;
      case 'play': this.player.start(); break;
      case 'stop': this.player.stop(); break;
      case 'panic': this.player.stop(); this.synth.panic(); break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const l = out[0];
    const r = out.length > 1 ? out[1] : out[0];
    this.player.render(l, r, 0, l.length);
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, LowTalkProcessor);
