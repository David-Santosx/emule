// Emule — TouchManager (owner: B). The ONLY way anything injects touches.
// Maps caller string ids ('mouse', 'km:<controlId>', 'km:look', ...) to distinct device finger
// ids 0..9 (BigInt). All fingers (mouse + keymap) combine as real multi-touch on the device;
// the server does the POINTER_DOWN/POINTER_UP bookkeeping, we only send DOWN / MOVE / UP.

import { AMOTION, injectTouch } from './control.js';

export const MAX_POINTERS = 10; // server-side MAX_POINTERS

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN → 0

export class TouchManager {
  /**
   * @param {(bytes: Uint8Array) => void} sendControl
   * @param {() => {width: number, height: number}} getFrameSize latest SESSION size (VideoPlayer.frameSize)
   */
  constructor(sendControl, getFrameSize) {
    this._send = sendControl;
    this._getFrameSize = getFrameSize;
    /** @type {Map<string, {pid: bigint, nx: number, ny: number}>} */
    this._active = new Map();
  }

  /** Device pixel position for normalized coords, using the latest frame size. */
  _toPixels(nx, ny) {
    const s = this._getFrameSize() || {};
    const w = s.width | 0;
    const h = s.height | 0;
    if (w <= 0 || h <= 0) return null;
    return {
      x: Math.min(w - 1, Math.round(clamp01(nx) * w)),
      y: Math.min(h - 1, Math.round(clamp01(ny) * h)),
      w,
      h,
    };
  }

  _emit(action, pid, nx, ny, pressure) {
    const p = this._toPixels(nx, ny);
    if (!p) return false;
    this._send(injectTouch(action, pid, p.x, p.y, p.w, p.h, pressure));
    return true;
  }

  /** Lowest finger id 0..9 not currently down, or -1. */
  _allocPid() {
    const used = new Set();
    for (const t of this._active.values()) used.add(t.pid);
    for (let i = 0n; i < BigInt(MAX_POINTERS); i++) if (!used.has(i)) return i;
    return -1n;
  }

  down(id, nx, ny) {
    nx = clamp01(nx); ny = clamp01(ny);
    const cur = this._active.get(id);
    if (cur) { this.move(id, nx, ny); return; }
    const pid = this._allocPid();
    if (pid < 0n) return; // 10 fingers already down: drop (server would drop it too)
    if (!this._toPixels(nx, ny)) return; // no frame yet
    this._active.set(id, { pid, nx, ny });
    this._emit(AMOTION.DOWN, pid, nx, ny, 1.0);
  }

  move(id, nx, ny) {
    const cur = this._active.get(id);
    if (!cur) return;
    nx = clamp01(nx); ny = clamp01(ny);
    cur.nx = nx; cur.ny = ny;
    this._emit(AMOTION.MOVE, cur.pid, nx, ny, 1.0);
  }

  up(id) {
    const cur = this._active.get(id);
    if (!cur) return;
    this._active.delete(id);
    this._emit(AMOTION.UP, cur.pid, cur.nx, cur.ny, 0);
  }

  isDown(id) { return this._active.has(id); }

  /** Number of fingers currently down. */
  get activeCount() { return this._active.size; }

  /** Lifts every active pointer (blur, profile change, disconnect). */
  releaseAll() {
    for (const id of [...this._active.keys()]) this.up(id);
  }

  /** Forget every pointer WITHOUT sending anything (session already gone). */
  reset() { this._active.clear(); }
}
