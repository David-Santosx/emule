// Emule — default (non-game) input: PC mouse/keyboard → device input (owner: B).
// app.js asks the keymap engine first; whatever it does not consume comes here.

import {
  AKEY, AMETA, KEYCODE, COPY_KEY,
  injectKeycode, injectText, injectScroll, backOrScreenOn,
  setClipboard, getClipboard, expandNotificationPanel,
} from './control.js';

export const MOUSE_ID = 'mouse';
/** Min interval between drag moves sent to the device (raw mouse events can arrive at 1 kHz). */
const DRAG_MIN_INTERVAL_MS = 4;

/** KeyboardEvent.code → Android keycode for non-text keys. */
const SPECIAL_KEYS = {
  Enter: KEYCODE.ENTER, NumpadEnter: KEYCODE.ENTER,
  Backspace: KEYCODE.DEL, Delete: KEYCODE.FORWARD_DEL,
  ArrowUp: KEYCODE.DPAD_UP, ArrowDown: KEYCODE.DPAD_DOWN,
  ArrowLeft: KEYCODE.DPAD_LEFT, ArrowRight: KEYCODE.DPAD_RIGHT,
  Tab: KEYCODE.TAB, Escape: KEYCODE.BACK,
  Home: KEYCODE.MOVE_HOME, End: KEYCODE.MOVE_END,
  PageUp: KEYCODE.PAGE_UP, PageDown: KEYCODE.PAGE_DOWN,
  AudioVolumeUp: KEYCODE.VOLUME_UP, AudioVolumeDown: KEYCODE.VOLUME_DOWN, AudioVolumeMute: KEYCODE.VOLUME_MUTE,
};

/** Wheel delta (any deltaMode) → scrcpy scroll units (1 = one notch), clamped to ±16. */
export function wheelToNotches(delta, deltaMode) {
  const perNotch = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 : 100; // pixels / lines / pages
  const v = delta / perNotch;
  return Math.max(-16, Math.min(16, v));
}

/** Map a client point to normalized video coords; null when outside the displayed rect. */
export function clientToNormalized(rect, clientX, clientY, clampInside = false) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  let nx = (clientX - rect.left) / rect.width;
  let ny = (clientY - rect.top) / rect.height;
  if (clampInside) return { nx: Math.min(1, Math.max(0, nx)), ny: Math.min(1, Math.max(0, ny)) };
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null;
  return { nx, ny };
}

export class InputHandler {
  /**
   * @param {object} o
   * @param {import('./touch.js').TouchManager} o.touch
   * @param {(bytes: Uint8Array) => void} o.send
   * @param {() => DOMRect} o.getVideoRect displayed (letterboxed) video rect in client coords
   * @param {() => {width:number,height:number}} o.getFrameSize
   * @param {() => boolean} [o.isLookActive]
   * @param {(msg: string) => void} [o.notify]
   */
  constructor({ touch, send, getVideoRect, getFrameSize, isLookActive, notify }) {
    this.touch = touch;
    this.send = send;
    this.getVideoRect = getVideoRect;
    this.getFrameSize = getFrameSize;
    this.isLookActive = isLookActive || (() => false);
    this.notify = notify || (() => {});
    this._dragging = false;
    this._buttonsDown = new Set();   // non-primary mouse buttons we sent a DOWN for
    this._keysDown = new Map();      // code → {keycode, meta, repeat}
    this._lastPointerLockExit = 0;
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) this._lastPointerLockExit = performance.now();
    });
  }

  get dragging() { return this._dragging; }

  /** @returns {boolean} true if the event was handled (and default prevented) */
  handle(e) {
    switch (e.type) {
      case 'mousedown': return this._mouseDown(e);
      case 'mousemove':
      case 'pointerrawupdate': return this._mouseMove(e);
      case 'mouseup': return this._mouseUp(e);
      case 'wheel': return this._wheel(e);
      case 'contextmenu': case 'auxclick':
        if (this._inside(e)) { e.preventDefault(); return true; }
        return false;
      case 'keydown': return this._keyDown(e);
      case 'keyup': return this._keyUp(e);
      default: return false;
    }
  }

  /** Lift the mouse finger and every held key (window blur / disconnect). */
  releaseAll() {
    if (this._dragging) { this.touch.up(MOUSE_ID); this._dragging = false; }
    for (const b of this._buttonsDown) this._buttonAction(b, AKEY.UP);
    this._buttonsDown.clear();
    for (const k of this._keysDown.values()) this.send(injectKeycode(AKEY.UP, k.keycode, 0, k.meta));
    this._keysDown.clear();
  }

  /** Forget state without sending (session gone). */
  reset() {
    this._dragging = false;
    this._buttonsDown.clear();
    this._keysDown.clear();
  }

  _inside(e) {
    return clientToNormalized(this.getVideoRect(), e.clientX, e.clientY) !== null;
  }

  /* ---------------------------------- mouse ---------------------------------- */

  _buttonAction(button, action) {
    switch (button) {
      case 1: this.send(injectKeycode(action, KEYCODE.HOME)); break;          // middle → HOME
      case 2: this.send(backOrScreenOn(action)); break;                       // right → BACK (or screen on)
      case 3: this.send(injectKeycode(action, KEYCODE.APP_SWITCH)); break;    // side 1 → Recentes
      case 4: if (action === AKEY.DOWN) this.send(expandNotificationPanel()); break; // side 2 → Notificações
      default: break;
    }
  }

  _mouseDown(e) {
    if (document.pointerLockElement) return false; // look mode belongs to the keymap
    const p = clientToNormalized(this.getVideoRect(), e.clientX, e.clientY);
    if (!p) return false;
    e.preventDefault();
    if (e.button === 0) {
      this.touch.down(MOUSE_ID, p.nx, p.ny);
      this._dragging = this.touch.isDown(MOUSE_ID);
    } else if (!this._buttonsDown.has(e.button)) {
      this._buttonsDown.add(e.button);
      this._buttonAction(e.button, AKEY.DOWN);
    }
    return true;
  }

  _mouseMove(e) {
    if (!this._dragging) return false;
    if (!(e.buttons & 1)) { // released outside the window
      this.touch.up(MOUSE_ID);
      this._dragging = false;
      return true;
    }
    const p = clientToNormalized(this.getVideoRect(), e.clientX, e.clientY, true);
    if (p) this._dragTo(p.nx, p.ny);
    e.preventDefault();
    return true;
  }

  /** Rate-limited drag move (≤ 1 move / DRAG_MIN_INTERVAL_MS, the latest position always wins). */
  _dragTo(nx, ny) {
    const now = performance.now();
    const wait = (this._lastDragSend || 0) + DRAG_MIN_INTERVAL_MS - now;
    if (wait <= 0) {
      this._lastDragSend = now;
      this._pendingDrag = null;
      this.touch.move(MOUSE_ID, nx, ny);
      return;
    }
    this._pendingDrag = { nx, ny };
    if (!this._dragTimer) {
      this._dragTimer = setTimeout(() => {
        this._dragTimer = null;
        const d = this._pendingDrag;
        if (d && this._dragging) this._dragTo(d.nx, d.ny);
      }, wait);
    }
  }

  _mouseUp(e) {
    if (e.button === 0) {
      if (!this._dragging) return false;
      const p = clientToNormalized(this.getVideoRect(), e.clientX, e.clientY, true);
      if (p) this.touch.move(MOUSE_ID, p.nx, p.ny);
      this.touch.up(MOUSE_ID);
      this._dragging = false;
      return true;
    }
    if (this._buttonsDown.delete(e.button)) {
      this._buttonAction(e.button, AKEY.UP);
      e.preventDefault();
      return true;
    }
    return false;
  }

  _wheel(e) {
    if (document.pointerLockElement) return false;
    const p = clientToNormalized(this.getVideoRect(), e.clientX, e.clientY);
    if (!p) return false;
    e.preventDefault();
    const fs = this.getFrameSize();
    if (!(fs.width > 0 && fs.height > 0)) return true;
    const h = wheelToNotches(e.deltaX, e.deltaMode);
    const v = -wheelToNotches(e.deltaY, e.deltaMode);
    if (h === 0 && v === 0) return true;
    const x = Math.min(fs.width - 1, Math.round(p.nx * fs.width));
    const y = Math.min(fs.height - 1, Math.round(p.ny * fs.height));
    this.send(injectScroll(x, y, fs.width, fs.height, h, v));
    return true;
  }

  /* --------------------------------- keyboard -------------------------------- */

  _keyDown(e) {
    const altGr = typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');
    const ctrl = e.ctrlKey && !altGr;
    const alt = e.altKey && !altGr;

    if (ctrl && !alt && !e.metaKey) {
      switch (e.code) {
        case 'KeyV':
          e.preventDefault();
          if (!e.repeat) this._paste();
          return true;
        case 'KeyC':
          e.preventDefault();
          if (!e.repeat) this.send(getClipboard(COPY_KEY.COPY)); // reply arrives as a CLIPBOARD device msg
          return true;
        case 'KeyX':
          e.preventDefault();
          if (!e.repeat) this.send(getClipboard(COPY_KEY.CUT));
          return true;
        default: break;
      }
    }

    const special = SPECIAL_KEYS[e.code];
    if (special !== undefined) {
      if (e.code === 'Escape' && (this.isLookActive() || document.pointerLockElement
          || performance.now() - this._lastPointerLockExit < 400)) {
        return false; // Esc leaves look mode; never also send BACK
      }
      e.preventDefault();
      const meta = this._meta(e, ctrl, alt);
      const prev = this._keysDown.get(e.code);
      const repeat = prev ? prev.repeat + 1 : 0;
      this._keysDown.set(e.code, { keycode: special, meta, repeat });
      this.send(injectKeycode(AKEY.DOWN, special, repeat, meta));
      return true;
    }

    // Ctrl/Alt + letter → keycode with meta state (Ctrl+A = selecionar tudo, Ctrl+Z, ...)
    if ((ctrl || alt) && /^Key[A-Z]$/.test(e.code)) {
      e.preventDefault();
      const keycode = KEYCODE.A + (e.code.charCodeAt(3) - 65);
      const meta = this._meta(e, ctrl, alt);
      const prev = this._keysDown.get(e.code);
      const repeat = prev ? prev.repeat + 1 : 0;
      this._keysDown.set(e.code, { keycode, meta, repeat });
      this.send(injectKeycode(AKEY.DOWN, keycode, repeat, meta));
      return true;
    }

    // printable characters (incl. AltGr combos and dead-key compositions) → text
    if (e.key && e.key.length === 1 && !ctrl && !alt && !e.metaKey) {
      e.preventDefault();
      this.send(injectText(e.key));
      return true;
    }
    return false;
  }

  _keyUp(e) {
    const k = this._keysDown.get(e.code);
    if (!k) return false;
    this._keysDown.delete(e.code);
    e.preventDefault();
    this.send(injectKeycode(AKEY.UP, k.keycode, 0, k.meta));
    return true;
  }

  _meta(e, ctrl, alt) {
    let m = 0;
    if (e.shiftKey) m |= AMETA.SHIFT_ON | AMETA.SHIFT_LEFT_ON;
    if (ctrl) m |= AMETA.CTRL_ON | AMETA.CTRL_LEFT_ON;
    if (alt) m |= AMETA.ALT_ON;
    return m;
  }

  async _paste() {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      console.warn('[input] leitura da área de transferência falhou', err);
    }
    if (text) this.send(setClipboard(text, true));
    else this.notify('Área de transferência do PC vazia');
  }
}
