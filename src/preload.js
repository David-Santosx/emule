'use strict';
// Exposes window.emule (see docs/ARCHITECTURE.md "IPC contract").

const { contextBridge, ipcRenderer } = require('electron');

/** invoke wrapper: main returns { ok, value } | { ok: false, error } so errors reach the UI cleanly. */
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok) return res.value;
  throw new Error((res && res.error) || 'Erro desconhecido');
}

function subscribe(channel, cb) {
  if (typeof cb !== 'function') throw new TypeError('callback deve ser uma função');
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function toBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  return null;
}

contextBridge.exposeInMainWorld('emule', {
  // devices
  listDevices: () => call('emule:listDevices'),
  onDevicesChanged: (cb) => subscribe('emule:devicesChanged', cb),

  // session
  connect: (serial, opts) => call('emule:connect', serial, opts || {}),
  disconnect: () => call('emule:disconnect'),
  onVideoPacket: (cb) => subscribe('emule:video', cb),
  onAudioPacket: (cb) => subscribe('emule:audio', cb),
  onSessionEnded: (cb) => subscribe('emule:sessionEnded', cb),
  onDeviceMessage: (cb) => subscribe('emule:deviceMessage', cb),
  sendControl: (bytes) => {
    const b = toBytes(bytes);
    if (b && b.byteLength > 0) ipcRenderer.send('emule:control', b);
  },

  // extra device actions
  screenshot: () => call('emule:screenshot'),
  installApk: () => call('emule:installApk'),

  // settings & profiles
  getSettings: () => call('emule:getSettings'),
  setSettings: (partial) => call('emule:setSettings', partial || {}),
  listProfiles: () => call('emule:listProfiles'),
  loadProfile: (name) => call('emule:loadProfile', name),
  saveProfile: (profile) => call('emule:saveProfile', profile),
  deleteProfile: (name) => call('emule:deleteProfile', name),
  importProfile: () => call('emule:importProfile'),
  exportProfile: (profile) => call('emule:exportProfile', profile),

  // window
  setFullscreen: (on) => ipcRenderer.send('emule:setFullscreen', !!on),
  isFullscreen: () => call('emule:isFullscreen'),
  setAlwaysOnTop: (on) => ipcRenderer.send('emule:setAlwaysOnTop', !!on),
  fitWindowToVideo: (width, height) => ipcRenderer.send('emule:fitWindowToVideo', Number(width), Number(height)),
  getVersions: () => call('emule:getVersions'),
});
