// Performance: the synth must stay well under real time. CLAUDE.md target is
// ~3% CPU per voice at 48 kHz on a mid-range laptop; CI/container CPUs are
// often slower, so the hard limit here has headroom and the numbers are logged.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { libraryPatches, loop } from './helpers/audio';

const SECONDS = 4;

function cpuPercent(patch: unknown): number {
  renderPatch(patch, loop('groove'), { seconds: 0.5 }); // warm-up / JIT
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    renderPatch(patch, loop('groove'), { seconds: SECONDS });
    runs.push(performance.now() - t0);
  }
  runs.sort((a, b) => a - b);
  return (runs[1] / (SECONDS * 1000)) * 100;
}

describe('performance', () => {
  it('every library patch renders far faster than real time', () => {
    const rows: string[] = [];
    for (const { file, json } of libraryPatches()) {
      const cpu = cpuPercent(json);
      rows.push(`${file.padEnd(22)} ${cpu.toFixed(2)}%`);
      expect(cpu, file).toBeLessThan(6);
    }
    console.log('CPU per voice @48 kHz (this machine):\n' + rows.join('\n'));
  });

  it('worst case (2×7 unison, formant, FM, all FX) stays under 15%', () => {
    const cpu = cpuPercent({
      meta: { name: 'worst' }, 'osc1.unison_voices': 7, 'osc2.unison_voices': 7, 'osc2.level': 0.8, 'osc1.wave': 'wavetable',
      'osc1.wt_pos': 0.6, 'filter.type': 'formant', 'dist.drive': 0.8, 'fm.amount': 0.5, 'noise.level': 0.3, 'drive.amount': 0.5,
      'chorus.mix': 1, 'phaser.mix': 1, 'reverb.mix': 1, 'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.5,
    });
    console.log(`worst case: ${cpu.toFixed(2)}%`);
    expect(cpu).toBeLessThan(15);
  });
});
