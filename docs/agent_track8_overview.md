# Track8 Prototyping — Agent Onboarding Guide

This document gives a coding agent the essential context needed to continue feature work on this codebase without reading every source file first.

---

## What This Project Is

A **browser-based UX/UI prototype** simulating the screen interface of a **Track8 hardware audio multi-track recorder** by Thingstone. It is not a DAW — it is a focused prototyping tool to design, test and iterate on specific UI features before they are built into the physical device.

The app runs at a fixed canvas resolution of **1280×400 px** (the device's display dimensions) and uses real audio stems to give feedback on features like timed mute, waveform navigation and marker placement.

Design philosophy is documented in [`docs/Track8_feature_design_principles.md`](Track8_feature_design_principles.md): interactions must be **immediate, obvious, fast, and intentional**. Avoid DAW complexity. The user want specific workflow tests, so stick to what the user tells you, or ask for clarification if there are inconsistencies in his descriptions.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Build | Vite 5, TypeScript 5.6 |
| UI framework | React 18 (hooks only, no class components) |
| Routing | react-router-dom v6, `BrowserRouter` with `basename="/track8_prototypor"` |
| Rendering | HTML5 Canvas (`requestAnimationFrame` loop), **no SVG, no DOM elements inside the viewport** |
| Audio | Web Audio API (`AudioContext`, `GainNode`, `AudioBufferSourceNode`) |
| Fonts | Monogram pixel font (`src/assets/fonts/monogram_Medium.ttf`) loaded via `src/theme/fonts.css` |
| Audio stems | 8 × MP3 in `src/assets/fonts/audio/track1.mp3` … `track8.mp3` |
| Deployment | GitHub Actions → GitHub Pages (`dist/`, `scripts/copy-404.mjs` for SPA fallback) |

---

## File Map

```
src/
  main.tsx                  React entry point
  App.tsx                   Router + all routes
  viewportConstants.ts      Shared constants: VISIBLE_WIDTH=1280, VISIBLE_HEIGHT=400
  app.css                   Global styles: .device-viewport, .demo-nav, controls-bar, timed-mute-*
  theme/fonts.css           @font-face for Monogram
  pages/
    MainOverviewPage.tsx    ★ PRIMARY VIEW – 8-track main overview (see below)
    TimedMutePage.tsx       Timed Mute lab view (configurable sync mute modes)
    WaveformPage.tsx        Single-waveform + polyline view
    PianoRollPage.tsx       MIDI piano roll + snap algorithm explorer
  assets/fonts/
    audio/track1-8.mp3      Demo audio stems
    monogram_Medium.ttf     Pixel font
docs/
  ARCHITECTURE.md           High-level stack overview
  Track8_feature_design_principles.md  Product design rules
  agent_track8_overview.md  ← this file
```

---

## Routing (App.tsx)

```
/           → redirect → /overview
/overview   → MainOverviewPage  (default on page load)
/piano      → PianoRollPage
/timed-mute → TimedMutePage
/waveform   → WaveformPage
/multitrack → redirect → /timed-mute
```

NavLinks are rendered inside each page component itself (not in App.tsx). Every page has the same set of four NavLinks so the user can switch views.

---

## MainOverviewPage — The Primary View

**File:** `src/pages/MainOverviewPage.tsx` (~1100 lines)

This is the most developed view and the one actively receiving new features. All canvas rendering, audio, and interaction logic lives in one React component with a `useRef`-based state machine.

### Canvas Layout (1280×400 px)

```
y=0   ┌─────────────────────────────────────────────────────┐
      │  CMD BAR  25px  — step division left, "SCROLL" right│  COLOR_CMD_BAR_BG #061208
y=25  ├─────────────────────────────────────────────────────┤
      │  TIME GRID  24px  — beat/bar ticks, markers (▼)    │  COLOR_CMD_BAR_BG #061208
y=49  ├─────────────────────────────────────────────────────┤
      │  TRACK 1  40px                                      │
      │  TRACK 2  40px                                      │
      │  …                                                  │  COLOR_LANE_BG #0d2818
      │  TRACK 8  40px                                      │
y=369 ├─────────────────────────────────────────────────────┤
      │  (5px gap)                                          │
y=374 ├─────────────────────────────────────────────────────┤
      │  BOTTOM BAR  26px  — squares + T mm:ss + B bar:beat │  COLOR_CMD_BAR_BG #061208
y=400 └─────────────────────────────────────────────────────┘
```

Key layout constants:
```typescript
CMD_BAR_H = 25        GRID_H = 24          BOTTOM_BAR_H = 26
TRACK_H = 40          TRACKS_Y0 = 49       BOTTOM_BAR_Y = 374
CURSOR_X = 640        // fixed playhead at horizontal center
```

### Timing / World Space

```typescript
BPM = 120             BEATS_PER_BAR = 4    PIXELS_PER_BEAT = 40
PIXELS_PER_SECOND = 80                     SONG_DURATION_SEC = 70
BAR_PITCH = 4         // px per waveform column (2px bar + 2px gap)
COLUMN_COUNT = 1400   // total waveform columns in 70s song
```

`scrollX = songSec * PIXELS_PER_SECOND - CURSOR_X`
The world scrolls so the current song position is always under `CURSOR_X` (screen center).

### State Architecture

All mutable rendering state lives in `stateRef: React.MutableRefObject<DrawState>` — this avoids React re-renders in the rAF loop.

```typescript
interface DrawState {
  songSec: number;           // current playhead position in seconds
  playing: boolean;
  muted: boolean[];          // [8] – per-track mute state
  selectedTrack: number;     // 0-based index, highlighted green
  pending: Map<number, PendingSyncEntry>; // scheduled timed-mute events
  syncMuteMode: SyncMuteMode;   // fixed 'BAR' in this view
  syncInteractionMode: SyncInteractionMode; // fixed 'SIMPLE'
  shiftDown: boolean;        // true while SHIFT key is held
  userMarkerSongSec: number[]; // user-placed timeline markers
  amplitudes: number[][] | null; // [8][COLUMN_COUNT] peak amplitudes
  loadError: string | null;
  stepDivision: StepDivision; // scroll step size, default '1/4'
}
```

`bumpUi()` — calls `setUiTick(t => t+1)` to force a React re-render (for DOM elements like the step-division select).

### Transport / Audio

- `AudioContext` + `GainNode[]` (one per track) + `AudioBufferSourceNode[]`  
- `anchorSongSecRef` + `anchorAudioTimeRef` — reference points for interpolating song position during playback  
- `getSongSecNow()` — derives current `songSec` from audio clock during playback  
- `startPlayback()` / `pausePlayback()` — start/stop all 8 source nodes looped  
- Pausing clears all `pending` mute entries (stopped = immediate control)

### rAF Draw Loop

Single `useEffect` with `requestAnimationFrame(draw)`. Dependencies: `[applyGainImmediate, bumpUi]`.  
Draw order per frame:
1. Background fill
2. CMD bar bg + text (step division, "SCROLL")
3. Time grid (beat/bar ticks, 2px wide lines)
4. 8 track lanes: bg → amplitude bars (with blink) → centerline (static, drawn AFTER bars)
5. Playhead cursor line (cyan, `CURSOR_X`, no triangle)
6. User marker triangles (orange ▼, 24px wide × 12px tall)
7. Bottom bar: either 8 squares + T/B time display, or track numbers 1–8 (when SHIFT held)
8. CMD bar text on top (Monogram 20px)

### Waveform Rendering Detail

Each track column is `BAR_PITCH=4` px wide: 2px colored bar + 2px gap.  
`centerY = TRACKS_Y0 + tr * TRACK_H + 20` (integer center of each 40px lane).  
Bars grow outward from `centerY ± 2` (the ±2px reserved for the centerline).  
`maxHalf = 16` (TRACK_H/2 − 4).

**Centerline:** 2×4px blocks at `clY = centerY − 2`, period=4px, drawn full visible width including negative time (before song start). Uses `baseColor` (no blink). Drawn after bars so it stays on top.

**Blink logic** (pending mute cue): bars switch between `baseColor` ↔ muted-variant at 4 Hz. Reject blink (invalid cue) at 11 Hz. Centerline never blinks.

### Timed Mute System

Fixed to `SYNC MUTE: BAR` + `SYNC MODE: SIMPLE`.

- **Playing:** `SHIFT+1-8` queues a mute/unmute at the next bar boundary. A vertical orange marker line appears in the track showing when the event fires. Pressing the same key again cancels.
- **Stopped:** `SHIFT+1-8` is always an **immediate** toggle — no pending entry, no blink.
- `pending: Map<trackIndex, PendingSyncEntry>` holds `{ targetMuted, boundarySongSec, applyAtAudioTime }`.
- `applyAtAudioTime` is a wall-clock (`AudioContext.currentTime`) timestamp; the rAF loop fires it when reached.

### Scroll / Navigation

- `ArrowLeft` / `ArrowRight`: move by `stepDivisionToSec(stepDivision)`.  
- **Re-alignment:** if playhead is not on the chosen grid, first press snaps directionally to the nearest grid point (left→floor, right→ceil) before stepping. 1ms tolerance for "on grid" check.
- `SHIFT+ArrowLeft`: jump to song position 0.
- Step division picker: transparent `<select>` HTML element overlaid on the CMD bar at top-left (opacity:0, z-index:10). Values `4/1` to `1/64` (bars). Default `1/4` (one beat).

### Markers

- User clicks in the GRID zone (y: 25–49) to place a marker snapped to the current step division.  
- Clicking an existing marker removes it. Dragging moves it (snapped to step division).  
- Marker at position 0 is implicit and cannot be deleted.  
- `getAllMarkersSorted()` always includes position 0.  
- Hit test radius: ±10px from marker screen-X.

### Bottom Bar Display

- **SHIFT not held:** 8 dark-orange squares (16×16px, starting ~x=154) + `T mm:ss` + `B bar:beat`  
  - Bar is 0-based (`Math.floor(totalBeats / BEATS_PER_BAR)`)  
  - Beat is 1-based (`(totalBeats % 4) + 1`)  
- **SHIFT held:** track numbers 1–8 in mute-state colors (bright orange = unmuted, dark = muted, blinking = pending)

### Key Bindings (this view)

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `ArrowLeft` / `Right` | Scroll by step division (with grid realignment) |
| `SHIFT + ArrowLeft` | Jump to start |
| `1–8` | Select track (highlights green) |
| `SHIFT + 1–8` | Mute/unmute (synced BAR if playing, immediate if stopped) |
| Click on grid | Place / remove marker |
| Drag marker | Move marker |

---

## TimedMutePage — Sync Mute Lab

**File:** `src/pages/TimedMutePage.tsx` (~1380 lines)

Similar canvas architecture to `MainOverviewPage` but with additional configurable sync modes:

- `syncMuteMode`: OFF / BEAT / BAR / BARS4 / BARS8 / MARKER (user-selectable via dropdown)
- `syncInteractionMode`: SIMPLE (each SHIFT+num queues individually) / QUEUED (hold SHIFT, press multiple, release SHIFT → all commit to one shared boundary)
- MARKER mode: syncs to the next user-placed marker; rejects (rapid blink) if no marker ahead
- Layout: `TIMELINE_H=20`, `TRACK_H=44`, `LABELS_H=28` — different from MainOverviewPage
- HTML controls above canvas: PLAY/PAUSE button, SYNC MUTE dropdown, SYNC MODE toggle
- Bottom canvas area shows track labels 1–8 permanently (not SHIFT-gated)

The timed mute logic in `TimedMutePage` is the reference implementation. `MainOverviewPage` uses a simplified subset of it (BAR/SIMPLE only, no QUEUED mode).

---

## WaveformPage

**File:** `src/pages/WaveformPage.tsx` (~623 lines)

SVG-based (not canvas). Shows a single audio waveform as a polyline with configurable render modes (plain, black outline, multiply halo). No audio playback. Horizontal scroll in px. Primarily a visual rendering experiment.

---

## PianoRollPage

**File:** `src/pages/PianoRollPage.tsx` (~620 lines)

CSS/DOM-based piano roll (no canvas). 128 semitone lanes × 5000px wide. MIDI notes as positioned `div` elements. Tests various 2D snap algorithms for arrow-key traversal of notes. No audio.

---

## Shared Constants

`src/viewportConstants.ts`:
```typescript
VISIBLE_WIDTH = 1280
VISIBLE_HEIGHT = 400
TOTAL_WIDTH = 5000   // piano roll scroll width
BAR_PITCH = 4        // px per waveform column
```

---

## Common Patterns / Gotchas

**Ref-based state in draw loops.** Never put fast-changing render state in React state — use `stateRef`. Only call `bumpUi()` when DOM elements (nav, select) need to re-render.

**Font in Canvas.** The Monogram font must be pre-loaded before canvas can use it: `document.fonts.load('20px Monogram')` in a `useEffect`. Currently set to 20px canvas font-size for approximately 14px visual glyph height (pixel font metrics differ from normal fonts).

**Audio graph lifecycle.** `AudioContext` is created lazily on first Play click (browser autoplay policy). `ensureAudioGraph()` is idempotent.

**Song looping.** The 70s song loops. All time values wrap with `while (pos >= SONG_DURATION_SEC) pos -= SONG_DURATION_SEC`.

**Waveform amplitude data.** `computeAmplitudes(buffer, COLUMN_COUNT)` → `number[]` (0–1 peak values per column). Called once at audio load time, stored in `stateRef.current.amplitudes`.

**Marker snap.** Markers snap to `snapToStepDivision(t, stepDivision)` — nearest multiple of the current step size. In `TimedMutePage` markers snap to beats (`snapSongSecToBeat`).

**Pointer capture.** Timeline drag uses `canvas.setPointerCapture(e.pointerId)` so the pointer can leave the canvas during drag.

**No CSS transforms.** The canvas viewport does not scale. `VISIBLE_WIDTH=1280` must fit the user's screen or they will see overflow/scroll.

---

## Adding a New Feature — Checklist

1. Identify which view is affected (`MainOverviewPage` for the main hardware screen, `TimedMutePage` for sync-mute experiments).
2. Add any new state fields to `DrawState` in the relevant page file.
3. Put render logic in the `draw()` function inside the rAF `useEffect`. Use `ctx2d.fillRect` / `ctx2d.strokeStyle` for pixel-accurate output.
4. Put interaction logic in the `onKeyDown` handler or pointer event callbacks.
5. For HTML overlay elements (dropdowns, buttons), place them absolutely inside `.device-viewport` and call `bumpUi()` on change.
6. Call `bumpUi()` whenever DOM elements need to reflect updated state.
7. Run `npx tsc --noEmit` to check types before finishing.
