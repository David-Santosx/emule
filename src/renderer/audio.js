// Emule — AudioPlayer (owner: B). Raw PCM s16le 48 kHz stereo → AudioWorklet ring buffer → GainNode.

export const AUDIO_UNAVAILABLE_MSG = 'Áudio indisponível neste dispositivo (requer Android 11+)';

const WORKLET_URL = new URL('./audio-worklet.js', import.meta.url).href;

export class AudioPlayer {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.gain = null;
    this._ready = null;       // Promise resolved when the worklet node exists
    this._active = false;
    this._volume = 1;
    this._muted = false;
    this.bufferedMs = 0;
    this.underruns = 0;
    this.dropped = 0;
  }

  /**
   * Create / resume the AudioContext. Call synchronously from a user gesture (e.g. the
   * "Conectar" click) so Chromium's autoplay policy lets it run.
   */
  prepare() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      } catch (e) {
        console.error('[audio] AudioContext falhou', e);
        return;
      }
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      this._applyGain();
      this._ready = this.ctx.audioWorklet.addModule(WORKLET_URL).then(() => {
        this.node = new AudioWorkletNode(this.ctx, 'emule-pcm', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { capacitySec: 1, targetMs: 50, prefillMs: 40, maxMs: 120 },
        });
        this.node.port.onmessage = (e) => {
          const d = e.data || {};
          this.bufferedMs = d.bufferedMs || 0;
          this.underruns = d.underruns || 0;
          this.dropped = d.dropped || 0;
        };
        this.node.connect(this.gain);
      }).catch((e) => {
        console.error('[audio] worklet falhou', e);
        this._ready = null;
      });
    }
    this.resume();
  }

  /** Resume after a user gesture if the context is suspended. */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get suspended() { return !!this.ctx && this.ctx.state === 'suspended'; }

  /**
   * Start playback for a session audio codec.
   * @param {string|null} codec SessionInfo.audio?.codec
   * @returns {boolean} false if the codec is not playable (caller shows AUDIO_UNAVAILABLE_MSG)
   */
  start(codec) {
    if (codec !== 'raw') { this.stop(); return false; }
    this.prepare();
    this._active = true;
    if (this.node) this.node.port.postMessage('flush');
    return true;
  }

  stop() {
    this._active = false;
    this.bufferedMs = 0;
    if (this.node) this.node.port.postMessage('flush');
  }

  get active() { return this._active; }

  /** @param {{data: Uint8Array, config?: boolean}} p */
  push(p) {
    if (!this._active || !p || p.config || !this.node) return;
    const d = p.data;
    if (!d || d.length < 4) return;
    // copy into a fresh, transferable ArrayBuffer (p.data may be a view on a shared buffer)
    const buf = d.buffer.slice(d.byteOffset, d.byteOffset + d.length);
    this.node.port.postMessage(buf, [buf]);
  }

  setVolume(v) { this._volume = Math.max(0, Math.min(1, Number(v) || 0)); this._applyGain(); }
  get volume() { return this._volume; }
  setMuted(m) { this._muted = !!m; this._applyGain(); }
  get muted() { return this._muted; }

  _applyGain() {
    if (!this.gain || !this.ctx) return;
    const g = this._muted ? 0 : this._volume * this._volume; // perceptual curve
    this.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
  }

  /** Total output latency estimate (ring buffer + audio device), ms. */
  get latencyMs() {
    if (!this.ctx) return 0;
    const dev = ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000;
    return this.bufferedMs + dev;
  }
}
