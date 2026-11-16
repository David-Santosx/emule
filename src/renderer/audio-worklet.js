// Emule — AudioWorklet ring buffer for raw PCM s16le 48 kHz stereo (owner: B).
// Low latency: plays as soon as ~TARGET ms are buffered; if more than MAX ms accumulate
// (clock drift / burst), the oldest samples are dropped back to TARGET; on underrun → silence
// and a short re-prefill (no stutter loops).

const CHANNELS = 2;

class EmulePcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    const rate = sampleRate; // global in AudioWorkletGlobalScope
    this.capacity = Math.round(rate * (o.capacitySec || 1)); // frames
    this.target = Math.round((rate * (o.targetMs || 50)) / 1000);
    this.prefill = Math.round((rate * (o.prefillMs || 40)) / 1000);
    this.max = Math.round((rate * (o.maxMs || 120)) / 1000);
    this.l = new Float32Array(this.capacity);
    this.r = new Float32Array(this.capacity);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.playing = false;
    this.underruns = 0;
    this.dropped = 0;
    this.lastReport = 0;
    this.port.onmessage = (e) => this.onData(e.data);
  }

  onData(d) {
    if (d === 'flush') {
      this.read = this.write = this.count = 0;
      this.playing = false;
      return;
    }
    if (!(d instanceof ArrayBuffer)) return;
    const n = d.byteLength >> 2; // frames (2 ch × 2 bytes)
    if (n === 0) return;
    const pcm = new Int16Array(d, 0, n * CHANNELS);
    const cap = this.capacity;
    let w = this.write;
    for (let i = 0, j = 0; i < n; i++, j += 2) {
      this.l[w] = pcm[j] / 32768;
      this.r[w] = pcm[j + 1] / 32768;
      if (++w === cap) w = 0;
    }
    this.write = w;
    this.count += n;
    if (this.count > cap) {
      // overflow: keep newest
      this.dropped += this.count - cap;
      this.count = cap;
      this.read = this.write;
    }
    if (this.count > this.max) {
      const drop = this.count - this.target;
      this.read = (this.read + drop) % cap;
      this.count -= drop;
      this.dropped += drop;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    const frames = L.length;
    if (!this.playing && this.count >= this.prefill) this.playing = true;
    if (this.playing) {
      const n = Math.min(frames, this.count);
      const cap = this.capacity;
      let rd = this.read;
      for (let i = 0; i < n; i++) {
        L[i] = this.l[rd];
        if (R !== L) R[i] = this.r[rd];
        if (++rd === cap) rd = 0;
      }
      this.read = rd;
      this.count -= n;
      if (n < frames) {
        L.fill(0, n);
        if (R !== L) R.fill(0, n);
        this.playing = false;
        this.underruns++;
      }
    } else {
      L.fill(0);
      if (R !== L) R.fill(0);
    }
    if (currentTime - this.lastReport >= 0.25) {
      this.lastReport = currentTime;
      this.port.postMessage({
        bufferedMs: (this.count * 1000) / sampleRate,
        underruns: this.underruns,
        dropped: this.dropped,
      });
    }
    return true;
  }
}

registerProcessor('emule-pcm', EmulePcmProcessor);
