// Emule — scrcpy v5.0.1 control-message serializers (owner: B)
// Byte layouts: docs/PROTOCOL.md §4. Everything is BIG-ENDIAN. Pure functions, no DOM:
// usable from the renderer and from `node --test`.
//
// IMPORTANT: only message types the v5.0.1 server knows are produced here. Sending an unknown
// type (or a camera / resize-display message while mirroring a display) KILLS the session.

/** Control message type ids (PROTOCOL.md §4). Only the display-mode-safe ones are used. */
export const TYPE = Object.freeze({
  INJECT_KEYCODE: 0,
  INJECT_TEXT: 1,
  INJECT_TOUCH_EVENT: 2,
  INJECT_SCROLL_EVENT: 3,
  BACK_OR_SCREEN_ON: 4,
  EXPAND_NOTIFICATION_PANEL: 5,
  EXPAND_SETTINGS_PANEL: 6,
  COLLAPSE_PANELS: 7,
  GET_CLIPBOARD: 8,
  SET_CLIPBOARD: 9,
  SET_DISPLAY_POWER: 10,
  ROTATE_DEVICE: 11,
  OPEN_HARD_KEYBOARD_SETTINGS: 15,
  RESET_VIDEO: 17,
});

/** Android MotionEvent actions. Only DOWN / UP / MOVE are ever sent for touches (server derives POINTER_*). */
export const AMOTION = Object.freeze({ DOWN: 0, UP: 1, MOVE: 2 });
/** Android KeyEvent actions. */
export const AKEY = Object.freeze({ DOWN: 0, UP: 1 });
/** Android MotionEvent buttons. */
export const ABUTTON = Object.freeze({ PRIMARY: 1, SECONDARY: 2, TERTIARY: 4, BACK: 8, FORWARD: 16 });
/** Android meta state flags. */
export const AMETA = Object.freeze({
  NONE: 0, SHIFT_ON: 0x1, ALT_ON: 0x2, SHIFT_LEFT_ON: 0x40, CTRL_ON: 0x1000, CTRL_LEFT_ON: 0x2000, META_ON: 0x10000,
});
/** GET_CLIPBOARD copy key. */
export const COPY_KEY = Object.freeze({ NONE: 0, COPY: 1, CUT: 2 });

/** Special pointer ids (PROTOCOL.md §4.2). Emule uses plain finger ids 0..9 instead (see touch.js). */
export const POINTER_ID = Object.freeze({ MOUSE: -1n, GENERIC_FINGER: -2n, VIRTUAL_FINGER: -3n });

/** Android keycodes used by the app (PROTOCOL.md §4.3). */
export const KEYCODE = Object.freeze({
  HOME: 3, BACK: 4,
  DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22, DPAD_CENTER: 23,
  VOLUME_UP: 24, VOLUME_DOWN: 25, POWER: 26, CAMERA: 27,
  A: 29, Z: 54,
  TAB: 61, SPACE: 62, ENTER: 66, DEL: 67, MENU: 82, NOTIFICATION: 83,
  PAGE_UP: 92, PAGE_DOWN: 93, ESCAPE: 111, FORWARD_DEL: 112,
  MOVE_HOME: 122, MOVE_END: 123, VOLUME_MUTE: 164, APP_SWITCH: 187,
  SLEEP: 223, WAKEUP: 224, CUT: 277, COPY: 278, PASTE: 279,
});

export const INJECT_TEXT_MAX_LENGTH = 300;       // client-side limit of the official client
export const CONTROL_MSG_MAX_SIZE = 1 << 18;      // 256 KiB
export const CLIPBOARD_TEXT_MAX_LENGTH = CONTROL_MSG_MAX_SIZE - 14;

const encoder = new TextEncoder();

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                    */
/* ------------------------------------------------------------------------------------------ */

function msg(size, type) {
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  buf[0] = type;
  return { buf, view };
}

/** Float [0,1] → u16 fixed point (sc_float_to_u16fp): 1.0 → 0xFFFF. */
export function floatToU16fp(f) {
  if (!(f > 0)) return 0; // also handles NaN
  if (f >= 1) return 0xffff;
  const u = Math.floor(f * 65536);
  return u >= 0xffff ? 0xffff : u;
}

/** Float [-1,1] → i16 fixed point (sc_float_to_i16fp): 1.0 → 0x7FFF, -1.0 → -0x8000. */
export function floatToI16fp(f) {
  if (Number.isNaN(f)) return 0;
  const c = Math.max(-1, Math.min(1, f));
  const i = Math.trunc(c * 32768);
  if (i >= 0x7fff) return 0x7fff;
  return i;
}

/** Truncate a UTF-8 byte array to at most maxLen bytes without splitting a code point. */
export function utf8Truncate(bytes, maxLen) {
  if (bytes.length <= maxLen) return bytes;
  let len = maxLen;
  // back up while the byte at `len` is a continuation byte (10xxxxxx)
  while (len > 0 && (bytes[len] & 0xc0) === 0x80) len--;
  return bytes.subarray(0, len);
}

function writePosition(view, offset, x, y, screenW, screenH) {
  view.setInt32(offset, Math.round(x) | 0);
  view.setInt32(offset + 4, Math.round(y) | 0);
  view.setUint16(offset + 8, screenW & 0xffff);
  view.setUint16(offset + 10, screenH & 0xffff);
}

function toBigInt64(id) {
  const b = typeof id === 'bigint' ? id : BigInt(Math.trunc(Number(id)));
  return BigInt.asIntN(64, b);
}

/* ------------------------------------------------------------------------------------------ */
/* Serializers                                                                                */
/* ------------------------------------------------------------------------------------------ */

/** INJECT_KEYCODE (14 bytes). */
export function injectKeycode(action, keycode, repeat = 0, metaState = 0) {
  const { buf, view } = msg(14, TYPE.INJECT_KEYCODE);
  view.setUint8(1, action);
  view.setInt32(2, keycode | 0);
  view.setInt32(6, repeat | 0);
  view.setInt32(10, metaState | 0);
  return buf;
}

/** INJECT_TEXT (5 + len). Text is truncated to 300 UTF-8 bytes (code-point safe). */
export function injectText(text) {
  const bytes = utf8Truncate(encoder.encode(String(text ?? '')), INJECT_TEXT_MAX_LENGTH);
  const { buf, view } = msg(5 + bytes.length, TYPE.INJECT_TEXT);
  view.setUint32(1, bytes.length);
  buf.set(bytes, 5);
  return buf;
}

/** INJECT_TOUCH_EVENT (32 bytes). pointerId: BigInt (or number), x/y in video-frame pixels. */
export function injectTouch(action, pointerId, x, y, screenW, screenH, pressure, actionButton = 0, buttons = 0) {
  const { buf, view } = msg(32, TYPE.INJECT_TOUCH_EVENT);
  view.setUint8(1, action);
  view.setBigInt64(2, toBigInt64(pointerId));
  writePosition(view, 10, x, y, screenW, screenH);
  view.setUint16(22, floatToU16fp(pressure));
  view.setInt32(24, actionButton | 0);
  view.setInt32(28, buttons | 0);
  return buf;
}

/**
 * INJECT_SCROLL_EVENT (21 bytes).
 * hScroll / vScroll are in scrcpy client units: one wheel notch = ±1 (accepted range −16..16,
 * normalized by /16 then encoded as i16 fixed point — exactly like the official client).
 * Positive vScroll = scroll up (Android convention).
 */
export function injectScroll(x, y, screenW, screenH, hScroll, vScroll, buttons = 0) {
  const { buf, view } = msg(21, TYPE.INJECT_SCROLL_EVENT);
  writePosition(view, 1, x, y, screenW, screenH);
  view.setInt16(13, floatToI16fp((Number(hScroll) || 0) / 16));
  view.setInt16(15, floatToI16fp((Number(vScroll) || 0) / 16));
  view.setInt32(17, buttons | 0);
  return buf;
}

/** BACK_OR_SCREEN_ON (2 bytes). Send DOWN then UP. */
export function backOrScreenOn(action) {
  const { buf } = msg(2, TYPE.BACK_OR_SCREEN_ON);
  buf[1] = action;
  return buf;
}

export function expandNotificationPanel() { return msg(1, TYPE.EXPAND_NOTIFICATION_PANEL).buf; }
export function expandSettingsPanel() { return msg(1, TYPE.EXPAND_SETTINGS_PANEL).buf; }
export function collapsePanels() { return msg(1, TYPE.COLLAPSE_PANELS).buf; }

/** GET_CLIPBOARD (2 bytes). copyKey: 0 none, 1 COPY, 2 CUT. */
export function getClipboard(copyKey = COPY_KEY.NONE) {
  const { buf } = msg(2, TYPE.GET_CLIPBOARD);
  buf[1] = copyKey;
  return buf;
}

/** SET_CLIPBOARD (14 + len). sequence: BigInt (0n = no ack). */
export function setClipboard(text, paste = false, sequence = 0n) {
  const bytes = utf8Truncate(encoder.encode(String(text ?? '')), CLIPBOARD_TEXT_MAX_LENGTH);
  const { buf, view } = msg(14 + bytes.length, TYPE.SET_CLIPBOARD);
  view.setBigUint64(1, BigInt.asUintN(64, typeof sequence === 'bigint' ? sequence : BigInt(sequence)));
  view.setUint8(9, paste ? 1 : 0);
  view.setUint32(10, bytes.length);
  buf.set(bytes, 14);
  return buf;
}

/** SET_DISPLAY_POWER (2 bytes). false = physical screen off while mirroring continues. */
export function setDisplayPower(on) {
  const { buf } = msg(2, TYPE.SET_DISPLAY_POWER);
  buf[1] = on ? 1 : 0;
  return buf;
}

export function rotateDevice() { return msg(1, TYPE.ROTATE_DEVICE).buf; }
export function openHardKeyboardSettings() { return msg(1, TYPE.OPEN_HARD_KEYBOARD_SETTINGS).buf; }
/** RESET_VIDEO (1 byte): restart capture → new session packet + config + keyframe. */
export function resetVideo() { return msg(1, TYPE.RESET_VIDEO).buf; }

/** Convenience: [DOWN, UP] pair for a key press. */
export function keyPress(keycode, metaState = 0) {
  return [injectKeycode(AKEY.DOWN, keycode, 0, metaState), injectKeycode(AKEY.UP, keycode, 0, metaState)];
}
