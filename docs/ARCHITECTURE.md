# Emule — Architecture & Module Contracts

Emule is a Windows desktop app (Electron) that mirrors an Android phone over USB with low latency
and maps keyboard/mouse to touch for games. Device side = official **scrcpy-server v5.0.1**
(unmodified). Client side = our own code. Wire protocol reference: `docs/PROTOCOL.md`
(verified from scrcpy v5.0.1 source — it is the source of truth for byte layouts).

UI language: **Portuguese (pt-BR)** for all user-visible text.

## Stack
- Electron (latest stable from npm), plain modern JavaScript (no TypeScript, no bundler).
  - Main process: CommonJS (`require`).
  - Renderer: native ES modules (`<script type="module">`), no frameworks.
- Video decode: **WebCodecs `VideoDecoder`** (hardware, `optimizeForLatency: true`) → `<canvas>`.
- Audio: scrcpy `audio_codec=raw` (PCM s16le, 48 kHz, stereo) → Web Audio (AudioWorklet ring buffer).
  Fallback/disable if device has no audio support (Android < 11).
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` allowed for preload only.
- Packaging: `@electron/packager` → `dist/Emule-win32-x64/Emule.exe`, vendor binaries as extra resources.

## Product priorities (binding for every agent)
1. **Lowest possible latency** — the main differentiator.
   - Video: render every decoded frame immediately (no jitter buffer, no frame queue); if the
     decoder backlog (`decoder.decodeQueueSize`) grows > 2, drop non-key frames until the next
     keyframe / request a reset; draw with `requestVideoFrameCallback`-free direct `drawImage`
     (or WebGL/`transferControlToOffscreen`) as soon as `output` fires, then `frame.close()`.
   - Main process: forward packets to the renderer the moment they are complete (no batching);
     `socket.setNoDelay(true)` on all sockets; control messages written immediately.
   - Input: send touch/key events synchronously from the DOM event; coalesced mouse moves are OK
     (use `getCoalescedEvents` only if it improves accuracy, never delay).
   - Chromium flags in main: disable background throttling for the window
     (`backgroundThrottling: false`), keep vsync default.
2. **Mirror quality** — defaults favour sharpness: native resolution (`maxSize: 0`), 16 Mbps,
   60 fps, H.264 with `video_codec_options` tuned for low latency where the server supports it;
   presets in Settings: "Máxima qualidade" (native, 24 Mbps, H.265 if decoder supports it),
   "Equilibrado" (1920, 12 Mbps), "Desempenho" (1280, 6 Mbps). Canvas rendering with
   high-quality scaling (`imageSmoothingQuality = 'high'`), no blurry CSS upscaling when the
   window is larger than the frame (keep aspect ratio, letterbox in black).
3. **Phone audio on the PC** — on by default (Android 11+). Low-latency playback: AudioContext
   `latencyHint: 'interactive'`, AudioWorklet ring buffer targeting ~40–60 ms; if the buffer
   grows beyond ~120 ms, drop samples to catch up; on underrun, output silence (no stutter
   loops). Volume slider + mute in the UI. Clear message if the device does not support audio.
4. A small on-screen stats HUD (toggle): FPS, resolution, codec, bitrate, decode queue, audio
   buffer ms — useful to prove the latency advantage.

## Folder layout
```
Emule/
  package.json            (owner: A)
  scripts/fetch-vendor.js (owner: A)  downloads scrcpy-win64-v5.0.1.zip, verifies SHA256, extracts
                                      adb.exe, AdbWinApi.dll, AdbWinUsbApi.dll, scrcpy-server → vendor/
  scripts/package.js      (owner: A)
  vendor/                 (generated)
  docs/                   ARCHITECTURE.md (this), PROTOCOL.md
  src/main/main.js        (owner: A)  window, IPC handlers
  src/main/adb.js         (owner: A)
  src/main/scrcpy.js      (owner: A)  server lifecycle + sockets + stream parsing
  src/main/store.js       (owner: A)  settings + profiles persistence (JSON in app.getPath('userData'))
  src/preload.js          (owner: A)  exposes window.emule
  src/renderer/index.html (owner: B)
  src/renderer/styles.css (owner: B)
  src/renderer/app.js     (owner: B)  UI shell, wiring of everything
  src/renderer/control.js (owner: B)  control-message serializers
  src/renderer/touch.js   (owner: B)  TouchManager
  src/renderer/video.js   (owner: B)  VideoPlayer (WebCodecs)
  src/renderer/audio.js   (owner: B)  AudioPlayer
  src/renderer/audio-worklet.js (owner: B)
  src/renderer/input.js   (owner: B)  default mouse/keyboard → device input
  src/renderer/keymap/engine.js  (owner: C)
  src/renderer/keymap/editor.js  (owner: C)
  src/renderer/keymap/keymap.css (owner: C)
  src/renderer/keymap/presets.js (owner: C)  built-in example profiles
```
Each agent writes ONLY its own files. If you need something from another owner, code against
the contract below; do not edit their files.

## IPC contract — `window.emule` (preload, owner A; used by B and C)
All methods return Promises unless noted. Event subscriptions return an unsubscribe function.

```js
window.emule = {
  // devices
  listDevices(): Promise<Array<{ serial, state /* 'device'|'unauthorized'|'offline'|... */, model, product }>>,
  onDevicesChanged(cb: (devices) => void): () => void,   // main polls/tracks adb every ~1.5 s

  // session
  connect(serial: string, opts: SessionOptions): Promise<SessionInfo>,  // rejects with Error(message pt-BR)
  disconnect(): Promise<void>,
  onVideoPacket(cb: (p: MediaPacket) => void): () => void,
  onAudioPacket(cb: (p: MediaPacket) => void): () => void,
  onSessionEnded(cb: (reason: string) => void): () => void,   // device unplugged, server died, etc.
  onDeviceMessage(cb: (msg: { type: 'clipboard', text: string } | { type: string, [k: string]: any }) => void): () => void,
  sendControl(bytes: Uint8Array): void,   // fire-and-forget, raw serialized control message (see control.js)

  // extra device actions (implemented in main via adb)
  screenshot(): Promise<string | null>,   // saves PNG (adb exec-out screencap -p) to Pictures/Emule, returns path
  installApk(): Promise<string | null>,   // opens file dialog, runs adb install -r, returns message

  // settings & profiles (persisted as JSON in userData)
  getSettings(): Promise<Settings>,
  setSettings(partial: Partial<Settings>): Promise<Settings>,
  listProfiles(): Promise<string[]>,             // profile names
  loadProfile(name: string): Promise<Profile | null>,
  saveProfile(profile: Profile): Promise<void>,  // file name derived from profile.name (sanitized)
  deleteProfile(name: string): Promise<void>,
  importProfile(): Promise<Profile | null>,      // open dialog (.json)
  exportProfile(profile: Profile): Promise<boolean>, // save dialog

  // window
  setFullscreen(on: boolean): void,
  isFullscreen(): Promise<boolean>,
  setAlwaysOnTop(on: boolean): void,
  fitWindowToVideo(width: number, height: number): void, // resize content area to video aspect (keep within screen work area; account for toolbar width passed in settings? no: renderer passes the full desired content size)
  getVersions(): Promise<{ app, electron, chrome, scrcpy }>,
};
```

```ts
type SessionOptions = {
  maxSize: number,        // 0 = native; else max dimension (e.g. 1920, 1600, 1280)
  videoBitRate: number,   // bits/s, default 16_000_000
  maxFps: number,         // default 60 (0 = unlimited)
  videoCodec: 'h264' | 'h265',   // default 'h264'
  audio: boolean,         // default true
  stayAwake: boolean,     // default true
  turnScreenOff: boolean, // default false (renderer sends set-display-power after connect; main ignores)
  showTouches: boolean,   // default false
  powerOffOnClose: boolean// default false
};
type SessionInfo = {
  deviceName: string,
  video: { codec: 'h264'|'h265'|'av1', width: number, height: number },
  audio: { codec: 'raw'|'opus'|'aac'|'flac' } | null,   // null if disabled/unsupported
};
// scrcpy v5 video stream contains SESSION packets (width/height, sent at start and after every
// rotation / reset) interleaved with media packets — see PROTOCOL.md. Main parses them and
// forwards them on the same onVideoPacket channel as { type: 'session', width, height, clientResized }.
// SessionInfo.video.width/height = the FIRST session packet (main reads it before resolving connect()).
// Touch events must use the latest session width/height (server silently ignores mismatches),
// so TouchManager's getFrameSize must return the latest session size (VideoPlayer.frameSize).
// Never send a control message type the server does not know: unknown types KILL the session.
type MediaPacket = {
  type: 'media',
  config: boolean,     // codec config packet (SPS/PPS etc.)
  keyframe: boolean,
  pts: number,         // microseconds (Number; -1 if not available)
  data: Uint8Array,    // payload exactly as received (Annex B for video)
};
type Settings = SessionOptions & {
  lastSerial: string | null,
  lastProfile: string | null,   // keymap profile name
  keymapEnabled: boolean,
  alwaysOnTop: boolean,
  showFps: boolean,
};
```

## Renderer module contracts

### control.js (owner B) — pure functions returning `Uint8Array`, exact layouts from PROTOCOL.md
```js
export const AMOTION = { DOWN: 0, UP: 1, MOVE: 2 /* + others if needed */ };
export const AKEY = { DOWN: 0, UP: 1 };
export const KEYCODE = { HOME: 3, BACK: 4, ... };  // Android keycodes used by the app
export function injectKeycode(action, keycode, repeat = 0, metaState = 0): Uint8Array;
export function injectText(text: string): Uint8Array;
export function injectTouch(action, pointerId /* BigInt */, x, y, screenW, screenH, pressure /*0..1*/, actionButton = 0, buttons = 0): Uint8Array;
export function injectScroll(x, y, screenW, screenH, hScroll /* -1..1 */, vScroll, buttons = 0): Uint8Array;
export function backOrScreenOn(action): Uint8Array;
export function expandNotificationPanel(): Uint8Array;
export function expandSettingsPanel(): Uint8Array;
export function collapsePanels(): Uint8Array;
export function setClipboard(text, paste = false, sequence = 0n): Uint8Array;
export function getClipboard(copyKey = 0): Uint8Array;
export function setDisplayPower(on: boolean): Uint8Array;
export function rotateDevice(): Uint8Array;
```

### touch.js (owner B) — the ONLY way anything injects touches
```js
export class TouchManager {
  constructor(sendControl /* (Uint8Array)=>void */, getFrameSize /* ()=>{width,height} */);
  // Coordinates are NORMALIZED 0..1 relative to the current video frame (clamped).
  // id: any string key chosen by the caller (e.g. 'mouse', 'km:<controlId>', 'km:look').
  // The manager maps string ids to distinct device pointer ids (BigInt), never reusing one
  // that is currently down. Calling down() on an id already down = move().
  down(id: string, nx: number, ny: number): void;
  move(id: string, nx: number, ny: number): void;
  up(id: string): void;
  isDown(id: string): boolean;
  releaseAll(): void;              // lifts every active pointer (used on blur, profile change, disconnect)
}
```

### video.js (owner B)
```js
export class VideoPlayer {
  constructor(canvas: HTMLCanvasElement);
  start(info: SessionInfo['video']): void;
  push(p: MediaPacket): void;           // handles config merging, codec string from SPS, reconfigure on new SPS
  stop(): void;
  get frameSize(): { width, height };   // size of last decoded frame (device pixels)
  onResize(cb: (w, h) => void): void;   // fired when frame size changes (rotation)
  get fps(): number;
}
```

### input.js (owner B) — default (non-game) input
Mouse on the video → single touch (id `'mouse'`), right-click → BACK, middle-click → HOME,
wheel → injectScroll, keyboard → keycodes for special keys + injectText for printable chars,
Ctrl+V → setClipboard(paste=true). It must ask the keymap engine first:
```js
// in app.js wiring:
// for every keydown/keyup/mousedown/mouseup/mousemove/wheel on the video area:
//   if (keymap.handleEvent(e)) return;   // consumed by keymap
//   else input.handle(e);
```

### keymap/engine.js (owner C)
```js
export class KeymapEngine {
  constructor({ touch /* TouchManager */, videoElement /* the canvas, for pointer lock + coord mapping */ });
  setProfile(profile: Profile | null): void;   // releases all keymap touches first
  get profile(): Profile | null;
  setEnabled(on: boolean): void;               // when disabled, handleEvent always returns false
  get enabled(): boolean;
  get lookActive(): boolean;                   // pointer lock / mouse-look mode currently on
  handleEvent(e: KeyboardEvent | MouseEvent | WheelEvent): boolean;  // true = consumed
  releaseAll(): void;                          // on window blur / disconnect
  onStateChange(cb: (state: { enabled, lookActive, profileName }) => void): void;
}
```
### keymap/editor.js (owner C)
```js
export class KeymapEditor {
  // overlay: an absolutely-positioned element exactly covering the visible video rect
  // (app.js keeps it sized/positioned to the canvas' displayed rect).
  constructor({ overlay: HTMLElement, getFrameSize: () => {width,height} });
  open(profile: Profile | null): void;        // edits a deep copy; null = new empty profile
  close(): void;
  get isOpen(): boolean;
  onSave(cb: (profile: Profile) => void): void;  // app.js calls window.emule.saveProfile + engine.setProfile
  onCancel(cb: () => void): void;
}
// keymap/presets.js
export const PRESETS: Profile[];   // e.g. "FPS (Free Fire / PUBG / CODM) - exemplo", "MOBA - exemplo"
```
The editor and the always-on overlay hints use `keymap/keymap.css`; app.js links it from index.html.
When not editing, the engine may optionally show small key-label hints on the overlay
(`KeymapEngine` gets an optional `overlay` element: `new KeymapEngine({touch, videoElement, overlay})`
and a `setHintsVisible(bool)` method).

## Profile schema (JSON, version 1)
Coordinates are normalized (0..1) relative to the video frame. Lengths (radius) are normalized to
the frame **height**. Keys are `KeyboardEvent.code` strings (`'KeyW'`, `'Space'`, `'ShiftLeft'`,
`'Digit1'`...) or mouse buttons `'Mouse0'` (left), `'Mouse1'` (middle), `'Mouse2'` (right),
`'Mouse3'`, `'Mouse4'`, or `'WheelUp'`/`'WheelDown'` (tap on wheel tick).
```json
{
  "version": 1,
  "name": "FPS exemplo",
  "lookToggleKey": "Backquote",
  "controls": [
    { "id": "c1", "type": "tap",      "key": "Space",  "x": 0.88, "y": 0.62 },
    { "id": "c2", "type": "tap",      "key": "Mouse0", "x": 0.80, "y": 0.70, "lookOnly": true },
    { "id": "c3", "type": "joystick", "keys": { "up": "KeyW", "down": "KeyS", "left": "KeyA", "right": "KeyD" },
      "x": 0.17, "y": 0.70, "radius": 0.12, "sprintKey": "ShiftLeft" },
    { "id": "c4", "type": "look",     "x": 0.65, "y": 0.45, "sensitivity": 1.0, "invertY": false },
    { "id": "c5", "type": "swipe",    "key": "KeyR", "x": 0.5, "y": 0.8, "x2": 0.5, "y2": 0.5, "durationMs": 120 },
    { "id": "c6", "type": "multitap", "key": "KeyQ", "points": [ {"x":0.3,"y":0.3,"delayMs":0}, {"x":0.4,"y":0.3,"delayMs":60} ] }
  ]
}
```
User requirements (override examples above): one key MAY be bound to several controls (all fire
together); mouse buttons Mouse0..Mouse4 and WheelUp/WheelDown are bindable; look control has
`sensitivityX`, `sensitivityY` (legacy `sensitivity` = both), `invertY`; profile has
`lookToggleMode: 'toggle'|'hold'`; look mode hides the PC cursor (pointer lock).

Semantics:
- `tap`: touch down at (x,y) on key down, up on key up (holding works = long press). `lookOnly: true`
  → only active while mouse-look is on (lets Mouse0 be normal click outside look mode).
- `joystick`: 4 keys → one finger: down at center when first direction key pressed, moves to
  center + dir·radius (diagonals normalized), up when all released. `sprintKey` (optional) pushes
  to 1.0·radius, otherwise 0.75·radius... (engine's choice; document it in the editor).
- `look`: mouse-look (FPS camera). Toggled by `lookToggleKey` (pointer lock on the canvas).
  While active: one finger held at (x,y); mouse movement moves it by delta·sensitivity;
  when the finger gets too far from the anchor (or near the frame edge), lift and re-press at
  the anchor transparently. Leaving look mode lifts it. Esc also leaves (browser exits pointer lock).
- `swipe`: on key down, finger from (x,y) to (x2,y2) over durationMs (interpolated moves), then up.
- `multitap`: sequence of quick taps (macro).
- Any key not consumed by the keymap falls through to default input (typing).
