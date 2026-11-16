---
name: Emule
description: The GitHub Pages landing for Emule, filmed as a frame-by-frame latency test.
colors:
  input-green: "#22c55e"
  input-green-hover: "#3ddc77"
  input-ink: "#062b13"
  time-yellow: "#f2e600"
  ground: "#121212"
  stock: "#1c1c1b"
  stock-raised: "#242422"
  film: "#0d0d0d"
  rule: "#3a3a37"
  overexposed-white: "#e9e8e2"
  dim: "#a9a89f"
  faint: "#8d8c84"
typography:
  display:
    fontFamily: "Big Shoulders Display, Impact, sans-serif"
    fontSize: "clamp(2.7rem, 6.4vw, 5rem)"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "-0.005em"
  headline:
    fontFamily: "Big Shoulders Display, Impact, sans-serif"
    fontSize: "clamp(2.2rem, 5vw, 3.6rem)"
    fontWeight: 900
    lineHeight: 0.95
  title:
    fontFamily: "Big Shoulders Display, Impact, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "0.01em"
  body:
    fontFamily: "Archivo, Segoe UI, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Share Tech Mono, ui-monospace, Consolas, monospace"
    fontSize: "0.72rem"
    fontWeight: 400
    letterSpacing: "0.04em"
    fontFeature: "tnum"
  measurement:
    fontFamily: "Share Tech Mono, ui-monospace, Consolas, monospace"
    fontSize: "clamp(1.3rem, 2.4vw, 1.75rem)"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  none: "0px"
  button: "2px"
  keycap: "4px"
spacing:
  gutter: "clamp(16px, 4vw, 40px)"
  container: "1240px"
  section: "clamp(56px, 8vw, 104px)"
  bar: "60px"
  row: "14px"
  touch: "44px"
components:
  button-download:
    backgroundColor: "{colors.input-green}"
    textColor: "{colors.input-ink}"
    rounded: "{rounded.button}"
    padding: "10px 16px"
    height: "44px"
  button-download-large:
    backgroundColor: "{colors.input-green}"
    textColor: "{colors.input-ink}"
    rounded: "{rounded.button}"
    padding: "16px 24px"
  button-download-hover:
    backgroundColor: "{colors.input-green-hover}"
    textColor: "{colors.input-ink}"
  frame:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.dim}"
    rounded: "{rounded.none}"
  frame-selected:
    backgroundColor: "{colors.stock-raised}"
    textColor: "{colors.overexposed-white}"
  keycap:
    backgroundColor: "{colors.stock-raised}"
    textColor: "{colors.overexposed-white}"
    typography: "{typography.label}"
    rounded: "{rounded.keycap}"
    padding: "0 0.45em"
    height: "1.9em"
  howto-frame:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.dim}"
    rounded: "{rounded.none}"
    padding: "52px 20px 24px"
  measurement-value:
    textColor: "{colors.time-yellow}"
    typography: "{typography.measurement}"
  top-bar:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.dim}"
    height: "{spacing.bar}"
---

# Design System: Emule

Scope: this file records the visual world of the public website only (`docs/index.html`, GitHub Pages, pt-BR). The desktop app's own UI (`src/renderer`) is an older, separate system and is not described here; do not apply these rules to it, and do not take its tokens as this world's.

## Overview

**Creative North Star: "The Latency Test Footage"**

The site is a slow-motion latency test filmed frame by frame. Surfaces are footage-grey film stock separated by hard 1px rules; information is burned into the frames the way a high-speed camera overlays timecode, in an uppercase monospaced video-overlay face. One input travels mouse, USB, phone, decode, PC screen across a strip of five frames, and a yellow playhead walks a ruler underneath it. The page has no imagery beyond line-drawn diagrams; the phone's pixels are an overexposed off-white.

Colour is rationed by role, not by decoration. Everything is greyscale except two signals: yellow means time and measurement, green means input. Because each colour carries one meaning, a reader can tell at a glance that a yellow number was measured and that a green thing is something they (or their mouse) do. The voice is direct and technical: real ms, fps and Hz, nothing unmeasured.

Motion is a cut, not a tween. Frames change state in hard steps like scrubbing footage, and under reduced motion they change instantly.

**Key Characteristics:**
- Footage-grey film stock on a near-black ground; depth by tone, never by shadow.
- Burned-in OSD text (frame number, stage, measured value) on frames and steps.
- Yellow is time and measurement; green is the input event and the download action.
- Square geometry with 1px rules, corner crop marks on the selected frame.
- Condensed uppercase display headlines over a neutral grotesque body.
- Frame-step motion (`steps(2)` cuts), gated by `prefers-reduced-motion`.

## Colors

A greyscale footage palette with two role-locked signals: a time yellow and an input green.

### Primary
- **Input Green** (`input-green`): the input event and the download action. Fills every "Baixar" button, draws the click and touch points in the frame diagrams, marks the five mouse updates on the one-frame ruler, and is the text caret colour. Also used as the hover colour for links and FAQ summaries (the page responding to the pointer).
- **Input Green Hover** (`input-green-hover`): the lighter green a download button takes on hover. Currently a literal in the stylesheet, not a custom property.
- **Input Ink** (`input-ink`): the deep green text on a green button. Never used on its own.

### Secondary
- **Time Yellow** (`time-yellow`): time and measurement. Burned-in measured values on the frames, the measurement-log numbers, the ms rulers and the playhead. It also serves keyboard focus (2px outline), text selection and the skip link, the page's one non-measurement use, kept because focus must be the most visible thing on screen.

### Neutral
- **Ground** (`ground`): page background, top bar (at 95% opacity), scrollbar track.
- **Film** (`film`): the footage block behind the headline plate, frame strip and edge; also the 1px seams between frames.
- **Frame Stock** (`stock`): unselected frames and how-to frames.
- **Raised Stock** (`stock-raised`): the selected frame and keycap faces.
- **Rule** (`rule`): every 1px border and divider, the how-to grid gutters, keycap edges, scrollbar thumb.
- **Overexposed White** (`overexposed-white`): primary text, headlines, line-drawn diagram ink, the phone's screen pixels.
- **Dim** (`dim`): secondary text, ledes, captions, nav links, crop marks, burn-ins on the frame's lower edge.
- **Faint** (`faint`): tertiary text: notes, footer, requirement labels, the frame-step hint.

### Named Rules
**The Two Signals Rule.** Yellow means time or a measured value; green means input or the download action. Nothing else gets colour. A number in yellow must be a real measurement; a decorative highlight in either colour breaks the code. Keyboard focus is the single sanctioned exception for yellow.

**The Green Is the Action Rule.** The only filled button on the site is the green download. Secondary actions are plain underlined links in white.

## Typography

**Display Font:** Big Shoulders Display (with Impact, sans-serif)
**Body Font:** Archivo (with Segoe UI, system-ui, sans-serif)
**Label/Mono Font:** Share Tech Mono (with ui-monospace, Consolas, monospace)

**Character:** Tall, condensed uppercase headlines read like slate and title cards; Archivo carries the explanation plainly; Share Tech Mono is the camera's overlay, used for every burned-in label and every measured number.

### Hierarchy
- **Display** (900, clamp 2.7–5rem, line-height 0.9, uppercase, balanced wrap): the single hero headline on the caption plate.
- **Headline** (900, clamp 2.2–3.6rem, 0.95, uppercase, max 18ch): section titles. The closing call uses a larger cut (clamp 2.4–4.4rem, 0.92, max 13ch); the one-frame ruler a smaller one (clamp 1.9–2.8rem).
- **Title** (800, 1.3–1.7rem, ~1.0, uppercase, slight positive tracking): frame names, how-to step titles, the active-frame caption, sub-heads, the wordmark.
- **Body** (400, 1.0625rem, 1.6): running text; ledes cap at 56ch, captions 60ch, notes and FAQ answers 70ch. Emphasis is weight 600 in Overexposed White inside Dim text.
- **Label** (Share Tech Mono 400, 0.72–0.8rem, 0.04em, uppercase, tabular numerals): burn-ins, ruler captions, requirement labels, keycap legends.
- **Measurement** (Share Tech Mono 400, clamp 1.3–1.75rem, 1, tabular, Time Yellow): the measured values in the measurement log.

### Named Rules
**The Burned-In Rule.** Burn-ins carry frame data (position like "QD 01/05" or "Passo 1/4", the stage, a measured value) and are set in the mono label style. They never restate or introduce the heading below them.

**The Mono Means Machine Rule.** Share Tech Mono is reserved for what the camera or the app would print: labels, keys, numbers. Prose is never set in it.

## Layout

A single centred column (max 1240px) with a fluid side gutter (clamp 16–40px). The top bar is sticky, 60px tall, with the wordmark left, section nav right of centre and the download button at the far right; anchor scrolling is offset by 72px for it.

The first viewport is one piece of film: a caption plate (headline 1.7fr, lede 1fr, bottom-aligned) over a strip of five equal square frames, then a ruled edge with the playhead and an OSD position readout. Directly under it sits the action row: download button, meta line, and the active frame's caption separated by a 1px vertical rule.

Sections are stacked "cuts": each opens with a 1px top rule and vertical padding of clamp 56–104px, with a headline and an optional right-aligned aside on one baseline. Content inside sections is tabular: rows divided by 1px rules (measurement log, shortcut table, requirement list, FAQ) or a 4-column grid of frames with 1px gutters (how-to).

Responsive behaviour: at 1060px the caption drops below the action row; at 980px how-to becomes 2 columns and the shortcut/requirement pair stacks; at 900px the plate and one-frame ruler stack; at 860px the nav hides; at 760px the frame strip becomes a horizontally scroll-snapped row of 74%-wide frames and how-to becomes one column; at 700px measurement rows reflow to value-beside-label with the note beneath. Interactive targets keep a 44px minimum.

## Elevation & Depth

Flat. There are no shadows, glows or gradients used as light. Depth is conveyed by tone steps of the same footage grey: Film under the strip, Frame Stock for frames, Raised Stock for the selected frame, Ground for the page. Unselected frame diagrams are greyscale at 42% opacity; the selected one is full colour and full opacity.

### Named Rules
**The Tone-Not-Shadow Rule.** A surface rises by moving one step lighter in the grey ramp, never by casting a shadow. The keycap's 3px bottom border is the only bevel, and it belongs to the keycap alone.

## Shapes

Square by default (0px). The 1px rule is the structural line: section dividers, row dividers, frame seams, the how-to grid. The selected frame gains corner crop marks: four 10px L-shaped ticks in Dim, inset 6px. Only two things round: the download button (2px, barely softened) and the keycap (4px, a physical key). Diagrams are drawn as round-capped 2px strokes in Overexposed White with 1.4px Dim secondary lines; dashed lines show signal travelling between stages.

## Components

### Download Button
The only filled button: green, confident, small-radius.
- **Shape:** nearly square (2px).
- **Default:** Input Green fill, Input Ink text, weight 700, a 2.2px square-capped download-arrow icon inline before the label; 10px 16px with a 44px minimum height in the top bar, 16px 24px at 1.08rem in the action row and closing section.
- **Hover:** fill lightens to Input Green Hover, text stays Input Ink.
- **Focus:** the global 2px Time Yellow outline at 3px offset.

### Frame (signature)
A square of film stock that is also a tab.
- **Structure:** a 1:1 picture area showing one 200-unit window of a shared 1000-unit line diagram, a top burn-in (frame number left, stage right, in Overexposed White), a bottom burn-in (subject left in Dim, measured value right in Time Yellow), and a name bar below, separated by a 1px Film seam.
- **Unselected:** Frame Stock, diagram greyscale at 42% opacity, name in Dim. Hover lifts the diagram to 75%.
- **Selected:** Raised Stock, full-colour diagram, name in Overexposed White, crop marks visible.
- **Behaviour:** tabs in a tablist; ← → / Home / End step frames, the ← → keycaps in the caption step them too, and on narrow screens scroll-snapping selects the centred frame. Selection updates the caption (with a `steps(2)` cut), moves the playhead and updates the "Quadro N de 5" readout.

### Film Edge and Playhead
A 22px ruler under the strip, drawn in 1.2px Time Yellow: a baseline, tall ticks at both ends, short ticks at each frame boundary, and a 4px-tall yellow bar the width of one frame marking the current frame. An OSD line beneath reads the position. The one-frame ruler below the action row uses the same drawing language at a finer scale, with green bars for the mouse updates.

### Measurement Log
A borderless table of rows divided by 1px Rule lines: stage name in Overexposed White (weight 500), the measured value in the Measurement style in Time Yellow, and a Dim explanation taking 46% of the width. A Faint note under it states the device and how to see live numbers.

### How-to Frames
Four Frame Stock cells joined by 1px Rule gutters inside a 1px Rule border. Each has a top burn-in ("Passo N/4" and the device), a Title-style step name, and Dim body text with Overexposed White bold for the literal UI labels to tap.

### Keycap
Inline key glyphs: Raised Stock face, Overexposed White mono legend at 0.8rem uppercase, 1px Rule border with a 3px bottom edge, 4px corners, 1.9em square minimum. Used in the shortcut table, notes, asides and the frame-step control.

### Rows (shortcuts, requirements)
Plain 1px-ruled rows. Shortcuts: keycaps left (44% width), Dim description right. Requirements: a 7.5rem Faint mono label column, then the value.

### FAQ
Native disclosure rows between 1px rules. Summary is Archivo 600 at 1.08rem with a thin Dim chevron drawn from two borders, rotating on open; summary hover turns Input Green. Answers are Dim body text capped at 70ch.

### Navigation
Sticky top bar on Ground at 95% opacity with a 1px bottom rule. Wordmark: 28px app icon plus "EMULE" in the display face at 800. Nav links are Dim, unadorned, turning Overexposed White on hover; hidden below 860px, where the download button holds the right edge alone.

## Do's and Don'ts

### Do:
- **Do** reserve Time Yellow for measured values, rulers, the playhead and keyboard focus.
- **Do** reserve Input Green for input events (click, touch point, mouse updates) and the download action.
- **Do** separate everything with 1px Rule lines and step surfaces by grey tone (Film, Frame Stock, Raised Stock).
- **Do** set burn-ins, labels, keys and numbers in Share Tech Mono, uppercase, tabular numerals.
- **Do** move between states with hard cuts (`steps(2)`, 0.1–0.14s) and drop them under `prefers-reduced-motion`.
- **Do** label illustrated frames as illustration and keep every number a real measurement.

### Don't:
- **Don't** use colour gradients, glows or drop shadows; the world is flat footage (solid single-colour `linear-gradient` fills that draw the crop marks are a drawing technique, not a gradient).
- **Don't** colour anything yellow or green for decoration or emphasis.
- **Don't** build cards with icon tiles or a floating phone mockup; content lives in frames and ruled rows.
- **Don't** round corners beyond the button (2px) and keycap (4px).
- **Don't** tween state changes with easing curves; cut between frames.
- **Don't** apply this system to the desktop app's UI in `src/renderer`, which has its own older look.
