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
      case 'listen': this.synth.setListen(m.at, m.mode); break;
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
      // channels 12-15: each GRIND stage's filter frequency (Hz, -1 when off)
      // channels 16-19: their resonance right now
      if (ctl.length >= 16) for (let i = 0; i < 4; i++) ctl[12 + i].fill(this.synth.liveGrind[i]);
      if (ctl.length >= 20) for (let i = 0; i < 4; i++) ctl[16 + i].fill(this.synth.liveGrindRes[i]);
      // channels 24-27: stages 5-8's filter frequency, 28-31: their resonance
      if (ctl.length >= 32) for (let i = 0; i < 4; i++) {
        ctl[24 + i].fill(this.synth.liveGrind[4 + i]);
        ctl[28 + i].fill(this.synth.liveGrindRes[4 + i]);
      }
      if (ctl.length >= 11) {
        for (let l = 0; l < 4; l++) {
          ctl[3 + l].fill(this.synth.liveLfoPhase[l]);
          ctl[7 + l].fill(this.synth.liveLfoValue[l]);
        }
      }
      // channels 20-21: LFO 5 and 6's phase, 22-23: their value
      if (ctl.length >= 24) {
        for (let l = 4; l < 6; l++) {
          ctl[16 + l].fill(this.synth.liveLfoPhase[l]);
          ctl[18 + l].fill(this.synth.liveLfoValue[l]);
        }
      }
    }
    // Output 3: the RUIN page's taps (chain input, each box, RUIN's OTT, the output),
    // the newest samples of each ring, for the page's meters and spectra.
    const tp = outputs[2];
    if (tp && tp.length >= 13) {
      const n = tp[0].length, taps = this.synth.taps, len = taps[0].length;
      let p = (this.synth.tapPos - n + len) & (len - 1);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 13; k++) tp[k][i] = taps[k][p];
        p = (p + 1) & (len - 1);
      }
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, LowTalkProcessor);
