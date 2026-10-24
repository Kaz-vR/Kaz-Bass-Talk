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
      case 'monitor': this.synth.setMonitor(m.solo, m.mute); break;
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
    // Output 2 carries the live filter (cutoff in Hz, resonance) as a control signal for the UI:
    // read by an analyser on the main thread, so nothing here allocates or posts messages.
    const ctl = outputs[1];
    if (ctl && ctl.length >= 2) {
      ctl[0].fill(this.synth.liveCutoff);
      ctl[1].fill(this.synth.liveRes);
      if (ctl.length >= 3) ctl[2].fill(this.synth.liveWob);
      // channels 3-6: each LFO's phase (0..1), 7-10: its value (-1..1); they always run
      // channel 11: the Wobbler filter's cutoff (Hz, -1 when it is not working)
      if (ctl.length >= 12) ctl[11].fill(this.synth.liveWobFc);
      if (ctl.length >= 11) {
        for (let l = 0; l < 4; l++) {
          ctl[3 + l].fill(this.synth.lfoPhase[l]);
          ctl[7 + l].fill(this.synth.lfoValue[l]);
        }
      }
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, LowTalkProcessor);
