class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._resampleRatio = sampleRate / 16000; // e.g., 48000->16000
    this._buffer = new Float32Array(0);
  }
  static get parameterDescriptors() { return []; }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const mono = input[0];

    const merged = new Float32Array(this._buffer.length + mono.length);
    merged.set(this._buffer, 0);
    merged.set(mono, this._buffer.length);
    this._buffer = merged;

    const outSamples = Math.floor(this._buffer.length / this._resampleRatio);
    if (outSamples > 0) {
      const out = new Float32Array(outSamples);
      for (let i = 0; i < out.length; i++) {
        const idx = i * this._resampleRatio;
        const i0 = Math.floor(idx);
        const i1 = Math.min(i0 + 1, this._buffer.length - 1);
        const frac = idx - i0;
        out[i] = this._buffer[i0] * (1 - frac) + this._buffer[i1] * frac;
      }
      const remStart = Math.floor(out.length * this._resampleRatio);
      this._buffer = this._buffer.slice(remStart);

      const pcm16 = new Int16Array(out.length);
      for (let i = 0; i < out.length; i++) {
        let s = Math.max(-1, Math.min(1, out[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}
registerProcessor('mic-processor', MicProcessor);
