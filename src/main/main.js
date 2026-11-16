'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const adb = require('./adb');
const { ScrcpySession } = require('./scrcpy');
const { Store } = require('./store');

// ---- Chromium switches (latency / decode) ------------------------------------------------------
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const MIN_W = 640;
const MIN_H = 400;

let mainWindow = null;
let store = null;
let tracker = null;
let session = null;
let quitting = false;

// ---- single instance ------------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(onReady);
}

function send(channel, payload) {
  const w = mainWindow;
  if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
}

async function onReady() {
  Menu.setApplicationMenu(null);
  store = new Store(app.getPath('userData'));

  // adb server + device tracking
  try {
    await adb.startServer();
  } catch (err) {
    console.error('[main] adb start-server falhou:', err.message);
  }
  tracker = new adb.DeviceTracker(1500);
  tracker.on('change', (devices) => send('emule:devicesChanged', devices));
  tracker.start();

  registerIpc();
  createWindow();
}

function createWindow() {
  const settings = store.getSettings();
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: MIN_W,
    minHeight: MIN_H,
    backgroundColor: '#0b0d10',
    title: 'Emule',
    show: false,
    alwaysOnTop: !!settings.alwaysOnTop,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  // show anyway if the renderer is slow / missing
  setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show(); }, 3000);

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && !input.alt && String(input.key).toLowerCase() === 'i') {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
    }
  });

  // external links open in the default browser, never in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) e.preventDefault();
  });

  mainWindow.on('close', (e) => {
    if (session && !session.ended) {
      e.preventDefault();
      const s = session;
      session = null;
      s.removeAllListeners('ended');
      s.stop().finally(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      });
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch((err) => {
    console.error('[main] falha ao carregar a interface:', err.message);
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (e) => {
  if (quitting) return;
  if (session && !session.ended) {
    e.preventDefault();
    quitting = true;
    const s = session;
    session = null;
    s.removeAllListeners('ended');
    s.stop().finally(() => app.quit());
  }
});

app.on('will-quit', () => {
  if (tracker) tracker.stop();
});

// ---- IPC ------------------------------------------------------------------------------------------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
}

/**
 * Parser payloads may be views into a larger socket chunk; structured clone would ship the whole
 * underlying ArrayBuffer, so give each packet its own tight buffer (cheap copy, no batching).
 */
function tight(p) {
  const d = p.data;
  if (!d || (d.byteOffset === 0 && d.byteLength === d.buffer.byteLength)) return p;
  return { type: p.type, config: p.config, keyframe: p.keyframe, pts: p.pts, data: new Uint8Array(d) };
}

async function activeSerial() {
  if (session && !session.ended) return session.serial;
  const devices = await adb.listDevices();
  const ready = devices.filter((d) => d.state === 'device');
  const last = store.getSettings().lastSerial;
  const pick = ready.find((d) => d.serial === last) || ready[0];
  if (!pick) throw new Error('Nenhum celular conectado.');
  return pick.serial;
}

async function stopSession() {
  const s = session;
  session = null;
  if (s) {
    s.removeAllListeners('ended'); // user-initiated: no onSessionEnded
    await s.stop();
  }
}

function registerIpc() {
  // devices
  handle('emule:listDevices', async () => {
    try {
      return await adb.listDevices();
    } catch (err) {
      console.warn('[main] listDevices:', err.message);
      return [];
    }
  });

  // session
  handle('emule:connect', async (serial, opts) => {
    if (typeof serial !== 'string' || !serial) throw new Error('Nenhum dispositivo selecionado.');
    await stopSession();
    const s = new ScrcpySession(serial, opts || {});
    session = s;
    s.on('video', (p) => send('emule:video', tight(p)));
    s.on('audio', (p) => send('emule:audio', tight(p)));
    s.on('deviceMessage', (m) => send('emule:deviceMessage', m));
    s.on('ended', (reason) => {
      if (session === s) session = null;
      send('emule:sessionEnded', reason);
    });
    try {
      const info = await s.start();
      if (session !== s) throw new Error('Conexão cancelada');
      try { store.setSettings({ lastSerial: serial }); } catch { /* ignore */ }
      return info;
    } catch (err) {
      if (session === s) session = null;
      throw err;
    }
  });

  handle('emule:disconnect', async () => {
    await stopSession();
  });

  ipcMain.on('emule:control', (_e, bytes) => {
    if (!session || !bytes) return;
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    session.sendControl(buf);
  });

  // extra device actions
  handle('emule:screenshot', async () => {
    const serial = await activeSerial();
    const png = await adb.screencap(serial);
    if (!png || png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) {
      throw new Error('Falha ao capturar a tela do celular.');
    }
    const dir = path.join(app.getPath('pictures'), 'Emule');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    let file = path.join(dir, `emule-${stamp}.png`);
    for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `emule-${stamp}-${i}.png`);
    fs.writeFileSync(file, png);
    return file;
  });

  handle('emule:installApk', async () => {
    const serial = await activeSerial();
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Instalar APK',
      filters: [{ name: 'Aplicativo Android', extensions: ['apk'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const apk = r.filePaths[0];
    try {
      const { stdout } = await adb.install(serial, apk);
      if (/Success/i.test(stdout)) return `APK instalado: ${path.basename(apk)}`;
      return `Falha ao instalar ${path.basename(apk)}: ${stdout.trim()}`;
    } catch (err) {
      return `Falha ao instalar ${path.basename(apk)}: ${(err.stderr || err.stdout || err.message || '').toString().trim()}`;
    }
  });

  // settings & profiles
  handle('emule:getSettings', () => store.getSettings());
  handle('emule:setSettings', (partial) => store.setSettings(partial));
  handle('emule:listProfiles', () => store.listProfiles());
  handle('emule:loadProfile', (name) => store.loadProfile(name));
  handle('emule:saveProfile', (profile) => { store.saveProfile(profile); });
  handle('emule:deleteProfile', (name) => { store.deleteProfile(name); });
  handle('emule:importProfile', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar perfil',
      filters: [{ name: 'Perfil Emule (JSON)', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    return store.importProfileFile(r.filePaths[0]);
  });
  handle('emule:exportProfile', async (profile) => {
    const { sanitizeName } = require('./store');
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar perfil',
      defaultPath: path.join(app.getPath('documents'), `${sanitizeName(profile && profile.name)}.json`),
      filters: [{ name: 'Perfil Emule (JSON)', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return false;
    store.exportProfileFile(profile, r.filePath);
    return true;
  });

  // window
  ipcMain.on('emule:setFullscreen', (_e, on) => {
    if (mainWindow) mainWindow.setFullScreen(!!on);
  });
  handle('emule:isFullscreen', () => !!(mainWindow && mainWindow.isFullScreen()));
  ipcMain.on('emule:setAlwaysOnTop', (_e, on) => {
    if (mainWindow) mainWindow.setAlwaysOnTop(!!on);
  });
  ipcMain.on('emule:fitWindowToVideo', (_e, w, h) => fitWindowToVideo(w, h));
  handle('emule:getVersions', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    scrcpy: adb.readVendorVersion() || '5.0.1',
  }));
}

function fitWindowToVideo(width, height) {
  const win = mainWindow;
  if (!win || win.isDestroyed() || win.isFullScreen()) return;
  width = Number(width);
  height = Number(height);
  if (!(width > 0 && height > 0)) return;
  if (win.isMaximized()) win.unmaximize();

  const bounds = win.getBounds();
  const content = win.getContentBounds();
  const frameW = bounds.width - content.width;
  const frameH = bounds.height - content.height;
  const area = screen.getDisplayMatching(bounds).workArea;
  const maxW = Math.max(MIN_W, area.width - frameW);
  const maxH = Math.max(MIN_H, area.height - frameH);
  const scale = Math.min(1, maxW / width, maxH / height);
  const cw = Math.max(MIN_W, Math.round(width * scale));
  const ch = Math.max(MIN_H, Math.round(height * scale));
  win.setContentSize(cw, ch);

  // keep the window inside the work area
  const nb = win.getBounds();
  const x = Math.min(Math.max(nb.x, area.x), area.x + Math.max(0, area.width - nb.width));
  const y = Math.min(Math.max(nb.y, area.y), area.y + Math.max(0, area.height - nb.height));
  if (x !== nb.x || y !== nb.y) win.setPosition(x, y);
}
