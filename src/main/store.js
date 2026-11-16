'use strict';
// Settings + keymap profiles persisted as JSON in app.getPath('userData').

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = Object.freeze({
  maxSize: 0,
  videoBitRate: 16000000,
  maxFps: 60,
  videoCodec: 'h264',
  audio: true,
  stayAwake: true,
  turnScreenOff: false,
  showTouches: false,
  powerOffOnClose: false,
  lastSerial: null,
  lastProfile: null,
  keymapEnabled: true,
  alwaysOnTop: false,
  showFps: false,
  qualityPreset: null,
  autoConnect: false,
  pcVolume: 1,
  pcMuted: false,
});

function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    // Windows can fail the rename if the target is briefly locked (AV scanners); retry by copy.
    try {
      fs.copyFileSync(tmp, file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    if (!fs.existsSync(file)) throw err;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** File-name-safe version of a profile name (Windows rules). */
function sanitizeName(name) {
  let s = String(name == null ? '' : name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!s) s = 'perfil';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  return s.slice(0, 100);
}

class Store {
  constructor(userDataDir) {
    this.dir = userDataDir;
    this.settingsFile = path.join(userDataDir, 'settings.json');
    this.profilesDir = path.join(userDataDir, 'profiles');
    this._settings = null;
  }

  getSettings() {
    if (!this._settings) {
      const saved = readJson(this.settingsFile);
      this._settings = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? pickKnown(saved) : {}) };
    }
    return { ...this._settings };
  }

  setSettings(partial) {
    const cur = this.getSettings();
    const next = { ...cur, ...(partial && typeof partial === 'object' ? pickKnown(partial) : {}) };
    this._settings = next;
    atomicWriteJson(this.settingsFile, next);
    return { ...next };
  }

  profilePath(name) {
    return path.join(this.profilesDir, `${sanitizeName(name)}.json`);
  }

  listProfiles() {
    let files = [];
    try {
      files = fs.readdirSync(this.profilesDir).filter((f) => f.toLowerCase().endsWith('.json'));
    } catch {
      return [];
    }
    const names = [];
    for (const f of files) {
      const p = readJson(path.join(this.profilesDir, f));
      names.push(p && typeof p.name === 'string' && p.name ? p.name : f.slice(0, -5));
    }
    return names.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  loadProfile(name) {
    const direct = readJson(this.profilePath(name));
    if (direct) return direct;
    // fall back to scanning (name inside the file may differ from the file name)
    try {
      for (const f of fs.readdirSync(this.profilesDir)) {
        if (!f.toLowerCase().endsWith('.json')) continue;
        const p = readJson(path.join(this.profilesDir, f));
        if (p && p.name === name) return p;
        if (f.slice(0, -5) === name && p) return p;
      }
    } catch { /* no dir */ }
    return null;
  }

  saveProfile(profile) {
    validateProfile(profile);
    atomicWriteJson(this.profilePath(profile.name), profile);
  }

  deleteProfile(name) {
    fs.rmSync(this.profilePath(name), { force: true });
    // also remove files whose stored name matches
    try {
      for (const f of fs.readdirSync(this.profilesDir)) {
        if (!f.toLowerCase().endsWith('.json')) continue;
        const full = path.join(this.profilesDir, f);
        const p = readJson(full);
        if (p && p.name === name) fs.rmSync(full, { force: true });
      }
    } catch { /* no dir */ }
  }

  importProfileFile(file) {
    const p = readJson(file);
    if (!p) throw new Error('Arquivo inválido: não é um JSON válido.');
    if (!p.name) p.name = path.basename(file).replace(/\.json$/i, '');
    if (p.version == null) p.version = 1;
    validateProfile(p);
    this.saveProfile(p);
    return p;
  }

  exportProfileFile(profile, file) {
    validateProfile(profile);
    atomicWriteJson(file, profile);
  }
}

function pickKnown(obj) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

function validateProfile(p) {
  if (!p || typeof p !== 'object') throw new Error('Perfil inválido.');
  if (typeof p.name !== 'string' || !p.name.trim()) throw new Error('Perfil sem nome.');
  if (!Array.isArray(p.controls)) throw new Error('Perfil inválido: "controls" deve ser uma lista.');
}

module.exports = { Store, DEFAULT_SETTINGS, sanitizeName, atomicWriteJson };
