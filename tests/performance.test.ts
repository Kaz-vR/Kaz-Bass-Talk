// Performance: the synth must stay well under real time. CLAUDE.md target is
// ~3% CPU per voice at 48 kHz on a mid-range laptop (and the C++ plugin will
// be faster still). Cloud/CI containers are much slower than a laptop (the
// one this was tuned on runs Math.sin ~3x slower) and noisy (±1.5% between
// identical runs; parallel test files add more), so the hard limit here is 15%
// per library patch (≈ 5% on a laptop: a regression alarm, not the target)
// and the real numbers are logged for review. Measured as this process's CPU
// time, which also counts JIT/GC threads, so it reads on the high side.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { libraryPatches, loop } from './helpers/audio';

const SECONDS = 4;

function cpuPercent(patch: unknown): number {
  renderPatch(patch, loop('groove'), { seconds: 0.5 }); // warm-up / JIT
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    // CPU time used by this process (not wall-clock), so parallel test files don't inflate it.
    const c0 = process.cpuUsage();
    renderPatch(patch, loop('groove'), { seconds: SECONDS });
    const c = process.cpuUsage(c0);
    runs.push((c.user + c.system) / 1000);
  }
  runs.sort((a, b) => a - b);
  return (runs[1] / (SECONDS * 1000)) * 100;
}

describe('performance', () => {
  it('every library patch renders far faster than real time', () => {
    const rows: [string, number][] = [];
    for (const { file, json } of libraryPatches()) rows.push([file, cpuPercent(json)]);
    rows.sort((a, b) => b[1] - a[1]);
    console.log('CPU per voice @48 kHz (this machine):\n' + rows.map(([f, c]) => `${f.padEnd(26)} ${c.toFixed(2)}%`).join('\n'));
    for (const [file, cpu] of rows) expect(cpu, file).toBeLessThan(15);
  });

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
