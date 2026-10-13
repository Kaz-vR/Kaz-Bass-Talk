// Oscilloscope + log-frequency spectrum from an AnalyserNode.

export class Scope {
  private wave: Float32Array<ArrayBuffer>;
  private spec: Float32Array<ArrayBuffer>;

  constructor(private analyser: AnalyserNode, private scope: HTMLCanvasElement, private spectrum: HTMLCanvasElement) {
    this.wave = new Float32Array(analyser.fftSize);
    this.spec = new Float32Array(analyser.frequencyBinCount);
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private draw(): void {
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim();
    const accent2 = css.getPropertyValue('--accent-2').trim();

    // Waveform (triggered on a rising zero crossing for a stable picture).
    const c = this.scope.getContext('2d')!;
    const { width: w, height: h } = this.scope;
    c.clearRect(0, 0, w, h);
    this.analyser.getFloatTimeDomainData(this.wave);
    let start = 0;
    for (let i = 1; i < this.wave.length / 2; i++) if (this.wave[i - 1] < 0 && this.wave[i] >= 0) { start = i; break; }
    const n = Math.min(2048, this.wave.length - start);
    c.strokeStyle = accent;
    c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / n) * w;
      const y = h / 2 - this.wave[start + i] * (h / 2) * 0.95;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
    c.strokeStyle = '#2e333b';
    c.beginPath();
    c.moveTo(0, h / 2);
    c.lineTo(w, h / 2);
    c.stroke();

    // Spectrum, 20 Hz – 20 kHz log scale, -100..0 dB.
    const s = this.spectrum.getContext('2d')!;
    const { width: sw, height: sh } = this.spectrum;
    s.clearRect(0, 0, sw, sh);
    this.analyser.getFloatFrequencyData(this.spec);
    const nyq = this.analyser.context.sampleRate / 2;
    const bins = this.spec.length;
    s.fillStyle = '#2e333b';
    s.font = '10px system-ui';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = (Math.log(f / 20) / Math.log(1000)) * sw;
      s.fillRect(x, 0, 1, sh);
      s.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, sh - 3);
    }
    s.strokeStyle = accent2;
    s.beginPath();
    for (let x = 0; x < sw; x++) {
      const f = 20 * Math.pow(1000, x / sw);
      const k = Math.min(bins - 1, Math.round((f / nyq) * bins));
      const db = Math.max(-100, Math.min(0, this.spec[k]));
      const y = sh - ((db + 100) / 100) * sh;
      x ? s.lineTo(x, y) : s.moveTo(x, y);
    }
    s.stroke();
  }
}
