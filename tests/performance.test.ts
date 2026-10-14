// Performance: the synth must stay well under real time. CLAUDE.md target is
// ~3% CPU per voice at 48 kHz on a mid-range laptop (and the C++ plugin will
// be faster still). Cloud/CI containers are much slower than a laptop (the
// one this was tuned on runs Math.sin ~3x slower) and noisy (±1.5% between
// identical runs; parallel test files add more), so the hard limit here is 15%
// per voice (≈ 5% on a laptop: a regression alarm, not the target) and 65%
// for a full 8-voice chord (≈ 20% on a laptop); the real numbers are logged.
// Per voice = one held note minus the same patch idle (the shared FX chain
// runs once, not per voice). Measured as this process's CPU
// time, which also counts JIT/GC threads, so it reads on the high side.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { heldNote, libraryPatches, type Loop } from './helpers/audio';

const SECONDS = 4;

const NOTE = 48;
const one = heldNote(NOTE, 8);
const idle: Loop = { ...one, notes: [] };
const chord: Loop = { ...one, notes: [0, 3, 7, 10, 12, 15, 19, 22].map((d) => ({ start: 0, dur: 8, note: NOTE + d, vel: 1 })) };

function cpuPercent(patch: unknown, l: Loop = one, tries = 3): number {
  renderPatch(patch, l, { seconds: 0.5 }); // warm-up / JIT
  const runs: number[] = [];
  for (let i = 0; i < tries; i++) {
    // CPU time used by this process (not wall-clock), so parallel test files don't inflate it.
    const c0 = process.cpuUsage();
    renderPatch(patch, l, { seconds: SECONDS });
    const c = process.cpuUsage(c0);
    runs.push((c.user + c.system) / 1000);
  }
  // Fastest of the runs: interference from other test files only ever adds time.
  runs.sort((a, b) => a - b);
  return (runs[0] / (SECONDS * 1000)) * 100;
}

describe('performance', () => {
  it('every library patch stays within the per-voice and full-chord budget', () => {
    const rows: [string, number, number][] = [];
    for (const { file, json } of libraryPatches()) {
      const voice = cpuPercent(json) - cpuPercent(json, idle, 2);
      const full = (json['voice.polyphony'] ?? 1) > 1 ? cpuPercent(json, chord, 2) : 0;
      rows.push([file, voice, full]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    console.log(
      'CPU @48 kHz (this machine): per voice / 8-voice chord\n' +
        rows.map(([f, v, c]) => `${f.padEnd(30)} ${v.toFixed(2)}%  ${c ? c.toFixed(1) + '%' : '-'}`).join('\n'),
    );
    for (const [file, voice, full] of rows) {
      expect(voice, file).toBeLessThan(15);
      expect(full, file).toBeLessThan(65);
    }
  }, 1200000);

  it('worst case (2×7 unison, formant, FM, all FX) stays under 20%', () => {
    const cpu = cpuPercent({
      meta: { name: 'worst' }, 'osc1.unison_voices': 7, 'osc2.unison_voices': 7, 'osc2.level': 0.8, 'osc1.wave': 'wavetable',
      'osc1.wt_pos': 0.6, 'filter.type': 'formant', 'dist.drive': 0.8, 'fm.amount': 0.5, 'noise.level': 0.3, 'drive.amount': 0.5,
      'chorus.mix': 1, 'phaser.mix': 1, 'reverb.mix': 1, 'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.5,
    });
    console.log(`worst case: ${cpu.toFixed(2)}%`);
    expect(cpu).toBeLessThan(20);
  });
});
