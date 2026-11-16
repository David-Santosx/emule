// Emule — keymap editor (owner: C)
// Full-overlay editing mode drawn over the visible video rect. All positions are percentages
// of the overlay, so app.js only has to keep the overlay sized to the video.

import {
  formatKeyLabel, normalizeProfile, validateProfile, newId, controlTypeName, KM_DEFAULTS,
} from './engine.js';

const DIRS = ['up', 'down', 'left', 'right'];
const DIR_LABEL = { up: 'Cima', down: 'Baixo', left: 'Esquerda', right: 'Direita' };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r4 = (v) => Math.round(v * 10000) / 10000;
const pct = (v) => (v * 100).toFixed(3) + '%';
const SVGNS = 'http://www.w3.org/2000/svg';

export class KeymapEditor {
  /**
   * @param {{ overlay: HTMLElement, getFrameSize?: () => {width,height} }} o
   */
  constructor({ overlay, getFrameSize } = {}) {
    if (!overlay) throw new Error('KeymapEditor: overlay é obrigatório');
    this._overlay = overlay;
    this._doc = overlay.ownerDocument;
    this._getFrameSize = getFrameSize || null;
    this._open = false;
    this._saveCbs = new Set();
    this._cancelCbs = new Set();
    this._widgets = new Map(); // controlId -> { group, update }
    this._p = null;
    this._sel = null;
    this._usage = new Map();
    this._errorIds = new Set();
    this._capture = null;
    this._confirmTimers = new Map();
    this._toastTimer = null;
    this._onKeyEvent = this._onKeyEvent.bind(this);
  }

  get isOpen() { return this._open; }

  onSave(cb) { this._saveCbs.add(cb); return () => this._saveCbs.delete(cb); }
  onCancel(cb) { this._cancelCbs.add(cb); return () => this._cancelCbs.delete(cb); }

  /** Opens the editor on a deep copy of `profile` (null = new empty profile). */
  open(profile) {
    if (this._open) this.close();
    this._p = normalizeProfile(profile || { name: '', lookToggleKey: 'Backquote', controls: [] });
    if (!this._p.lookToggleKey) this._p.lookToggleKey = 'Backquote';
    this._sel = null;
    this._dirty = false;
    this._errorIds = new Set();
    this._open = true;
    this._build();
    const win = this._doc.defaultView;
    win.addEventListener('keydown', this._onKeyEvent, true);
    win.addEventListener('keyup', this._onKeyEvent, true);
    this._overlay.classList.add('km-editing');
    this._renderAllWidgets();
    this._renderProps();
  }

  /** Closes without firing callbacks. */
  close() {
    if (!this._open) return;
    this._open = false;
    const win = this._doc.defaultView;
    win.removeEventListener('keydown', this._onKeyEvent, true);
    win.removeEventListener('keyup', this._onKeyEvent, true);
    for (const t of this._confirmTimers.values()) clearTimeout(t);
    this._confirmTimers.clear();
    clearTimeout(this._toastTimer);
    this._capture = null;
    this._root?.remove();
    this._root = null;
    this._widgets.clear();
    this._overlay.classList.remove('km-editing');
  }

  /* ====================================================================================== */
  /* DOM construction                                                                       */
  /* ====================================================================================== */

  _el(tag, cls, text) {
    const el = this._doc.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  _btn(text, cls, onClick, title) {
    const b = this._el('button', 'km-btn ' + (cls || ''), text);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
    return b;
  }

  _build() {
    const root = this._el('div', 'km-editor');
    this._root = root;
    // keep mouse/wheel/context-menu inside the editor
    for (const t of ['mousedown', 'mouseup', 'click', 'auxclick', 'wheel', 'dblclick']) {
      root.addEventListener(t, (e) => e.stopPropagation());
    }
    root.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

    const layer = this._el('div', 'km-ed-layer');
    layer.addEventListener('pointerdown', (e) => {
      if (e.target === layer) this._select(null);
    });
    this._layer = layer;

    const ui = this._el('div', 'km-ed-ui');
    this._ui = ui;
    ui.appendChild(this._buildBar());
    this._props = this._el('div', 'km-ed-props km-panel');
    this._props.addEventListener('pointerdown', (e) => e.stopPropagation());
    ui.appendChild(this._props);

    this._toastEl = this._el('div', 'km-ed-toast');
    this._toastEl.hidden = true;

    this._capEl = this._buildCapture();

    root.append(layer, ui, this._toastEl, this._capEl);
    this._overlay.appendChild(root);
  }

  _buildBar() {
    const bar = this._el('div', 'km-ed-bar km-panel');
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());

    const title = this._el('span', 'km-ed-title', 'Editor de teclas');

    const add = this._el('div', 'km-group');
    add.append(
      this._btn('+ Toque', '', () => this._add('tap'), 'Toque: segura enquanto a tecla estiver pressionada'),
      this._btn('+ Joystick', '', () => this._add('joystick'), 'Direcional de 4 teclas (WASD)'),
      (this._addLookBtn = this._btn('+ Mira', '', () => this._add('look'), 'Mira com o mouse (câmera de FPS) — apenas uma por perfil')),
      this._btn('+ Deslizar', '', () => this._add('swipe'), 'Deslizar de um ponto a outro'),
      this._btn('+ Macro', '', () => this._add('multitap'), 'Sequência de toques'),
    );

    const name = this._el('input', 'km-input km-name');
    name.type = 'text';
    name.placeholder = 'Nome do perfil';
    name.maxLength = 80;
    name.value = this._p.name;
    name.addEventListener('input', () => { this._p.name = name.value; this._dirty = true; name.classList.remove('km-invalid'); });
    this._nameInput = name;

    const look = this._el('div', 'km-group km-lookcfg');
    look.append(this._el('span', 'km-lbl', 'Mira:'));
    this._lookKeyBtn = this._btn('', 'km-keycap', () => {
      this._captureKey('Tecla do modo mira', false, (k) => {
        this._p.lookToggleKey = k; this._changed();
      });
    }, 'Tecla (ou botão do mouse) que ativa o modo mira');
    look.append(this._lookKeyBtn);
    const mode = this._el('select', 'km-input km-select');
    for (const [v, t] of [['toggle', 'Alternar'], ['hold', 'Segurar']]) {
      const o = this._el('option', null, t); o.value = v; mode.appendChild(o);
    }
    mode.value = this._p.lookToggleMode;
    mode.title = 'Alternar: aperta uma vez para ligar e outra para desligar. Segurar: ativo só enquanto a tecla estiver pressionada.';
    mode.addEventListener('change', () => { this._p.lookToggleMode = mode.value === 'hold' ? 'hold' : 'toggle'; this._dirty = true; });
    look.append(mode);
    this._lookCfg = look;

    const actions = this._el('div', 'km-group km-actions');
    actions.append(
      this._btn('⇅', 'km-icon', () => this._ui.classList.toggle('km-bottom'), 'Mover barra para cima/baixo'),
      (this._clearBtn = this._btn('Limpar tudo', 'km-danger', () => this._confirm(this._clearBtn, 'Confirmar?', () => this._clearAll()))),
      (this._cancelBtn = this._btn('Cancelar', '', () => this._cancel())),
      this._btn('Salvar', 'km-primary', () => this._save()),
    );

    bar.append(title, add, name, look, actions);
    return bar;
  }

  _buildCapture() {
    const cap = this._el('div', 'km-ed-capture');
    cap.hidden = true;
    const box = this._el('div', 'km-cap-box km-panel');
    this._capTitle = this._el('div', 'km-cap-title');
    const msg = this._el('div', 'km-cap-msg', 'Pressione uma tecla ou botão do mouse…');
    const sub = this._el('div', 'km-cap-sub', 'Também vale: rodinha para cima/baixo, botão do meio e laterais. Esc cancela.');
    const btns = this._el('div', 'km-cap-btns');
    this._capClear = this._btn('Remover tecla', 'km-cap-btn', () => this._finishCapture(null, true));
    btns.append(this._capClear, this._btn('Cancelar (Esc)', 'km-cap-btn', () => this._finishCapture(undefined)));
    box.append(this._capTitle, msg, sub, btns);
    cap.append(box);
    const isBtn = (e) => e.target && e.target.closest && e.target.closest('.km-cap-btn');
    cap.addEventListener('mousedown', (e) => {
      if (isBtn(e)) return;
      e.preventDefault(); e.stopPropagation();
      this._finishCapture('Mouse' + e.button);
    });
    cap.addEventListener('wheel', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.deltaY) this._finishCapture(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
    }, { passive: false });
    cap.addEventListener('pointerdown', (e) => e.stopPropagation());
    cap.addEventListener('auxclick', (e) => e.preventDefault());
    return cap;
  }

  /* ====================================================================================== */
  /* Key capture                                                                            */
  /* ====================================================================================== */

  _captureKey(title, allowClear, cb) {
    this._capture = { cb };
    this._capTitle.textContent = title;
    this._capClear.hidden = !allowClear;
    this._capEl.hidden = false;
  }

  /** key: string = captured, null+clear = remove key, undefined = cancelled. */
  _finishCapture(key, clear = false) {
    const c = this._capture;
    this._capture = null;
    this._capEl.hidden = true;
    if (!c) return;
    if (key === undefined) return;
    if (key === null && !clear) return;
    c.cb(key);
    if (key) {
      const n = this._usage.get(key) || 0;
      if (n > 1) this._toast(`Tecla "${formatKeyLabel(key)}" usada em ${n} controles — todos serão acionados juntos.`, 'info');
    }
  }

  _onKeyEvent(e) {
    if (!this._open) return;
    // Never let key events reach the app / device while editing.
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (this._capture) {
      e.preventDefault();
      if (e.type !== 'keydown' || e.repeat) return;
      if (e.code === 'Escape') this._finishCapture(undefined);
      else if (e.code) this._finishCapture(e.code);
      return;
    }
    const t = e.target;
    const tag = t && t.tagName;
    const typing = (tag === 'INPUT' && !['checkbox', 'range', 'button'].includes(t.type)) || tag === 'TEXTAREA' || tag === 'SELECT';
    if (typing) {
      if (e.type === 'keydown' && (e.key === 'Enter' || e.key === 'Escape') && tag !== 'SELECT') t.blur();
      return; // default action (typing) allowed
    }
    if (e.type !== 'keydown') return;
    if (/^F\d+$/.test(e.code) || e.code === 'Tab') return;
    e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { this._save(); return; }
    if (e.code === 'Escape') { this._select(null); return; }
    if ((e.code === 'Delete' || e.code === 'Backspace') && this._sel) { this._delete(this._sel); return; }
    const nudge = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.code];
    if (nudge && this._sel) {
      const step = e.shiftKey ? 0.01 : 0.002;
      this._nudge(this._selControl(), nudge[0] * step, nudge[1] * step);
    }
  }

  /* ====================================================================================== */
  /* Model operations                                                                       */
  /* ====================================================================================== */

  _selControl() { return this._p.controls.find((c) => c.id === this._sel) || null; }

  _add(type) {
    const n = this._p.controls.length;
    const off = (n % 5) * 0.03;
    let c;
    switch (type) {
      case 'tap': c = { id: newId(), type, key: null, x: r4(0.5 + off), y: r4(0.5 + off) }; break;
      case 'joystick': {
        const used = this._usage;
        const keys = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
        if (DIRS.some((d) => used.has(keys[d]))) {
          Object.assign(keys, { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' });
        }
        c = { id: newId(), type, keys, x: 0.17, y: 0.7, radius: 0.12 };
        break;
      }
      case 'look':
        if (this._p.controls.some((x) => x.type === 'look')) { this._toast('Já existe uma Mira neste perfil.', 'warn'); return; }
        c = { id: newId(), type, x: 0.62, y: 0.42, sensitivityX: 1, sensitivityY: 1, invertY: false, smoothing: 0 };
        if (!this._p.lookToggleKey) this._p.lookToggleKey = 'Backquote';
        break;
      case 'swipe': c = { id: newId(), type, key: null, x: 0.5, y: 0.72, x2: 0.5, y2: 0.42, durationMs: 120 }; break;
      case 'multitap':
        c = { id: newId(), type, key: null, points: [
          { x: r4(0.45 + off), y: 0.5, delayMs: 0 }, { x: r4(0.55 + off), y: 0.5, delayMs: 60 },
        ] };
        break;
      default: return;
    }
    this._p.controls.push(c);
    this._dirty = true;
    this._buildWidget(c);
    this._select(c.id);
    this._refresh();
    if (type === 'tap' || type === 'swipe' || type === 'multitap') {
      this._captureKey(`Tecla para ${controlTypeName(type)}`, false, (k) => { c.key = k; this._changed(); });
    }
  }

  _delete(id) {
    const i = this._p.controls.findIndex((c) => c.id === id);
    if (i < 0) return;
    this._p.controls.splice(i, 1);
    this._dirty = true;
    const w = this._widgets.get(id);
    w?.group.remove();
    this._widgets.delete(id);
    if (this._sel === id) this._sel = null;
    this._renderProps();
    this._refresh();
  }

  _clearAll() {
    this._p.controls = [];
    this._sel = null;
    this._dirty = true;
    this._renderAllWidgets();
    this._renderProps();
  }

  _nudge(c, dx, dy) {
    if (!c) return;
    const mv = (o, kx, ky) => { o[kx] = r4(clamp(o[kx] + dx, 0, 1)); o[ky] = r4(clamp(o[ky] + dy, 0, 1)); };
    if (c.type === 'multitap') c.points.forEach((p) => mv(p, 'x', 'y'));
    else { mv(c, 'x', 'y'); if (c.type === 'swipe') mv(c, 'x2', 'y2'); }
    this._dirty = true;
    this._widgets.get(c.id)?.update();
  }

  /** Something other than position changed: update widgets, usage badges, props. */
  _changed({ props = true } = {}) {
    this._dirty = true;
    this._refresh();
    if (props) this._renderProps();
  }

  _refresh() {
    const v = validateProfile(normalizeProfile(this._p));
    this._usage = v.keyUsage;
    for (const w of this._widgets.values()) w.update();
    this._lookKeyBtn.textContent = formatKeyLabel(this._p.lookToggleKey);
    const hasLook = this._p.controls.some((c) => c.type === 'look');
    this._addLookBtn.disabled = hasLook;
    this._lookCfg.classList.toggle('km-muted', !hasLook);
    this._lookKeyBtn.classList.toggle('km-invalid', this._errorIds.has('__lookToggle'));
  }

  _select(id) {
    if (this._sel === id) return;
    this._sel = id;
    for (const [wid, w] of this._widgets) w.group.classList.toggle('km-sel', wid === id);
    this._renderProps();
  }

  _confirm(btn, text, action) {
    if (this._confirmTimers.has(btn)) {
      clearTimeout(this._confirmTimers.get(btn));
      this._confirmTimers.delete(btn);
      btn.textContent = btn.dataset.text;
      btn.classList.remove('km-confirming');
      action();
      return;
    }
    btn.dataset.text = btn.textContent;
    btn.textContent = text;
    btn.classList.add('km-confirming');
    this._confirmTimers.set(btn, setTimeout(() => {
      this._confirmTimers.delete(btn);
      btn.textContent = btn.dataset.text;
      btn.classList.remove('km-confirming');
    }, 3000));
  }

  _cancel() {
    const go = () => {
      this.close();
      for (const cb of this._cancelCbs) { try { cb(); } catch (err) { console.error(err); } }
    };
    if (this._dirty) this._confirm(this._cancelBtn, 'Descartar alterações?', go);
    else go();
  }

  _save() {
    this._p.name = this._nameInput.value;
    const profile = normalizeProfile(this._p);
    const v = validateProfile(profile);
    this._errorIds = v.conflictIds;
    this._nameInput.classList.toggle('km-invalid', !profile.name);
    this._refresh();
    if (!v.ok) {
      const list = [...new Set(v.errors)];
      this._toast('Não foi possível salvar: ' + list.slice(0, 3).join(' ') + (list.length > 3 ? ` (+${list.length - 3})` : ''), 'error');
      return;
    }
    this.close();
    for (const cb of this._saveCbs) { try { cb(profile); } catch (err) { console.error(err); } }
  }

  _toast(msg, kind = 'info') {
    if (!this._toastEl) return;
    this._toastEl.textContent = msg;
    this._toastEl.className = 'km-ed-toast km-' + kind;
    this._toastEl.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { if (this._toastEl) this._toastEl.hidden = true; }, kind === 'error' ? 6000 : 3500);
  }

  /* ====================================================================================== */
  /* Widgets                                                                                */
  /* ====================================================================================== */

  _renderAllWidgets() {
    this._layer.replaceChildren();
    this._widgets.clear();
    for (const c of this._p.controls) this._buildWidget(c);
    this._refresh();
  }

  _rebuildWidget(c) {
    this._widgets.get(c.id)?.group.remove();
    this._buildWidget(c);
    this._widgets.get(c.id).update();
  }

  _keyBadge(el, key) {
    const n = key ? this._usage.get(key) || 0 : 0;
    el.querySelector('.km-usage')?.remove();
    if (n > 1) {
      const b = this._el('span', 'km-usage', '×' + n);
      b.title = `Tecla usada em ${n} controles`;
      el.appendChild(b);
    }
  }

  _buildWidget(c) {
    const group = this._el('div', 'km-wg km-wg-' + c.type);
    group.dataset.id = c.id;
    if (this._sel === c.id) group.classList.add('km-sel');
    let update;
    const common = () => {
      group.classList.toggle('km-err', this._errorIds.has(c.id));
    };
    const handle = (cls, text) => {
      const h = this._el('div', 'km-h ' + cls);
      const s = this._el('span', 'km-h-lbl', text);
      h.appendChild(s);
      group.appendChild(h);
      return h;
    };
    const place = (el, x, y) => { el.style.left = pct(x); el.style.top = pct(y); };
    const setLabel = (h, text, key) => {
      h.firstChild.textContent = text;
      this._keyBadge(h, key);
    };

    switch (c.type) {
      case 'tap': {
        const h = handle('km-h-tap', '');
        this._drag(h, c, () => ({ x: c.x, y: c.y }), (x, y) => { c.x = x; c.y = y; });
        update = () => {
          common();
          place(h, c.x, c.y);
          setLabel(h, formatKeyLabel(c.key), c.key);
          h.classList.toggle('km-lookonly', !!c.lookOnly);
          h.classList.toggle('km-nokey', !c.key);
          h.title = 'Toque' + (c.lookOnly ? ' (só no modo mira)' : '');
        };
        break;
      }
      case 'look': {
        const h = handle('km-h-look', '');
        this._drag(h, c, () => ({ x: c.x, y: c.y }), (x, y) => { c.x = x; c.y = y; });
        update = () => {
          common();
          place(h, c.x, c.y);
          setLabel(h, 'Mira', null);
          h.title = 'Ponto onde o dedo da câmera fica pressionado';
        };
        break;
      }
      case 'joystick': {
        const ring = this._el('div', 'km-joy');
        const labels = {};
        for (const d of DIRS) {
          labels[d] = this._el('span', 'km-joy-k km-' + d);
          ring.appendChild(labels[d]);
        }
        const center = this._el('span', 'km-joy-c', 'Joystick');
        const rh = this._el('div', 'km-joy-resize');
        rh.title = 'Arraste para mudar o raio';
        ring.append(center, rh);
        group.appendChild(ring);
        this._drag(ring, c, () => ({ x: c.x, y: c.y }), (x, y) => { c.x = x; c.y = y; });
        this._dragRadius(rh, c);
        update = () => {
          common();
          place(ring, c.x, c.y);
          ring.style.height = pct(c.radius * 2);
          for (const d of DIRS) {
            labels[d].textContent = formatKeyLabel(c.keys[d]);
            this._keyBadge(labels[d], c.keys[d]);
          }
          center.textContent = c.sprintKey ? `Correr: ${formatKeyLabel(c.sprintKey)}` : 'Joystick';
        };
        break;
      }
      case 'swipe': {
        const svg = this._svg(group);
        const line = this._doc.createElementNS(SVGNS, 'line');
        svg.appendChild(line);
        const a = handle('km-h-swipe', '');
        const b = handle('km-h-swipe-end', 'Fim');
        this._drag(a, c, () => ({ x: c.x, y: c.y }), (x, y) => { c.x = x; c.y = y; });
        this._drag(b, c, () => ({ x: c.x2, y: c.y2 }), (x, y) => { c.x2 = x; c.y2 = y; });
        update = () => {
          common();
          place(a, c.x, c.y); place(b, c.x2, c.y2);
          setLabel(a, formatKeyLabel(c.key), c.key);
          a.classList.toggle('km-nokey', !c.key);
          line.setAttribute('x1', c.x * 100); line.setAttribute('y1', c.y * 100);
          line.setAttribute('x2', c.x2 * 100); line.setAttribute('y2', c.y2 * 100);
        };
        break;
      }
      case 'multitap': {
        const svg = this._svg(group);
        const poly = this._doc.createElementNS(SVGNS, 'polyline');
        svg.appendChild(poly);
        const hs = c.points.map((pt, i) => {
          const h = handle('km-h-mt', String(i + 1));
          this._drag(h, c, () => ({ x: pt.x, y: pt.y }), (x, y) => { pt.x = x; pt.y = y; });
          return h;
        });
        update = () => {
          common();
          c.points.forEach((pt, i) => {
            const h = hs[i];
            if (!h) return;
            place(h, pt.x, pt.y);
            setLabel(h, i === 0 ? `1 · ${formatKeyLabel(c.key)}` : String(i + 1), i === 0 ? c.key : null);
            h.classList.toggle('km-nokey', i === 0 && !c.key);
          });
          poly.setAttribute('points', c.points.map((pt) => `${pt.x * 100},${pt.y * 100}`).join(' '));
        };
        break;
      }
      default: return;
    }
    this._layer.appendChild(group);
    this._widgets.set(c.id, { group, update });
    update();
  }

  _svg(group) {
    const svg = this._doc.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'km-wg-svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    group.appendChild(svg);
    return svg;
  }

  /** Generic drag: moves a normalized point keeping the grab offset. */
  _drag(el, c, getPos, setPos) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.classList.contains('km-joy-resize')) return;
      e.preventDefault(); e.stopPropagation();
      this._select(c.id);
      const rect = this._layer.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const p0 = getPos();
      const sx = e.clientX, sy = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      el.classList.add('km-dragging');
      const move = (ev) => {
        setPos(
          r4(clamp(p0.x + (ev.clientX - sx) / rect.width, 0, 1)),
          r4(clamp(p0.y + (ev.clientY - sy) / rect.height, 0, 1)),
        );
        this._dirty = true;
        this._widgets.get(c.id)?.update();
      };
      const end = () => {
        el.classList.remove('km-dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', end);
        el.removeEventListener('pointercancel', end);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    });
  }

  _dragRadius(handleEl, c) {
    handleEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      this._select(c.id);
      const rect = this._layer.getBoundingClientRect();
      if (!rect.height) return;
      try { handleEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const move = (ev) => {
        const cx = rect.left + c.x * rect.width;
        const cy = rect.top + c.y * rect.height;
        c.radius = r4(clamp(Math.hypot(ev.clientX - cx, ev.clientY - cy) / rect.height, 0.03, 0.45));
        this._dirty = true;
        this._widgets.get(c.id)?.update();
        if (this._radiusInput) this._radiusInput(c.radius);
      };
      const end = () => {
        handleEl.removeEventListener('pointermove', move);
        handleEl.removeEventListener('pointerup', end);
        handleEl.removeEventListener('pointercancel', end);
      };
      handleEl.addEventListener('pointermove', move);
      handleEl.addEventListener('pointerup', end);
      handleEl.addEventListener('pointercancel', end);
    });
  }

  /* ====================================================================================== */
  /* Properties panel                                                                       */
  /* ====================================================================================== */

  _renderProps() {
    const P = this._props;
    if (!P) return;
    P.replaceChildren();
    this._radiusInput = null;
    const c = this._selControl();
    if (!c) {
      P.hidden = false;
      P.classList.add('km-props-empty');
      P.append(this._el('div', 'km-note',
        'Adicione controles na barra acima e arraste-os sobre o botão correspondente do jogo. ' +
        'Clique em um controle para editar. Setas ajustam a posição (Shift = passo maior), Delete remove.'));
      return;
    }
    P.hidden = false;
    P.classList.remove('km-props-empty');

    const head = this._el('div', 'km-props-head');
    head.append(
      this._el('strong', null, controlTypeName(c.type)),
      this._btn('◧', 'km-icon', () => P.classList.toggle('km-left'), 'Mover painel para o outro lado'),
      this._btn('Excluir', 'km-danger', () => this._delete(c.id)),
    );
    P.append(head);

    switch (c.type) {
      case 'tap':
        P.append(this._fieldKey('Tecla', () => c.key, (k) => { c.key = k; }));
        P.append(this._fieldCheck('Só no modo mira', !!c.lookOnly, (v) => {
          if (v) c.lookOnly = true; else delete c.lookOnly;
          this._changed({ props: false });
        }, 'Ativo apenas com a mira ligada. Fora dela, o botão/tecla funciona normalmente (ex.: clique esquerdo).'));
        break;
      case 'joystick':
        for (const d of DIRS) {
          P.append(this._fieldKey(DIR_LABEL[d], () => c.keys[d], (k) => { c.keys[d] = k; }));
        }
        P.append(this._fieldKey('Correr (opcional)', () => c.sprintKey || null, (k) => {
          if (k) c.sprintKey = k; else delete c.sprintKey;
        }, true));
        P.append(this._fieldNum('Raio', c.radius, 0.03, 0.45, 0.005, (v) => {
          c.radius = r4(v); this._dirty = true; this._widgets.get(c.id)?.update();
        }, (setter) => { this._radiusInput = setter; }));
        P.append(this._el('div', 'km-note',
          `Sem a tecla de correr o direcional vai a ${Math.round(KM_DEFAULTS.joystickWalk * 100)}% do raio; ` +
          'segurando-a vai a 100%. Teclas opostas se anulam. Arraste a bolinha da borda para mudar o raio.'));
        break;
      case 'look': {
        const setS = (k) => (v) => { c[k] = r4(v); this._dirty = true; };
        P.append(this._fieldNum('Sensibilidade X', c.sensitivityX, 0.1, 5, 0.05, setS('sensitivityX')));
        P.append(this._fieldNum('Sensibilidade Y', c.sensitivityY, 0.1, 5, 0.05, setS('sensitivityY')));
        P.append(this._fieldCheck('Inverter eixo Y', !!c.invertY, (v) => { c.invertY = v; this._dirty = true; }));
        P.append(this._fieldNum('Suavização (0 = desligada)', c.smoothing || 0, 0, 0.9, 0.05, setS('smoothing')));
        P.append(this._el('div', 'km-note',
          'A tecla e o modo (alternar/segurar) ficam na barra superior. Com a mira ligada o cursor some e ' +
          'o mouse controla a câmera; Esc sempre sai. Posicione a Mira numa área vazia da tela (sem botões). ' +
          'Sensibilidade 1,0 ≈ 1 px do mouse = 1 px numa tela de 1080p. Suavização adiciona atraso.'));
        break;
      }
      case 'swipe':
        P.append(this._fieldKey('Tecla', () => c.key, (k) => { c.key = k; }));
        P.append(this._fieldNum('Duração (ms)', c.durationMs, 16, 1000, 1, (v) => { c.durationMs = Math.round(v); this._dirty = true; }));
        P.append(this._el('div', 'km-note', 'Ao apertar, o dedo desliza do início até "Fim" no tempo definido.'));
        break;
      case 'multitap': {
        P.append(this._fieldKey('Tecla', () => c.key, (k) => { c.key = k; }));
        c.points.forEach((pt, i) => {
          const row = this._fieldNum(i === 0 ? 'Ponto 1 — atraso (ms)' : `Ponto ${i + 1} — atraso após o anterior (ms)`,
            pt.delayMs, 0, 2000, 1, (v) => { pt.delayMs = Math.round(v); this._dirty = true; });
          if (c.points.length > 1) {
            row.append(this._btn('✕', 'km-icon km-danger', () => {
              c.points.splice(i, 1); this._dirty = true; this._rebuildWidget(c); this._renderProps(); this._refresh();
            }, 'Remover ponto'));
          }
          P.append(row);
        });
        P.append(this._btn('+ Adicionar ponto', '', () => {
          const last = c.points[c.points.length - 1];
          c.points.push({ x: r4(clamp(last.x + 0.05, 0, 1)), y: last.y, delayMs: 60 });
          this._dirty = true;
          this._rebuildWidget(c); this._renderProps(); this._refresh();
        }));
        break;
      }
      default: break;
    }
  }

  _fieldKey(label, get, set, allowClear = false) {
    const row = this._el('div', 'km-field km-field-key');
    row.append(this._el('label', 'km-lbl', label));
    const key = get();
    const b = this._btn(formatKeyLabel(key), 'km-keycap' + (key ? '' : ' km-nokey'), () => {
      this._captureKey(label, allowClear, (k) => { set(k); this._changed(); });
    }, 'Clique e pressione a tecla ou botão do mouse');
    row.append(b);
    const n = key ? this._usage.get(key) || 0 : 0;
    if (n > 1) {
      row.append(this._el('div', 'km-info', `Tecla usada em ${n} controles (todos são acionados juntos).`));
    }
    return row;
  }

  _fieldCheck(label, value, onChange, title) {
    const row = this._el('label', 'km-field km-check');
    const cb = this._el('input');
    cb.type = 'checkbox';
    cb.checked = value;
    cb.addEventListener('change', () => onChange(cb.checked));
    row.append(cb, this._el('span', null, label));
    if (title) row.title = title;
    return row;
  }

  _fieldNum(label, value, min, max, step, onChange, exposeSetter) {
    const row = this._el('div', 'km-field');
    row.append(this._el('label', 'km-lbl', label));
    const wrap = this._el('div', 'km-num');
    const range = this._el('input', 'km-range');
    range.type = 'range';
    const numIn = this._el('input', 'km-input km-numin');
    numIn.type = 'number';
    for (const el of [range, numIn]) { el.min = min; el.max = max; el.step = step; el.value = value; }
    range.addEventListener('input', () => { numIn.value = range.value; onChange(Number(range.value)); });
    numIn.addEventListener('change', () => {
      let v = Number(numIn.value);
      if (!Number.isFinite(v)) v = value;
      v = clamp(v, min, max);
      numIn.value = v; range.value = v;
      onChange(v);
    });
    if (exposeSetter) exposeSetter((v) => { range.value = v; numIn.value = v; });
    wrap.append(range, numIn);
    row.append(wrap);
    return row;
  }
}
