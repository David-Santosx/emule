'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MediaStreamParser, DeviceMessageParser, ChunkQueue, buildServerArgs, buildServerCommand, makeScid,
} = require('../src/main/scrcpy');
const { parseDevices } = require('../src/main/adb');
const { sanitizeName } = require('../src/main/store');

// ---- helpers ---------------------------------------------------------------------------------
function deviceName(name) {
  const b = Buffer.alloc(64);
  b.write(name, 'utf8');
  return b;
}
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; }
function sessionPkt(w, h, resized = false) {
  const b = Buffer.alloc(12);
  b.writeUInt32BE((0x80000000 | (resized ? 1 : 0)) >>> 0, 0);
  b.writeUInt32BE(w, 4);
  b.writeUInt32BE(h, 8);
  return b;
}
function mediaPkt({ config = false, key = false, pts = 0n }, payload) {
  const b = Buffer.alloc(12);
  let v = config ? (1n << 62n) : (BigInt(pts) | (key ? (1n << 61n) : 0n));
  b.writeBigUInt64BE(v, 0);
  b.writeUInt32BE(payload.length, 8);
  return Buffer.concat([b, payload]);
}

function collectVideo() {
  const out = { names: [], codecs: [], sessions: [], media: [], errors: [] };
  const p = new MediaStreamParser({ readDeviceName: true, video: true }, {
    onDeviceName: (n) => out.names.push(n),
    onCodecId: (c) => out.codecs.push(c),
    onSession: (s) => out.sessions.push(s),
    onMedia: (m) => out.media.push({ ...m, data: Buffer.from(m.data) }),
    onError: (e) => out.errors.push(e),
  });
  return { p, out };
}

const BIG_PTS = (1n << 60n) + 123456789n; // uses high bits below the flags
const videoStream = Buffer.concat([
  deviceName('Pixel 8 Pró'),
  u32(0x68323634),
  sessionPkt(1080, 2400),
  mediaPkt({ config: true }, Buffer.from([0, 0, 0, 1, 0x67, 1, 2, 3])),
  mediaPkt({ key: true, pts: 1000n }, Buffer.from([0, 0, 0, 1, 0x65, 9, 9])),
  mediaPkt({ pts: BIG_PTS }, Buffer.alloc(300, 7)),
  sessionPkt(2400, 1080, true),
  mediaPkt({ pts: 2000n }, Buffer.from([1])),
]);

function checkVideo(out) {
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.names, ['Pixel 8 Pró']);
  assert.deepEqual(out.codecs, [0x68323634]);
  assert.deepEqual(out.sessions, [
    { type: 'session', width: 1080, height: 2400, clientResized: false },
    { type: 'session', width: 2400, height: 1080, clientResized: true },
  ]);
  assert.equal(out.media.length, 4);
  assert.equal(out.media[0].config, true);
  assert.equal(out.media[0].keyframe, false);
  assert.equal(out.media[0].pts, -1);
  assert.deepEqual([...out.media[0].data], [0, 0, 0, 1, 0x67, 1, 2, 3]);
  assert.equal(out.media[1].config, false);
  assert.equal(out.media[1].keyframe, true);
  assert.equal(out.media[1].pts, 1000);
  assert.equal(out.media[2].keyframe, false);
  assert.equal(out.media[2].pts, Number(BIG_PTS));
  assert.equal(out.media[2].data.length, 300);
  assert.equal(out.media[3].pts, 2000);
  assert.deepEqual([...out.media[3].data], [1]);
}

// ---- media stream ----------------------------------------------------------------------------
test('video stream parsed in one chunk', () => {
  const { p, out } = collectVideo();
  p.push(videoStream);
  checkVideo(out);
});

test('video stream split at every byte boundary (two chunks)', () => {
  for (let i = 1; i < videoStream.length; i++) {
    const { p, out } = collectVideo();
    p.push(videoStream.subarray(0, i));
    p.push(videoStream.subarray(i));
    checkVideo(out);
  }
});

test('video stream fed one byte at a time', () => {
  const { p, out } = collectVideo();
  for (let i = 0; i < videoStream.length; i++) p.push(videoStream.subarray(i, i + 1));
  checkVideo(out);
});

test('PTS mask excludes flag bits', () => {
  const { p, out } = collectVideo();
  const maxPts = (1n << 61n) - 1n;
  p.push(Buffer.concat([deviceName('x'), u32(0x68323635), sessionPkt(2, 2), mediaPkt({ key: true, pts: maxPts }, Buffer.from([5]))]));
  assert.equal(out.media[0].keyframe, true);
  assert.equal(out.media[0].config, false);
  assert.equal(out.media[0].pts, Number(maxPts));
});

test('zero-size media packet is an error', () => {
  const { p, out } = collectVideo();
  const hdr = Buffer.alloc(12);
  p.push(Buffer.concat([deviceName('x'), u32(0x68323634), sessionPkt(2, 2), hdr]));
  assert.equal(out.errors.length, 1);
});

test('audio stream: raw codec and packets; disabled codec 0; error codec 1', () => {
  const pk = [];
  const codecs = [];
  const a = new MediaStreamParser({ video: false }, { onCodecId: (c) => codecs.push(c), onMedia: (m) => pk.push(m) });
  const pcm = Buffer.alloc(4096, 3);
  const s = Buffer.concat([u32(0x00726177), mediaPkt({ pts: 5n }, pcm), mediaPkt({ pts: 6n }, pcm)]);
  for (let i = 0; i < s.length; i += 1000) a.push(s.subarray(i, i + 1000));
  assert.deepEqual(codecs, [0x00726177]);
  assert.equal(pk.length, 2);
  assert.equal(pk[1].pts, 6);
  assert.equal(pk[0].data.length, 4096);

  for (const id of [0, 1]) {
    const got = [];
    const media = [];
    const d = new MediaStreamParser({ video: false }, { onCodecId: (c) => got.push(c), onMedia: (m) => media.push(m) });
    d.push(Buffer.concat([u32(id), Buffer.alloc(20, 1)]));
    assert.deepEqual(got, [id]);
    assert.equal(media.length, 0);
  }
});

test('session packet on audio socket is an error', () => {
  const errors = [];
  const a = new MediaStreamParser({ video: false }, { onError: (e) => errors.push(e) });
  a.push(Buffer.concat([u32(0x00726177), sessionPkt(1, 1)]));
  assert.equal(errors.length, 1);
});

// ---- chunk queue -----------------------------------------------------------------------------
test('ChunkQueue reads across chunks and zero-copies inside one', () => {
  const q = new ChunkQueue();
  q.push(Buffer.from([1, 2, 3]));
  q.push(Buffer.from([4, 5]));
  q.push(Buffer.from([6]));
  assert.equal(q.length, 6);
  assert.equal(q.peek(4), 5);
  assert.deepEqual([...q.read(2)], [1, 2]);
  assert.deepEqual([...q.read(3)], [3, 4, 5]);
  assert.equal(q.length, 1);
  assert.deepEqual([...q.read(1)], [6]);
  assert.equal(q.length, 0);
});

// ---- device messages -------------------------------------------------------------------------
test('device messages: clipboard, ack, uhid output, split everywhere', () => {
  const text = 'olá, área de transferência';
  const tb = Buffer.from(text, 'utf8');
  const clip = Buffer.concat([Buffer.from([0]), u32(tb.length), tb]);
  const ack = Buffer.alloc(9); ack[0] = 1; ack.writeBigUInt64BE(42n, 1);
  const uhid = Buffer.from([2, 0x00, 0x07, 0x00, 0x03, 0xaa, 0xbb, 0xcc]);
  const emptyClip = Buffer.concat([Buffer.from([0]), u32(0)]);
  const stream = Buffer.concat([clip, ack, uhid, emptyClip]);
  const expected = [
    { type: 'clipboard', text },
    { type: 'ackClipboard', sequence: 42 },
    { type: 'uhidOutput', id: 7, data: [0xaa, 0xbb, 0xcc] },
    { type: 'clipboard', text: '' },
  ];
  const norm = (m) => (m.data ? { ...m, data: [...m.data] } : m);
  for (let i = 0; i <= stream.length; i++) {
    const msgs = [];
    const errs = [];
    const p = new DeviceMessageParser({ onMessage: (m) => msgs.push(norm(m)), onError: (e) => errs.push(e) });
    p.push(stream.subarray(0, i));
    p.push(stream.subarray(i));
    assert.deepEqual(errs, []);
    assert.deepEqual(msgs, expected);
  }
});

test('unknown device message type is an error', () => {
  const errs = [];
  const p = new DeviceMessageParser({ onError: (e) => errs.push(e) });
  p.push(Buffer.from([9, 0, 0]));
  assert.equal(errs.length, 1);
});

// ---- server command line ---------------------------------------------------------------------
test('server command line', () => {
  const cmd = buildServerCommand('ABC123', '1a2b3c4d', {
    maxSize: 1920, videoBitRate: 8000000, maxFps: 60, videoCodec: 'h265', audio: true,
    stayAwake: true, showTouches: false, powerOffOnClose: true, turnScreenOff: true,
  });
  assert.deepEqual(cmd.slice(0, 8), [
    '-s', 'ABC123', 'shell', 'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
    'app_process', '/', 'com.genymobile.scrcpy.Server', '5.0.1',
  ]);
  const args = cmd.slice(8);
  for (const a of args) assert.match(a, /^[a-z_]+=\S*$/);
  const kv = Object.fromEntries(args.map((a) => a.split('=')));
  assert.equal(kv.scid, '1a2b3c4d');
  assert.equal(kv.log_level, 'info');
  assert.equal(kv.video, 'true');
  assert.equal(kv.audio, 'true');
  assert.equal(kv.audio_codec, 'raw');
  assert.equal(kv.control, 'true');
  assert.equal(kv.tunnel_forward, 'true');
  assert.equal(kv.video_codec, 'h265');
  assert.equal(kv.video_bit_rate, '8000000');
  assert.equal(kv.max_size, '1920');
  assert.equal(kv.max_fps, '60');
  assert.equal(kv.stay_awake, 'true');
  assert.equal(kv.show_touches, 'false');
  assert.equal(kv.power_off_on_close, 'true');
  assert.equal(kv.send_codec_meta, undefined);
  assert.equal(kv.turn_screen_off, undefined);
});

test('server args: defaults, audio off, unlimited fps, bad codec', () => {
  const kv = Object.fromEntries(buildServerArgs('00000001', { audio: false, maxFps: 0, videoCodec: 'xyz', maxSize: 0 }).map((a) => a.split('=')));
  assert.equal(kv.audio, 'false');
  assert.equal(kv.audio_codec, undefined);
  assert.equal(kv.max_fps, undefined);
  assert.equal(kv.video_codec, 'h264');
  assert.equal(kv.max_size, '0');
  assert.equal(kv.video_bit_rate, '16000000');
});

test('scid is 8 lowercase hex chars, 31-bit', () => {
  for (let i = 0; i < 200; i++) {
    const s = makeScid();
    assert.match(s, /^[0-7][0-9a-f]{7}$/);
  }
});

// ---- adb / store helpers ---------------------------------------------------------------------
test('parseDevices', () => {
  const out = parseDevices([
    '* daemon not running; starting now at tcp:5037',
    '* daemon started successfully',
    'List of devices attached',
    'RXCX304ZYMM            device product:a25xdxx model:SM_A256E device:a25x transport_id:12',
    'emulator-5554          unauthorized transport_id:3',
    '192.168.0.5:5555       offline product:x model:Pixel_8_Pro device:husky',
    '',
  ].join('\r\n'));
  assert.deepEqual(out, [
    { serial: 'RXCX304ZYMM', state: 'device', model: 'SM A256E', product: 'a25xdxx' },
    { serial: 'emulator-5554', state: 'unauthorized', model: '', product: '' },
    { serial: '192.168.0.5:5555', state: 'offline', model: 'Pixel 8 Pro', product: 'x' },
  ]);
});

test('sanitizeName', () => {
  assert.equal(sanitizeName('FPS: Free/Fire?'), 'FPS_ Free_Fire_');
  assert.equal(sanitizeName('CON'), '_CON');
  assert.equal(sanitizeName('  '), 'perfil');
  assert.equal(sanitizeName('abc. '), 'abc');
});
