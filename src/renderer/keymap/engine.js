// Emule — keymap engine (owner: C)
// Translates keyboard / mouse events into touches through the injected TouchManager.
// Pure helpers (exported) are DOM-free so they can be unit-tested with `node --test`.

/* ------------------------------------------------------------------------------------------ */
/* Tunables                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export const KM_DEFAULTS = Object.freeze({
  /** Joystick deflection without sprint key (fraction of radius). With sprint key: 1.0. */
  joystickWalk: 0.75,
  /** Joystick smoothing: fractions of the way to the target applied at t=0, t=joyStepMs, ... */
  joySteps: [0.6, 1],
  joyStepMs: 10,
  /** Mouse-look: a mouse delta of N px moves the finger N/lookRefPx frame-heights (× sensitivity). */
  lookRefPx: 1080,
  /** Re-center the look finger when it is farther than this from the anchor (frame-height units). */
  // Large on purpose: every re-center is a lift + new touch, which games handle as a new drag
  // (the delta of that frame is lost). Fewer re-centers = smoother, more precise camera.
  lookRecenter: 0.42,
  /** Min interval between look-finger moves sent to the device (mouse deltas are accumulated). */
  lookMinIntervalMs: 4,
  /** After a re-center, wait this long (accumulating mouse movement) so the game registers the
   *  new touch before it starts moving — otherwise the first movement after it is swallowed. */
  lookSettleMs: 14,
  /** ...or when it gets closer than this to any frame edge (normalized). */
  lookEdge: 0.03,
  /** Hold time of a tap triggered by a wheel tick, and gap between queued ticks. */
  wheelTapMs: 30,
  wheelGapMs: 20,
  /** Max wheel ticks queued per control while a previous tick is still being tapped. */
  wheelMaxQueue: 4,
  /** Hold time of each tap of a macro (multitap). */
  multitapHoldMs: 30,
  /** Interval between interpolated moves of a swipe. */
  swipeStepMs: 8,
});

const DIRS = ['up', 'down', 'left', 'right'];
const TOUCH_PREFIX = 'km:';

/* ------------------------------------------------------------------------------------------ */
/* Pure helpers                                                                               */
/* ------------------------------------------------------------------------------------------ */

export function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const round4 = (v) => Math.round(v * 10000) / 10000;
const coord = (v, d = 0.5) => round4(clamp(num(v, d), 0, 1));

const KEY_LABELS = {
  Space: 'Espaço', Enter: 'Enter', NumpadEnter: 'Num Enter', Tab: 'Tab', Escape: 'Esc',
  Backspace: 'Backspace', CapsLock: 'Caps Lock',
  ShiftLeft: 'Shift', ShiftRight: 'Shift Dir.', ControlLeft: 'Ctrl', ControlRight: 'Ctrl Dir.',
  AltLeft: 'Alt', AltRight: 'AltGr', MetaLeft: 'Win', MetaRight: 'Win Dir.', ContextMenu: 'Menu',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Insert: 'Insert', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  // ABNT2 (pt-BR) physical layout labels
  Backquote: "'", Minus: '-', Equal: '=', BracketLeft: '´', BracketRight: '[', Backslash: ']',
  Semicolon: 'Ç', Quote: '~', Comma: ',', Period: '.', Slash: ';', IntlRo: '/', IntlBackslash: '\\',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
  NumpadDecimal: 'Num ,', NumpadComma: 'Num .',
  Mouse0: 'Botão Esq.', Mouse1: 'Botão Meio', Mouse2: 'Botão Dir.',
  Mouse3: 'Botão Lateral 1', Mouse4: 'Botão Lateral 2',
  WheelUp: 'Roda ↑', WheelDown: 'Roda ↓',
};

/** Friendly pt-BR label for a KeyboardEvent.code / 'MouseN' / 'WheelUp|Down'. */
export function formatKeyLabel(code) {
  if (!code) return '—';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return 'Num ' + m[1];
  if ((m = /^F(\d{1,2})$/.exec(code))) return 'F' + m[1];
  if ((m = /^Mouse(\d+)$/.exec(code))) return 'Botão ' + (Number(m[1]) + 1);
  return code;
}

/** Maps a DOM event to a binding key string, or null. */
export function eventToKey(e) {
  switch (e.type) {
    case 'keydown': case 'keyup': return e.code || null;
    case 'mousedown': case 'mouseup': case 'auxclick': case 'contextmenu':
      return typeof e.button === 'number' ? 'Mouse' + e.button : null;
    case 'wheel': {
      const d = e.deltaY || 0;
      if (d < 0) return 'WheelUp';
      if (d > 0) return 'WheelDown';
      return null;
    }
    default: return null;
  }
}

/**
 * Joystick direction vector. `dirs` = {up,down,left,right} booleans.
 * Opposing keys cancel; diagonals are normalized; result length = magnitude (or 0).
 * y grows downward (screen coords).
 */
export function joystickVector(dirs, magnitude = 1) {
  const x = (dirs.right ? 1 : 0) - (dirs.left ? 1 : 0);
  const y = (dirs.down ? 1 : 0) - (dirs.up ? 1 : 0);
  const len = Math.hypot(x, y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: (x / len) * magnitude, y: (y / len) * magnitude };
}

/**
 * Position of the joystick finger for the given directions.
 * radius is in frame-height units; aspect = frameWidth / frameHeight.
 */
export function joystickTarget(control, dirs, sprint, aspect, walk = KM_DEFAULTS.joystickWalk) {
  const v = joystickVector(dirs, sprint ? 1 : walk);
  const r = control.radius;
  return {
    x: clamp(control.x + (v.x * r) / aspect, 0, 1),
    y: clamp(control.y + v.y * r, 0, 1),
  };
}

/**
 * One mouse-look step (pure).
 * @param {{x,y}} anchor  look anchor (normalized)
 * @param {{x,y}} cur     current finger position (normalized)
 * @param {number} mx,my  mouse movement in px (movementX/Y)
 * @param {{sensitivityX:number, sensitivityY:number, invertY:boolean}} control
 *        (legacy `sensitivity` is accepted as both axes)
 * @param {number} aspect frameWidth / frameHeight
 * @returns {{x,y,recenter:boolean}} new finger position; if recenter, the caller must lift
 *          the finger, press again at the anchor and then move to (x,y).
 */
export function lookStep(anchor, cur, mx, my, control, aspect, opts = KM_DEFAULTS) {
  const legacy = num(control.sensitivity, 1);
  const sx = num(control.sensitivityX, legacy);
  const sy = num(control.sensitivityY, legacy);
  // deltas in frame-height units
  let dh = (num(mx, 0) * sx) / opts.lookRefPx;
  let dv = ((control.invertY ? -1 : 1) * num(my, 0) * sy) / opts.lookRefPx;
  const nx = cur.x + dh / aspect;
  const ny = cur.y + dv;
  const off = Math.hypot((nx - anchor.x) * aspect, ny - anchor.y);
  const e = opts.lookEdge;
  if (off > opts.lookRecenter || nx < e || nx > 1 - e || ny < e || ny > 1 - e) {
    // Re-press at the anchor and apply this step's delta from there (clamped so a huge flick
    // can't immediately overshoot again).
    const maxStep = opts.lookRecenter / 2;
    const m = Math.hypot(dh, dv);
    if (m > maxStep) { dh *= maxStep / m; dv *= maxStep / m; }
    return {
      x: clamp(anchor.x + dh / aspect, 0, 1),
      y: clamp(anchor.y + dv, 0, 1),
      recenter: true,
    };
  }
  return { x: nx, y: ny, recenter: false };
}

/** List of {key, role} bindings of a control (role: 'key' | 'up'|'down'|'left'|'right' | 'sprint'). */
export function controlBindings(c) {
  const out = [];
  if (c.type === 'joystick') {
    for (const d of DIRS) if (c.keys && c.keys[d]) out.push({ key: c.keys[d], role: d });
    if (c.sprintKey) out.push({ key: c.sprintKey, role: 'sprint' });
  } else if (c.type === 'tap' || c.type === 'swipe' || c.type === 'multitap') {
    if (c.key) out.push({ key: c.key, role: 'key' });
  }
  return out;
}

/**
 * Returns a clean deep copy of a profile with only known fields, defaults applied and values
 * clamped. Controls with unknown types are dropped. Missing/duplicate ids get a new id;
 * with { assignIds: true } every control gets a fresh id.
 */
export function normalizeProfile(p, { assignIds = false } = {}) {
  const src = p && typeof p === 'object' ? p : {};
  const seen = new Set();
  const controls = [];
  for (const c of Array.isArray(src.controls) ? src.controls : []) {
    if (!c || typeof c !== 'object') continue;
    let id = !assignIds && typeof c.id === 'string' && c.id ? c.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    const key = typeof c.key === 'string' && c.key ? c.key : null;
    switch (c.type) {
      case 'tap': {
        const o = { id, type: 'tap', key, x: coord(c.x), y: coord(c.y) };
        if (c.lookOnly) o.lookOnly = true;
        controls.push(o);
        break;
      }
      case 'joystick': {
        const k = c.keys || {};
        const keys = {};
        for (const d of DIRS) keys[d] = typeof k[d] === 'string' && k[d] ? k[d] : null;
        const o = {
          id, type: 'joystick', keys, x: coord(c.x, 0.17), y: coord(c.y, 0.7),
          radius: round4(clamp(num(c.radius, 0.12), 0.02, 0.5)),
        };
        if (typeof c.sprintKey === 'string' && c.sprintKey) o.sprintKey = c.sprintKey;
        controls.push(o);
        break;
      }
      case 'look': {
        const legacy = num(c.sensitivity, 1);
        controls.push({
          id, type: 'look', x: coord(c.x, 0.65), y: coord(c.y, 0.45),
          sensitivityX: round4(clamp(num(c.sensitivityX, legacy), 0.05, 10)),
          sensitivityY: round4(clamp(num(c.sensitivityY, legacy), 0.05, 10)),
          invertY: !!c.invertY,
          smoothing: round4(clamp(num(c.smoothing, 0), 0, 0.9)),
        });
        break;
      }
      case 'swipe':
        controls.push({
          id, type: 'swipe', key, x: coord(c.x), y: coord(c.y, 0.7),
          x2: coord(c.x2), y2: coord(c.y2, 0.4),
          durationMs: Math.round(clamp(num(c.durationMs, 120), 16, 3000)),
        });
        break;
      case 'multitap': {
        const pts = (Array.isArray(c.points) ? c.points : [])
          .filter((pt) => pt && typeof pt === 'object')
          .map((pt, i) => ({
            x: coord(pt.x), y: coord(pt.y),
            delayMs: Math.round(clamp(num(pt.delayMs, i === 0 ? 0 : 60), 0, 10000)),
          }));
        if (pts.length === 0) pts.push({ x: 0.5, y: 0.5, delayMs: 0 });
        controls.push({ id, type: 'multitap', key, points: pts });
        break;
      }
      default: break; // unknown type → dropped
    }
  }
  return {
    version: 1,
    name: typeof src.name === 'string' ? src.name.trim() : '',
    lookToggleKey: typeof src.lookToggleKey === 'string' && src.lookToggleKey ? src.lookToggleKey : null,
    lookToggleMode: src.lookToggleMode === 'hold' ? 'hold' : 'toggle',
    controls,
  };
}

const TYPE_NAMES = { tap: 'Toque', joystick: 'Joystick', look: 'Mira', swipe: 'Deslizar', multitap: 'Macro' };
export function controlTypeName(type) { return TYPE_NAMES[type] || type; }

/**
 * Validates a (normalized) profile.
 * The same key MAY be bound to several controls (all of them fire together) — that is not an
 * error; `keyUsage` reports, per key, how many distinct controls use it (for UI badges).
 * @returns {{ ok:boolean, errors:string[], conflictIds:Set<string>, keyUsage:Map<string,number> }}
 * conflictIds contains control ids involved in errors ('__lookToggle' for the toggle key).
 */
export function validateProfile(p) {
  const errors = [];
  const conflictIds = new Set();
  const keyUsage = new Map();
  if (!p || typeof p !== 'object') return { ok: false, errors: ['Perfil inválido.'], conflictIds, keyUsage };
  const controls = Array.isArray(p.controls) ? p.controls : [];

  if (!p.name || !String(p.name).trim()) errors.push('Informe um nome para o perfil.');

  const looks = controls.filter((c) => c.type === 'look');
  if (looks.length > 1) {
    errors.push('Apenas uma Mira é permitida por perfil.');
    looks.forEach((c) => conflictIds.add(c.id));
  }
  if (looks.length > 0 && !p.lookToggleKey) {
    errors.push('Defina a tecla que liga/desliga o modo mira.');
    conflictIds.add('__lookToggle');
  }
  if (p.lookToggleKey === 'Escape') {
    errors.push('Esc não pode ser usado como tecla da mira (o navegador o usa para sair da mira).');
    conflictIds.add('__lookToggle');
  }

  const uses = new Map(); // key -> Set(controlId)
  const addUse = (key, id) => {
    if (!uses.has(key)) uses.set(key, new Set());
    uses.get(key).add(id);
  };
  for (const c of controls) {
    if (c.type === 'joystick') {
      const missing = DIRS.filter((d) => !c.keys || !c.keys[d]);
      if (missing.length) {
        errors.push('Joystick sem todas as 4 teclas de direção definidas.');
        conflictIds.add(c.id);
      }
      const dk = DIRS.map((d) => c.keys && c.keys[d]).filter(Boolean);
      if (new Set(dk).size !== dk.length) {
        errors.push('Joystick com a mesma tecla em duas direções.');
        conflictIds.add(c.id);
      }
    } else if (c.type !== 'look' && !c.key) {
      errors.push(`${controlTypeName(c.type)} sem tecla definida.`);
      conflictIds.add(c.id);
    }
    if (c.type === 'multitap' && (!c.points || c.points.length === 0)) {
      errors.push('Macro sem pontos.');
      conflictIds.add(c.id);
    }
    for (const b of controlBindings(c)) addUse(b.key, c.id);
  }
  if (looks.length > 0 && p.lookToggleKey) addUse(p.lookToggleKey, '__lookToggle');
  for (const [key, set] of uses) keyUsage.set(key, set.size);
  return { ok: errors.length === 0, errors, conflictIds, keyUsage };
}

/* ------------------------------------------------------------------------------------------ */
/* Engine                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const realTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

/** Default pointer-lock adapter over the DOM (raw/unadjusted mouse movement when available). */
function domPointerLock(el) {
  if (!el || typeof el.requestPointerLock !== 'function') return null;
  const doc = el.ownerDocument;
  return {
    isLocked: () => doc.pointerLockElement === el,
    exit: () => { if (doc.pointerLockElement === el) doc.exitPointerLock(); },
    request(onFail) {
      let p;
      try { p = el.requestPointerLock({ unadjustedMovement: true }); } catch { p = undefined; }
      if (p && typeof p.then === 'function') {
        // Unadjusted (raw) movement not supported → retry with a plain lock.
        p.catch(() => {
          let q;
          try { q = el.requestPointerLock(); } catch (err) { onFail(err); return; }
          if (q && typeof q.then === 'function') q.catch(onFail);
        });
      } else {
        // Legacy non-promise API: failure arrives as a 'pointerlockerror' event.
        const onErr = () => { doc.removeEventListener('pointerlockerror', onErr); onFail(); };
        doc.addEventListener('pointerlockerror', onErr);
        setTimeout(() => doc.removeEventListener('pointerlockerror', onErr), 2000);
      }
    },
    listen(cb) {
      doc.addEventListener('pointerlockchange', cb);
      return () => doc.removeEventListener('pointerlockchange', cb);
    },
  };
}

export class KeymapEngine {
  /**
   * @param {object} o
   * @param {object} o.touch           TouchManager
   * @param {HTMLElement} [o.videoElement] canvas (pointer lock target; width/height = frame size fallback)
   * @param {HTMLElement} [o.overlay]  element covering the visible video rect (hints)
   * @param {() => {width,height}} [o.getFrameSize] optional, preferred source of frame aspect
   * @param {object} [o.pointerLock]   test hook: {request(onFail), exit(), isLocked(), listen(cb)}
   * @param {object} [o.timers]        test hook: {setTimeout, clearTimeout}
   * @param {object} [o.options]       overrides of KM_DEFAULTS
   */
  constructor({ touch, videoElement = null, overlay = null, getFrameSize = null, pointerLock, timers, options } = {}) {
    if (!touch) throw new Error('KeymapEngine: touch é obrigatório');
    this._touch = touch;
    this._video = videoElement;
    this._overlay = overlay;
    this._getFrameSize = getFrameSize;
    this._timers = timers || realTimers;
    this._opt = { ...KM_DEFAULTS, ...(options || {}) };
    this._lock = pointerLock !== undefined ? pointerLock : domPointerLock(videoElement);
    this._unlisten = this._lock && this._lock.listen ? this._lock.listen(() => this._onPointerLockChange()) : null;

    this._enabled = true;
    this._profile = null;
    this._bindings = new Map();   // key -> [{control, role}]
    this._lookControl = null;
    this._lookActive = false;
    this._wantLook = false;
    this._lookPos = null;
    this._smooth = { x: 0, y: 0 };
    this._lockless = false;
    this._now = (timers && typeof timers.now === 'function') ? timers.now
      : () => (globalThis.performance ? globalThis.performance.now() : Date.now());
    this._resetLookFlow();

    this._pressed = new Map();    // key -> [binding] activated by that key press
    this._active = new Set();     // touch ids currently down (ours)
    this._pending = new Set();    // timer handles
    this._joy = new Map();        // controlId -> joystick state
    this._pulses = new Map();     // binding -> timer (wheel taps)
    this._swipes = new Set();     // control ids with a running swipe

    this._listeners = new Set();
    this._hintsVisible = true;
    this._hintsEl = null;
    this._bannerEl = null;
  }

  /* ---------------- public API ---------------- */

  get profile() { return this._profile; }
  get enabled() { return this._enabled; }
  get lookActive() { return this._lookActive; }

  setProfile(profile) {
    this.releaseAll();
    this._profile = profile ? normalizeProfile(profile) : null;
    this._buildBindings();
    this._renderHints();
    this._emit();
  }

  setEnabled(on) {
    on = !!on;
    if (on === this._enabled) return;
    if (!on) this.releaseAll();
    this._enabled = on;
    this._renderHints();
    this._emit();
  }

  setHintsVisible(on) {
    this._hintsVisible = !!on;
    this._renderHints();
  }

  onStateChange(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  /** Lifts every keymap touch, cancels timers and leaves look mode. Never touches non-km ids. */
  releaseAll() {
    for (const h of this._pending) this._timers.clearTimeout(h);
    this._pending.clear();
    this._pulses.clear();
    this._swipes.clear();
    for (const st of this._joy.values()) {
      st.timer = null; st.down = false; st.sprint = false;
      for (const d of DIRS) st.dirs[d] = false;
    }
    this._pressed.clear();
    for (const id of [...this._active]) this._up(id);
    const wasLook = this._lookActive || this._wantLook;
    this._wantLook = false;
    if (this._lookActive) this._setLook(false, { silent: true });
    if (wasLook && this._lock) { try { this._lock.exit(); } catch { /* ignore */ } }
    if (wasLook) this._emit();
  }

  /** Detach listeners / DOM (optional, for teardown). */
  destroy() {
    this.releaseAll();
    if (this._unlisten) this._unlisten();
    this._hintsEl?.remove();
    this._bannerEl?.remove();
    this._listeners.clear();
  }

  /**
   * @returns {boolean} true when the event was consumed (preventDefault already called).
   */
  handleEvent(e) {
    if (!this._enabled || !this._profile || !e) return false;
    switch (e.type) {
      case 'keydown': return this._consume(e, this._keyDown(e.code, e.repeat));
      case 'keyup': return this._consume(e, this._keyUp(e.code));
      case 'mousedown': {
        const r = this._keyDown(eventToKey(e), false);
        return this._consume(e, r || this._lookActive);
      }
      case 'mouseup': {
        const r = this._keyUp(eventToKey(e));
        return this._consume(e, r || this._lookActive);
      }
      case 'mousemove':
      case 'pointerrawupdate':   // high-rate raw mouse events (app.js feeds one of the two)
        if (!this._lookActive) return false;
        this._lookMove(e.movementX || 0, e.movementY || 0);
        return this._consume(e, true);
      case 'wheel': {
        const key = eventToKey(e);
        const r = key ? this._wheel(key) : false;
        return this._consume(e, r || this._lookActive);
      }
      case 'contextmenu': case 'auxclick': case 'click': {
        // Swallow the follow-up events of a consumed mouse button.
        const key = eventToKey(e);
        const bound = this._lookActive || (key && this._activeBindings(key).length > 0);
        return this._consume(e, !!bound);
      }
      default: return false;
    }
  }

  /* ---------------- internals: events ---------------- */

  _consume(e, consumed) {
    if (consumed && typeof e.preventDefault === 'function') e.preventDefault();
    return !!consumed;
  }

  _activeBindings(key) {
    const binds = this._bindings.get(key);
    if (!binds) return [];
    return binds.filter((b) => !(b.control.type === 'tap' && b.control.lookOnly && !this._lookActive));
  }

  _keyDown(key, repeat) {
    if (!key) return false;
    if (this._pressed.has(key)) return true;   // auto-repeat or missed keyup: swallow
    if (repeat) return false;                   // repeat of a key we did not consume
    const active = this._activeBindings(key);
    if (active.length === 0) return false;
    this._pressed.set(key, active);
    for (const b of active) this._activate(b);
    return true;
  }

  _keyUp(key) {
    if (!key || !this._pressed.has(key)) return false; // keyup without our keydown → ignore
    const list = this._pressed.get(key);
    this._pressed.delete(key);
    for (const b of list) this._deactivate(b);
    return true;
  }

  /** Each wheel tick = one quick tap (down, up wheelTapMs later). Fast ticks are queued. */
  _wheel(key) {
    const active = this._activeBindings(key);
    if (active.length === 0) return false;
    for (const b of active) {
      if (b.role === 'lookToggle') { this._toggleLook(); continue; } // wheel always toggles
      const st = this._pulses.get(b);
      if (st) { if (st.queued < this._opt.wheelMaxQueue) st.queued++; continue; }
      this._pulse(b, { queued: 0 });
    }
    return true;
  }

  _pulse(b, st) {
    this._pulses.set(b, st);
    this._activate(b);
    this._later(() => {
      this._deactivate(b);
      if (st.queued > 0) {
        st.queued--;
        this._later(() => this._pulse(b, st), this._opt.wheelGapMs);
      } else {
        this._pulses.delete(b);
      }
    }, this._opt.wheelTapMs);
  }

  _activate(b) {
    const c = b.control;
    switch (b.role) {
      case 'lookToggle':
        if (this._lookMode() === 'hold') this._enterLook();
        else this._toggleLook();
        break;
      case 'key':
        if (c.type === 'tap') this._down(TOUCH_PREFIX + c.id, c.x, c.y);
        else if (c.type === 'swipe') this._startSwipe(c);
        else if (c.type === 'multitap') this._startMultitap(c);
        break;
      case 'sprint': { const st = this._joy.get(c.id); st.sprint = true; this._updateJoy(st); break; }
      default: { const st = this._joy.get(c.id); st.dirs[b.role] = true; this._updateJoy(st); }
    }
  }

  _deactivate(b) {
    const c = b.control;
    switch (b.role) {
      case 'lookToggle': if (this._lookMode() === 'hold') this._exitLook(); break;
      case 'key': if (c.type === 'tap') this._up(TOUCH_PREFIX + c.id); break;
      case 'sprint': { const st = this._joy.get(c.id); st.sprint = false; this._updateJoy(st); break; }
      default: { const st = this._joy.get(c.id); st.dirs[b.role] = false; this._updateJoy(st); }
    }
  }

  _buildBindings() {
    this._bindings.clear();
    this._joy.clear();
    this._lookControl = null;
    const p = this._profile;
    if (!p) return;
    const add = (key, control, role) => {
      if (!key) return;
      if (!this._bindings.has(key)) this._bindings.set(key, []);
      this._bindings.get(key).push({ control, role });
    };
    for (const c of p.controls) {
      if (c.type === 'look') { if (!this._lookControl) this._lookControl = c; continue; }
      if (c.type === 'joystick') {
        this._joy.set(c.id, {
          control: c, tid: TOUCH_PREFIX + c.id, dirs: { up: false, down: false, left: false, right: false },
          sprint: false, down: false, cur: { x: c.x, y: c.y }, timer: null,
        });
      }
      for (const b of controlBindings(c)) add(b.key, c, b.role);
    }
    // Without a look control the toggle key does nothing (falls through).
    if (this._lookControl && p.lookToggleKey) add(p.lookToggleKey, this._lookControl, 'lookToggle');
  }

  /* ---------------- internals: touches & timers ---------------- */

  _down(id, x, y) { this._active.add(id); this._touch.down(id, x, y); }
  _move(id, x, y) { if (this._active.has(id)) this._touch.move(id, x, y); }
  _up(id) { if (this._active.delete(id)) this._touch.up(id); }

  _later(fn, ms) {
    const h = this._timers.setTimeout(() => { this._pending.delete(h); fn(); }, ms);
    this._pending.add(h);
    return h;
  }
  _clearTimer(h) {
    if (h === null || h === undefined) return;
    this._timers.clearTimeout(h);
    this._pending.delete(h);
  }

  _frame() {
    let s = null;
    try { s = this._getFrameSize ? this._getFrameSize() : null; } catch { s = null; }
    if (!s || !(s.width > 0) || !(s.height > 0)) {
      const v = this._video;
      s = v && v.width > 0 && v.height > 0 ? { width: v.width, height: v.height } : { width: 16, height: 9 };
    }
    return s;
  }
  _aspect() { const s = this._frame(); return s.width / s.height; }

  /* ---------------- joystick ---------------- */

  _updateJoy(st) {
    const c = st.control;
    const any = DIRS.some((d) => st.dirs[d]);
    if (!any) {
      this._clearTimer(st.timer); st.timer = null;
      if (st.down) { this._up(st.tid); st.down = false; }
      st.cur = { x: c.x, y: c.y };
      return;
    }
    const target = joystickTarget(c, st.dirs, st.sprint, this._aspect(), this._opt.joystickWalk);
    if (!st.down) {
      this._down(st.tid, c.x, c.y);
      st.down = true;
      st.cur = { x: c.x, y: c.y };
    }
    this._joyAnimate(st, target);
  }

  _joyAnimate(st, target) {
    this._clearTimer(st.timer); st.timer = null;
    const from = { ...st.cur };
    const steps = this._opt.joySteps && this._opt.joySteps.length ? this._opt.joySteps : [1];
    const apply = (f) => {
      st.cur = { x: from.x + (target.x - from.x) * f, y: from.y + (target.y - from.y) * f };
      this._move(st.tid, st.cur.x, st.cur.y);
    };
    apply(steps[0]);
    let i = 1;
    const next = () => {
      st.timer = null;
      if (!st.down) return;
      apply(steps[i]); i++;
      if (i < steps.length) st.timer = this._later(next, this._opt.joyStepMs);
    };
    if (steps.length > 1) st.timer = this._later(next, this._opt.joyStepMs);
  }

  /* ---------------- swipe / multitap ---------------- */

  _startSwipe(c) {
    if (this._swipes.has(c.id)) return; // one at a time per control
    this._swipes.add(c.id);
    const tid = TOUCH_PREFIX + c.id + ':swipe';
    const stepMs = this._opt.swipeStepMs;
    const steps = Math.max(2, Math.round(c.durationMs / stepMs));
    this._down(tid, c.x, c.y);
    let i = 0;
    const tick = () => {
      i++;
      const f = i / steps;
      this._move(tid, c.x + (c.x2 - c.x) * f, c.y + (c.y2 - c.y) * f);
      if (i < steps) this._later(tick, stepMs);
      else this._later(() => { this._up(tid); this._swipes.delete(c.id); }, stepMs);
    };
    this._later(tick, stepMs);
  }

  _startMultitap(c) {
    let t = 0;
    c.points.forEach((pt, i) => {
      t += pt.delayMs || 0;
      const tid = `${TOUCH_PREFIX}${c.id}:mt${i}`;
      const fire = () => {
        this._down(tid, pt.x, pt.y);
        this._later(() => this._up(tid), this._opt.multitapHoldMs);
      };
      if (t <= 0) fire(); else this._later(fire, t);
    });
  }

  /* ---------------- look ---------------- */

  _lookMode() { return this._profile && this._profile.lookToggleMode === 'hold' ? 'hold' : 'toggle'; }

  _toggleLook() {
    if (this._lookActive || this._wantLook) this._exitLook();
    else this._enterLook();
  }

  _exitLook() {
    if (!this._lookActive && !this._wantLook) return;
    this._wantLook = false;
    if (this._lock) { try { this._lock.exit(); } catch { /* ignore */ } }
    if (this._lookActive) this._setLook(false);
  }

  _enterLook() {
    if (!this._lookControl || this._lookActive || this._wantLook) return;
    if (!this._lock) { this._setLook(true); return; } // no pointer lock available (e.g. tests)
    this._wantLook = true;
    try {
      this._lock.request(() => this._lockFailed());
    } catch (err) {
      this._lockFailed(err);
    }
    if (this._wantLook && this._lock.isLocked()) this._onPointerLockChange();
  }

  /** Pointer lock refused: still enter look mode (cursor stays visible; toggle key exits). */
  _lockFailed(err) {
    if (!this._wantLook) return;
    console.warn('[keymap] pointer lock recusado; modo mira sem travar o cursor', err || '');
    this._wantLook = false;
    if (this._enabled && this._lookControl && !this._lookActive) {
      this._lockless = true;
      this._setLook(true);
    }
  }

  _onPointerLockChange() {
    if (this._lockless) return;
    const locked = !!(this._lock && this._lock.isLocked());
    if (locked && this._wantLook && !this._lookActive && this._enabled && this._lookControl) {
      this._setLook(true);
    } else if (locked && !this._wantLook && !this._lookActive) {
      // Lock granted after we stopped wanting it (e.g. hold key released early) → give it back.
      try { this._lock.exit(); } catch { /* ignore */ }
    } else if (!locked && this._lookActive) {
      // Browser left pointer lock (Esc, blur, ...) → leave look mode.
      this._wantLook = false;
      this._setLook(false);
    } else if (!locked) {
      this._wantLook = false;
    }
  }

  _setLook(on, { silent = false } = {}) {
    if (on === this._lookActive) return;
    this._lookActive = on;
    this._resetLookFlow();
    const c = this._lookControl;
    if (on && c) {
      this._lookPos = { x: c.x, y: c.y };
      this._smooth = { x: 0, y: 0 };
      this._down(TOUCH_PREFIX + 'look', c.x, c.y);   // pressed immediately → camera responds
      // Keys already held that also have look-only taps (e.g. Mouse2 = hold-to-aim + scope).
      for (const [key, list] of this._pressed) {
        for (const b of this._bindings.get(key) || []) {
          if (b.control.type === 'tap' && b.control.lookOnly && !list.includes(b)) {
            list.push(b);
            this._activate(b);
          }
        }
      }
    } else {
      this._up(TOUCH_PREFIX + 'look');
      this._lookPos = null;
      this._wantLook = false;
      this._lockless = false;
      // lift look-only taps; their key stays "pressed" so the later key/mouse up is swallowed
      for (const [key, list] of this._pressed) {
        const keep = list.filter((b) => {
          if (b.control.type === 'tap' && b.control.lookOnly) { this._up(TOUCH_PREFIX + b.control.id); return false; }
          return true;
        });
        this._pressed.set(key, keep);
      }
    }
    this._renderHints();
    if (!silent) this._emit();
  }

  _lookMove(mx, my) {
    const c = this._lookControl;
    if (!c || !this._lookPos || (mx === 0 && my === 0)) return;
    const s = c.smoothing || 0;
    if (s > 0) { // optional EMA smoothing of mouse deltas (off by default: adds latency)
      this._smooth = { x: this._smooth.x * s + mx * (1 - s), y: this._smooth.y * s + my * (1 - s) };
      mx = this._smooth.x; my = this._smooth.y;
    }
    this._lookAcc.x += mx;
    this._lookAcc.y += my;
    this._lookFlush();
  }

  _resetLookFlow() {
    if (this._lookTimer !== undefined) this._clearTimer(this._lookTimer);
    this._lookTimer = null;
    this._lookAcc = { x: 0, y: 0 };
    this._lookLastSend = -Infinity;
    this._lookHoldUntil = -Infinity;
    this._lookSettling = false;
  }

  /** Sends the accumulated mouse delta as one finger move (rate-limited, re-center aware). */
  _lookFlush() {
    const c = this._lookControl;
    if (!c || !this._lookPos) return;
    const o = this._opt;
    const now = this._now();
    const due = Math.max(this._lookHoldUntil, this._lookLastSend + o.lookMinIntervalMs);
    if (now < due) {
      if (this._lookTimer === null) {
        this._lookTimer = this._later(() => { this._lookTimer = null; this._lookFlush(); }, Math.max(1, due - now));
      }
      return;
    }
    const { x: mx, y: my } = this._lookAcc;
    if (mx === 0 && my === 0) { this._lookSettling = false; return; }
    this._lookAcc = { x: 0, y: 0 };
    this._lookLastSend = now;
    const id = TOUCH_PREFIX + 'look';
    const anchor = { x: c.x, y: c.y };
    const r = lookStep(anchor, this._lookPos, mx, my, c, this._aspect(), o);
    if (r.recenter && !this._lookSettling && o.lookSettleMs > 0) {
      // lift, press again at the anchor, and replay this movement once the game saw the new touch
      this._up(id);
      this._down(id, anchor.x, anchor.y);
      this._lookPos = anchor;
      this._lookAcc = { x: mx, y: my };
      this._lookHoldUntil = now + o.lookSettleMs;
      this._lookSettling = true;
      this._lookFlush();
      return;
    }
    if (r.recenter && !this._lookSettling) {
      this._up(id);
      this._down(id, anchor.x, anchor.y);
    }
    // (while settling, a recenter result is just the clamped step from the anchor: no re-press)
    this._lookSettling = false;
    this._lookPos = { x: r.x, y: r.y };
    this._move(id, r.x, r.y);
  }

  /* ---------------- state / hints ---------------- */

  _emit() {
    const s = { enabled: this._enabled, lookActive: this._lookActive, profileName: this._profile ? this._profile.name : null };
    for (const cb of this._listeners) {
      try { cb(s); } catch (err) { console.error('[keymap] onStateChange', err); }
    }
  }

  _renderHints() {
    const ov = this._overlay;
    if (!ov || !ov.ownerDocument) return;
    const doc = ov.ownerDocument;
    if (!this._hintsEl) {
      this._hintsEl = doc.createElement('div');
      this._hintsEl.className = 'km-hints';
      ov.appendChild(this._hintsEl);
    }
    if (!this._bannerEl) {
      this._bannerEl = doc.createElement('div');
      this._bannerEl.className = 'km-look-banner';
      ov.appendChild(this._bannerEl);
    }
    const p = this._profile;
    const toggleLabel = p && p.lookToggleKey ? formatKeyLabel(p.lookToggleKey) : '';
    this._bannerEl.hidden = !this._lookActive;
    this._bannerEl.textContent = this._lookMode() === 'hold'
      ? `Modo mira: ON — solte ${toggleLabel} para sair`
      : `Modo mira: ON — ${toggleLabel} para sair`;

    const root = this._hintsEl;
    root.replaceChildren();
    root.hidden = !(this._hintsVisible && this._enabled && p);
    if (root.hidden) return;

    const pct = (v) => (v * 100).toFixed(3) + '%';
    const label = (x, y, text, cls = '') => {
      const el = doc.createElement('div');
      el.className = 'km-hint ' + cls;
      el.style.left = pct(x);
      el.style.top = pct(y);
      el.textContent = text;
      root.appendChild(el);
      return el;
    };
    // Taps at the same spot (e.g. "1" and "Roda ↑" on the same button) share one label.
    const tapSpots = new Map();
    for (const c of p.controls) {
      if (c.type !== 'tap') continue;
      const k = c.x.toFixed(3) + ',' + c.y.toFixed(3);
      if (!tapSpots.has(k)) tapSpots.set(k, []);
      tapSpots.get(k).push(c);
    }
    for (const list of tapSpots.values()) {
      const dim = list.every((c) => c.lookOnly) && !this._lookActive;
      label(list[0].x, list[0].y, list.map((c) => formatKeyLabel(c.key)).join(' / '), dim ? 'km-hint-dim' : '');
    }
    for (const c of p.controls) {
      switch (c.type) {
        case 'tap': break;
        case 'joystick': {
          const ring = doc.createElement('div');
          ring.className = 'km-hint-joy';
          ring.style.left = pct(c.x);
          ring.style.top = pct(c.y);
          ring.style.height = pct(c.radius * 2);
          for (const d of DIRS) {
            const k = doc.createElement('span');
            k.className = 'km-hint-joy-k km-' + d;
            k.textContent = formatKeyLabel(c.keys[d]);
            ring.appendChild(k);
          }
          root.appendChild(ring);
          break;
        }
        case 'look':
          label(c.x, c.y, `⌖ Mira (${toggleLabel || '—'})`, this._lookActive ? 'km-hint-look km-on' : 'km-hint-look');
          break;
        case 'swipe':
          label(c.x, c.y, formatKeyLabel(c.key) + ' ⇢');
          label(c.x2, c.y2, '•', 'km-hint-dot');
          break;
        case 'multitap':
          c.points.forEach((pt, i) => {
            if (i === 0) label(pt.x, pt.y, formatKeyLabel(c.key) + ' ×' + c.points.length);
            else label(pt.x, pt.y, String(i + 1), 'km-hint-dot');
          });
          break;
        default: break;
      }
    }
  }
}
