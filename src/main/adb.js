'use strict';
// Thin wrapper around the vendored adb.exe (no shell, always execFile/spawn with arg arrays).

const { execFile, spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

let cachedAdbPath = null;

function resolveAdbPath() {
  if (cachedAdbPath) return cachedAdbPath;
  const candidates = [];
  let packaged = false;
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron');
    packaged = !!(app && app.isPackaged);
  } catch { /* plain node (tests / scripts) */ }
  if (packaged && process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'vendor', 'adb.exe'));
  candidates.push(path.join(__dirname, '..', '..', 'vendor', 'adb.exe'));
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'vendor', 'adb.exe'));
  for (const c of candidates) {
    if (fs.existsSync(c)) return (cachedAdbPath = c);
  }
  return (cachedAdbPath = 'adb'); // PATH fallback
}

function resolveServerPath() {
  const adb = resolveAdbPath();
  if (adb !== 'adb') {
    const p = path.join(path.dirname(adb), 'scrcpy-server');
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, '..', '..', 'vendor', 'scrcpy-server');
}

function readVendorVersion() {
  try {
    return fs.readFileSync(path.join(path.dirname(resolveServerPath()), 'VERSION'), 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Run adb with the given args. Resolves { stdout, stderr } (strings, or Buffers with
 * { encoding: 'buffer' }). Rejects with an Error whose message includes stderr.
 */
function run(args, { timeout = 15000, encoding = 'utf8', maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(resolveAdbPath(), args, { timeout, encoding, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const se = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : (stderr || '');
        const so = Buffer.isBuffer(stdout) ? '' : (stdout || '');
        const e = new Error(`adb ${args.join(' ')} falhou: ${(se || so || err.message).trim()}`);
        e.stderr = se;
        e.stdout = stdout;
        e.code = err.code;
        e.killed = err.killed;
        reject(e);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function startServer() {
  return run(['start-server'], { timeout: 20000 });
}

/** Parses `adb devices -l` output. */
function parseDevices(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('List of devices') || line.startsWith('*') || line.startsWith('adb ')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [serial, state, ...rest] = parts;
    let model = '';
    let product = '';
    for (const tok of rest) {
      if (tok.startsWith('model:')) model = tok.slice(6).replace(/_/g, ' ');
      else if (tok.startsWith('product:')) product = tok.slice(8);
    }
    out.push({ serial, state, model, product });
  }
  return out;
}

async function listDevices() {
  const { stdout } = await run(['devices', '-l'], { timeout: 10000 });
  return parseDevices(stdout);
}

function push(serial, local, remote, opts) {
  return run(['-s', serial, 'push', local, remote], { timeout: 60000, ...opts });
}

function shell(serial, cmd, opts) {
  const args = ['-s', serial, 'shell'].concat(Array.isArray(cmd) ? cmd : [cmd]);
  return run(args, opts);
}

function forward(serial, local, remote) {
  return run(['-s', serial, 'forward', local, remote], { timeout: 10000 });
}

function removeForward(serial, local) {
  return run(['-s', serial, 'forward', '--remove', local], { timeout: 10000 });
}

async function screencap(serial) {
  const { stdout } = await run(['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 30000, encoding: 'buffer' });
  return stdout; // Buffer (PNG)
}

function install(serial, apkPath) {
  return run(['-s', serial, 'install', '-r', apkPath], { timeout: 5 * 60 * 1000 });
}

/** Spawns a long-lived adb child (used for the scrcpy server). */
function spawnAdb(args) {
  return spawn(resolveAdbPath(), args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Polls `adb devices -l` and emits 'change' (devices) only when the list differs.
 * Robust to adb server restarts: failures emit an empty list once and the next poll restarts adb.
 */
class DeviceTracker extends EventEmitter {
  constructor(intervalMs = 1500) {
    super();
    this.intervalMs = intervalMs;
    this.devices = [];
    this._key = null;
    this._timer = null;
    this._busy = false;
    this._failures = 0;
  }

  start() {
    if (this._timer) return;
    this._tick();
    this._timer = setInterval(() => this._tick(), this.intervalMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async _tick() {
    if (this._busy) return;
    this._busy = true;
    try {
      let list;
      try {
        list = await listDevices();
        this._failures = 0;
      } catch (err) {
        this._failures++;
        list = [];
        if (this._failures === 1 || this._failures % 10 === 0) console.warn('[adb] devices falhou:', err.message);
        if (this._failures % 3 === 0) startServer().catch(() => {});
      }
      const key = JSON.stringify(list);
      if (key !== this._key) {
        this._key = key;
        this.devices = list;
        this.emit('change', list);
      }
    } finally {
      this._busy = false;
    }
  }
}

module.exports = {
  resolveAdbPath,
  resolveServerPath,
  readVendorVersion,
  run,
  startServer,
  parseDevices,
  listDevices,
  push,
  shell,
  forward,
  removeForward,
  screencap,
  install,
  spawnAdb,
  DeviceTracker,
};
