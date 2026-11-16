# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary:** mobile gamers (Free Fire, PUBG Mobile, CODM, MOBAs and similar) who want to play their phone's games on a Windows PC with keyboard and mouse, on a big screen, without an emulator.
- **Secondary:** anyone who wants to mirror and control an Android phone from the PC (use apps, present, record, type with a real keyboard).
- Brazilian, Portuguese-speaking (pt-BR). Most are not developers; they must enable USB debugging on their phone to use the app.

## Product Purpose

Emule is a free Windows desktop app that mirrors an Android phone to the PC over a USB cable with very low latency, plays the phone's audio on the PC, and maps keyboard and mouse to touches for games. Success = a visitor downloads the exe, connects the phone in a couple of minutes and plays with input that feels immediate.

The website (GitHub Pages) exists to explain what Emule does, prove it is fast, get the visitor to download it, and get them through phone setup.

## Positioning

- Runs the real game on the real phone (no emulator), so games, accounts and performance are the phone's own.
- Latency is the main differentiator vs ApowerMirror-style tools: USB only, hardware decoding, every frame drawn the moment it is decoded (no buffer), raw 1 kHz mouse input forwarded at ~250 Hz.
- Complete key mapping including an aim mode (hidden cursor, mouse-look) with separate X/Y sensitivity.

## Operating Context

- Windows 10/11 x64 PC + Android phone (5.0+; phone audio needs Android 11+) connected by a USB data cable.
- One-time phone setup: Developer options → USB debugging → accept the "Allow USB debugging?" prompt.
- Distribution: portable `Emule.exe` (no install) or `Emule-Setup-<version>.exe`, from GitHub Releases (https://github.com/David-Santosx/emule/releases/latest). adb is bundled.
- The exe is unsigned: Windows SmartScreen shows "O Windows protegeu o computador" → "Mais informações" → "Executar assim mesmo".
- Other adb-based tools open at the same time (WASD+, emulators, scrcpy, Vysor) can drop the connection.

## Capabilities and Constraints

- Mirroring: scrcpy-server v5.0.1 on the phone (unmodified) + Emule's own client; WebCodecs H.264/H.265 hardware decoding; native resolution, up to 24 Mbps, 60 fps; quality presets "Máxima qualidade", "Equilibrado", "Desempenho".
- Phone audio on the PC (raw PCM, ~25–60 ms buffer), volume and mute.
- Key mapping: tap/hold, WASD joystick with sprint key, swipe, macro (multitap); all keys, mouse buttons (left/right/middle/side) and wheel up/down bindable; one key can fire several controls; aim mode with pointer lock (toggle or hold), separate X/Y sensitivity, invert Y; visual drag-and-drop editor; FPS and MOBA example profiles; JSON import/export.
- Toolbar: back, home, recents, volume, power, rotate, notifications, screenshot, install APK, turn phone screen off, fullscreen, always on top, stats HUD.
- Shortcuts: F1 help, F11 fullscreen, F12 / Ctrl+K toggle mapping, Ctrl+Shift+E editor, Ctrl+Shift+H stats.
- Android only (no iPhone). Windows only.
- Using key mapping in online games may break some games' terms; risk is the user's.
- License: undecided (repository currently has no license). Do not call it open source.

## Brand Commitments

- Name: **Emule**. Existing app icon: `build/icon.png` (dark rounded square, green outline, phone + play glyph). App UI is dark with green accent #22c55e.
- Voice: direct and technical — real numbers (ms, fps, Hz, Mbps), no marketing hype, no superlatives that aren't measured.
- Language: Portuguese (pt-BR).
- Offer: **free**. Not claimed: open source, no-ads/no-account statements beyond what is true, beta status.
- Credits must stay: scrcpy (Genymobile, Apache-2.0), Android platform-tools adb (Apache-2.0), Electron (MIT). Not affiliated with Google, Samsung or Genymobile.

## Evidence on Hand

- Measurements on a Samsung Galaxy A25 (Android 16): connect ~1.2 s, first frame ~1.6 s, 1080×2340 at up to 60 fps (39–55 fps measured while swiping), decode queue 0, audio buffer ~24–35 ms (up to ~60 ms).
- Docs: `README.md`, `release/LEIA-ME.txt`, `docs/ARCHITECTURE.md`, `docs/PROTOCOL.md`, `src/renderer/keymap/README.md`.
- No real screenshots of the app are published; QA screenshots contain the owner's phone content and must not be used. No testimonials, user counts, reviews or benchmarks against competitors exist — do not fabricate them.

## Product Principles

1. Latency first: every claim about speed is backed by a measured number.
2. Real phone, real game: Emule never pretends to be an emulator.
3. Two minutes to first frame: setup guidance is part of the product, not an afterthought.
4. Honest by default: say what is unsigned, what needs Android 11+, and what risks exist.
