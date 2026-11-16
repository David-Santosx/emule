// TouchManager + codec-string tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TouchManager, MAX_POINTERS } from '../src/renderer/touch.js';
import { wheelToNotches, clientToNormalized } from '../src/renderer/input.js';
import {
  splitAnnexB, unescapeRbsp, avcCodecFromSps, hevcCodecFromParamSet, codecStringFromConfig,
  guessFamily, DEFAULT_H264, DEFAULT_H265,
} from '../src/renderer/codec-string.js';

function decode(m) {
  const v = new DataView(m.buffer, m.byteOffset, m.byteLength);
  return {
    type: m[0], action: m[1], pid: v.getBigInt64(2), x: v.getInt32(10), y: v.getInt32(14),
    w: v.getUint16(18), h: v.getUint16(20), pressure: v.getUint16(22),
  };
}

function setup(size = { width: 1080, height: 2400 }) {
  const sent = [];
  const frame = { ...size };
  const tm = new TouchManager((b) => sent.push(decode(b)), () => frame);
  return { tm, sent, frame };
}

test('down/move/up: normalized → pixels with latest frame size, pressure 1 / 0', () => {
  const { tm, sent, frame } = setup();
  tm.down('mouse', 0.5, 0.25);
  assert.deepEqual(sent[0], { type: 2, action: 0, pid: 0n, x: 540, y: 600, w: 1080, h: 2400, pressure: 0xffff });
  frame.width = 2400; frame.height = 1080; // rotation
  tm.move('mouse', 0.5, 0.5);
  assert.deepEqual(sent[1], { type: 2, action: 2, pid: 0n, x: 1200, y: 540, w: 2400, h: 1080, pressure: 0xffff });
  tm.up('mouse');
  assert.deepEqual(sent[2], { type: 2, action: 1, pid: 0n, x: 1200, y: 540, w: 2400, h: 1080, pressure: 0 });
  assert.equal(tm.isDown('mouse'), false);
});

test('clamping to [0, size-1]', () => {
  const { tm, sent } = setup({ width: 100, height: 200 });
  tm.down('a', -0.5, 1.7);
  assert.equal(sent[0].x, 0);
  assert.equal(sent[0].y, 199);
  tm.move('a', 1, NaN);
  assert.equal(sent[1].x, 99);
  assert.equal(sent[1].y, 0);
});

test('distinct ids, lowest free reused, down on held id = move', () => {
  const { tm, sent } = setup();
  tm.down('mouse', 0.1, 0.1);
  tm.down('km:a', 0.2, 0.2);
  tm.down('km:b', 0.3, 0.3);
  assert.deepEqual(sent.map((s) => s.pid), [0n, 1n, 2n]);
  tm.down('km:a', 0.25, 0.25); // already down → MOVE with same pid
  assert.equal(sent[3].action, 2);
  assert.equal(sent[3].pid, 1n);
  tm.up('km:a');
  tm.down('km:c', 0.4, 0.4);   // reuses 1
  assert.equal(sent.at(-1).pid, 1n);
  assert.equal(sent.at(-1).action, 0);
  // never reuses an id currently down
  const active = new Set([0n, 1n, 2n]);
  tm.down('km:d', 0.5, 0.5);
  assert.ok(!active.has(sent.at(-1).pid));
  assert.equal(sent.at(-1).pid, 3n);
});

test('max 10 fingers, extra downs dropped', () => {
  const { tm, sent } = setup();
  for (let i = 0; i < 12; i++) tm.down('f' + i, 0.5, 0.5);
  assert.equal(sent.length, MAX_POINTERS);
  assert.equal(tm.activeCount, 10);
  assert.equal(tm.isDown('f11'), false);
  assert.deepEqual(sent.map((s) => s.pid), [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]);
});

test('move / up on unknown id do nothing', () => {
  const { tm, sent } = setup();
  tm.move('x', 0.5, 0.5);
  tm.up('x');
  assert.equal(sent.length, 0);
});

test('releaseAll lifts every pointer at its last position', () => {
  const { tm, sent } = setup({ width: 1000, height: 1000 });
  tm.down('a', 0.1, 0.1);
  tm.down('b', 0.2, 0.2);
  tm.move('b', 0.3, 0.3);
  sent.length = 0;
  tm.releaseAll();
  assert.equal(sent.length, 2);
  assert.ok(sent.every((s) => s.action === 1 && s.pressure === 0));
  assert.deepEqual(sent.map((s) => [s.pid, s.x]).sort(), [[0n, 100], [1n, 300]]);
  assert.equal(tm.activeCount, 0);
  tm.releaseAll();
  assert.equal(sent.length, 2);
});

test('no frame size yet → nothing sent, nothing tracked', () => {
  const { tm, sent } = setup({ width: 0, height: 0 });
  tm.down('a', 0.5, 0.5);
  assert.equal(sent.length, 0);
  assert.equal(tm.isDown('a'), false);
});

test('reset forgets pointers without sending', () => {
  const { tm, sent } = setup();
  tm.down('a', 0.5, 0.5);
  tm.reset();
  assert.equal(sent.length, 1);
  assert.equal(tm.isDown('a'), false);
});

test('input helpers: wheel notches and rect mapping', () => {
  assert.equal(wheelToNotches(100, 0), 1);
  assert.equal(wheelToNotches(-300, 0), -3);
  assert.equal(wheelToNotches(3, 1), 1);
  assert.equal(wheelToNotches(1e6, 0), 16);
  const r = { left: 10, top: 20, width: 100, height: 200 };
  assert.deepEqual(clientToNormalized(r, 60, 120), { nx: 0.5, ny: 0.5 });
  assert.equal(clientToNormalized(r, 5, 120), null);
  assert.deepEqual(clientToNormalized(r, 5, 500, true), { nx: 0, ny: 1 });
});

/* --------------------------------- codec strings --------------------------------- */

const bytes = (h) => Uint8Array.from(Buffer.from(h.replace(/\s+/g, ''), 'hex'));

// Real H.264 config (SPS + PPS) as emitted by an Android encoder: High profile, level 4.0
const H264_CONFIG = bytes(`
  00000001 67640028 acd94078 0227e5c0 44000003 00040000 0300f03c 60c658
  00000001 68ebe3cb 22c0`);

// Real H.265 config (VPS + SPS + PPS): Main profile, Main tier, level 3.1 (93)
const H265_CONFIG = bytes(`
  00000001 40010c01 ffff0160 00000300 90000003 00000300 5d959809
  00000001 42010101 60000003 00900000 03000003 005da002 80802d16 5959a493 2bc05a70 800001f4 80003a98 04
  00000001 4401c172 b46240`);

test('Annex-B split', () => {
  const nals = splitAnnexB(H264_CONFIG);
  assert.equal(nals.length, 2);
  assert.equal(nals[0][0], 0x67);
  assert.equal(nals[1][0], 0x68);
  assert.equal(splitAnnexB(H265_CONFIG).length, 3);
  // 3-byte start codes
  assert.equal(splitAnnexB(bytes('000001 6742 000001 68ce')).length, 2);
});

test('emulation prevention removal', () => {
  assert.equal(Buffer.from(unescapeRbsp(bytes('0000030100000300'))).toString('hex'), '000001000000');
  assert.deepEqual([...unescapeRbsp(bytes('00000301'))], [0, 0, 1]);
});

test('H.264 SPS → avc1.PPCCLL', () => {
  assert.equal(avcCodecFromSps(splitAnnexB(H264_CONFIG)[0]), 'avc1.640028');
  assert.equal(codecStringFromConfig('h264', H264_CONFIG), 'avc1.640028');
  // Baseline constrained, level 3.1
  assert.equal(codecStringFromConfig('h264', bytes('00000001 6742c01f da01')), 'avc1.42c01f');
  assert.equal(codecStringFromConfig('h264', bytes('00000001 68ce')), DEFAULT_H264);
});

test('H.265 SPS / VPS → hev1 string', () => {
  const nals = splitAnnexB(H265_CONFIG);
  assert.equal(hevcCodecFromParamSet(nals[1]), 'hev1.1.6.L93.90');   // SPS
  assert.equal(hevcCodecFromParamSet(nals[0]), 'hev1.1.6.L93.90');   // VPS has the same PTL
  assert.equal(codecStringFromConfig('h265', H265_CONFIG), 'hev1.1.6.L93.90');
  assert.equal(codecStringFromConfig('h265', bytes('00000001 4401c1')), DEFAULT_H265);
});

test('family guess from config', () => {
  assert.equal(guessFamily(H264_CONFIG), 'h264');
  assert.equal(guessFamily(H265_CONFIG), 'h265');
  assert.equal(guessFamily(bytes('00000001 0910')), null);
});
