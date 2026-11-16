// Emule — UI shell: start screen, mirror view, toolbar, wiring of everything (owner: B).

import * as C from './control.js';
import { TouchManager } from './touch.js';
import { VideoPlayer, isHevcSupported } from './video.js';
import { AudioPlayer, AUDIO_UNAVAILABLE_MSG } from './audio.js';
import { InputHandler } from './input.js';

const emule = window.emule;
const $ = (sel) => document.querySelector(sel);

const TOOLBAR_W = 52;

const DEFAULT_SETTINGS = {
  maxSize: 0, videoBitRate: 16_000_000, maxFps: 60, videoCodec: 'h264', audio: true,
  stayAwake: true, turnScreenOff: false, showTouches: false, powerOffOnClose: false,
  lastSerial: null, lastProfile: null, keymapEnabled: true, alwaysOnTop: false, showFps: false,
  // extra keys owned by the renderer
  qualityPreset: null, autoConnect: false, pcVolume: 1, pcMuted: false,
};

const QUALITY = {
  max: { label: 'Resolução nativa, 24 Mbps, H.265 se disponível', maxSize: 0, videoBitRate: 24_000_000, maxFps: 60, videoCodec: 'h265' },
  balanced: { label: '1920 px, 12 Mbps, H.264', maxSize: 1920, videoBitRate: 12_000_000, maxFps: 60, videoCodec: 'h264' },
  performance: { label: '1280 px, 6 Mbps, H.264 — menor uso de rede e CPU', maxSize: 1280, videoBitRate: 6_000_000, maxFps: 60, videoCodec: 'h264' },
  custom: { label: 'Ajuste os valores em "Avançado"' },
};

/* ------------------------------------------------------------------------------------------ */
/* State & core objects                                                                       */
/* ------------------------------------------------------------------------------------------ */

const state = {
  settings: { ...DEFAULT_SETTINGS },
  devices: [],
  selected: null,
  connecting: false,
  connected: false,
  userDisconnecting: false,
  info: null,
  serial: null,
  h265: false,
  screenOff: false,
  panelOpen: false,
  autoArmed: new Set(),
  profileKey: '',          // '' | 'user:<name>' | 'preset:<index>'
  userProfiles: [],
  lastLook: false,
  audioMsg: '',
};

const canvas = $('#video');
const videoArea = $('#video-area');
const overlay = $('#keymap-overlay');
const hud = $('#hud');

const video = new VideoPlayer(canvas);
const audio = new AudioPlayer();

function send(bytes) {
  if (state.connected && emule) emule.sendControl(bytes);
}
function sendAll(list) { for (const b of list) send(b); }

const getFrameSize = () => {
  const s = video.frameSize;
  if (s.width > 0) return s;
  return state.info ? { width: state.info.video.width, height: state.info.video.height } : { width: 0, height: 0 };
};

const touch = new TouchManager(send, getFrameSize);
const input = new InputHandler({
  touch,
  send,
  getVideoRect: () => canvas.getBoundingClientRect(),
  getFrameSize,
  isLookActive: () => !!(keymap && keymap.lookActive),
  notify: (m) => toast(m),
});

let keymap = null;
let editor = null;
let PRESETS = [];
let formatKeyLabel = (k) => k || '—';

video.onKeyframeNeeded(() => send(C.resetVideo()));
video.onResize(() => layoutVideo());

/* ------------------------------------------------------------------------------------------ */
/* Small UI helpers                                                                           */
/* ------------------------------------------------------------------------------------------ */

let toastTimer = 0;
function toast(msg, { error = false, ms = 2600 } = {}) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function showBanner(text) {
  $('#banner-text').textContent = text;
  $('#banner').hidden = !text;
}

function setSettings(partial) {
  Object.assign(state.settings, partial);
  if (emule) emule.setSettings(partial).catch((e) => console.warn('[app] setSettings', e));
}

function showScreen(which) {
  $('#start-screen').hidden = which !== 'start';
  $('#mirror-screen').hidden = which !== 'mirror';
  closePopovers();
  if (which === 'mirror') requestAnimationFrame(layoutVideo);
}

function setLoading(text) {
  const el = $('#loading');
  if (text) { $('#loading-text').textContent = text; el.hidden = false; } else el.hidden = true;
}

function isTypingTarget(t) {
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable;
}

/* ------------------------------------------------------------------------------------------ */
/* Video layout: letterboxed canvas + keymap overlay exactly over the displayed rect          */
/* ------------------------------------------------------------------------------------------ */

function layoutVideo() {
  const fs = getFrameSize();
  const aw = videoArea.clientWidth;
  const ah = videoArea.clientHeight;
  if (!(fs.width > 0 && fs.height > 0 && aw > 0 && ah > 0)) return;
  const scale = Math.min(aw / fs.width, ah / fs.height);
  const w = Math.round(fs.width * scale);
  const h = Math.round(fs.height * scale);
  const left = Math.floor((aw - w) / 2);
  const top = Math.floor((ah - h) / 2);
  for (const el of [canvas, overlay]) {
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
  }
  const dpr = window.devicePixelRatio || 1;
  video.setDisplaySize(w * dpr, h * dpr);
}

new ResizeObserver(() => layoutVideo()).observe(videoArea);
window.addEventListener('resize', () => {
  layoutVideo();
  if (emule) emule.isFullscreen().then((fs) => document.body.classList.toggle('fullscreen', !!fs)).catch(() => {});
});

function fitWindow() {
  if (!emule || !state.info) return;
  const fs = getFrameSize();
  if (!(fs.width > 0)) return;
  const maxW = screen.availWidth * 0.92 - TOOLBAR_W;
  const maxH = screen.availHeight * 0.9;
  const s = Math.min(1, maxW / fs.width, maxH / fs.height);
  emule.fitWindowToVideo(Math.round(fs.width * s) + TOOLBAR_W, Math.round(fs.height * s));
}

/* ------------------------------------------------------------------------------------------ */
/* Start screen: devices & quality                                                            */
/* ------------------------------------------------------------------------------------------ */

const STATE_INFO = {
  device: { label: 'Pronto', cls: 'ok' },
  unauthorized: { label: 'não autorizado', cls: 'warn', hint: 'Aceite a depuração USB no celular' },
  offline: { label: 'offline', cls: 'bad', hint: 'Reconecte o cabo USB ou reinicie a depuração USB' },
  authorizing: { label: 'autorizando…', cls: 'warn', hint: 'Aceite a depuração USB no celular' },
  'no permissions': { label: 'sem permissão', cls: 'bad' },
};

function renderDevices() {
  const list = $('#device-list');
  list.textContent = '';
  const devices = state.devices;
  $('#device-count').textContent = String(devices.length);
  $('#device-empty').hidden = devices.length > 0;

  if (!devices.some((d) => d.serial === state.selected)) {
    const pref = devices.find((d) => d.serial === state.settings.lastSerial && d.state === 'device')
      || devices.find((d) => d.state === 'device') || devices[0];
    state.selected = pref ? pref.serial : null;
  }

  for (const d of devices) {
    const info = STATE_INFO[d.state] || { label: d.state, cls: 'bad' };
    const li = document.createElement('li');
    li.className = 'device' + (d.serial === state.selected ? ' selected' : '') + (d.state !== 'device' ? ' disabled' : '');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(d.serial === state.selected));
    li.innerHTML = `
      <div class="dev-icon"><svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18.5h4"/></svg></div>
      <div class="dev-main">
        <div class="dev-name"></div>
        <div class="dev-serial"></div>
        <div class="dev-hint" hidden></div>
      </div>
      <span class="state ${info.cls}"></span>`;
    li.querySelector('.dev-name').textContent = d.model ? d.model.replace(/_/g, ' ') : (d.product || 'Dispositivo Android');
    li.querySelector('.dev-serial').textContent = d.serial;
    li.querySelector('.state').textContent = info.label;
    if (info.hint) {
      const h = li.querySelector('.dev-hint');
      h.textContent = info.hint;
      h.hidden = false;
    }
    li.addEventListener('click', () => { state.selected = d.serial; renderDevices(); });
    li.addEventListener('dblclick', () => { if (d.state === 'device') connect(d.serial); });
    list.appendChild(li);
  }
  updateConnectButton();
}

function updateConnectButton() {
  const d = state.devices.find((x) => x.serial === state.selected);
  const btn = $('#connect-btn');
  btn.disabled = !d || d.state !== 'device' || state.connecting || state.connected;
  btn.querySelector('span').textContent = state.connecting ? 'Conectando…' : 'Conectar';
}

function onDevices(devices) {
  const prevSerials = new Set(state.devices.filter((d) => d.state === 'device').map((d) => d.serial));
  state.devices = Array.isArray(devices) ? devices : [];
  const ready = new Set(state.devices.filter((d) => d.state === 'device').map((d) => d.serial));
  // re-arm auto-connect for a device that went away (unplugged / unauthorized) and came back
  for (const s of prevSerials) if (!ready.has(s)) state.autoArmed.add(s);
  renderDevices();
  maybeAutoConnect();
}

function maybeAutoConnect() {
  const s = state.settings;
  if (!s.autoConnect || !s.lastSerial || state.connecting || state.connected) return;
  const d = state.devices.find((x) => x.serial === s.lastSerial);
  if (!d || d.state !== 'device' || !state.autoArmed.has(d.serial)) return;
  state.autoArmed.delete(d.serial);
  connect(d.serial);
}

/* quality form */
const F = {
  preset: $('#quality-preset'),
  maxSize: $('#opt-maxSize'),
  bitrate: $('#opt-bitrate'),
  maxFps: $('#opt-maxFps'),
  codec: $('#opt-codec'),
  stayAwake: $('#opt-stayAwake'),
  turnScreenOff: $('#opt-turnScreenOff'),
  showTouches: $('#opt-showTouches'),
  powerOffOnClose: $('#opt-powerOffOnClose'),
  audio: $('#opt-audio'),
  autoConnect: $('#opt-autoConnect'),
};

function presetValues(key) {
  const q = QUALITY[key];
  if (!q || key === 'custom') return null;
  return { maxSize: q.maxSize, videoBitRate: q.videoBitRate, maxFps: q.maxFps, videoCodec: q.videoCodec === 'h265' && !state.h265 ? 'h264' : q.videoCodec };
}

function detectPreset(s) {
  for (const key of ['max', 'balanced', 'performance']) {
    const v = presetValues(key);
    if (v.maxSize === s.maxSize && v.videoBitRate === s.videoBitRate && v.maxFps === s.maxFps && v.videoCodec === s.videoCodec) return key;
  }
  return 'custom';
}

function ensureOption(select, value, label) {
  if (![...select.options].some((o) => o.value === String(value))) {
    const o = document.createElement('option');
    o.value = String(value);
    o.textContent = label || String(value);
    select.appendChild(o);
  }
  select.value = String(value);
}

function writeQualityFields(v) {
  ensureOption(F.maxSize, v.maxSize);
  F.bitrate.value = String(Math.round(v.videoBitRate / 1_000_000));
  ensureOption(F.maxFps, v.maxFps);
  F.codec.value = v.videoCodec === 'h265' && state.h265 ? 'h265' : 'h264';
}

function updatePresetDesc() {
  const key = F.preset.value;
  let desc = QUALITY[key] ? QUALITY[key].label : '';
  if (key === 'max' && !state.h265) desc = 'Resolução nativa, 24 Mbps, H.264 (H.265 não suportado neste PC)';
  $('#preset-desc').textContent = desc;
}

function loadForm() {
  const s = state.settings;
  writeQualityFields(s);
  F.preset.value = s.qualityPreset && QUALITY[s.qualityPreset] ? s.qualityPreset : detectPreset(s);
  if (F.preset.value !== 'custom') {
    const v = presetValues(F.preset.value);
    writeQualityFields(v);
  }
  F.stayAwake.checked = !!s.stayAwake;
  F.turnScreenOff.checked = !!s.turnScreenOff;
  F.showTouches.checked = !!s.showTouches;
  F.powerOffOnClose.checked = !!s.powerOffOnClose;
  F.audio.checked = s.audio !== false;
  F.autoConnect.checked = !!s.autoConnect;
  const h265Opt = F.codec.querySelector('option[value="h265"]');
  h265Opt.disabled = !state.h265;
  h265Opt.textContent = state.h265 ? 'H.265 (HEVC)' : 'H.265 (não suportado neste PC)';
  updatePresetDesc();
}

function collectOptions() {
  const mbps = Math.max(1, Math.min(200, Number(F.bitrate.value) || 16));
  return {
    maxSize: Number(F.maxSize.value) || 0,
    videoBitRate: Math.round(mbps * 1_000_000),
    maxFps: Number(F.maxFps.value) || 0,
    videoCodec: F.codec.value === 'h265' && state.h265 ? 'h265' : 'h264',
    audio: F.audio.checked,
    stayAwake: F.stayAwake.checked,
    turnScreenOff: F.turnScreenOff.checked,
    showTouches: F.showTouches.checked,
    powerOffOnClose: F.powerOffOnClose.checked,
  };
}

function saveForm() {
  setSettings({ ...collectOptions(), qualityPreset: F.preset.value, autoConnect: F.autoConnect.checked });
}

F.preset.addEventListener('change', () => {
  const v = presetValues(F.preset.value);
  if (v) writeQualityFields(v);
  else $('#advanced').open = true;
  updatePresetDesc();
  saveForm();
});
for (const el of [F.maxSize, F.bitrate, F.maxFps, F.codec]) {
  el.addEventListener('change', () => {
    F.preset.value = detectPreset(collectOptions());
    updatePresetDesc();
    saveForm();
  });
}
for (const el of [F.stayAwake, F.turnScreenOff, F.showTouches, F.powerOffOnClose, F.audio, F.autoConnect]) {
  el.addEventListener('change', () => { saveForm(); if (el === F.autoConnect && el.checked) maybeAutoConnect(); });
}

$('#connect-btn').addEventListener('click', () => { if (state.selected) connect(state.selected); });
$('#banner-close').addEventListener('click', () => showBanner(''));

/* ------------------------------------------------------------------------------------------ */
/* Session lifecycle                                                                          */
/* ------------------------------------------------------------------------------------------ */

async function connect(serial) {
  if (!emule || state.connecting || state.connected) return;
  const opts = collectOptions();
  audio.prepare(); // inside the click gesture when user-initiated → AudioContext may start
  showBanner('');
  state.connecting = true;
  state.serial = serial;
  state.info = null;
  state.screenOff = false;
  state.panelOpen = false;
  state.audioMsg = '';
  state.autoArmed.delete(serial);
  updateConnectButton();

  const dev = state.devices.find((d) => d.serial === serial);
  showScreen('mirror');
  setLoading('Conectando a ' + (dev && dev.model ? dev.model.replace(/_/g, ' ') : serial) + '…');
  touch.reset();
  input.reset();
  video.start({ codec: opts.videoCodec, width: 0, height: 0 });
  if (opts.audio) audio.start('raw'); else audio.stop();
  setSettings({ ...opts, lastSerial: serial, qualityPreset: F.preset.value, autoConnect: F.autoConnect.checked });

  let info;
  try {
    info = await emule.connect(serial, opts);
  } catch (e) {
    state.connecting = false;
    video.stop();
    audio.stop();
    showScreen('start');
    showBanner((e && e.message) ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Falha ao conectar.');
    updateConnectButton();
    return;
  }

  state.connecting = false;
  state.connected = true;
  state.info = info;
  video.updateInfo(info.video);
  setLoading('Aguardando o primeiro quadro…');
  hud.hidden = !state.settings.showFps;

  if (!opts.audio) {
    state.audioMsg = 'Áudio desativado nas opções.';
  } else if (!info.audio || info.audio.codec !== 'raw') {
    audio.stop();
    state.audioMsg = AUDIO_UNAVAILABLE_MSG;
    toast(AUDIO_UNAVAILABLE_MSG, { ms: 4000 });
  } else {
    state.audioMsg = '';
  }
  updateAudioUI();

  layoutVideo();
  fitWindow();
  if (opts.turnScreenOff) {
    send(C.setDisplayPower(false));
    state.screenOff = true;
  }
  if (state.settings.alwaysOnTop) emule.setAlwaysOnTop(true);
  updateToolbarState();
}

/** Tear down everything locally. reason → banner on the start screen. */
function endSession(reason) {
  if (!state.connected && !state.connecting) return;
  if (state.connecting) return; // connect() rejection path shows the error
  if (editor && editor.isOpen) closeEditor();
  if (keymap) keymap.releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  state.connected = false;
  touch.reset();
  input.reset();
  video.stop();
  audio.stop();
  state.info = null;
  hud.hidden = true;
  emule.isFullscreen().then((fs) => { if (fs) emule.setFullscreen(false); }).catch(() => {});
  showScreen('start');
  if (reason) showBanner(reason);
  updateConnectButton();
}

async function disconnect() {
  if (!state.connected) return;
  // lift fingers / keys while the control socket is still up
  if (keymap) keymap.releaseAll();
  input.releaseAll();
  touch.releaseAll();
  state.userDisconnecting = true;
  try { await emule.disconnect(); } catch (e) { console.warn('[app] disconnect', e); }
  state.userDisconnecting = false;
  endSession(null);
}

/* ------------------------------------------------------------------------------------------ */
/* Event routing                                                                              */
/* ------------------------------------------------------------------------------------------ */

function route(e) {
  if (keymap) {
    let consumed = false;
    try { consumed = keymap.handleEvent(e); } catch (err) { console.error('[keymap] handleEvent', err); }
    if (consumed) return;
  }
  input.handle(e);
}

// High-rate raw mouse events (up to the mouse polling rate, not aligned to display frames like
// 'mousemove'). Used for drags and aim mode, where every millisecond of input lag counts.
const RAW_MOUSE = typeof window.onpointerrawupdate !== 'undefined';
const highRateMove = () => input.dragging || (keymap && keymap.lookActive);

function onMouseEvent(e) {
  if (!state.connected) return;
  if (editor && editor.isOpen) return;
  if (e.type === 'pointerrawupdate') {
    if (e.pointerType !== 'mouse' || !highRateMove()) return;
  } else if (RAW_MOUSE && e.type === 'mousemove' && highRateMove()) {
    return; // handled by pointerrawupdate
  }
  const locked = !!document.pointerLockElement;
  const inVideo = videoArea.contains(e.target);
  if (e.type === 'mousedown' && !e.target.closest?.('.popover, #toolbar')) closePopovers();
  if (locked || inVideo) {
    if (e.type === 'mousedown') audio.resume();
    route(e);
    return;
  }
  // outside the video: only finish what was started on it
  if (e.type === 'mouseup') route(e);
  else if ((e.type === 'mousemove' || e.type === 'pointerrawupdate') && highRateMove()) route(e);
}
for (const t of ['mousedown', 'mouseup', 'mousemove', 'wheel', 'contextmenu', 'auxclick', ...(RAW_MOUSE ? ['pointerrawupdate'] : [])]) {
  window.addEventListener(t, onMouseEvent, { capture: true, passive: false });
}

function appShortcut(e) {
  if (e.type !== 'keydown') return false;
  const mirror = state.connected;
  if (e.code === 'F11') {
    e.preventDefault();
    if (!e.repeat) toggleFullscreen();
    return true;
  }
  if (!mirror) return false;
  if (editor && editor.isOpen) return false;
  const ctrl = e.ctrlKey && !e.altKey;
  if (e.code === 'F12' || (ctrl && !e.shiftKey && e.code === 'KeyK')) {
    e.preventDefault();
    if (!e.repeat) toggleKeymap();
    return true;
  }
  if (ctrl && e.shiftKey && e.code === 'KeyE') { e.preventDefault(); if (!e.repeat) openEditor(); return true; }
  if (ctrl && e.shiftKey && e.code === 'KeyH') { e.preventDefault(); if (!e.repeat) toggleHud(); return true; }
  if (e.code === 'F1') { e.preventDefault(); if (!e.repeat) togglePopover('help', $('[data-action=help]')); return true; }
  if (e.code === 'Escape' && openPopover) { e.preventDefault(); closePopovers(); return true; }
  return false;
}

function onKeyEvent(e) {
  if (appShortcut(e)) return;
  if (!state.connected) return;
  if (editor && editor.isOpen) return;
  if (isTypingTarget(e.target)) return;
  audio.resume();
  route(e);
}
window.addEventListener('keydown', onKeyEvent, true);
window.addEventListener('keyup', onKeyEvent, true);

window.addEventListener('blur', () => {
  if (keymap) keymap.releaseAll();
  input.releaseAll();
  touch.releaseAll();
});

/* ------------------------------------------------------------------------------------------ */
/* Toolbar                                                                                    */
/* ------------------------------------------------------------------------------------------ */

const ACTIONS = {
  back: () => sendAll(C.keyPress(C.KEYCODE.BACK)),
  home: () => sendAll(C.keyPress(C.KEYCODE.HOME)),
  recents: () => sendAll(C.keyPress(C.KEYCODE.APP_SWITCH)),
  volup: () => sendAll(C.keyPress(C.KEYCODE.VOLUME_UP)),
  voldown: () => sendAll(C.keyPress(C.KEYCODE.VOLUME_DOWN)),
  power: () => sendAll(C.keyPress(C.KEYCODE.POWER)),
  rotate: () => send(C.rotateDevice()),
  notifications: () => {
    state.panelOpen = !state.panelOpen;
    send(state.panelOpen ? C.expandNotificationPanel() : C.collapsePanels());
  },
  screenshot: async () => {
    toast('Capturando a tela…');
    try {
      const p = await emule.screenshot();
      toast(p ? 'Captura salva em ' + p : 'Não foi possível capturar a tela', { error: !p, ms: 4000 });
    } catch (e) { toast('Falha na captura: ' + (e.message || e), { error: true }); }
  },
  apk: async () => {
    try {
      const msg = await emule.installApk();
      if (msg) toast(msg, { ms: 5000 });
    } catch (e) { toast('Falha ao instalar: ' + (e.message || e), { error: true }); }
  },
  screenoff: () => {
    state.screenOff = !state.screenOff;
    send(C.setDisplayPower(!state.screenOff));
    toast(state.screenOff ? 'Tela do celular desligada — o espelhamento continua' : 'Tela do celular ligada');
  },
  fullscreen: () => toggleFullscreen(),
  ontop: () => {
    const on = !state.settings.alwaysOnTop;
    emule.setAlwaysOnTop(on);
    setSettings({ alwaysOnTop: on });
    toast(on ? 'Sempre no topo: ativado' : 'Sempre no topo: desativado');
  },
  pcvolume: (btn) => togglePopover('volume', btn),
  keymap: () => toggleKeymap(),
  editkeymap: () => openEditor(),
  profile: (btn) => togglePopover('profile', btn),
  stats: () => toggleHud(),
  help: (btn) => togglePopover('help', btn),
  disconnect: () => disconnect(),
};

$('#toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  btn.blur(); // keep keyboard focus off the button (Space/Enter go to the phone)
  const fn = ACTIONS[btn.dataset.action];
  if (fn) fn(btn);
  updateToolbarState();
});

function updateToolbarState() {
  const set = (a, on) => { const b = $(`[data-action=${a}]`); if (b) b.classList.toggle('active', !!on); };
  set('screenoff', state.screenOff);
  set('ontop', state.settings.alwaysOnTop);
  set('keymap', keymap && keymap.enabled && keymap.profile);
  set('stats', !hud.hidden);
  set('fullscreen', document.body.classList.contains('fullscreen'));
  set('notifications', state.panelOpen);
  const kmBtn = $('[data-action=keymap]');
  if (kmBtn) {
    kmBtn.disabled = !keymap;
    const name = keymap && keymap.profile ? keymap.profile.name : null;
    kmBtn.title = !keymap ? 'Mapeamento de teclas indisponível'
      : `Mapeamento de teclas: ${keymap.enabled ? 'ON' : 'OFF'}${name ? ' — ' + name : ' (sem perfil)'} (F12 ou Ctrl+K)`;
  }
  const edBtn = $('[data-action=editkeymap]');
  if (edBtn) edBtn.disabled = !editor;
  const prBtn = $('[data-action=profile]');
  if (prBtn) prBtn.disabled = !keymap;
}

async function toggleFullscreen() {
  if (!emule) return;
  let fs = false;
  try { fs = await emule.isFullscreen(); } catch { /* ignore */ }
  emule.setFullscreen(!fs);
  document.body.classList.toggle('fullscreen', !fs);
  setTimeout(() => { layoutVideo(); updateToolbarState(); }, 120);
}

function toggleHud() {
  hud.hidden = !hud.hidden;
  setSettings({ showFps: !hud.hidden });
  updateHud();
  updateToolbarState();
}

/* popovers */
let openPopover = null;
function togglePopover(name, anchor) {
  const el = $('#pop-' + name);
  if (!el) return;
  if (openPopover === el) { closePopovers(); return; }
  closePopovers();
  if (name === 'profile') refreshProfiles();
  if (name === 'volume') updateAudioUI();
  el.hidden = false;
  openPopover = el;
  const r = anchor ? anchor.getBoundingClientRect() : { top: 60 };
  const h = el.offsetHeight;
  el.style.top = Math.max(8, Math.min(r.top, window.innerHeight - h - 8)) + 'px';
}
function closePopovers() {
  for (const el of document.querySelectorAll('.popover')) el.hidden = true;
  openPopover = null;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
}

/* PC audio volume */
const volSlider = $('#volume-slider');
function updateAudioUI() {
  volSlider.value = String(Math.round(audio.volume * 100));
  $('#volume-value').textContent = Math.round(audio.volume * 100) + '%';
  $('#mute-btn').classList.toggle('muted', audio.muted);
  $('#audio-status').textContent = state.audioMsg || (audio.active ? 'Áudio do celular tocando no PC.' : '');
  const b = $('[data-action=pcvolume]');
  if (b) b.classList.toggle('active', audio.active && !audio.muted);
}
volSlider.addEventListener('input', () => {
  audio.setVolume(Number(volSlider.value) / 100);
  if (audio.muted && audio.volume > 0) audio.setMuted(false);
  updateAudioUI();
});
volSlider.addEventListener('change', () => setSettings({ pcVolume: audio.volume, pcMuted: audio.muted }));
$('#mute-btn').addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  setSettings({ pcMuted: audio.muted });
  updateAudioUI();
});

/* ------------------------------------------------------------------------------------------ */
/* Keymap (agent C modules, loaded dynamically; mirroring works without them)                 */
/* ------------------------------------------------------------------------------------------ */

async function loadKeymapModules() {
  try {
    const m = await import('./keymap/engine.js');
    if (typeof m.formatKeyLabel === 'function') formatKeyLabel = m.formatKeyLabel;
    keymap = new m.KeymapEngine({ touch, videoElement: canvas, overlay, getFrameSize });
  } catch (e) {
    console.warn('[app] mapeamento de teclas indisponível', e);
    keymap = null;
  }
  try {
    const m = await import('./keymap/editor.js');
    editor = new m.KeymapEditor({ overlay, getFrameSize });
    editor.onSave((p) => onEditorSave(p));
    editor.onCancel(() => closeEditor());
  } catch (e) {
    console.warn('[app] editor de mapeamento indisponível', e);
    editor = null;
  }
  try {
    const m = await import('./keymap/presets.js');
    PRESETS = Array.isArray(m.PRESETS) ? m.PRESETS : [];
  } catch (e) {
    console.warn('[app] perfis de exemplo indisponíveis', e);
    PRESETS = [];
  }
  if (!keymap) return;
  keymap.setEnabled(state.settings.keymapEnabled !== false);
  keymap.onStateChange((s) => {
    if (s.lookActive !== state.lastLook) {
      state.lastLook = s.lookActive;
      const p = keymap.profile;
      const key = formatKeyLabel(p && p.lookToggleKey);
      if (s.lookActive) {
        toast(p && p.lookToggleMode === 'hold' ? `Modo mira ativado — solte ${key} para sair` : `Modo mira ativado — ${key} para sair`);
      } else {
        toast('Modo mira desativado');
      }
    }
    updateToolbarState();
  });
  await loadInitialProfile();
}

const clone = (o) => JSON.parse(JSON.stringify(o));

async function refreshProfiles() {
  if (!emule) return;
  try { state.userProfiles = await emule.listProfiles(); } catch { state.userProfiles = []; }
  const sel = $('#profile-select');
  sel.textContent = '';
  const none = new Option('— Nenhum —', '');
  sel.appendChild(none);
  if (state.userProfiles.length) {
    const g = document.createElement('optgroup');
    g.label = 'Meus perfis';
    for (const n of state.userProfiles) g.appendChild(new Option(n, 'user:' + n));
    sel.appendChild(g);
  }
  if (PRESETS.length) {
    const g = document.createElement('optgroup');
    g.label = 'Exemplos';
    PRESETS.forEach((p, i) => g.appendChild(new Option(p.name, 'preset:' + i)));
    sel.appendChild(g);
  }
  sel.value = state.profileKey;
  if (sel.value !== state.profileKey) sel.value = '';
  const isUser = state.profileKey.startsWith('user:');
  $('#profile-delete').disabled = !isUser;
  $('#profile-export').disabled = !(keymap && keymap.profile);
  $('#profile-edit').disabled = !editor;
  $('#profile-new').disabled = !editor;
  $('#profile-hint').textContent = keymap && keymap.profile
    ? (keymap.enabled ? 'Mapeamento ligado.' : 'Mapeamento desligado — F12 para ligar.')
    : 'Escolha um perfil ou crie um novo.';
}

async function applyProfileKey(key, { persist = true } = {}) {
  if (!keymap) return;
  let profile = null;
  if (key.startsWith('user:')) {
    try { profile = await emule.loadProfile(key.slice(5)); } catch (e) { console.warn(e); }
    if (!profile) { toast('Não foi possível carregar o perfil', { error: true }); key = ''; }
  } else if (key.startsWith('preset:')) {
    const p = PRESETS[Number(key.slice(7))];
    profile = p ? clone(p) : null;
    if (!profile) key = '';
  }
  touch.releaseAll();
  keymap.setProfile(profile);
  state.profileKey = key;
  if (persist) setSettings({ lastProfile: profile ? profile.name : null });
  updateToolbarState();
}

async function loadInitialProfile() {
  const name = state.settings.lastProfile;
  if (!name || !emule) return;
  try { state.userProfiles = await emule.listProfiles(); } catch { state.userProfiles = []; }
  if (state.userProfiles.includes(name)) return applyProfileKey('user:' + name, { persist: false });
  const i = PRESETS.findIndex((p) => p.name === name);
  if (i >= 0) return applyProfileKey('preset:' + i, { persist: false });
}

$('#profile-select').addEventListener('change', async (e) => {
  await applyProfileKey(e.target.value);
  e.target.blur();
  refreshProfiles();
  if (keymap && keymap.profile) toast(`Perfil "${keymap.profile.name}" carregado`);
});
$('#profile-new').addEventListener('click', () => { closePopovers(); openEditor(null); });
$('#profile-edit').addEventListener('click', () => { closePopovers(); openEditor(); });
$('#profile-import').addEventListener('click', async () => {
  try {
    const p = await emule.importProfile();
    if (!p) return;
    await emule.saveProfile(p);
    await refreshProfiles();
    await applyProfileKey('user:' + p.name);
    refreshProfiles();
    toast(`Perfil "${p.name}" importado`);
  } catch (e) { toast('Falha ao importar: ' + (e.message || e), { error: true }); }
});
$('#profile-export').addEventListener('click', async () => {
  if (!keymap || !keymap.profile) return;
  try {
    const ok = await emule.exportProfile(clone(keymap.profile));
    if (ok) toast('Perfil exportado');
  } catch (e) { toast('Falha ao exportar: ' + (e.message || e), { error: true }); }
});
$('#profile-delete').addEventListener('click', async () => {
  if (!state.profileKey.startsWith('user:')) return;
  const name = state.profileKey.slice(5);
  if (!window.confirm(`Excluir o perfil "${name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await emule.deleteProfile(name);
    await applyProfileKey('');
    refreshProfiles();
    toast(`Perfil "${name}" excluído`);
  } catch (e) { toast('Falha ao excluir: ' + (e.message || e), { error: true }); }
});

function toggleKeymap() {
  if (!keymap) { toast('Mapeamento de teclas indisponível', { error: true }); return; }
  const on = !keymap.enabled;
  keymap.setEnabled(on);
  if (typeof keymap.setHintsVisible === 'function') keymap.setHintsVisible(on);
  setSettings({ keymapEnabled: on });
  if (on && !keymap.profile) toast('Mapeamento ativado — escolha um perfil em "Perfil"');
  else toast(on ? 'Mapeamento de teclas ativado' : 'Mapeamento de teclas desativado');
  updateToolbarState();
}

/** profile === undefined → edit the current profile. */
function openEditor(profile) {
  if (!editor) { toast('Editor de mapeamento indisponível', { error: true }); return; }
  if (!state.connected) return;
  closePopovers();
  if (keymap) keymap.releaseAll();
  input.releaseAll();
  touch.releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  const p = profile === undefined ? (keymap && keymap.profile ? clone(keymap.profile) : null) : profile;
  overlay.classList.add('editing');
  if (keymap && typeof keymap.setHintsVisible === 'function') keymap.setHintsVisible(false);
  editor.open(p);
}

function closeEditor() {
  if (editor && editor.isOpen) editor.close();
  overlay.classList.remove('editing');
  if (keymap && typeof keymap.setHintsVisible === 'function') keymap.setHintsVisible(keymap.enabled);
}

async function onEditorSave(p) {
  try {
    await emule.saveProfile(p);
  } catch (e) {
    toast('Falha ao salvar o perfil: ' + (e.message || e), { error: true });
    return;
  }
  closeEditor();
  if (keymap) keymap.setProfile(p);
  state.profileKey = 'user:' + p.name;
  setSettings({ lastProfile: p.name });
  refreshProfiles();
  toast(`Perfil "${p.name}" salvo`);
  updateToolbarState();
}

/* ------------------------------------------------------------------------------------------ */
/* HUD                                                                                        */
/* ------------------------------------------------------------------------------------------ */

const CODEC_NAMES = { h264: 'H.264', h265: 'H.265', av1: 'AV1' };
function updateHud() {
  if (hud.hidden || !state.connected) return;
  const s = video.stats;
  const codec = (CODEC_NAMES[video.family] || video.family || '—') + (video.codecString ? ` (${video.codecString})` : '');
  const audioLine = audio.active
    ? `${audio.bufferedMs.toFixed(0)} ms (+${Math.max(0, audio.latencyMs - audio.bufferedMs).toFixed(0)} ms saída) falhas ${audio.underruns}${audio.suspended ? ' — clique para ativar' : ''}`
    : 'desligado';
  hud.textContent = [
    `FPS        ${s.fps}`,
    `Resolução  ${s.width}×${s.height}`,
    `Codec      ${codec}`,
    `Bitrate    ${(s.bitrate / 1e6).toFixed(1)} Mbps`,
    `Fila dec.  ${s.decodeQueue}   descartados ${s.dropped}`,
    `Decodif.   ${s.hardware === 'prefer-hardware' ? 'hardware' : 'software/auto'}`,
    `Áudio buf  ${audioLine}`,
  ].join('\n');
}

setInterval(() => {
  if (!state.connected) return;
  if (!$('#loading').hidden && video.totalFrames > 0) setLoading(null);
  updateHud();
}, 250);

/* ------------------------------------------------------------------------------------------ */
/* Init                                                                                       */
/* ------------------------------------------------------------------------------------------ */

async function init() {
  if (!emule) {
    showBanner('API do Emule indisponível (preload não carregado).');
    return;
  }

  // media / session subscriptions (once, for the whole app lifetime)
  emule.onVideoPacket((p) => { if (state.connected || state.connecting) video.push(p); });
  emule.onAudioPacket((p) => { if (state.connected || state.connecting) audio.push(p); });
  emule.onSessionEnded((reason) => {
    if (state.userDisconnecting) return;
    endSession(reason || 'A conexão com o celular foi encerrada.');
  });
  emule.onDeviceMessage((msg) => {
    if (msg && msg.type === 'audioDisabled') {
      audio.stop();
      if (state.connected || state.connecting) {
        state.audioMsg = AUDIO_UNAVAILABLE_MSG;
        toast(AUDIO_UNAVAILABLE_MSG, { ms: 4000 });
        updateAudioUI();
      }
      return;
    }
    if (msg && msg.type === 'clipboard' && typeof msg.text === 'string') {
      navigator.clipboard.writeText(msg.text)
        .then(() => toast('Texto copiado do celular para o PC'))
        .catch((e) => console.warn('[app] clipboard write', e));
    }
  });

  try {
    const s = await emule.getSettings();
    state.settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
  } catch (e) { console.warn('[app] getSettings', e); }

  state.h265 = await isHevcSupported().catch(() => false);
  loadForm();

  audio.setVolume(typeof state.settings.pcVolume === 'number' ? state.settings.pcVolume : 1);
  audio.setMuted(!!state.settings.pcMuted);
  hud.hidden = !state.settings.showFps;
  if (state.settings.lastSerial) state.autoArmed.add(state.settings.lastSerial);

  emule.getVersions().then((v) => { if (v && v.app) $('#version').textContent = 'v' + v.app; }).catch(() => {});

  await loadKeymapModules();
  updateToolbarState();

  emule.onDevicesChanged(onDevices);
  try { onDevices(await emule.listDevices()); } catch (e) { console.warn('[app] listDevices', e); renderDevices(); }
}

init().catch((e) => {
  console.error('[app] init', e);
  showBanner('Erro ao iniciar: ' + (e.message || e));
});
