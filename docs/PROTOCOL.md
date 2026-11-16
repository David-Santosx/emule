# scrcpy v5.0.1 wire protocol (server side) — reference for the Emule client

Source of truth: `github.com/Genymobile/scrcpy` at tag **v5.0.1** (raw files fetched 2026-11-15).
Paths below are relative to the repo root; `S/` = `server/src/main/java/com/genymobile/scrcpy/`.

Version facts verified: `meson.build` → `version: '5.0.1'`; `server/build.gradle` → `versionName "5.0.1"`, `versionCode 50001`.

> Upstream warning (`doc/develop.md`): the protocol is *internal* and changes between versions with no
> backward/forward compatibility. Always pair this document with the exact v5.0.1 server.

**All multi-byte integers on every socket are BIG-ENDIAN** (Java `DataInputStream`/`DataOutputStream`/`ByteBuffer` defaults; client uses `sc_read*be`/`sc_write*be`).

---

## 1. Starting the server

### 1.1 Push
```
adb -s <serial> push scrcpy-server /data/local/tmp/scrcpy-server.jar
```
- Device path is `/data/local/tmp/scrcpy-server.jar` (`app/src/server.c`: `SC_DEVICE_SERVER_PATH`).
- The release file is named `scrcpy-server` (no extension); it is an unsigned APK/jar containing `classes.dex`.
- With `cleanup=true` (default) the server **deletes its own jar** (`S/CleanUp.java` → `unlinkSelf()`, called by the cleanup child process on start, and on `list_*` runs). → **Push before every start.**

### 1.2 Launch (exact form used by the official client, `app/src/server.c` `execute_server`)
```
adb -s <serial> shell CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 5.0.1 key=value key=value ...
```
- `argv[0]` after the class name must be **exactly `5.0.1`** (compared with `BuildConfig.VERSION_NAME`; mismatch → `IllegalArgumentException`, server exits 1). (`S/Options.java` `parse()`)
- Every further arg must contain `=`, otherwise fatal "Invalid key=value pair". Order is irrelevant.
- **Unknown keys are NOT fatal** — only `Ln.w("Unknown server option: ...")`. So a misspelled/renamed key is silently ignored (see `send_codec_meta` below!).
- Booleans use `Boolean.parseBoolean` → only case-insensitive `"true"` is true; anything else is false.
- The server keeps running as the `adb shell` child; its logs go to that process's stdout/stderr. Killing the adb shell process (or closing sockets) stops it.
- The SERVER_PATH used for cleanup is `classPaths[0]` of `CLASSPATH`, so keep the jar first in CLASSPATH.

### 1.3 Server options (`S/Options.java`, v5.0.1) — complete list

| key | value format | default | notes |
|---|---|---|---|
| `scid` | **hex** (`Integer.parseInt(v,16)`), 31-bit, or `-1` | `-1` | socket name `scrcpy_%08x`; `-1` → socket name `scrcpy`. Official client sends `scid=%08x` with `rand & 0x7FFFFFFF`. |
| `log_level` | `verbose`/`debug`/`info`/`warn`/`error` (case-insensitive) | `debug` | |
| `video` | bool | `true` | |
| `audio` | bool | `true` | |
| `control` | bool | `true` | |
| `tunnel_forward` | bool | `false` | `true` = device listens (adb forward). |
| `video_codec` | `h264`/`h265`/`av1`/`vp8`/`vp9` | `h264` | vp8/vp9 are new vs 3.x |
| `audio_codec` | `opus`/`aac`/`flac`/`raw` | `opus` | `raw` = PCM s16le 48 kHz stereo, allowed by server |
| `video_source` | `display`/`camera` | `display` | camera needs Android 12+ |
| `audio_source` | `output`, `mic`, `playback`, `mic-unprocessed`, `mic-camcorder`, `mic-voice-recognition`, `mic-voice-communication`, `voice-call`, `voice-call-uplink`, `voice-call-downlink`, `voice-performance` | `output` | (`S/audio/AudioSource.java`) |
| `audio_dup` | bool | `false` | only meaningful with `audio_source=playback` |
| `video_bit_rate` | int (bps) | `8000000` | |
| `audio_bit_rate` | int (bps) | `128000` | ignored for raw |
| `max_size` | int | `0` (no limit) | max of width/height |
| `min_size_alignment` | 1,2,4,8,16 | `1` | **new**; else fatal |
| `max_fps` | float | `0` (no limit) | |
| `angle` | float (degrees) | `0` | |
| `crop` | `W:H:X:Y` or empty | none | |
| `display_id` | int | `0` | |
| `show_touches` | bool | `false` | restored by cleanup |
| `stay_awake` | bool | `false` | restored by cleanup |
| `screen_off_timeout` | int ms, ≥ -1 | `-1` | |
| `video_codec_options` / `audio_codec_options` | `key[:type]=value[,...]`, type ∈ int(default)/long/float/string, `\,` escapes comma | none | (`S/model/CodecOption.java`) |
| `video_encoder` / `audio_encoder` | MediaCodec name or empty | none | |
| `power_off_on_close` | bool | `false` | |
| `clipboard_autosync` | bool | `true` | device→client clipboard pushes |
| `downsize_on_error` | bool | `true` | |
| `cleanup` | bool | `true` | spawns a cleanup process; deletes jar |
| `power_on` | bool | `true` | presses POWER at control start if screen off (display 0 only) |
| `list_encoders`/`list_displays`/`list_cameras`/`list_camera_sizes`/`list_apps` | bool | `false` | print & exit, no sockets |
| `camera_id`, `camera_size` (`WxH`), `camera_facing` (front/back/external), `camera_ar` (`sensor`, `W:H`, float), `camera_zoom` (float, default 1), `camera_fps` (int), `camera_high_speed` (bool), `camera_torch` (bool) | | | camera only |
| `new_display` | `""`, `WxH`, `WxH/dpi`, `/dpi` | none | virtual display (Android 10+) |
| `vd_destroy_content` | bool | `true` | |
| `vd_system_decorations` | bool | `true` | |
| `flex_display` | bool | `false` | **new** (resizable virtual display, see RESIZE_DISPLAY) |
| `capture_orientation` | `[@]0|90|180|270|flip0|...` or `@` | unlocked, 0 | |
| `display_ime_policy` | `local`/`fallback`/`hide` | -1 | Android 10+ |
| `keep_active` | bool | `false` | **new**: simulates user activity every 4 s |
| `ignore_video_encoder_constraints` | bool | `false` | **new** |
| `send_device_meta` | bool | `true` | 64-byte device name on first socket |
| `send_frame_meta` | bool | `true` | 12-byte packet headers |
| `send_dummy_byte` | bool | `true` | forward mode only |
| `send_stream_meta` | bool | `true` | codec id + **session packets**. **Renamed from 3.x `send_codec_meta`** (old name is now an ignored unknown key) |
| `raw_stream` | bool | `false` | `true` sets all four `send_*` above to false |

Not options (do not exist in v5.0.1): `stay_awake` exists; there is **no** `send_codec_meta`, no `lock_video_orientation` (replaced by `capture_orientation` in 3.0), no `bit_rate` (it is `video_bit_rate`).

---

## 2. Connection setup (tunnel_forward=true)

Sources: `S/device/DesktopConnection.java`, `app/src/server.c` (`sc_server_connect_to`, `connect_to_server`, `connect_and_read_byte`), `doc/develop.md`.

1. Host: `adb -s <serial> forward tcp:<PORT> localabstract:scrcpy_<scid as %08x>` (e.g. scid `0x1a2b3c4d` → `localabstract:scrcpy_1a2b3c4d`; lowercase hex, zero-padded to 8). If `scid=-1`/absent, name is `scrcpy`.
2. Start the server (§1.2) with `tunnel_forward=true`.
3. Server creates `LocalServerSocket(name)` and calls `accept()` **in this fixed order, skipping disabled ones: video, audio, control**. Client must connect in the same order, **sequentially** (the official client finishes each connect before starting the next).
4. **Dummy byte**: on the *first* accepted socket only (whichever stream is first), the server immediately writes one byte `0x00` (if `send_dummy_byte=true`). Nothing is written on the others.
5. **Retry while server not listening**: with adb forward, a TCP connect to `127.0.0.1:<PORT>` succeeds even when nothing listens on the device; the read then gets EOF/reset. The official client: open socket → connect → `recv(1)`; if it doesn't get exactly 1 byte, close and retry; **100 attempts, 100 ms apart** (`attempts = 100; delay = 100ms`). Only the first socket uses this loop; audio/control sockets are then connected plainly (no byte read). Set TCP_NODELAY on the control socket (official client does).
6. After all sockets are accepted, the server sends **device meta** on the **first** socket (if `send_device_meta=true`):
   - **64 bytes**, UTF-8 `Build.MODEL`, truncated at a UTF-8 boundary to ≤ 63 bytes, NUL-padded. (`DEVICE_NAME_FIELD_LENGTH = 64`.) No length prefix.
7. The adb forward can be removed once connected (official client removes it).

So the byte sequence on the video socket (video enabled, forward, defaults) is:
```
[0x00 dummy] [64B device name] [u32 codec id] [12B session packet] [media packets ...]
```
On the audio socket: `[u32 codec id] [media packets ...]` (no session packets for audio).
On the control socket: bidirectional message stream (§4, §5), nothing initial.

### 2.1 Stream header: codec id (u32 BE) — `S/device/Streamer.java`, `S/video/VideoCodec.java`, `S/audio/AudioCodec.java`

| codec | id (hex) | ASCII |
|---|---|---|
| h264 | `0x68323634` | "h264" |
| h265 | `0x68323635` | "h265" |
| av1 | `0x00617631` | "\0av1" |
| vp8 | `0x00767038` | "\0vp8" |
| vp9 | `0x00767039` | "\0vp9" |
| opus | `0x6F707573` | "opus" |
| aac | `0x00616163` | "\0aac" |
| flac | `0x666C6163` | "flac" |
| raw | `0x00726177` | "\0raw" (PCM S16LE) |
| **0** | `0x00000000` | stream explicitly disabled by device (continue without it) |
| **1** | `0x00000001` | configuration error on device — client must stop |

- **No width/height after the codec id any more** (3.x sent `codec_id, width, height` = 12 bytes). In v5 the size comes in the **session packet** (§3.1).
- Codes 0/1 (`Streamer.writeDisableStream`) are written **even if `send_stream_meta=false`**. Only the audio path uses them:
  - Android < 11 (API 30): audio → `0` (both `AudioEncoder` and `AudioRawRecorder`).
  - Capture start failure (`AudioCaptureException`, e.g. permission/source unsupported) → `0`.
  - Any other encoder init error (e.g. codec not found) → `1`, and the audio thread reports a fatal error so the **whole server exits**.
- The audio codec id is only written **after** capture started successfully, so the audio socket can stay silent for a while.
- Video has no disable code: a video failure terminates the server (video thread always reports `fatalError=true` on termination, `S/video/SurfaceEncoder.java`), the client just sees EOF.

---

## 3. Media packet framing (`S/device/Streamer.java`, `app/src/demuxer.c`)

Every unit after the codec id is introduced by a **12-byte header**. Distinguish by the **MSB of byte 0**.

### 3.1 Session packet (video only, MSB = 1) — NEW in 4.x/5.x
```
offset size  field
0      4     u32 flags: bit31 = 1 (session), bit0 = "client resized" (R), others 0
4      4     u32 video width  (BE)
8      4     u32 height        (BE)
(no payload)
```
- Written by `SurfaceEncoder` at the start of **every capture/encoding session**: the first one right after the codec id, then again after every reset: rotation / fold / display property change (`RESET_REASON_DISPLAY_PROPERTIES_CHANGED`), client `RESET_VIDEO` (`RESET_REASON_CLIENT_RESET`), flex-display client resize (`RESET_REASON_CLIENT_RESIZED`), encoder-error retry with a smaller size.
- `R` (bit 0 of byte 3) = 1 only when the reset was caused by a client RESIZE_DISPLAY and not also by a display property change.
- Sent only if `send_stream_meta=true`. The official client requires the very first header after the codec id to be a session packet with non-zero w/h.
- After each session packet the encoder is **re-created** → expect a **new config packet** (SPS/PPS for H.264; VPS/SPS/PPS for H.265; AV1 sequence header) followed by a **key frame**. Treat a session packet as "reconfigure decoder with new size, wait for config + keyframe".
- These dimensions are the ones touch events must reference (§6).

### 3.2 Media packet (MSB = 0)
```
offset size  field
0      8     u64 BE: bit63 = 0, bit62 = CONFIG, bit61 = KEY_FRAME, bits 0..60 = PTS (µs)
8      4     u32 BE packet size N (> 0; client treats 0 as error)
12     N     payload (raw MediaCodec output buffer)
```
- `PACKET_FLAG_CONFIG = 1<<62`, `PACKET_FLAG_KEY_FRAME = 1<<61`; PTS mask = `(1<<61) - 1`.
- **Config packets**: the 8-byte field is exactly `0x4000000000000000` (PTS not meaningful, key-frame bit never set). Non-config: `pts | (keyframe ? 1<<61 : 0)`.
- PTS unit is microseconds (`MediaCodec.BufferInfo.presentationTimeUs`); it is not reset to 0 at stream start.
- If `send_frame_meta=false`, packets are written back-to-back without headers (no framing).
- **H.264/H.265 config** = codec-specific data as emitted by MediaCodec: Annex-B NAL units with start codes (SPS+PPS). The official client **prepends the config packet to the next media packet** (`app/src/packet_merger.c`, only for h264/h265) before decoding. Video frames are Annex-B too. For WebCodecs, either use `avc` Annex-B mode (no `description`) and feed config+keyframe concatenated, or convert to avcC yourself.
- **Opus config**: server strips Android's `AOPUSHDR` wrapper and sends only the **`OpusHead`** structure (19 bytes typically) as the config packet (`fixOpusConfigPacket`). Use it as decoder extradata/`description`.
- **FLAC config**: server strips `fLaC` + 4-byte header and sends only the 34-byte STREAMINFO.
- **AAC config**: sent as-is (AudioSpecificConfig, 2 bytes typically).
- **Raw audio**: no config packet; each packet = interleaved PCM **s16le, 48000 Hz, 2 channels**, up to 1024 frames = **4096 bytes** (`S/audio/AudioConfig.java` `MAX_READ_SIZE`). Raw requires Android ≥ 11 like all audio.
- Encoder settings (`SurfaceEncoder.createFormat`): I-frame interval 10 s, `KEY_REPEAT_PREVIOUS_FRAME_AFTER` = 100 ms (a frame is repeated if the screen is static, so frames keep coming), `KEY_FRAME_RATE`=60 (nominal), `KEY_LATENCY`=1 / priority 0 where supported. There is **no on-demand IDR request message**; to get a fresh keyframe send `RESET_VIDEO` (type 17), which restarts the session (→ session packet + config + keyframe).
- Static screen at startup: thanks to repeat-frame, a first frame should arrive, but nothing guarantees timing.

---

## 4. Control messages (client → device), control socket

Sources: `app/src/control_msg.h/.c` (serializer), `S/control/ControlMessageReader.java`, `S/control/ControlMessage.java`, `S/control/Controller.java`.
Max message size 256 KiB (`1<<18`). All offsets from start of message; byte 0 = type (u8).

Common sub-structure **position** (12 bytes):
```
+0  i32 x            (signed, in video-frame pixel coordinates)
+4  i32 y
+8  u16 screen width  (= current video width from the latest session packet)
+10 u16 screen height
```

| id | name | total size | layout after type byte |
|---|---|---|---|
| 0 | INJECT_KEYCODE | 14 | `[1] u8 action` (KeyEvent action), `[2] i32 keycode`, `[6] i32 repeat`, `[10] i32 metaState` |
| 1 | INJECT_TEXT | 5+len | `[1] u32 len`, `[5] UTF-8 bytes` (no NUL). Client truncates to **300 bytes** (`SC_CONTROL_MSG_INJECT_TEXT_MAX_LENGTH`); server does not enforce but each char is turned into key events via the virtual KeyCharacterMap (non-ASCII may fail; failures just logged). |
| 2 | INJECT_TOUCH_EVENT | 32 | `[1] u8 action` (MotionEvent action), `[2] i64 pointerId`, `[10] position (12B)`, `[22] u16 pressure` (fixed-point), `[24] i32 actionButton`, `[28] i32 buttons` |
| 3 | INJECT_SCROLL_EVENT | 21 | `[1] position (12B)`, `[13] i16 hscroll`, `[15] i16 vscroll`, `[17] i32 buttons` |
| 4 | BACK_OR_SCREEN_ON | 2 | `[1] u8 action` (KeyEvent action). Injects BACK if screen on, else POWER (only on DOWN). Send DOWN then UP. |
| 5 | EXPAND_NOTIFICATION_PANEL | 1 | — |
| 6 | EXPAND_SETTINGS_PANEL | 1 | — |
| 7 | COLLAPSE_PANELS | 1 | — |
| 8 | GET_CLIPBOARD | 2 | `[1] u8 copyKey`: 0 NONE, 1 COPY, 2 CUT (injects KEYCODE_COPY/CUT first on Android 7+). Reply: CLIPBOARD device msg — **only if `clipboard_autosync=false`**; with autosync on, the reply comes via the normal clipboard-change notification. |
| 9 | SET_CLIPBOARD | 14+len | `[1] u64 sequence` (0 = no ack wanted), `[9] u8 paste` (≠0 → inject PASTE on Android 7+), `[10] u32 len`, `[14] UTF-8 text` (max 256K−14) |
| 10 | SET_DISPLAY_POWER | 2 | `[1] u8 on` (0/1). Turns the physical display off while mirroring continues. |
| 11 | ROTATE_DEVICE | 1 | — |
| 12 | UHID_CREATE | var | `[1] u16 id`, `[3] u16 vendorId`, `[5] u16 productId`, `[7] u8 nameLen`, name (≤127 from client), then `u16 reportDescSize`, report descriptor bytes |
| 13 | UHID_INPUT | 5+n | `[1] u16 id`, `[3] u16 size`, `[5] data` |
| 14 | UHID_DESTROY | 3 | `[1] u16 id` |
| 15 | OPEN_HARD_KEYBOARD_SETTINGS | 1 | — |
| 16 | START_APP | 2+len | `[1] u8 len`, name (≤255). Prefix `+` = force-stop first; `?` = search by app label instead of package name. Async. |
| 17 | RESET_VIDEO | 1 | restart capture/encoder → new session packet + config + keyframe |
| 18 | CAMERA_SET_TORCH | 2 | `[1] u8 on` — **camera source only** |
| 19 | CAMERA_ZOOM_IN | 1 | camera only |
| 20 | CAMERA_ZOOM_OUT | 1 | camera only |
| 21 | RESIZE_DISPLAY | 5 | `[1] u16 width`, `[3] u16 height` — **only valid with `new_display`** (flex display) |
| 22 | SCAN_FILE | 5+len | `[1] u32 len`, path (≤256) → MEDIA_SCANNER_SCAN_FILE broadcast |

New vs 3.x: 18–22 (camera torch/zoom, resize display, scan file). Ids 0–17 unchanged from 3.x.

**Danger — messages that kill the server** (`Controller.handleEvent`):
- An unknown type byte → `ControlProtocolException` → controller stops → reported as fatal → **server exits**.
- Camera messages (18–20) while mirroring a display, or display messages (anything except 17) while `video_source=camera` → `AssertionError` → fatal.
- RESIZE_DISPLAY (21) when not using `new_display` → `ClassCastException` → fatal.
- A malformed/short message desynchronises the stream (no length prefix framing). Write each message atomically.

### 4.1 Fixed-point encodings
- **pressure** (u16): `u = floor(p * 65536)`, clamp `0xFFFF` for p = 1.0. Decode: `0xFFFF → 1.0`, else `u/65536`. (`app/src/util/binary.h sc_float_to_u16fp`, `S/util/Binary.java`). Use `0xFFFF` for a normal press, `0` for UP.
- **scroll** (i16): client accepts −16..16, normalises `v/16`, clamps to [−1,1], encodes `i = trunc(n * 32768)`, clamp to `0x7FFF` for 1.0. Server: `value == 0x7FFF ? 1 : value/32768`, then `×16`. Values become `AXIS_HSCROLL`/`AXIS_VSCROLL` of an `ACTION_SCROLL` mouse event. Typical wheel notch: vscroll = ±1 (positive = scroll up / content moves down, Android convention).

### 4.2 Special pointer ids (`app/src/control_msg.h`)
| name | value (as u64 / i64) |
|---|---|
| `POINTER_ID_MOUSE` | `0xFFFFFFFFFFFFFFFF` (−1) |
| `POINTER_ID_GENERIC_FINGER` | `0xFFFFFFFFFFFFFFFE` (−2) |
| `POINTER_ID_VIRTUAL_FINGER` | `0xFFFFFFFFFFFFFFFD` (−3) (pinch-to-zoom helper) |
Any other value = a real finger id chosen by the client (e.g. browser `Touch.identifier`/`PointerEvent.pointerId`).

Server treatment (`Controller.injectTouch`): if `pointerId == -1` **and** (`action == HOVER_MOVE` or any button other than PRIMARY in `actionButton|buttons`) → injected as `SOURCE_MOUSE`/`TOOL_TYPE_MOUSE` with button press/release sequences; **otherwise everything (including mouse −1 with only primary button) is injected as a finger on `SOURCE_TOUCHSCREEN`, and `buttons` is forced to 0**.

### 4.3 Android constants (`app/src/android/input.h`, `app/src/android/keycodes.h`)
KeyEvent actions: `DOWN=0`, `UP=1`, `MULTIPLE=2`.
MotionEvent actions: `DOWN=0, UP=1, MOVE=2, CANCEL=3, OUTSIDE=4, POINTER_DOWN=5, POINTER_UP=6, HOVER_MOVE=7, SCROLL=8, HOVER_ENTER=9, HOVER_EXIT=10, BUTTON_PRESS=11, BUTTON_RELEASE=12`; `ACTION_MASK=0xff`, `POINTER_INDEX_SHIFT=8`.
Buttons: `PRIMARY=1, SECONDARY=2, TERTIARY=4, BACK=8, FORWARD=16, STYLUS_PRIMARY=32, STYLUS_SECONDARY=64`.
Meta state: `SHIFT_ON=0x1, ALT_ON=0x2, SHIFT_LEFT_ON=0x40, CTRL_ON=0x1000, CTRL_LEFT_ON=0x2000, META_ON=0x10000`.
Keycodes: `HOME=3, BACK=4, DPAD_UP=19, DPAD_DOWN=20, DPAD_LEFT=21, DPAD_RIGHT=22, VOLUME_UP=24, VOLUME_DOWN=25, POWER=26, CAMERA=27, A=29 (…Z=54), TAB=61, SPACE=62, ENTER=66, DEL=67 (backspace), MENU=82, NOTIFICATION=83, PAGE_UP=92, PAGE_DOWN=93, ESCAPE=111, FORWARD_DEL=112, MOVE_HOME=122, MOVE_END=123, VOLUME_MUTE=164, APP_SWITCH=187, SLEEP=223, WAKEUP=224, CUT=277, COPY=278, PASTE=279`.

### 4.4 Multi-touch (`S/control/PointersState.java`, `Controller.injectTouch`)
- **The server does multi-touch bookkeeping itself.** Send only `ACTION_DOWN (0)`, `ACTION_MOVE (2)`, `ACTION_UP (1)` per pointer id; **do not send POINTER_DOWN/POINTER_UP yourself**.
- Server keeps up to **10** pointers (`MAX_POINTERS`); a new id gets the lowest free local id 0..9. 11th simultaneous pointer → event dropped ("Too many pointers").
- Every injected MotionEvent contains **all currently tracked pointers** (last known positions/pressures). If more than one pointer is tracked, DOWN → `POINTER_DOWN | index<<8`, UP → `POINTER_UP | index<<8` automatically.
- A pointer is removed after the event in which it goes UP. If you send `POINTER_UP (6)` yourself, the pointer is **never released** (only action==UP marks it up) → stuck finger. If you lose an UP, send an UP for that id to clean up.
- Each MOVE message moves only the given pointer; for multiple moving fingers send one MOVE per finger.

---

## 5. Device messages (device → client), control socket

Sources: `S/control/DeviceMessage.java`, `S/control/DeviceMessageWriter.java`, `app/src/device_msg.c`.

| id | name | layout |
|---|---|---|
| 0 | CLIPBOARD | `[0] u8 type`, `[1] u32 len`, `[5] UTF-8 text` (≤ 256K−5) |
| 1 | ACK_CLIPBOARD | `[0] u8 type`, `[1] u64 sequence` (9 bytes total) |
| 2 | UHID_OUTPUT | `[0] u8 type`, `[1] u16 id`, `[3] u16 size`, `[5] data` |

No new device message types in v5.0.1. CLIPBOARD is sent automatically on every device clipboard change when `clipboard_autosync=true` (default), except for changes caused by SET_CLIPBOARD. A client must parse/skip these even if it ignores them, or the stream desyncs.

---

## 6. Server behaviours a custom client must respect

- **Coordinates**: touch/scroll `position` is in **video-frame pixels**, and `screenWidth/screenHeight` must **equal the current video size** (from the latest session packet). `PositionMapper.map()` returns null if sizes differ → **event silently ignored** (only a verbose log). This happens e.g. right after a rotation, until the client uses the new size. The server maps video coords → device coords itself (handles max_size scaling, crop, angle, orientation).
- Before the first video session (or with `video=false`), positional events use raw coordinates on `display_id` (no mapping/size check), per `getEventPointAndDisplayId`.
- Key events (INJECT_KEYCODE) go to `display_id` (or the virtual display with `new_display`), all inject modes ASYNC.
- `power_on=true` (default): at control start, if display 0 is off, POWER is pressed and the controller sleeps 500 ms before reading messages.
- `SET_DISPLAY_POWER off`: later POWER/WAKEUP key-up re-schedules display-off after 200 ms (keeps screen off while mirroring).
- **Disconnect**: when any socket read/write fails (client closed), that component terminates; video and controller termination is always reported as fatal → `Looper` quits → all components stopped, sockets shut down, process `System.exit`. Audio termination is fatal only on non-capture errors. So closing any one socket ends the session.
- **cleanup=true**: at startup a separate `app_process` (`com.genymobile.scrcpy.CleanUp`, `setsid()`-detached) is spawned; it deletes the jar, waits for the server's death (stdin EOF), then restores `show_touches`, `stay_on_while_plugged_in`, `screen_off_timeout`, display IME policy, display power, and powers the screen off if `power_off_on_close=true`. Works even on USB unplug.
- The official client kills the server 1 s after interrupting the sockets if it hasn't exited ("watchdog"); do the same (kill the adb shell child).
- Only one server per socket name: use a fresh random scid per session to avoid conflicts with a stale server.

---

## 7. Minimal client recipe (Emule, v5.0.1)

Raw audio **is allowed** by the server (`audio_codec=raw`, Android ≥ 11). Packets are PCM s16le/48k/stereo, ≤4096 B, each with a 12-byte header.

1. `scid = random & 0x7FFFFFFF`; `name = "scrcpy_" + scid.toString(16).padStart(8,'0')`.
2. `adb -s SERIAL push scrcpy-server /data/local/tmp/scrcpy-server.jar`
3. `adb -s SERIAL forward tcp:PORT localabstract:<name>` (pick a free PORT, e.g. 27183).
4. Spawn (keep the child process handle):
   ```
   adb -s SERIAL shell CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 5.0.1 scid=<8 hex> log_level=info video=true audio=true control=true tunnel_forward=true video_codec=h264 audio_codec=raw max_size=1920 video_bit_rate=8000000 max_fps=60
   ```
   (Defaults already give send_device_meta/frame_meta/dummy_byte/stream_meta = true and cleanup=true.)
5. Video socket: loop up to ~100× every 100 ms: TCP connect `127.0.0.1:PORT`, read exactly 1 byte (`0x00`); on EOF/error close and retry. Also abort if the adb child exits.
6. Audio socket: connect (after 5 succeeds). Then control socket: connect, set `setNoDelay(true)`.
7. `adb forward --remove tcp:PORT` (optional).
8. Video socket, read in order: 64 B device name (NUL-trimmed UTF-8) → u32 codec id (expect `0x68323634`) → 12 B header, must have MSB=1 → width/height → loop: 12 B header; if `byte0 & 0x80` → session (new w,h; reconfigure decoder; wait for config+keyframe) else read `size` bytes payload; config flag → keep as SPS/PPS and prepend to next frame; keyframe flag → IDR.
9. Audio socket: u32 codec id: `0x00726177` → raw OK; `0` → audio disabled, close/ignore the socket but keep going; `1` → fatal. Then loop 12 B header + payload (PCM).
10. Control socket: read loop for device messages (§5); send control messages (§4) using the latest session width/height in every position.
11. Shutdown: close sockets, wait ≤1 s for the adb child to exit, then kill it.

Example tap at (x,y) on a 1080×2400 video, finger:
```
02 00 | FFFFFFFFFFFFFFFE | x(i32) y(i32) 0438 0960 | FFFF | 00000000 | 00000000   (DOWN)
02 01 | FFFFFFFFFFFFFFFE | x(i32) y(i32) 0438 0960 | 0000 | 00000000 | 00000000   (UP)
```
(byte 1 is the action; type byte `02` first.) HOME key: `00 00 00000003 00000000 00000000` then `00 01 00000003 00000000 00000000`.

---

## 8. Release asset `scrcpy-win64-v5.0.1.zip` (from packaging scripts, not downloaded)

Sources: `release/release.sh`, `release/build_windows.sh`, `release/package_client.sh`, `release/build_common`, `app/deps/*.sh`.
- `release.sh` builds `win32`, `win64` (zip) and `linux-x86_64` (tar.gz); `package_client.sh` names it `scrcpy-<target>-$VERSION` where `VERSION = git describe --tags` → `scrcpy-win64-v5.0.1.zip` containing a top-level folder **`scrcpy-win64-v5.0.1/`**.
- Contents:
  - `scrcpy.exe`, `scrcpy-noconsole.vbs`, `scrcpy.png`, `disconnected.png`, `open_a_terminal_here.bat`, `LICENSE.txt`
  - **`scrcpy-server`** (the server jar, no extension; copied from `build-server/server/scrcpy-server`)
  - **`adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll`** (from Google platform-tools **r37.0.1**, `app/deps/adb_windows.sh`)
  - all DLLs from the deps install `bin/`: SDL **3.4.18** (`SDL3.dll`), FFmpeg **9.0.2** shared libs (avcodec, avformat, avutil, swresample — swscale/avfilter/avdevice disabled), dav1d **1.5.4**, libusb **1.0.30**. Exact DLL file names (e.g. `avcodec-NN.dll`) depend on library major versions and were **not verified**.
- For Emule you only need `scrcpy-server`, `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll`.

---

## 9. Differences vs scrcpy 2.x/3.x (surprises)

1. **Video stream header changed**: 3.x = `codec_id(4) + width(4) + height(4)`; v5 = `codec_id(4)` then a **12-byte session packet** (MSB=1) carrying width/height, repeated on every rotation/reset. A 3.x parser will misread the stream. Clients must check the MSB of every 12-byte header.
2. Option **`send_codec_meta` → `send_stream_meta`**; the old key is silently ignored (warning only).
3. New video codecs `vp8`/`vp9`; new options `min_size_alignment`, `flex_display`, `keep_active`, `ignore_video_encoder_constraints`; camera/new_display options as in 3.x.
4. New control messages 18–22 (camera torch/zoom, RESIZE_DISPLAY, SCAN_FILE); sending a message invalid for the current mode **crashes the server**.
5. Session packet has a "client resized" flag (flex display).
6. `doc/develop.md` at v5.0.1 still says "documents the current protocol in scrcpy 4.0" and its examples use version `4.0` — use `5.0.1` as the version argument.

## 10. Not verified / caveats
- Exact Windows DLL file names in the zip (version-dependent); no zip was downloaded.
- Behaviour of `adb forward` connection ordering under heavy concurrency is assumed sequential (as the official client does it).
- Typical size of OpusHead/AAC config packets is from comments, not measured.
- Raw audio packet PTS semantics (from `AudioRecordReader`) were not reviewed in detail.
