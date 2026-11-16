// Emule — VideoPlayer (owner: B). WebCodecs VideoDecoder → <canvas>, lowest latency:
// every decoded frame is drawn immediately in `output` and closed; no jitter buffer.

import { codecStringFromConfig, guessFamily, DEFAULT_H265 } from './codec-string.js';

// decodeQueueSize above this → drop until next keyframe. Hardware decoders on Windows routinely
// hold a few frames during bursts; resetting the encoder for that causes visible freezes, so only
// react to a real, sustained backlog (~0.3 s at 60 fps).
const MAX_BACKLOG = 18;
const RESET_MIN_INTERVAL_MS = 1000;

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class VideoPlayer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this._resizeCbs = [];
    this._keyframeCbs = [];
    this._hwPref = 'prefer-hardware';
    this._reset();
    // backing-store size for drawing (device pixels of the displayed rect); 0 = frame size
    this._displayW = 0;
    this._displayH = 0;
  }

  _reset() {
    this.decoder = null;
    this.family = null;
    this.codecString = null;
    this._configuredCodec = null;
    this._pendingConfig = null;
    this._lastConfig = null;
    this._lastConfigRaw = null;
    this._needKey = true;
    this._frameW = 0;
    this._frameH = 0;
    this._decodedW = 0;
    this._decodedH = 0;
    this._started = false;
    this._lastReset = 0;
    this._ptsCounter = 0;
    // stats
    this._frames = 0;
    this._bytes = 0;
    this._dropped = 0;
    this._statT0 = performance.now();
    this._fps = 0;
    this._bitrate = 0;
    this.droppedTotal = 0;
    this.totalFrames = 0;
  }

  /** @param {{codec: string, width?: number, height?: number}} info */
  start(info) {
    this.stop();
    this._started = true;
    this.family = info && info.codec ? info.codec : null;
    if (info && info.width > 0 && info.height > 0) this._setFrameSize(info.width, info.height);
  }

  /** Update session info after connect() resolved (codec + first session size). */
  updateInfo(info) {
    if (!info) return;
    if (info.codec && info.codec !== this.family) {
      this.family = info.codec;
      this._configuredCodec = null; // force reconfigure on next config packet
    }
    if (!(this._frameW > 0) && info.width > 0 && info.height > 0) this._setFrameSize(info.width, info.height);
  }

  stop() {
    if (this.decoder) {
      try { if (this.decoder.state !== 'closed') this.decoder.close(); } catch { /* ignore */ }
    }
    const disp = [this._displayW, this._displayH];
    this._reset();
    [this._displayW, this._displayH] = disp;
  }

  /** Latest SESSION size (what touch coordinates must reference). */
  get frameSize() {
    if (this._frameW > 0) return { width: this._frameW, height: this._frameH };
    return { width: this._decodedW, height: this._decodedH };
  }

  onResize(cb) { this._resizeCbs.push(cb); }
  /** cb() is called when the player needs a fresh keyframe (app sends RESET_VIDEO). */
  onKeyframeNeeded(cb) { this._keyframeCbs.push(cb); }

  get fps() { this._tickStats(); return this._fps; }
  get bitrate() { this._tickStats(); return this._bitrate; } // bits/s received
  get decodeQueueSize() { return this.decoder ? this.decoder.decodeQueueSize : 0; }
  get stats() {
    this._tickStats();
    return {
      fps: this._fps, bitrate: this._bitrate, decodeQueue: this.decodeQueueSize,
      width: this.frameSize.width, height: this.frameSize.height,
      codec: this.codecString || this.family || '—', dropped: this.droppedTotal, hardware: this._hwPref,
    };
  }

  /**
   * Size of the canvas backing store = displayed rect in device pixels. Drawing scales the
   * frame with high-quality filtering into it (sharper than CSS scaling). 0/0 → frame size.
   */
  setDisplaySize(w, h) {
    this._displayW = Math.max(0, Math.round(w));
    this._displayH = Math.max(0, Math.round(h));
    this._applyCanvasSize();
  }

  _applyCanvasSize() {
    const fw = this._decodedW || this._frameW;
    const fh = this._decodedH || this._frameH;
    let w = this._displayW || fw;
    let h = this._displayH || fh;
    if (!(w > 0 && h > 0)) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
    }
  }

  _setFrameSize(w, h) {
    const changed = w !== this._frameW || h !== this._frameH;
    this._frameW = w;
    this._frameH = h;
    if (changed) {
      this._applyCanvasSize();
      for (const cb of this._resizeCbs) { try { cb(w, h); } catch (e) { console.error(e); } }
    }
  }

  _tickStats() {
    const now = performance.now();
    const dt = now - this._statT0;
    if (dt >= 1000) {
      this._fps = Math.round((this._frames * 1000) / dt);
      this._bitrate = Math.round((this._bytes * 8 * 1000) / dt);
      this._frames = 0;
      this._bytes = 0;
      this._statT0 = now;
    }
  }

  _requestKeyframe() {
    const now = performance.now();
    if (now - this._lastReset < RESET_MIN_INTERVAL_MS) return;
    this._lastReset = now;
    for (const cb of this._keyframeCbs) { try { cb(); } catch (e) { console.error(e); } }
  }

  _createDecoder() {
    if (this.decoder && this.decoder.state !== 'closed') {
      try { this.decoder.close(); } catch { /* ignore */ }
    }
    const dec = new VideoDecoder({
      output: (frame) => this._onFrame(frame),
      error: (e) => this._onError(dec, e),
    });
    this.decoder = dec;
    return dec;
  }

  _configure(codec) {
    const dec = (this.decoder && this.decoder.state !== 'closed') ? this.decoder : this._createDecoder();
    const cfg = { codec, optimizeForLatency: true, hardwareAcceleration: this._hwPref };
    try {
      dec.configure(cfg);
      this._configuredCodec = codec;
    } catch (e) {
      console.warn('[video] configure falhou', codec, e);
      this._configuredCodec = null;
      return false;
    }
    // async sanity check: fall back to software / default HEVC string if not supported
    if (typeof VideoDecoder.isConfigSupported === 'function') {
      VideoDecoder.isConfigSupported(cfg).then((r) => {
        if (r && r.supported) return;
        if (this.codecString !== codec) return; // stale
        if (this.family === 'h265' && codec !== DEFAULT_H265) {
          console.warn('[video] codec não suportado, usando padrão HEVC', codec);
          this.codecString = DEFAULT_H265;
        } else if (this._hwPref !== 'no-preference') {
          console.warn('[video] aceleração por hardware indisponível para', codec);
          this._hwPref = 'no-preference';
        } else {
          return;
        }
        this._configuredCodec = null;
        this._needKey = true;
        this._requestKeyframe();
      }).catch(() => {});
    }
    return true;
  }

  _onError(dec, e) {
    if (dec !== this.decoder) return;
    console.error('[video] erro do decodificador', e);
    // switch to software decoding on a hardware failure, then ask for a fresh keyframe
    if (this._hwPref === 'prefer-hardware') this._hwPref = 'no-preference';
    this.decoder = null;
    this._configuredCodec = null;
    this._needKey = true;
    this._requestKeyframe();
  }

  _onFrame(frame) {
    try {
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      if (w !== this._decodedW || h !== this._decodedH) {
        this._decodedW = w;
        this._decodedH = h;
        if (!(this._frameW > 0)) this._setFrameSize(w, h);
        this._applyCanvasSize();
      }
      const c = this.canvas;
      this.ctx.drawImage(frame, 0, 0, c.width, c.height);
      this._frames++;
      this.totalFrames++;
    } finally {
      frame.close();
    }
  }

  /** @param {{type:'media', config, keyframe, pts, data} | {type:'session', width, height}} p */
  push(p) {
    if (!p) return;
    if (p.type === 'session') {
      if (p.width > 0 && p.height > 0) this._setFrameSize(p.width, p.height);
      // the encoder is re-created: new config + keyframe follow
      this._needKey = true;
      return;
    }
    if (!this._started) return;
    const data = p.data instanceof Uint8Array ? p.data : new Uint8Array(p.data);
    this._bytes += data.length;

    if (p.config) {
      if (!this.family) this.family = guessFamily(data) || 'h264';
      this._pendingConfig = data;
      const codec = codecStringFromConfig(this.family, data);
      if (codec !== this.codecString) this.codecString = codec;
      // new parameter sets (e.g. new resolution after rotation) → reconfigure the decoder
      if (!sameBytes(data, this._lastConfigRaw)) this._configuredCodec = null;
      this._lastConfigRaw = data;
      this._needKey = true;
      return;
    }

    let payload = data;
    let key = !!p.keyframe;
    if (this._pendingConfig) {
      // packet merger (as the official client): config prepended to the next frame
      payload = concat(this._pendingConfig, data);
      this._pendingConfig = null;
      key = true;
      if (!this.decoder || this.decoder.state === 'closed' || this._configuredCodec !== this.codecString) {
        if (!this._configure(this.codecString)) return;
      }
      this._lastConfig = payload.subarray(0, payload.length - data.length);
    } else if (key && this._lastConfig && (!this.decoder || this._configuredCodec !== this.codecString)) {
      // keyframe without fresh config after a decoder reset: reuse the last known config
      payload = concat(this._lastConfig, data);
      if (!this._configure(this.codecString)) return;
    }

    const dec = this.decoder;
    if (!dec || dec.state !== 'configured') {
      this._needKey = true;
      this._dropped++;
      return;
    }

    if (!key) {
      if (this._needKey) {
        this.droppedTotal++;
        // keep asking (rate-limited) so we never wait for the 10 s natural keyframe interval
        this._requestKeyframe();
        return;
      }
      if (dec.decodeQueueSize > MAX_BACKLOG) {
        // backlog: drop until next keyframe and ask for one now (keyframe interval is 10 s)
        this._needKey = true;
        this.droppedTotal++;
        this._requestKeyframe();
        return;
      }
    }

    const timestamp = p.pts >= 0 ? p.pts : (this._ptsCounter += 16666);
    try {
      dec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp, data: payload }));
      if (key) this._needKey = false;
    } catch (e) {
      console.error('[video] decode falhou', e);
      this._needKey = true;
      this._requestKeyframe();
    }
  }
}

/** Is H.265 decoding available (hardware preferred)? */
export async function isHevcSupported() {
  if (typeof VideoDecoder === 'undefined' || !VideoDecoder.isConfigSupported) return false;
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
    try {
      const r = await VideoDecoder.isConfigSupported({ codec: DEFAULT_H265, hardwareAcceleration, optimizeForLatency: true });
      if (r && r.supported) return true;
    } catch { /* ignore */ }
  }
  return false;
}
