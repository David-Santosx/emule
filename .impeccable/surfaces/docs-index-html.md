---
version: 1
slug: "docs-index-html"
primary_target: "docs/index.html"
related_targets: []
---

# Surface brief: docs/index.html (GitHub Pages landing)

Scope: the public landing page of Emule (pt-BR). Mode: Persuade.
Audience: Brazilian mobile gamers first, plus people who just want to mirror/control an Android phone on a Windows PC. Job: understand what Emule does, believe it is fast, download it, get the phone connected.
Action: download Emule.exe directly (https://github.com/David-Santosx/emule/releases/latest/download/Emule.exe); installer and zip as secondary links to the release page.
Proof: only measured numbers (Galaxy A25: connect ~1.2 s, first frame ~1.6 s, 1080×2340 up to 60 fps = 16.7 ms per frame, decode queue 0, audio buffer ~25–35 ms; mouse read at up to 1 kHz, sent at ~250 Hz = every 4 ms). Frames are labelled as illustration. No invented benchmarks, testimonials or competitor comparisons.
Sections kept (user): latency proof (hero), Como usar, Atalhos + requisitos, Dúvidas + créditos. No dedicated key-mapping section (user did not keep it); mapping/aim mode appears only inside the latency story.
User constraint: green (#22c55e family) replaces the red role for the input event.

## Direction contract

THESIS: The page is a slow-motion latency test filmed frame by frame: every section is a frame with burned-in time. Refuses the category default of a dark neon hero with a floating phone mockup and a row of feature cards.

OWN-WORLD: Footage-grey frames (#121212 ground, #1c1c1b frame stock, #e9e8e2 overexposed white for phone pixels) with hard 1px frame borders and corner crop marks; burned-in OSD text in a monospaced video-overlay face, yellow #f2e600 reserved for time and measurement (timestamps, brackets, ms rulers); green #22c55e reserved for the input event (keypress, click, touch point, the download action). No gradients, no glows, no cards with icon tiles.

STORY: The visitor watches one input travel mouse → USB → phone → decode → screen in labelled frames, understands Emule is a real phone mirrored over a cable, believes it is fast because every number on screen is measured, and downloads the exe; then sets up the phone in four steps.

FIRST VIEWPORT: Top bar: wordmark left, "Baixar Emule.exe" right. Headline and lede set as the caption plate of the footage block, directly over a full-width horizontal strip of 5 frames (input, USB, phone, decode, PC screen), each with burned-in time, frame number and a yellow ms ruler running under the strip; green marks the click and the touch point. Primary action (green, "Baixar Emule.exe · Windows 10/11") sits directly under the strip with secondary links. Keyboard: ← → / Home / End step frames while the strip has focus (no single-key global shortcuts).

FORM: Grounded candidate 7 of 7 (high-speed latency test footage), raised by the deep-dive (one ms axis rules the page), ANSI BBS (full keyboard operation with visible keycaps) and Bauhaus (colour rationed by role) challengers. seed:c3c02a4d0b2bed09

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: stepping through frames (← →, scroll, click) advances a playhead along the ms ruler; the active frame's caption explains that stage. Motion grammar: frame-step cuts (no easing tweens) like scrubbing footage; disabled under prefers-reduced-motion except instant state changes.

Unresolved: none.
