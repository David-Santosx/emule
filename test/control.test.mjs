// Byte-exact checks of the control serializers against docs/PROTOCOL.md §4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/renderer/control.js';

const hex = (u8) => Buffer.from(u8).toString('hex');

test('INJECT_KEYCODE: 14 bytes, HOME down/up example from PROTOCOL.md §7', () => {
  assert.equal(hex(C.injectKeycode(C.AKEY.DOWN, C.KEYCODE.HOME)), '00' + '00' + '00000003' + '00000000' + '00000000');
  assert.equal(hex(C.injectKeycode(C.AKEY.UP, C.KEYCODE.HOME)), '00' + '01' + '00000003' + '00000000' + '00000000');
  const m = C.injectKeycode(C.AKEY.DOWN, C.KEYCODE.ENTER, 5, C.AMETA.CTRL_ON | C.AMETA.CTRL_LEFT_ON);
  assert.equal(m.length, 14);
  assert.equal(hex(m), '00' + '00' + '00000042' + '00000005' + '00003000');
});

test('INJECT_TEXT: u32 length + UTF-8, truncated to 300 bytes on a code point boundary', () => {
  assert.equal(hex(C.injectText('hé')), '01' + '00000003' + '68c3a9');
  const long = C.injectText('a'.repeat(400));
  assert.equal(long.length, 5 + 300);
  assert.equal(new DataView(long.buffer).getUint32(1), 300);
  // 299 'a' + 'é' (2 bytes) → é must be dropped entirely
  const cut = C.injectText('a'.repeat(299) + 'é');
  assert.equal(cut.length, 5 + 299);
  assert.equal(hex(C.injectText('')), '0100000000');
});

test('INJECT_TOUCH_EVENT: 32 bytes, example from PROTOCOL.md §7', () => {
  const down = C.injectTouch(C.AMOTION.DOWN, C.POINTER_ID.GENERIC_FINGER, 100, 200, 1080, 2400, 1.0);
  assert.equal(down.length, 32);
  assert.equal(hex(down),
    '02' + '00' + 'fffffffffffffffe' + '00000064' + '000000c8' + '0438' + '0960' + 'ffff' + '00000000' + '00000000');
  const up = C.injectTouch(C.AMOTION.UP, 3n, 100, 200, 1080, 2400, 0);
  assert.equal(hex(up),
    '02' + '01' + '0000000000000003' + '00000064' + '000000c8' + '0438' + '0960' + '0000' + '00000000' + '00000000');
  const mv = C.injectTouch(C.AMOTION.MOVE, 0n, -5, 7, 1920, 1080, 0.5, C.ABUTTON.PRIMARY, C.ABUTTON.PRIMARY);
  assert.equal(hex(mv),
    '02' + '02' + '0000000000000000' + 'fffffffb' + '00000007' + '0780' + '0438' + '8000' + '00000001' + '00000001');
  // mouse pointer id -1 accepted as BigInt or number
  assert.equal(hex(C.injectTouch(0, -1n, 0, 0, 1, 1, 1)).slice(4, 20), 'ffffffffffffffff');
  assert.equal(hex(C.injectTouch(0, 7, 0, 0, 1, 1, 1)).slice(4, 20), '0000000000000007');
});

test('pressure fixed point (u16)', () => {
  assert.equal(C.floatToU16fp(1), 0xffff);
  assert.equal(C.floatToU16fp(0), 0);
  assert.equal(C.floatToU16fp(0.5), 0x8000);
  assert.equal(C.floatToU16fp(0.25), 0x4000);
  assert.equal(C.floatToU16fp(2), 0xffff);
  assert.equal(C.floatToU16fp(-1), 0);
  assert.equal(C.floatToU16fp(NaN), 0);
});

test('INJECT_SCROLL_EVENT: 21 bytes, i16 fixed point of v/16', () => {
  const m = C.injectScroll(10, 20, 1080, 2400, 0, 1);
  assert.equal(m.length, 21);
  // vscroll 1 → 1/16 → 0x0800
  assert.equal(hex(m), '03' + '0000000a' + '00000014' + '0438' + '0960' + '0000' + '0800' + '00000000');
  const m2 = C.injectScroll(0, 0, 100, 100, -1, 16);
  assert.equal(hex(m2).slice(26, 34), 'f800' + '7fff');      // -1/16 → -2048, 16/16 → 0x7FFF
  const m3 = C.injectScroll(0, 0, 100, 100, -16, -40);       // clamped
  assert.equal(hex(m3).slice(26, 34), '8000' + '8000');
  assert.equal(C.floatToI16fp(1), 0x7fff);
  assert.equal(C.floatToI16fp(-1), -0x8000);
  assert.equal(C.floatToI16fp(0.5), 0x4000);
});

test('fixed-size and simple messages', () => {
  assert.equal(hex(C.backOrScreenOn(C.AKEY.DOWN)), '0400');
  assert.equal(hex(C.backOrScreenOn(C.AKEY.UP)), '0401');
  assert.equal(hex(C.expandNotificationPanel()), '05');
  assert.equal(hex(C.expandSettingsPanel()), '06');
  assert.equal(hex(C.collapsePanels()), '07');
  assert.equal(hex(C.getClipboard()), '0800');
  assert.equal(hex(C.getClipboard(C.COPY_KEY.COPY)), '0801');
  assert.equal(hex(C.getClipboard(C.COPY_KEY.CUT)), '0802');
  assert.equal(hex(C.setDisplayPower(false)), '0a00');
  assert.equal(hex(C.setDisplayPower(true)), '0a01');
  assert.equal(hex(C.rotateDevice()), '0b');
  assert.equal(hex(C.openHardKeyboardSettings()), '0f');
  assert.equal(hex(C.resetVideo()), '11');
});

test('SET_CLIPBOARD: u64 sequence, u8 paste, u32 len, UTF-8', () => {
  assert.equal(hex(C.setClipboard('olá', true)), '09' + '0000000000000000' + '01' + '00000004' + '6f6cc3a1');
  assert.equal(hex(C.setClipboard('x', false, 0x0102030405060708n)), '09' + '0102030405060708' + '00' + '00000001' + '78');
});

test('keyPress returns DOWN then UP', () => {
  const [d, u] = C.keyPress(C.KEYCODE.BACK);
  assert.equal(hex(d), '0000000000040000000000000000');
  assert.equal(hex(u), '0001000000040000000000000000');
});

test('only display-safe known message types are exported', () => {
  const types = Object.values(C.TYPE);
  for (const t of types) assert.ok(t >= 0 && t <= 17, `type ${t}`);
  // never camera (18-20), RESIZE_DISPLAY (21), or UHID (12-14)
  for (const bad of [12, 13, 14, 18, 19, 20, 21]) assert.ok(!types.includes(bad));
});

test('keycodes match PROTOCOL.md §4.3', () => {
  const K = C.KEYCODE;
  assert.deepEqual(
    [K.HOME, K.BACK, K.DPAD_UP, K.DPAD_DOWN, K.DPAD_LEFT, K.DPAD_RIGHT, K.VOLUME_UP, K.VOLUME_DOWN, K.POWER,
      K.A, K.Z, K.TAB, K.SPACE, K.ENTER, K.DEL, K.MENU, K.PAGE_UP, K.PAGE_DOWN, K.ESCAPE, K.FORWARD_DEL,
      K.MOVE_HOME, K.MOVE_END, K.APP_SWITCH, K.WAKEUP, K.CUT, K.COPY, K.PASTE],
    [3, 4, 19, 20, 21, 22, 24, 25, 26, 29, 54, 61, 62, 66, 67, 82, 92, 93, 111, 112, 122, 123, 187, 224, 277, 278, 279]);
});
