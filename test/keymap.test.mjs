// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KeymapEngine, KM_DEFAULTS, joystickVector, joystickTarget, lookStep, formatKeyLabel,
  normalizeProfile, validateProfile, eventToKey,
} from '../src/renderer/keymap/engine.js';
import { PRESETS } from '../src/renderer/keymap/presets.js';

/* ------------------------------ fakes ------------------------------ */

class FakeTouch {
  constructor() { this.log = []; this.downs = new Map(); }
  down(id, x, y) { this.log.push(['down', id, x, y]); this.downs.set(id, { x, y }); }
  move(id, x, y) { this.log.push(['move', id, x, y]); if (this.downs.has(id)) this.downs.set(id, { x, y }); }
  up(id) { this.log.push(['up', id]); this.downs.delete(id); }
  isDown(id) { return this.downs.has(id); }
  releaseAll() { throw new Error('engine must not call touch.releaseAll()'); }
}

function fakeTimers() {
  let now = 0, seq = 0;
  const q = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; q.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { q.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of q) if (t.at <= end && (!next || t.at < next[1].at || (t.at === next[1].at && id < next[0]))) next = [id, t];
        if (!next) break;
        q.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    },
    get pending() { return q.size; },
    now: () => now,
  };
}

function fakeLock() {
  const l = {
    locked: false, cb: null, requests: 0, auto: true,
    isLocked: () => l.locked,
    request() { l.requests++; if (l.auto) { l.locked = true; l.cb && l.cb(); } },
    exit() { if (l.locked) { l.locked = false; l.cb && l.cb(); } },
    listen(cb) { l.cb = cb; return () => { l.cb = null; }; },
    // simulate the browser leaving pointer lock (Esc)
    browserExit() { l.locked = false; l.cb && l.cb(); },
    grant() { l.locked = true; l.cb && l.cb(); },
  };
  return l;
}

function ev(type, props = {}) {
  return { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
}
const kd = (code, extra) => ev('keydown', { code, ...extra });
const ku = (code) => ev('keyup', { code });
const md = (button) => ev('mousedown', { button });
const mu = (button) => ev('mouseup', { button });
const mm = (movementX, movementY) => ev('mousemove', { movementX, movementY });

function setup(profile, opts = {}) {
  const touch = new FakeTouch();
  const timers = fakeTimers();
  const lock = fakeLock();
  const engine = new KeymapEngine({
    touch, timers, pointerLock: lock, getFrameSize: () => ({ width: 1920, height: 1080 }),
    options: { joySteps: [1], ...opts },
  });
  engine.setProfile(profile);
  return { touch, timers, lock, engine };
}

const FPS = {
  version: 1, name: 'T', lookToggleKey: 'Backquote',
  controls: [
    { id: 'j', type: 'joystick', keys: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }, x: 0.2, y: 0.7, radius: 0.1, sprintKey: 'ShiftLeft' },
    { id: 'look', type: 'look', x: 0.6, y: 0.4, sensitivity: 1, invertY: false },
    { id: 'fire', type: 'tap', key: 'Mouse0', x: 0.8, y: 0.6, lookOnly: true },
    { id: 'jump', type: 'tap', key: 'Space', x: 0.9, y: 0.6 },
    { id: 'sw', type: 'swipe', key: 'KeyR', x: 0.5, y: 0.8, x2: 0.5, y2: 0.4, durationMs: 40 },
    { id: 'mt', type: 'multitap', key: 'KeyQ', points: [{ x: 0.1, y: 0.1, delayMs: 0 }, { x: 0.2, y: 0.1, delayMs: 50 }] },
  ],
};

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ------------------------------ pure helpers ------------------------------ */

test('joystickVector: cardinal, diagonal normalized, opposing cancel', () => {
  assert.deepEqual(joystickVector({ up: true }, 1), { x: 0, y: -1 });
  const d = joystickVector({ up: true, right: true }, 1);
  assert.ok(near(Math.hypot(d.x, d.y), 1));
  assert.ok(near(d.x, Math.SQRT1_2) && near(d.y, -Math.SQRT1_2));
  assert.deepEqual(joystickVector({ up: true, down: true }, 1), { x: 0, y: 0 });
  const c = joystickVector({ up: true, down: true, left: true }, 0.75);
  assert.ok(near(c.x, -0.75) && near(c.y, 0));
});

test('joystickTarget respects radius in height units and aspect', () => {
  const c = { x: 0.5, y: 0.5, radius: 0.1 };
  const t = joystickTarget(c, { right: true }, true, 16 / 9);
  assert.ok(near(t.x, 0.5 + 0.1 * 9 / 16) && near(t.y, 0.5));
  const w = joystickTarget(c, { up: true }, false, 16 / 9);
  assert.ok(near(w.y, 0.5 - 0.075));
});

test('lookStep: scaling, invertY, separate X/Y sensitivity, re-centering', () => {
  const a = { x: 0.5, y: 0.5 }; const asp = 16 / 9;
  let r = lookStep(a, a, 108, 0, { sensitivityX: 1, sensitivityY: 1 }, asp);
  assert.equal(r.recenter, false);
  assert.ok(near((r.x - 0.5) * asp, 0.1)); // 108px on 1080 ref = 0.1 frame heights
  r = lookStep(a, a, 0, 54, { sensitivityX: 1, sensitivityY: 2, invertY: true }, asp);
  assert.ok(near(r.y, 0.4));
  r = lookStep(a, a, 0, 54, { sensitivity: 2 }, asp); // legacy field
  assert.ok(near(r.y, 0.6));
  // beyond lookRecenter from anchor → recenter at anchor + delta
  r = lookStep(a, { x: 0.5 + (KM_DEFAULTS.lookRecenter - 0.01) / asp, y: 0.5 }, 54, 0, { sensitivityX: 1 }, asp);
  assert.equal(r.recenter, true);
  assert.ok(near((r.x - 0.5) * asp, 0.05));
  // near the frame edge → recenter
  r = lookStep({ x: 0.5, y: 0.04 }, { x: 0.5, y: 0.04 }, 0, -20, { sensitivityY: 1 }, asp);
  assert.equal(r.recenter, true);
  // huge flick clamped to half the recenter radius
  r = lookStep(a, a, 5000, 0, { sensitivityX: 1 }, asp);
  assert.equal(r.recenter, true);
  assert.ok(near((r.x - 0.5) * asp, KM_DEFAULTS.lookRecenter / 2));
});

test('formatKeyLabel pt-BR', () => {
  assert.equal(formatKeyLabel('KeyW'), 'W');
  assert.equal(formatKeyLabel('Digit1'), '1');
  assert.equal(formatKeyLabel('Space'), 'Espaço');
  assert.equal(formatKeyLabel('Mouse0'), 'Botão Esq.');
  assert.equal(formatKeyLabel('Mouse2'), 'Botão Dir.');
  assert.equal(formatKeyLabel('Mouse1'), 'Botão Meio');
  assert.equal(formatKeyLabel('ShiftLeft'), 'Shift');
  assert.equal(formatKeyLabel('Backquote'), "'");
  assert.equal(formatKeyLabel('WheelUp'), 'Roda ↑');
  assert.equal(formatKeyLabel('Numpad5'), 'Num 5');
  assert.equal(formatKeyLabel('F11'), 'F11');
  assert.equal(formatKeyLabel(null), '—');
  assert.equal(formatKeyLabel('Weird'), 'Weird');
});

test('eventToKey', () => {
  assert.equal(eventToKey({ type: 'mousedown', button: 3 }), 'Mouse3');
  assert.equal(eventToKey({ type: 'wheel', deltaY: -3 }), 'WheelUp');
  assert.equal(eventToKey({ type: 'wheel', deltaY: 3 }), 'WheelDown');
  assert.equal(eventToKey({ type: 'wheel', deltaY: 0 }), null);
});

test('normalizeProfile: defaults, legacy sensitivity, clamping, ids', () => {
  const p = normalizeProfile({
    name: '  X ', lookToggleMode: 'hold',
    controls: [
      { type: 'look', sensitivity: 2 }, { type: 'tap', key: 'KeyA', x: 5, y: -1, junk: 1 },
      { id: 'dup', type: 'tap', key: 'KeyB' }, { id: 'dup', type: 'tap', key: 'KeyC' }, { type: 'nope' },
    ],
  });
  assert.equal(p.version, 1); assert.equal(p.name, 'X'); assert.equal(p.lookToggleMode, 'hold');
  assert.equal(p.controls.length, 4);
  assert.equal(p.controls[0].sensitivityX, 2); assert.equal(p.controls[0].sensitivityY, 2);
  assert.equal(p.controls[0].smoothing, 0);
  assert.deepEqual([p.controls[1].x, p.controls[1].y], [1, 0]);
  assert.equal(p.controls[1].junk, undefined);
  assert.equal(new Set(p.controls.map((c) => c.id)).size, 4);
  assert.equal(normalizeProfile({}).lookToggleMode, 'toggle');
});

test('validateProfile: name, look toggle, missing keys; shared keys allowed', () => {
  let v = validateProfile(normalizeProfile({ name: '', controls: [] }));
  assert.equal(v.ok, false);
  v = validateProfile(normalizeProfile({ name: 'a', controls: [{ id: 'l', type: 'look' }] }));
  assert.equal(v.ok, false); assert.ok(v.conflictIds.has('__lookToggle'));
  v = validateProfile(normalizeProfile({ name: 'a', controls: [{ id: 'l', type: 'look' }, { id: 'l2', type: 'look' }], lookToggleKey: 'KeyZ' }));
  assert.equal(v.ok, false); assert.ok(v.conflictIds.has('l2'));
  v = validateProfile(normalizeProfile({ name: 'a', controls: [{ id: 't', type: 'tap' }] }));
  assert.equal(v.ok, false); assert.ok(v.conflictIds.has('t'));
  v = validateProfile(normalizeProfile({ name: 'a', controls: [{ id: 'j', type: 'joystick', keys: { up: 'KeyW' } }] }));
  assert.equal(v.ok, false);
  // same key on several controls is fine, reported in keyUsage
  v = validateProfile(normalizeProfile({ name: 'a', controls: [
    { id: 'a', type: 'tap', key: 'Mouse0' }, { id: 'b', type: 'tap', key: 'Mouse0' },
    { id: 'j', type: 'joystick', keys: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' } },
    { id: 'c', type: 'tap', key: 'KeyW' },
  ] }));
  assert.equal(v.ok, true, v.errors.join());
  assert.equal(v.keyUsage.get('Mouse0'), 2);
  assert.equal(v.keyUsage.get('KeyW'), 2);
  assert.equal(v.keyUsage.get('KeyS'), 1);
});

test('presets are valid', () => {
  assert.ok(PRESETS.length >= 2);
  for (const p of PRESETS) {
    const v = validateProfile(normalizeProfile(p));
    assert.equal(v.ok, true, p.name + ': ' + v.errors.join('; '));
  }
});

/* ------------------------------ engine ------------------------------ */

test('tap: down/up, repeat ignored, keyup without keydown ignored, unmapped falls through', () => {
  const { touch, engine } = setup(FPS);
  const e = kd('Space');
  assert.equal(engine.handleEvent(e), true); assert.equal(e.defaultPrevented, true);
  assert.deepEqual(touch.downs.get('km:jump'), { x: 0.9, y: 0.6 });
  const n = touch.log.length;
  assert.equal(engine.handleEvent(kd('Space', { repeat: true })), true);
  assert.equal(touch.log.length, n);
  assert.equal(engine.handleEvent(ku('Space')), true);
  assert.equal(touch.isDown('km:jump'), false);
  assert.equal(engine.handleEvent(ku('Space')), false);
  const u = kd('KeyZ');
  assert.equal(engine.handleEvent(u), false); assert.equal(u.defaultPrevented, false);
  assert.equal(engine.handleEvent(kd('KeyZ', { repeat: true })), false);
});

test('disabled engine consumes nothing and lifts its touches', () => {
  const { touch, engine } = setup(FPS);
  engine.handleEvent(kd('Space'));
  engine.setEnabled(false);
  assert.equal(touch.downs.size, 0);
  assert.equal(engine.handleEvent(kd('Space')), false);
});

test('joystick: press, diagonal, opposing cancel, direction switch, release', () => {
  const { touch, engine } = setup(FPS);
  const asp = 16 / 9;
  engine.handleEvent(kd('KeyW'));
  assert.equal(touch.log[0][0], 'down'); assert.deepEqual(touch.log[0].slice(2), [0.2, 0.7]); // starts at center
  let p = touch.downs.get('km:j');
  assert.ok(near(p.x, 0.2) && near(p.y, 0.7 - 0.075));
  engine.handleEvent(kd('KeyD'));
  p = touch.downs.get('km:j');
  assert.ok(near(Math.hypot((p.x - 0.2) * asp, p.y - 0.7), 0.075));
  engine.handleEvent(kd('KeyS')); // W+S cancel → pure right
  p = touch.downs.get('km:j');
  assert.ok(near(p.y, 0.7) && near(p.x, 0.2 + 0.075 / asp));
  engine.handleEvent(ku('KeyW')); // now S+D
  p = touch.downs.get('km:j');
  assert.ok(p.y > 0.7 && p.x > 0.2);
  engine.handleEvent(kd('ShiftLeft')); // sprint → full radius
  p = touch.downs.get('km:j');
  assert.ok(near(Math.hypot((p.x - 0.2) * asp, p.y - 0.7), 0.1));
  const downsBefore = touch.log.filter((l) => l[0] === 'down').length;
  engine.handleEvent(ku('KeyS')); engine.handleEvent(ku('KeyD'));
  assert.equal(touch.isDown('km:j'), false);
  assert.equal(touch.log.filter((l) => l[0] === 'down').length, downsBefore); // never re-pressed while moving
  engine.handleEvent(ku('ShiftLeft'));
});

test('joystick smoothing steps reach the target over time', () => {
  const { touch, timers, engine } = setup(FPS, { joySteps: [0.6, 1], joyStepMs: 10 });
  engine.handleEvent(kd('KeyW'));
  assert.ok(near(touch.downs.get('km:j').y, 0.7 - 0.075 * 0.6));
  timers.advance(10);
  assert.ok(near(touch.downs.get('km:j').y, 0.7 - 0.075));
  engine.handleEvent(ku('KeyW'));
  assert.equal(timers.pending, 0);
});

test('look: toggle activates with finger pressed, moves, recenters, Esc exit lifts', () => {
  const { touch, lock, engine, timers } = setup(FPS);
  const states = [];
  engine.onStateChange((s) => states.push(s));
  assert.equal(engine.handleEvent(md(0)), false); // lookOnly: normal click outside look mode
  assert.equal(engine.handleEvent(mu(0)), false);
  assert.equal(engine.handleEvent(mm(10, 10)), false);
  assert.equal(engine.handleEvent(kd('Backquote')), true);
  engine.handleEvent(ku('Backquote'));
  assert.equal(engine.lookActive, true);
  assert.equal(lock.requests, 1);
  assert.deepEqual(touch.downs.get('km:look'), { x: 0.6, y: 0.4 });
  assert.equal(states.at(-1).lookActive, true);
  assert.equal(engine.handleEvent(mm(54, 0)), true);
  assert.ok(touch.downs.get('km:look').x > 0.6);
  // fire works in look mode, concurrently with look finger
  assert.equal(engine.handleEvent(md(0)), true);
  assert.ok(touch.isDown('km:fire') && touch.isDown('km:look'));
  engine.handleEvent(mu(0));
  // drift until a recenter happens
  const before = touch.log.filter((l) => l[0] === 'up' && l[1] === 'km:look').length;
  for (let i = 0; i < 20; i++) { engine.handleEvent(mm(54, 0)); timers.advance(20); }
  const ups = touch.log.filter((l) => l[0] === 'up' && l[1] === 'km:look').length;
  assert.ok(ups > before);
  assert.ok(touch.isDown('km:look'));
  const ax = (touch.downs.get('km:look').x - 0.6) * 16 / 9;
  assert.ok(ax <= KM_DEFAULTS.lookRecenter + 1e-9);
  // unmapped mouse buttons are swallowed in look mode
  assert.equal(engine.handleEvent(md(1)), true);
  engine.handleEvent(md(0)); // hold fire, then browser exits pointer lock (Esc)
  lock.browserExit();
  assert.equal(engine.lookActive, false);
  assert.equal(touch.isDown('km:look'), false);
  assert.equal(touch.isDown('km:fire'), false);
  assert.equal(engine.handleEvent(mu(0)), true); // its up is swallowed (down was consumed)
  assert.equal(states.at(-1).lookActive, false);
});

test('look: 1000 Hz mouse is rate-limited without losing movement', () => {
  const { touch, engine, timers } = setup(FPS);
  engine.handleEvent(kd('Backquote')); engine.handleEvent(ku('Backquote'));
  touch.log.length = 0;
  // 200 ms of a 1 kHz mouse moving 1 count per ms to the right (no recenter: 200 counts)
  for (let i = 0; i < 200; i++) { engine.handleEvent(mm(1, 0)); timers.advance(1); }
  timers.advance(20);
  const moves = touch.log.filter((l) => l[0] === 'move' && l[1] === 'km:look');
  assert.ok(moves.length >= 40 && moves.length <= 60, `moves=${moves.length}`); // ~250 Hz
  assert.equal(touch.log.some((l) => l[0] === 'up'), false);
  const dx = (touch.downs.get('km:look').x - 0.6) * 16 / 9;
  assert.ok(near(dx, 200 / KM_DEFAULTS.lookRefPx), `dx=${dx}`); // nothing lost
});

test('look: toggle key again exits; no look control → toggle key falls through', () => {
  const { touch, lock, engine } = setup(FPS);
  engine.handleEvent(kd('Backquote')); engine.handleEvent(ku('Backquote'));
  engine.handleEvent(kd('Backquote')); engine.handleEvent(ku('Backquote'));
  assert.equal(engine.lookActive, false); assert.equal(lock.locked, false);
  assert.equal(touch.isDown('km:look'), false);
  const s2 = setup({ ...FPS, controls: FPS.controls.filter((c) => c.type !== 'look') });
  assert.equal(s2.engine.handleEvent(kd('Backquote')), false);
  assert.equal(s2.lock.requests, 0);
});

test('look hold mode: active only while held; lookOnly on the same key engages after lock', () => {
  const p = { ...FPS, lookToggleKey: 'Mouse2', lookToggleMode: 'hold',
    controls: [...FPS.controls, { id: 'scope', type: 'tap', key: 'Mouse2', x: 0.9, y: 0.4, lookOnly: true }] };
  const { touch, lock, engine } = setup(p);
  lock.auto = false; // lock is granted asynchronously
  assert.equal(engine.handleEvent(md(2)), true);
  assert.equal(engine.lookActive, false);
  lock.grant();
  assert.equal(engine.lookActive, true);
  assert.ok(touch.isDown('km:scope'));
  engine.handleEvent(mu(2));
  assert.equal(engine.lookActive, false);
  assert.equal(lock.locked, false);
  assert.equal(touch.downs.size, 0);
  // released before the lock arrives → lock given back, look not entered
  engine.handleEvent(md(2)); engine.handleEvent(mu(2));
  lock.grant();
  assert.equal(engine.lookActive, false); assert.equal(lock.locked, false);
});

test('pointer lock refused → look still activates (lockless), toggle exits', () => {
  const { touch, lock, engine } = setup(FPS);
  lock.request = (onFail) => { lock.requests++; onFail(new Error('denied')); };
  const warn = console.warn; console.warn = () => {};
  try {
    engine.handleEvent(kd('Backquote')); engine.handleEvent(ku('Backquote'));
  } finally { console.warn = warn; }
  assert.equal(engine.lookActive, true);
  assert.ok(touch.isDown('km:look'));
  lock.cb(); // stray pointerlockchange must not kick us out
  assert.equal(engine.lookActive, true);
  engine.handleEvent(kd('Backquote'));
  assert.equal(engine.lookActive, false);
  assert.equal(touch.isDown('km:look'), false);
});

test('look smoothing (EMA) reduces first step', () => {
  const p = { ...FPS, controls: FPS.controls.map((c) => (c.type === 'look' ? { ...c, smoothing: 0.5 } : c)) };
  const { touch, engine } = setup(p);
  engine.handleEvent(kd('Backquote'));
  engine.handleEvent(mm(54, 0));
  const dx = (touch.downs.get('km:look').x - 0.6) * 16 / 9;
  assert.ok(near(dx, 0.025));
});

test('shared key triggers all bound controls, each with its own touch id', () => {
  const p = { version: 1, name: 's', controls: [
    { id: 'a', type: 'tap', key: 'Mouse0', x: 0.1, y: 0.1 },
    { id: 'b', type: 'tap', key: 'Mouse0', x: 0.9, y: 0.9 },
    { id: 'j', type: 'joystick', keys: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }, x: 0.2, y: 0.7, radius: 0.1 },
    { id: 'c', type: 'tap', key: 'KeyW', x: 0.5, y: 0.5 },
  ] };
  const { touch, engine } = setup(p);
  assert.equal(engine.handleEvent(md(0)), true);
  assert.ok(touch.isDown('km:a') && touch.isDown('km:b'));
  engine.handleEvent(mu(0));
  assert.equal(touch.downs.size, 0);
  engine.handleEvent(kd('KeyW'));
  assert.ok(touch.isDown('km:j') && touch.isDown('km:c'));
  engine.handleEvent(ku('KeyW'));
  assert.equal(touch.downs.size, 0);
});

test('wheel: each tick is a quick tap; fast ticks queue', () => {
  const p = { version: 1, name: 'w', controls: [{ id: 'w', type: 'tap', key: 'WheelUp', x: 0.3, y: 0.3 }] };
  const { touch, timers, engine } = setup(p);
  assert.equal(engine.handleEvent(ev('wheel', { deltaY: -100 })), true);
  assert.ok(touch.isDown('km:w'));
  engine.handleEvent(ev('wheel', { deltaY: -100 }));
  assert.equal(engine.handleEvent(ev('wheel', { deltaY: 100 })), false); // WheelDown unmapped
  timers.advance(30);
  assert.equal(touch.isDown('km:w'), false);
  timers.advance(20);
  assert.ok(touch.isDown('km:w'));
  timers.advance(30);
  assert.equal(touch.isDown('km:w'), false);
  assert.equal(touch.log.filter((l) => l[0] === 'down').length, 2);
  assert.equal(timers.pending, 0);
});

test('swipe interpolates then lifts; multitap fires timed taps with distinct ids', () => {
  const { touch, timers, engine } = setup(FPS);
  engine.handleEvent(kd('KeyR'));
  assert.deepEqual(touch.downs.get('km:sw:swipe'), { x: 0.5, y: 0.8 });
  engine.handleEvent(kd('KeyQ'));
  assert.ok(touch.isDown('km:mt:mt0'));
  timers.advance(40);
  assert.ok(near(touch.downs.get('km:sw:swipe').y, 0.4));
  assert.equal(touch.isDown('km:mt:mt0'), false);
  timers.advance(10);
  assert.equal(touch.isDown('km:sw:swipe'), false);
  assert.ok(touch.isDown('km:mt:mt1'));
  timers.advance(100);
  assert.equal(touch.downs.size, 0);
  assert.equal(timers.pending, 0);
});

test('releaseAll lifts only km touches, cancels timers, exits look; setProfile releases', () => {
  const { touch, timers, lock, engine } = setup(FPS);
  touch.down('mouse', 0.5, 0.5); // user's own finger
  engine.handleEvent(kd('KeyW'));
  engine.handleEvent(kd('KeyR'));
  engine.handleEvent(kd('Backquote'));
  engine.releaseAll();
  assert.deepEqual([...touch.downs.keys()], ['mouse']);
  assert.equal(timers.pending, 0);
  assert.equal(engine.lookActive, false); assert.equal(lock.locked, false);
  assert.equal(engine.handleEvent(ku('KeyW')), false); // keyup after release is ignored
  engine.handleEvent(kd('Space'));
  engine.setProfile(null);
  assert.deepEqual([...touch.downs.keys()], ['mouse']);
  assert.equal(engine.handleEvent(kd('Space')), false);
});
