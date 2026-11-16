'use strict';
// scrcpy v5.0.1 client session (see docs/PROTOCOL.md §7 "Minimal client recipe").

const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const adb = require('./adb');

const SERVER_VERSION = '5.0.1';
const DEVICE_SERVER_PATH = '/data/local/tmp/scrcpy-server.jar';
const DEVICE_NAME_LENGTH = 64;

const CODECS = {
  0x68323634: 'h264',
  0x68323635: 'h265',
  0x00617631: 'av1',
  0x00767038: 'vp8',
  0x00767039: 'vp9',
  0x6f707573: 'opus',
  0x00616163: 'aac',
  0x666c6163: 'flac',
  0x00726177: 'raw',
};

const MSG = {
  UNAUTHORIZED: 'Depuração USB não autorizada — aceite o aviso no celular',
  DISCONNECTED: 'Dispositivo desconectado',
  SERVER_FAILED: 'Falha ao iniciar o servidor no celular',
};

// ---------------------------------------------------------------------------------------------
// Chunk queue: list of chunks + total length; reads copy only when a read spans chunks.
// ---------------------------------------------------------------------------------------------
class ChunkQueue {
  constructor() {
    this.chunks = [];
    this.offset = 0; // read offset into chunks[0]
    this.length = 0;
  }

  push(buf) {
    if (buf.length === 0) return;
    this.chunks.push(buf);
    this.length += buf.length;
  }

  /** Byte at logical index i (i < length). */
  peek(i) {
    let idx = this.offset + i;
    for (const c of this.chunks) {
      if (idx < c.length) return c[idx];
      idx -= c.length;
    }
    throw new RangeError('peek out of range');
  }

  /** Removes and returns n bytes (zero-copy when inside one chunk). Caller ensures n <= length. */
  read(n) {
    if (n === 0) return Buffer.alloc(0);
    const first = this.chunks[0];
    const avail = first.length - this.offset;
    let out;
    if (avail >= n) {
      out = first.subarray(this.offset, this.offset + n);
      this.offset += n;
      if (this.offset === first.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    } else {
      out = Buffer.allocUnsafe(n);
      let written = 0;
      while (written < n) {
        const c = this.chunks[0];
        const take = Math.min(c.length - this.offset, n - written);
        c.copy(out, written, this.offset, this.offset + take);
        written += take;
        this.offset += take;
        if (this.offset === c.length) {
          this.chunks.shift();
          this.offset = 0;
        }
      }
    }
    this.length -= n;
    return out;
  }

  /** Remaining bytes as one Buffer (used to hand leftovers over). */
  drain() {
    return this.read(this.length);
  }
}

// ---------------------------------------------------------------------------------------------
// Media stream parser (video and audio sockets).
// ---------------------------------------------------------------------------------------------
/**
 * handlers: { onDeviceName(name), onCodecId(id), onSession({type,width,height,clientResized}),
 *             onMedia({type,config,keyframe,pts,data}), onError(err) }
 */
class MediaStreamParser {
  constructor({ readDeviceName = false, video = true } = {}, handlers = {}) {
    this.q = new ChunkQueue();
    this.video = video;
    this.h = handlers;
    this.state = readDeviceName ? 'name' : 'codec';
    this.payloadSize = 0;
    this.pending = null; // header fields for current payload
  }

  push(chunk) {
    if (this.state === 'done' || this.state === 'error') return;
    this.q.push(chunk);
    const q = this.q;
    for (;;) {
      switch (this.state) {
        case 'name': {
          if (q.length < DEVICE_NAME_LENGTH) return;
          const raw = q.read(DEVICE_NAME_LENGTH);
          let end = raw.indexOf(0);
          if (end < 0) end = raw.length;
          this.state = 'codec';
          this.h.onDeviceName && this.h.onDeviceName(raw.toString('utf8', 0, end));
          break;
        }
        case 'codec': {
          if (q.length < 4) return;
          const id = q.read(4).readUInt32BE(0);
          if (id === 0 || id === 1) {
            this.state = 'done';
            this.h.onCodecId && this.h.onCodecId(id);
            return;
          }
          this.state = 'header';
          this.h.onCodecId && this.h.onCodecId(id);
          break;
        }
        case 'header': {
          if (q.length < 12) return;
          const hdr = q.read(12);
          const hi = hdr.readUInt32BE(0);
          if (hdr[0] & 0x80) {
            if (!this.video) return this._fail(new Error('Pacote de sessão inesperado no fluxo de áudio'));
            const width = hdr.readUInt32BE(4);
            const height = hdr.readUInt32BE(8);
            this.h.onSession && this.h.onSession({ type: 'session', width, height, clientResized: (hi & 1) === 1 });
            break;
          }
          const lo = hdr.readUInt32BE(4);
          const size = hdr.readUInt32BE(8);
          if (size === 0) return this._fail(new Error('Pacote de mídia com tamanho 0'));
          const config = (hi & 0x40000000) !== 0;
          const keyframe = (hi & 0x20000000) !== 0;
          const pts = config ? -1 : (hi & 0x1fffffff) * 4294967296 + lo;
          this.pending = { config, keyframe, pts };
          this.payloadSize = size;
          this.state = 'payload';
          break;
        }
        case 'payload': {
          if (q.length < this.payloadSize) return;
          const data = q.read(this.payloadSize);
          const p = this.pending;
          this.pending = null;
          this.state = 'header';
          this.h.onMedia && this.h.onMedia({ type: 'media', config: p.config, keyframe: p.keyframe, pts: p.pts, data });
          break;
        }
        default:
          return;
      }
    }
  }

  _fail(err) {
    this.state = 'error';
    this.h.onError && this.h.onError(err);
  }
}

// ---------------------------------------------------------------------------------------------
// Device message parser (control socket, device → client).
// ---------------------------------------------------------------------------------------------
class DeviceMessageParser {
  constructor(handlers = {}) {
    this.q = new ChunkQueue();
    this.h = handlers; // { onMessage(msg), onError(err) }
    this.failed = false;
  }

  push(chunk) {
    if (this.failed) return;
    this.q.push(chunk);
    const q = this.q;
    while (q.length > 0) {
      const type = q.peek(0);
      if (type === 0) {
        // CLIPBOARD: u8 type, u32 len, text
        if (q.length < 5) return;
        const len = (q.peek(1) * 0x1000000) + ((q.peek(2) << 16) | (q.peek(3) << 8) | q.peek(4));
        if (len > (1 << 18)) return this._fail(new Error(`Mensagem de clipboard grande demais (${len})`));
        if (q.length < 5 + len) return;
        q.read(5);
        const text = q.read(len).toString('utf8');
        this.h.onMessage && this.h.onMessage({ type: 'clipboard', text });
      } else if (type === 1) {
        // ACK_CLIPBOARD: u8 type, u64 sequence
        if (q.length < 9) return;
        const b = q.read(9);
        const seq = b.readBigUInt64BE(1);
        const sequence = seq <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(seq) : seq.toString();
        this.h.onMessage && this.h.onMessage({ type: 'ackClipboard', sequence });
      } else if (type === 2) {
        // UHID_OUTPUT: u8 type, u16 id, u16 size, data
        if (q.length < 5) return;
        const size = (q.peek(3) << 8) | q.peek(4);
        if (q.length < 5 + size) return;
        const hdr = q.read(5);
        const data = new Uint8Array(q.read(size)); // own tight copy
        this.h.onMessage && this.h.onMessage({ type: 'uhidOutput', id: hdr.readUInt16BE(1), data });
      } else {
        return this._fail(new Error(`Mensagem desconhecida do dispositivo (tipo ${type})`));
      }
    }
  }

  _fail(err) {
    this.failed = true;
    this.h.onError && this.h.onError(err);
  }
}

// ---------------------------------------------------------------------------------------------
// Server command line
// ---------------------------------------------------------------------------------------------
function makeScid() {
  const scid = crypto.randomBytes(4).readUInt32BE(0) & 0x7fffffff;
  return scid.toString(16).padStart(8, '0');
}

function bool(v) {
  return v ? 'true' : 'false';
}

function intOr(v, def, min = 0) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min ? n : def;
}

/** key=value args after the version argument. */
function buildServerArgs(scidHex, opts = {}) {
  const codec = ['h264', 'h265', 'av1'].includes(opts.videoCodec) ? opts.videoCodec : 'h264';
  const audio = opts.audio !== false;
  const args = [
    `scid=${scidHex}`,
    `log_level=${['verbose', 'debug', 'info', 'warn', 'error'].includes(opts.logLevel) ? opts.logLevel : 'info'}`,
    'video=true',
    `audio=${bool(audio)}`,
    'control=true',
    'tunnel_forward=true',
    `video_codec=${codec}`,
    `video_bit_rate=${intOr(opts.videoBitRate, 16000000, 100000)}`,
    `max_size=${intOr(opts.maxSize, 0)}`,
  ];
  if (audio) args.push('audio_codec=raw');
  const fps = intOr(opts.maxFps, 0);
  if (fps > 0) args.push(`max_fps=${fps}`);
  args.push(`stay_awake=${bool(opts.stayAwake !== false)}`);
  args.push(`show_touches=${bool(!!opts.showTouches)}`);
  args.push(`power_off_on_close=${bool(!!opts.powerOffOnClose)}`);
  return args;
}

/** Full adb argument vector used to spawn the server. */
function buildServerCommand(serial, scidHex, opts) {
  return [
    '-s', serial, 'shell',
    `CLASSPATH=${DEVICE_SERVER_PATH}`,
    'app_process', '/', 'com.genymobile.scrcpy.Server', SERVER_VERSION,
    ...buildServerArgs(scidHex, opts),
  ];
}

function mapAdbError(err) {
  const m = String((err && err.message) || err).toLowerCase();
  if (m.includes('unauthorized')) return MSG.UNAUTHORIZED;
  if (m.includes('not found') || m.includes('offline') || m.includes('no devices') || m.includes('device \'') || m.includes('closed')) {
    return MSG.DISCONNECTED;
  }
  return null;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------------------------
/**
 * Events: 'video' (packet), 'audio' (packet), 'deviceMessage' (msg), 'ended' (reason pt-BR), 'log' (line)
 */
class ScrcpySession extends EventEmitter {
  constructor(serial, opts = {}) {
    super();
    this.serial = serial;
    this.opts = opts;
    this.scid = makeScid();
    this.port = null;
    this.proc = null;
    this.procExited = false;
    this.procExitCode = null;
    this.videoSocket = null;
    this.audioSocket = null;
    this.controlSocket = null;
    this.logLines = [];
    this.info = null;
    this.ended = false;
    this.endReason = null;
    this._live = false;
    this._held = [];
    this._forwardActive = false;
    this._startError = null; // set when a fatal error happens during start
    this._waiters = new Set();
  }

  // ---- logging -------------------------------------------------------------------------------
  _log(line) {
    const l = String(line).replace(/\s+$/, '');
    if (!l) return;
    this.logLines.push(l);
    if (this.logLines.length > 200) this.logLines.splice(0, this.logLines.length - 200);
    console.log(`[scrcpy ${this.serial}] ${l}`);
    this.emit('log', l);
  }

  lastLogLines(n = 5) {
    const interesting = this.logLines.filter((l) => /ERROR|Exception|WARN|error|Error|Aborted|Killed|denied/.test(l));
    const src = interesting.length ? interesting : this.logLines;
    return src.slice(-n).join('\n');
  }

  _serverFailedMessage() {
    const lines = this.lastLogLines();
    return lines ? `${MSG.SERVER_FAILED}: ${lines}` : `${MSG.SERVER_FAILED}.`;
  }

  // ---- emit helpers (hold packets until start() has resolved) ---------------------------------
  _out(event, payload) {
    if (this.ended) return;
    if (this._live) this.emit(event, payload);
    else this._held.push([event, payload]);
  }

  _goLive() {
    if (this._live || this.ended) return;
    this._live = true;
    const held = this._held;
    this._held = [];
    for (const [e, p] of held) {
      if (this.ended) break;
      this.emit(e, p);
    }
  }

  // ---- start ---------------------------------------------------------------------------------
  /** Resolves with SessionInfo. Rejects with Error(pt-BR message). */
  async start({ timeoutMs = 20000 } = {}) {
    try {
      const info = await this._start(timeoutMs);
      this.info = info;
      setImmediate(() => this._goLive());
      return info;
    } catch (err) {
      const msg = (err && err.userMessage) || mapAdbError(err) || (err && err.message) || String(err);
      await this._teardown(null);
      throw new Error(msg);
    }
  }

  async _start(timeoutMs) {
    const serial = this.serial;
    const deadline = Date.now() + timeoutMs;

    // 1. push the server (it deletes itself on start, so push every time)
    try {
      await adb.push(serial, adb.resolveServerPath(), DEVICE_SERVER_PATH);
    } catch (err) {
      throw userError(mapAdbError(err) || `Falha ao enviar o servidor para o celular: ${err.message}`);
    }
    this._checkAborted();

    // 2. adb forward tcp:0 → adb picks a free port and prints it
    const socketName = `localabstract:scrcpy_${this.scid}`;
    try {
      const { stdout } = await adb.run(['-s', serial, 'forward', 'tcp:0', socketName], { timeout: 10000 });
      const port = parseInt(String(stdout).trim(), 10);
      if (port > 0) {
        this.port = port;
      } else {
        this.port = await findFreePort();
        await adb.forward(serial, `tcp:${this.port}`, socketName);
      }
      this._forwardActive = true;
    } catch (err) {
      throw userError(mapAdbError(err) || `Falha ao criar o túnel adb: ${err.message}`);
    }
    this._checkAborted();

    // 3. spawn the server
    const args = buildServerCommand(serial, this.scid, this.opts);
    this._log(`iniciando servidor: adb ${args.slice(2).join(' ')}`);
    const proc = adb.spawnAdb(args);
    this.proc = proc;
    const onLines = (prefix) => {
      let partial = '';
      return (d) => {
        partial += d.toString('utf8');
        const parts = partial.split(/\r?\n/);
        partial = parts.pop();
        for (const p of parts) this._log(prefix + p);
      };
    };
    proc.stdout.on('data', onLines(''));
    proc.stderr.on('data', onLines(''));
    proc.on('error', (err) => {
      this._log(`erro no processo adb: ${err.message}`);
      this._onProcExit(-1);
    });
    proc.on('exit', (code) => this._onProcExit(code));

    // 4. connect sockets (video first, with dummy-byte retry loop)
    const first = await this._connectFirst(this.port);
    this.videoSocket = first.socket;
    const wantAudio = this.opts.audio !== false;
    if (wantAudio) this.audioSocket = await this._connectPlain(this.port);
    this.controlSocket = await this._connectPlain(this.port);
    this._checkAborted();

    // 5. forward no longer needed
    this._removeForward();

    // 6. read device name, codec ids, first session packet
    const st = {
      deviceName: null,
      videoCodecId: null,
      firstSession: null,
      audioCodecId: wantAudio ? null : 0,
    };
    let notify = () => {};
    const changed = () => notify();

    const videoParser = new MediaStreamParser({ readDeviceName: true, video: true }, {
      onDeviceName: (n) => { st.deviceName = n; changed(); },
      onCodecId: (id) => { st.videoCodecId = id; changed(); },
      onSession: (s) => {
        if (!st.firstSession) { st.firstSession = s; changed(); }
        this._out('video', s);
      },
      onMedia: (p) => this._out('video', p),
      onError: (err) => this._fatal(`Erro no fluxo de vídeo: ${err.message}`),
    });
    this._wireSocket(this.videoSocket, 'vídeo', (d) => videoParser.push(d));
    if (first.rest && first.rest.length) videoParser.push(first.rest);

    if (this.audioSocket) {
      const audioParser = new MediaStreamParser({ readDeviceName: false, video: false }, {
        onCodecId: (id) => {
          st.audioCodecId = id;
          changed();
          if (id === 0) {
            this._log('áudio desativado pelo dispositivo (Android < 11 ou captura indisponível)');
            if (this.info) this._out('deviceMessage', { type: 'audioDisabled' });
          } else if (id === 1) {
            this._fatal(`Falha ao iniciar o áudio no celular: ${this.lastLogLines()}`);
          }
        },
        onMedia: (p) => this._out('audio', p),
        onError: (err) => this._fatal(`Erro no fluxo de áudio: ${err.message}`),
      });
      // audio socket may legitimately close after "disabled" (codec 0): not fatal by itself
      this._wireSocket(this.audioSocket, 'áudio', (d) => audioParser.push(d), { fatalOnClose: false });
    }

    const ctrlParser = new DeviceMessageParser({
      onMessage: (m) => this._out('deviceMessage', m),
      onError: (err) => this._fatal(`Erro no canal de controle: ${err.message}`),
    });
    this._wireSocket(this.controlSocket, 'controle', (d) => ctrlParser.push(d));

    await new Promise((resolve, reject) => {
      let audioGraceTimer = null;
      const timer = setTimeout(() => {
        cleanup();
        this._log(`timeout no início: nome=${st.deviceName != null} codecVídeo=${st.videoCodecId} sessão=${!!st.firstSession} codecÁudio=${st.audioCodecId}`);
        reject(userError(st.deviceName
          ? 'Tempo esgotado aguardando o vídeo do celular. ' + this._serverFailedMessage()
          : this._serverFailedMessage()));
      }, Math.max(1000, deadline - Date.now()));
      const cleanup = () => {
        clearTimeout(timer);
        if (audioGraceTimer) clearTimeout(audioGraceTimer);
        this._waiters.delete(check);
        notify = () => {};
      };
      const check = () => {
        if (this._startError) { cleanup(); reject(userError(this._startError)); return; }
        if (st.videoCodecId != null && !CODECS[st.videoCodecId]) {
          cleanup(); reject(userError(`Codec de vídeo desconhecido (0x${st.videoCodecId.toString(16)})`)); return;
        }
        if (st.audioCodecId === 1) { cleanup(); reject(userError(`Falha ao iniciar o áudio no celular: ${this.lastLogLines()}`)); return; }
        if (st.deviceName == null || st.videoCodecId == null || !st.firstSession) return;
        if (st.audioCodecId == null) {
          // The audio codec id is written only after capture started; give it a short grace period.
          if (!audioGraceTimer) audioGraceTimer = setTimeout(() => { st.audioCodecId = -1; check(); }, 3000);
          return;
        }
        cleanup();
        resolve();
      };
      notify = check;
      this._waiters.add(check);
      check();
    });

    let audio = null;
    if (st.audioCodecId === -1) audio = { codec: 'raw' }; // not announced yet; 'audioDisabled' message if it turns out disabled
    else if (st.audioCodecId && CODECS[st.audioCodecId]) audio = { codec: CODECS[st.audioCodecId] };

    return {
      deviceName: st.deviceName,
      video: { codec: CODECS[st.videoCodecId], width: st.firstSession.width, height: st.firstSession.height },
      audio,
    };
  }

  _checkAborted() {
    if (this._startError) throw userError(this._startError);
    if (this.ended) throw userError('Conexão cancelada');
  }

  _onProcExit(code) {
    if (this.procExited) return;
    this.procExited = true;
    this.procExitCode = code;
    this._log(`servidor encerrado (código ${code})`);
    if (this.ended) return;
    if (!this.info) {
      this._startError = this._serverFailedMessage();
      for (const w of this._waiters) w();
    } else {
      this._fatal(null);
    }
  }

  _wireSocket(sock, label, onData, { fatalOnClose = true } = {}) {
    sock.on('data', onData);
    const onGone = (err) => {
      if (this.ended) return;
      if (err) this._log(`socket de ${label}: ${err.message}`);
      if (!fatalOnClose) return;
      if (!this.info) {
        // during start: wait briefly for the process to exit so its logs are captured
        setTimeout(() => {
          if (!this._startError) this._startError = this._serverFailedMessage();
          for (const w of this._waiters) w();
        }, 300);
      } else {
        this._fatal(null);
      }
    };
    sock.on('error', onGone);
    sock.on('close', () => onGone(null));
    sock.resume();
  }

  _connectFirst(port) {
    return new Promise((resolve, reject) => {
      let attempts = 100;
      const tryOnce = () => {
        if (this._startError || this.ended) { reject(userError(this._startError || 'Conexão cancelada')); return; }
        if (this.procExited) { reject(userError(this._serverFailedMessage())); return; }
        const sock = net.createConnection({ host: '127.0.0.1', port });
        sock.setNoDelay(true);
        let done = false;
        const perAttempt = setTimeout(() => fail(new Error('timeout')), 3000);
        const fail = () => {
          if (done) return;
          done = true;
          clearTimeout(perAttempt);
          sock.removeAllListeners();
          sock.on('error', () => {});
          sock.destroy();
          if (--attempts <= 0) {
            reject(userError(this._serverFailedMessage()));
            return;
          }
          setTimeout(tryOnce, 100);
        };
        sock.once('data', (d) => {
          if (done) return;
          done = true;
          clearTimeout(perAttempt);
          sock.removeAllListeners();
          // Hold further data until the parser is wired (_wireSocket resumes it).
          sock.pause();
          sock.on('error', () => {});
          // d[0] is the dummy byte (0x00); keep anything after it for the parser
          resolve({ socket: sock, rest: d.length > 1 ? d.subarray(1) : null });
        });
        sock.once('end', fail);
        sock.once('close', fail);
        sock.once('error', fail);
      };
      tryOnce();
    });
  }

  _connectPlain(port) {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: '127.0.0.1', port });
      sock.setNoDelay(true);
      sock.pause(); // resumed by _wireSocket once the parser is attached
      const t = setTimeout(() => { sock.destroy(); reject(userError(this._serverFailedMessage())); }, 5000);
      sock.once('connect', () => {
        clearTimeout(t);
        sock.removeAllListeners('error');
        sock.on('error', () => {});
        resolve(sock);
      });
      sock.once('error', (err) => { clearTimeout(t); reject(userError(`${this._serverFailedMessage()} (${err.message})`)); });
    });
  }

  _removeForward() {
    if (!this._forwardActive || !this.port) return Promise.resolve();
    this._forwardActive = false;
    return adb.removeForward(this.serial, `tcp:${this.port}`).catch(() => {});
  }

  // ---- runtime -------------------------------------------------------------------------------
  /** Writes a serialized control message immediately (fire-and-forget). */
  sendControl(buf) {
    const s = this.controlSocket;
    if (!s || this.ended || s.destroyed || !this.info) return false;
    s.write(buf);
    return true;
  }

  _fatal(reason) {
    if (this.ended) return;
    if (!this.info) {
      if (!this._startError) this._startError = reason || this._serverFailedMessage();
      for (const w of this._waiters) w();
      return;
    }
    this._endWithDiagnosis(reason);
  }

  async _endWithDiagnosis(reason) {
    if (this._diagnosing || this.ended) return;
    this._diagnosing = true;
    let finalReason = reason;
    if (!finalReason) {
      // figure out whether the device was unplugged
      let present = true;
      try {
        const list = await Promise.race([adb.listDevices(), delay(2500).then(() => null)]);
        if (list) present = list.some((d) => d.serial === this.serial && d.state === 'device');
      } catch { present = false; }
      if (!present) finalReason = MSG.DISCONNECTED;
      else {
        const lines = this.lastLogLines(3);
        finalReason = 'O espelhamento foi encerrado pelo celular' + (lines ? `: ${lines}` : '.');
      }
    }
    await this._teardown(finalReason);
  }

  /** User-initiated stop. */
  async stop(reason = 'Desconectado') {
    if (this.ended) return;
    if (!this.info) {
      this._startError = this._startError || 'Conexão cancelada';
      await this._teardown(null); // start() rejects; no 'ended' for a session that never started
      return;
    }
    await this._teardown(reason);
  }

  async _teardown(reason) {
    if (this.ended) return this._teardownPromise;
    this.ended = true;
    this.endReason = reason;
    this._teardownPromise = (async () => {
      for (const s of [this.videoSocket, this.audioSocket, this.controlSocket]) {
        if (s) { s.removeAllListeners('data'); s.on('error', () => {}); s.destroy(); }
      }
      for (const w of this._waiters) w();
      const p = this.proc;
      if (p && !this.procExited) {
        try { p.stdin.end(); } catch { /* ignore */ }
        await Promise.race([new Promise((r) => p.once('exit', r)), delay(1000)]);
        if (!this.procExited) {
          try { p.kill(); } catch { /* ignore */ }
        }
      }
      await this._removeForward();
      this._held = [];
      if (reason != null) this.emit('ended', reason);
    })();
    return this._teardownPromise;
  }
}

function userError(msg) {
  const e = new Error(msg);
  e.userMessage = msg;
  return e;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

module.exports = {
  ScrcpySession,
  MediaStreamParser,
  DeviceMessageParser,
  ChunkQueue,
  buildServerArgs,
  buildServerCommand,
  makeScid,
  CODECS,
  SERVER_VERSION,
  DEVICE_SERVER_PATH,
  MSG,
};
