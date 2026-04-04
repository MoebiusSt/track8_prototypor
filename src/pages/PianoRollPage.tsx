import React, { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import '../app.css';

const VISIBLE_WIDTH = 1280;
const VISIBLE_HEIGHT = 400;
const KEY_HEIGHT = 8;
// Fixed pitch weight for COUPLED W mode. Calibrated to feel natural at fine
// grid resolutions (~1/32). Not derived from the GRID slider — that caused
// erratic jumps at coarser grid settings. This roughly corresponds to the feel of 1/32 (mathematically, 1/32 = 12.5px / 8px = 1.56, but 3.0 would give time spacing jumps slightly more weight)
const PITCH_BIAS = 1.8;
const TOTAL_KEYS = 128;
const TOTAL_WIDTH = 5000;
const SCROLL_STEP_Y = KEY_HEIGHT;

const GRID_OPTIONS = [
  { label: '1/1 (400px)', value: 400 },
  { label: '1/2 (200px)', value: 200 },
  { label: '1/4 (100px)', value: 100 },
  { label: '1/8 (50px)', value: 50 },
  { label: '1/16 (25px)', value: 25 },
  { label: '1/32 (12.5px)', value: 12.5 },
];

/**
 * SNAP NAVIGATION ALGORITHMS – FEASIBILITY NOTES FOR REAL IMPLEMENTATION
 *
 * This prototype uses pixel distances for scoring. In a real embedded system,
 * the data model provides only:
 *   - Horizontal: quantized grid positions (1/1, 1/2, 1/4, ... 1/64 ticks)
 *   - Vertical: MIDI note numbers (0-127, i.e. semitones)
 *
 * These two units are not directly comparable ("3 ticks" vs "5 semitones").
 * Each algorithm maps to real-world data as follows:
 *
 * AXIS PRIORITY:    No conversion needed. Compares only within one axis at a time.
 *                   Directly implementable on tick/note data.
 *
 * REVERSIBLE:       Stores note IDs only. No distance calculation involved.
 *                   Directly implementable.
 *
 * NEAREST VISUAL:   Requires a weighting factor W to compare ticks vs semitones:
 *                   score = |dx_ticks| * W_time + |dy_semitones| * W_pitch
 *                   W is a design parameter (could be coupled to the GRID setting).
 *
 * DIRECTIONAL BIAS: Same as Nearest but with asymmetric weights per axis.
 *                   Directly translatable: just different W values per direction.
 *
 * PITCH PROXIMITY:  Same structure, with W_time >> W_pitch.
 *                   Directly translatable.
 */

type SnapMode = 'nearest' | 'directional' | 'ellipsoid' | 'pitch_proximity' | 'axis_priority' | 'x_then_y' | 'time_harmony' | 'time_harmony_fallback';

interface MidiNote {
  id: string;
  noteNumber: number;
  startTime: number;
  duration: number;
  velocity: number;
  density: number; // 0.0 = last to disappear (melodic), 1.0 = first to disappear (harmonic)
}

const isBlackKey = (noteNumber: number) => {
  const noteInOctave = noteNumber % 12;
  return [1, 3, 6, 8, 10].includes(noteInOctave);
};

const generateSampleNotes = (): MidiNote[] => {
  const beat = 100;

  // Density is assigned by explicit layer — no post-processing needed.
  // Each layer's range is randomized so notes within a layer fade out one
  // by one as the slider moves (no step-wise group disappearance).
  // Layer 0 (0.00–0.12): arpeggio skeleton — last notes to disappear
  // Layer 1 (0.12–0.38): single bass notes
  // Layer 2 (0.38–0.60): dyads
  // Layer 3 (0.60–0.80): triads
  // Layer 4 (0.80–1.00): full chords + ornaments — first to disappear
  const layerRanges: [number, number][] = [
    [0.00, 0.12],
    [0.12, 0.38],
    [0.38, 0.60],
    [0.60, 0.80],
    [0.80, 1.00],
  ];

  type RawNote = { nn: number; t: number; d: number; layer: number };
  const raw: RawNote[] = [];
  const add = (nn: number, t: number, d: number, layer: number) =>
    raw.push({ nn, t, d, layer });

  // ── LAYER 0: Arpeggio skeleton ────────────────────────────────────────────
  // Strictly sequential (no simultaneous notes), melodic up/down movement
  // with pauses and register jumps — visible at all slider positions.
  // [noteNumber, startBeat, durationBeats]
  const arp: [number, number, number][] = [
    [48,  0.0, 1.4],  // C3  — low anchor
    [52,  2.0, 2.4],  // E3
    [55,  5.0, 0.5],  // G3  — quick
    [60,  6.0, 3.2],  // C4  — held
    [57, 10.0, 1.4],  // A3
    [64, 12.0, 2.7],  // E4  — high
    [53, 16.0, 1.4],  // F3  — drop
    [59, 18.0, 0.5],  // B3  — quick
    [62, 20.0, 2.0],  // D4
    [55, 23.0, 0.4],  // G3  — quick
    [67, 24.0, 0.9],  // G4  — peak
    [64, 26.0, 1.4],  // E4
    [60, 28.0, 2.4],  // C4
    [57, 32.0, 0.7],  // A3
    [55, 34.0, 3.0],  // G3  — held
    [52, 38.0, 0.5],  // E3  — quick
    [48, 40.0, 0.9],  // C3  — low anchor
    [55, 42.0, 0.3],  // G3  — quick
    [59, 43.0, 1.4],  // B3
    [62, 46.0, 2.0],  // D4
    [65, 49.0, 0.5],  // F4  — quick
  ];
  for (const [nn, start, dur] of arp) {
    add(nn, start * beat, dur * beat, 0);
  }

  // ── LAYERS 1–4: Harmonic complexity on C–G–Am–F progression ─────────────
  const progressions = [
    { root: 48, quality: 'major' },
    { root: 55, quality: 'major' },
    { root: 57, quality: 'minor' },
    { root: 53, quality: 'major' },
    { root: 48, quality: 'major' },
    { root: 55, quality: 'major' },
    { root: 53, quality: 'major' },
    { root: 50, quality: 'minor' },
  ];
  const getChord = (root: number, q: string) =>
    q === 'major' ? [root, root + 4, root + 7, root + 12] : [root, root + 3, root + 7, root + 12];

  for (let bar = 0; bar < 12; bar++) {
    const { root, quality } = progressions[bar % 8];
    const [c0, c1, c2, c3] = getChord(root, quality);
    const bs = bar * beat * 4;

    // Layer 1 – bass root, split across bar halves (no overlap between them)
    add(c0 - 12, bs,              beat * 1.85, 1);
    add(c0 - 12, bs + beat * 2.0, beat * 1.85, 1);

    // Layer 2 – dyads at staggered positions (each pair of notes simultaneous)
    add(c0, bs + beat * 0.5, beat * 1.2, 2);
    add(c1, bs + beat * 0.5, beat * 1.2, 2);
    add(c0, bs + beat * 2.3, beat * 0.9, 2);
    add(c2, bs + beat * 2.3, beat * 0.9, 2);
    add(c1, bs + beat * 3.3, beat * 0.6, 2);
    add(c2, bs + beat * 3.3, beat * 0.6, 2);

    // Layer 3 – triads (3 notes simultaneous)
    add(c0, bs,              beat * 0.65, 3);
    add(c1, bs,              beat * 0.65, 3);
    add(c2, bs,              beat * 0.65, 3);
    add(c1, bs + beat * 2.0, beat * 0.65, 3);
    add(c2, bs + beat * 2.0, beat * 0.65, 3);
    add(c3, bs + beat * 2.0, beat * 0.65, 3);

    // Layer 4 – full 4-note voicings + short ornaments (max 0.6 beat long)
    add(c0, bs + beat * 1.0, beat * 0.5, 4);
    add(c1, bs + beat * 1.0, beat * 0.5, 4);
    add(c2, bs + beat * 1.0, beat * 0.5, 4);
    add(c3, bs + beat * 1.0, beat * 0.5, 4);
    add(c0, bs + beat * 3.0, beat * 0.5, 4);
    add(c1, bs + beat * 3.0, beat * 0.5, 4);
    add(c2, bs + beat * 3.0, beat * 0.5, 4);
    add(c3, bs + beat * 3.0, beat * 0.5, 4);
    // ornamental strikes
    add(c2 + 12, bs + beat * 0.6,  beat * 0.22, 4);
    add(c3 + 12, bs + beat * 1.55, beat * 0.22, 4);
    add(c1 + 12, bs + beat * 2.2,  beat * 0.22, 4);
    add(c0 + 12, bs + beat * 3.5,  beat * 0.22, 4);
  }

  // ── Assign density randomly within each layer's range ────────────────────
  // Random spread prevents step-wise group disappearance when sliding.
  type RawWithDensity = RawNote & { density: number };
  const rawD: RawWithDensity[] = raw.map(n => {
    const [lo, hi] = layerRanges[n.layer];
    return { ...n, density: lo + Math.random() * (hi - lo) };
  });

  // ── Resolve pitch overlaps ────────────────────────────────────────────────
  // Track8 is monophonic per pitch lane: no two notes may overlap in time at
  // the same noteNumber. Process in ascending density order so that lower-
  // density (more important) notes keep their original pitch; higher-density
  // notes shift up/down by semitones until they find a free slot.
  const byDensity = [...rawD].sort((a, b) => a.density - b.density);
  const occupied = new Map<number, Array<{ start: number; end: number }>>();
  const resolvedPitch = new Map<RawWithDensity, number>();

  for (const n of byDensity) {
    const noteEnd = n.t + n.d;
    let chosen = -1;
    for (let delta = 0; delta < 64 && chosen === -1; delta++) {
      for (const pitch of (delta === 0 ? [n.nn] : [n.nn + delta, n.nn - delta])) {
        if (pitch < 0 || pitch > 127) continue;
        const slots = occupied.get(pitch) ?? [];
        if (!slots.some(s => n.t < s.end && noteEnd > s.start)) {
          chosen = pitch;
          slots.push({ start: n.t, end: noteEnd });
          occupied.set(pitch, slots);
          break;
        }
      }
    }
    resolvedPitch.set(n, chosen >= 0 ? chosen : n.nn);
  }

  return rawD.map((n, i) => ({
    id: `note-${i}`,
    noteNumber: resolvedPitch.get(n)!,
    startTime: n.t,
    duration: n.d,
    velocity: 80 + Math.random() * 40,
    density: n.density,
  }));
};

const getNotePos = (note: MidiNote) => ({
  x: note.startTime,
  y: (127 - note.noteNumber) * KEY_HEIGHT + KEY_HEIGHT / 2
});

const getCursorWorldPos = (scrollX: number, scrollY: number) => {
  const cursorX = scrollX + VISIBLE_WIDTH / 2;
  const cursorY = scrollY + VISIBLE_HEIGHT / 2;
  const rawPitch = 127 - Math.floor(cursorY / KEY_HEIGHT);
  const cursorPitch = Math.max(0, Math.min(TOTAL_KEYS - 1, rawPitch));
  return { cursorX, cursorY, cursorPitch };
};

const isInDirection = (dx: number, dy: number, direction: string): boolean => {
  const THRESHOLD = 0.5;
  switch (direction) {
    case 'right': return dx > THRESHOLD;
    case 'left': return dx < -THRESHOLD;
    case 'down': return dy > THRESHOLD;
    case 'up': return dy < -THRESHOLD;
    default: return false;
  }
};

export const PianoRollPage: React.FC = () => {
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [isSnapEnabled, setIsSnapEnabled] = useState(true);
  const [isAnimated, setIsAnimated] = useState(true);
  const [preferReversible, setPreferReversible] = useState(true);
  const [gridCoupledW, setGridCoupledW] = useState(false);
  const [snapMode, setSnapMode] = useState<SnapMode>('time_harmony');
  const [gridIndex, setGridIndex] = useState(3);
  const gridSize = GRID_OPTIONS[gridIndex].value;
  const [densityThreshold, setDensityThreshold] = useState(1.0);
  const [maxPitchDistance, setMaxPitchDistance] = useState(2);
  // Modes that apply off-axis weighting — these benefit from grid-coupled W.
  const wPitchModes: SnapMode[] = ['nearest', 'directional', 'ellipsoid', 'pitch_proximity'];
  const showCoupledW = isSnapEnabled && wPitchModes.includes(snapMode);
  
  const notes = useRef(generateSampleNotes()).current;
  const scrollPos = useRef({ x: 0, y: 0 });
  const snapHistory = useRef<{ originNoteId: string; direction: string } | null>(null);
  // Tracks the X pixel position of the last horizontal snap in x_then_y mode.
  // Subsequent UP/DOWN presses look for notes at exactly this X position.
  const xThenYAnchorX = useRef<number | null>(null);

  useEffect(() => {
    scrollPos.current = { x: scrollX, y: scrollY };
  }, [scrollX, scrollY]);
  
  useEffect(() => {
    const c4TopY = (127 - 60) * KEY_HEIGHT;
    const c4MiddleY = c4TopY + KEY_HEIGHT / 2;
    const initialScrollY = c4MiddleY - VISIBLE_HEIGHT / 2;
    setScrollY(initialScrollY);
  }, []);

  useEffect(() => {
    const clampX = (val: number) => Math.max(-VISIBLE_WIDTH / 2, Math.min(TOTAL_WIDTH - VISIBLE_WIDTH / 2, val));
    const clampY = (val: number) => Math.max(-VISIBLE_HEIGHT / 2, Math.min(TOTAL_KEYS * KEY_HEIGHT - VISIBLE_HEIGHT / 2, val));

    const snapToNote = (direction: 'up' | 'down' | 'left' | 'right') => {
      const cx = scrollPos.current.x + VISIBLE_WIDTH / 2;
      const cy = scrollPos.current.y + VISIBLE_HEIGHT / 2;
      const isHorizontal = direction === 'left' || direction === 'right';
      // wPitch: exchange rate between time pixels and pitch pixels.
      // 1.0 = pixel-equal (prototype default).
      // PITCH_BIAS = fixed ratio calibrated for fine grid resolutions.
      const wPitch = gridCoupledW ? PITCH_BIAS : 1;
      const opposites: Record<string, string> = { up: 'down', down: 'up', left: 'right', right: 'left' };
      const isReversal = preferReversible
        && snapHistory.current !== null
        && direction === opposites[snapHistory.current.direction];

      const activeNotes = notes.filter(n => n.density <= densityThreshold);

      // ── TIME / HARMONY (+ optional Fallback): early return ───────────────
      if (snapMode === 'time_harmony' || snapMode === 'time_harmony_fallback') {
        const cursorPitch = 127 - Math.floor(cy / KEY_HEIGHT);

        if (isHorizontal) {
          // LEFT/RIGHT: tick-group search with pitch gate.
          // Walk through start ticks in chronological order (nearest first).
          // Accept the first tick that contains a note within MAX_PITCH_DISTANCE
          // semitones. Falls back to the very nearest tick if none qualifies.
          const MAX_PITCH_DISTANCE = maxPitchDistance;

          const candidates = activeNotes.filter(n =>
            direction === 'right' ? n.startTime > cx : n.startTime < cx
          );
          if (candidates.length === 0) return;

          const tickSet = new Set(candidates.map(n => n.startTime));
          const ticks = [...tickSet].sort((a, b) =>
            direction === 'right' ? a - b : b - a
          );

          const pickNearest = (notesAtTick: MidiNote[]) =>
            notesAtTick.reduce((best, n) => {
              const nd = Math.abs(n.noteNumber - cursorPitch);
              const bd = Math.abs(best.noteNumber - cursorPitch);
              if (nd < bd) return n;
              if (nd === bd && n.noteNumber < best.noteNumber) return n;
              return best;
            });

          let picked: MidiNote | null = null;
          for (const tick of ticks) {
            const group = candidates.filter(n => n.startTime === tick);
            const nearest = pickNearest(group);
            if (Math.abs(nearest.noteNumber - cursorPitch) <= MAX_PITCH_DISTANCE) {
              picked = nearest;
              break;
            }
          }

          if (!picked) {
            const fallbackGroup = candidates.filter(n => n.startTime === ticks[0]);
            picked = pickNearest(fallbackGroup);
          }

          const targetY = (127 - picked.noteNumber) * KEY_HEIGHT + KEY_HEIGHT / 2;
          setScrollX(clampX(picked.startTime - VISIBLE_WIDTH / 2));
          setScrollY(clampY(targetY - VISIBLE_HEIGHT / 2));
        } else {
          // UP/DOWN: step vertically through notes sounding at the current X.
          // A note "sounds at" cursor.x when startTime <= cursor.x < startTime + duration.
          // X axis is never changed.
          const soundingNotes = activeNotes.filter(n =>
            n.startTime <= cx && cx < n.startTime + n.duration
          );

          const pickVertical = (pool: MidiNote[], dir: 'up' | 'down'): MidiNote | null => {
            if (dir === 'up') {
              const above = pool.filter(n => n.noteNumber > cursorPitch);
              if (above.length === 0) return null;
              return above.reduce((best, n) => n.noteNumber < best.noteNumber ? n : best);
            } else {
              const below = pool.filter(n => n.noteNumber < cursorPitch);
              if (below.length === 0) return null;
              return below.reduce((best, n) => n.noteNumber > best.noteNumber ? n : best);
            }
          };

          let picked = pickVertical(soundingNotes, direction as 'up' | 'down');

          if (!picked && snapMode === 'time_harmony_fallback') {
            // Fallback (w. Fallback mode only): search notes starting near cursor.x
            // within TIME_FALLBACK_RADIUS to reach short notes that LEFT/RIGHT
            // never lands inside.
            const TIME_FALLBACK_RADIUS = 200; // pixels (~2 beats at beat=100px)
            const nearbyNotes = activeNotes.filter(n =>
              Math.abs(n.startTime - cx) < TIME_FALLBACK_RADIUS &&
              !(n.startTime <= cx && cx < n.startTime + n.duration)
            );
            picked = pickVertical(nearbyNotes, direction as 'up' | 'down');
          }

          if (picked) {
            const targetY = (127 - picked.noteNumber) * KEY_HEIGHT + KEY_HEIGHT / 2;
            setScrollY(clampY(targetY - VISIBLE_HEIGHT / 2));
            // scrollX intentionally unchanged
          }
        }
        return;
      }
      // ──────────────────────────────────────────────────────────────────────

      // Find the note we are currently on (closest to crosshair) to store as origin
      let currentNoteId: string | null = null;
      let minCurrentDist = Infinity;
      for (const n of activeNotes) {
        const p = getNotePos(n);
        const d = Math.abs(p.x - cx) + Math.abs(p.y - cy);
        if (d < minCurrentDist) {
          minCurrentDist = d;
          currentNoteId = n.id;
        }
      }

      let bestNote: MidiNote | null = null;
      let bestScore = Infinity;

      for (const note of activeNotes) {
        const pos = getNotePos(note);
        const dx = pos.x - cx;
        const dy = pos.y - cy;

        if (!isInDirection(dx, dy, direction)) continue;

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        let score = Infinity;

        if (snapMode === 'nearest') {
          score = absDx + absDy * wPitch;
        } else if (snapMode === 'directional') {
          if (isHorizontal) {
            score = absDx + absDy * wPitch * 2;
          } else {
            score = absDy * wPitch + absDx * 2;
          }
        } else if (snapMode === 'ellipsoid') {
          // Compress the off-axis dimension before computing Euclidean distance.
          // Factor 0.25 makes the search space 4x wider in the primary direction,
          // equivalent to an ellipse elongated along the navigation axis.
          if (isHorizontal) {
            score = Math.sqrt(absDx * absDx + (absDy * wPitch * 0.25) * (absDy * wPitch * 0.25));
          } else {
            score = Math.sqrt((absDx * 0.25) * (absDx * 0.25) + (absDy * wPitch) * (absDy * wPitch));
          }
        } else if (snapMode === 'pitch_proximity') {
          if (isHorizontal) {
            score = absDx * 4 + absDy * wPitch;
          } else {
            score = absDy * wPitch * 4 + absDx;
          }
        } else if (snapMode === 'axis_priority') {
          if (isHorizontal) {
            score = absDx * 10000 + absDy;
          } else {
            score = absDy * 10000 + absDx;
          }
        } else if (snapMode === 'x_then_y') {
          if (isHorizontal) {
            // LEFT/RIGHT: pure X navigation, ignore pitch entirely.
            // Y is only a tiebreaker when two notes share the same start time.
            score = absDx * 10000 + absDy;
          } else {
            // UP/DOWN: only score notes that sit at the anchor X position.
            // Anchor is set by the preceding LEFT/RIGHT snap.
            const anchorX = xThenYAnchorX.current;
            if (anchorX !== null && Math.abs(pos.x - anchorX) < 2) {
              score = absDy;
            }
            // Notes not at anchor X keep score = Infinity → skipped.
          }
        }

        // REVERSIBLE: if this is an exact direction reversal and the candidate
        // is the note we originally came FROM, force it to win.
        if (isReversal && note.id === snapHistory.current!.originNoteId) {
          score = -1;
        }

        if (score < bestScore) {
          bestScore = score;
          bestNote = note;
        }
      }

      // x_then_y fallback: UP/DOWN found no note at the anchor X position.
      // This happens when the anchor is unset (user moved freely without
      // a preceding LEFT/RIGHT snap) or when no note starts at that column.
      // Fall back to Nearest Visual without the REVERSIBLE modifier.
      if (snapMode === 'x_then_y' && !isHorizontal && bestNote === null) {
        let fallbackBest: MidiNote | null = null;
        let fallbackScore = Infinity;
        for (const n of activeNotes) {
          const p = getNotePos(n);
          const ndx = p.x - cx;
          const ndy = p.y - cy;
          if (!isInDirection(ndx, ndy, direction)) continue;
          const s = Math.abs(ndx) + Math.abs(ndy);
          if (s < fallbackScore) { fallbackScore = s; fallbackBest = n; }
        }
        if (fallbackBest) {
          xThenYAnchorX.current = null; // position is now arbitrary, clear anchor
          const target = getNotePos(fallbackBest);
          setScrollX(clampX(target.x - VISIBLE_WIDTH / 2));
          setScrollY(clampY(target.y - VISIBLE_HEIGHT / 2));
          // snapHistory intentionally not updated (no REVERSIBLE on fallback)
        }
        return;
      }

      if (bestNote) {
        snapHistory.current = { originNoteId: currentNoteId!, direction };
        const target = getNotePos(bestNote);
        if (snapMode === 'x_then_y') {
          if (isHorizontal) {
            // Phase 1: move crosshair in time only — pitch (Y) stays unchanged.
            xThenYAnchorX.current = target.x;
            setScrollX(clampX(target.x - VISIBLE_WIDTH / 2));
          } else {
            // Phase 2: move crosshair in pitch only — time (X) stays at anchor.
            setScrollY(clampY(target.y - VISIBLE_HEIGHT / 2));
          }
        } else {
          setScrollX(clampX(target.x - VISIBLE_WIDTH / 2));
          setScrollY(clampY(target.y - VISIBLE_HEIGHT / 2));
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }

      if (isSnapEnabled) {
        if (e.key === 'ArrowUp') snapToNote('up');
        else if (e.key === 'ArrowDown') snapToNote('down');
        else if (e.key === 'ArrowLeft') snapToNote('left');
        else if (e.key === 'ArrowRight') snapToNote('right');
      } else {
        if (e.key === 'ArrowUp') {
          setScrollY((prev) => clampY(prev - SCROLL_STEP_Y));
        } else if (e.key === 'ArrowDown') {
          setScrollY((prev) => clampY(prev + SCROLL_STEP_Y));
        } else if (e.key === 'ArrowLeft') {
          setScrollX((prev) => clampX(prev - gridSize));
        } else if (e.key === 'ArrowRight') {
          setScrollX((prev) => clampX(prev + gridSize));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSnapEnabled, snapMode, preferReversible, gridCoupledW, gridSize, notes, densityThreshold, maxPitchDistance]);

  const renderBackground = () => {
    const lanes = [];
    const startLane = Math.max(0, Math.floor(scrollY / KEY_HEIGHT));
    const endLane = Math.min(TOTAL_KEYS - 1, Math.ceil((scrollY + VISIBLE_HEIGHT) / KEY_HEIGHT));

    for (let i = startLane; i <= endLane; i++) {
      const noteNumber = 127 - i;
      const isBlack = isBlackKey(noteNumber);
      const yPos = i * KEY_HEIGHT;
      
      lanes.push(
        <div
          key={i}
          className={`piano-lane ${isBlack ? 'black-key' : 'white-key'}`}
          style={{ top: `${yPos}px` }}
        />
      );
    }
    return lanes;
  };

  const renderNotes = () => {
    const { cursorX, cursorPitch } = getCursorWorldPos(scrollX, scrollY);
    const activeNotes = notes.filter(n => n.density <= densityThreshold);

    return activeNotes.map((note) => {
      const yPos = (127 - note.noteNumber) * KEY_HEIGHT;

      if (
        note.startTime + note.duration < scrollX ||
        note.startTime > scrollX + VISIBLE_WIDTH ||
        yPos + KEY_HEIGHT < scrollY ||
        yPos > scrollY + VISIBLE_HEIGHT
      ) {
        return null;
      }

      const isHighlighted =
        note.startTime <= cursorX &&
        cursorX < note.startTime + note.duration &&
        note.noteNumber === cursorPitch;

      return (
        <div
          key={note.id}
          className={`midi-note${isHighlighted ? ' midi-note--highlighted' : ''}`}
          style={{
            left: `${note.startTime}px`,
            top: `${yPos}px`,
            width: `${note.duration}px`
          }}
        />
      );
    });
  };

  return (
    <div className="app-container">
      <nav className="demo-nav" aria-label="Demo views">
        <NavLink to="/" end className={({ isActive }) => `demo-nav-link${isActive ? ' demo-nav-link-active' : ''}`}>
          Piano roll
        </NavLink>
        <NavLink to="/waveform" className={({ isActive }) => `demo-nav-link${isActive ? ' demo-nav-link-active' : ''}`}>
          Waveform
        </NavLink>
      </nav>
      <div className="controls-bar">
        <label>
          Snap Mode:
          <select 
            value={snapMode} 
            onChange={(e) => { setSnapMode(e.target.value as SnapMode); (e.target as HTMLElement).blur(); }}
          >
            <option value="nearest">Nearest Visual</option>
            <option value="directional">Directional Bias</option>
            <option value="ellipsoid">Ellipsoid (Voice Leading)</option>
            <option value="pitch_proximity">Pitch Proximity</option>
            <option value="axis_priority">Axis Priority</option>
            <option value="x_then_y">X then Y</option>
            <option value="time_harmony">Time / Harmony</option>
            <option value="time_harmony_fallback">Time / Harmony + Fallback</option>
          </select>
        </label>
        {(snapMode === 'time_harmony' || snapMode === 'time_harmony_fallback') && (
          <label>
            PITCH GATE: {maxPitchDistance} st
            <input
              type="range"
              min={0}
              max={12}
              step={1}
              value={maxPitchDistance}
              onChange={(e) => setMaxPitchDistance(Number(e.target.value))}
              onMouseUp={(e) => (e.target as HTMLElement).blur()}
              style={{ marginLeft: '10px', cursor: 'pointer' }}
            />
          </label>
        )}
        <button 
          className={isSnapEnabled ? 'active' : ''} 
          onClick={(e) => { setIsSnapEnabled(!isSnapEnabled); (e.currentTarget as HTMLElement).blur(); }}
        >
          SNAP
        </button>
        <button 
          className={isAnimated ? 'active' : ''} 
          onClick={(e) => { setIsAnimated(!isAnimated); (e.currentTarget as HTMLElement).blur(); }}
        >
          ANIMATED
        </button>
        {snapMode !== 'time_harmony' && snapMode !== 'time_harmony_fallback' && (
          <button 
            className={preferReversible ? 'active' : ''} 
            onClick={(e) => { setPreferReversible(!preferReversible); (e.currentTarget as HTMLElement).blur(); }}
          >
            WEIGHTED-REVERSE
          </button>
        )}
        {showCoupledW && (
          <button
            className={gridCoupledW ? 'active' : ''}
            onClick={(e) => { setGridCoupledW(!gridCoupledW); (e.currentTarget as HTMLElement).blur(); }}
            title="Weight pitch vs time by current GRID setting (1 grid step = 1 semitone)"
          >
            PITCH BIAS
          </button>
        )}
        <label>
          GRID: {GRID_OPTIONS[gridIndex].label}
          <input 
            type="range"
            min={0}
            max={GRID_OPTIONS.length - 1}
            step={1}
            value={gridIndex} 
            onChange={(e) => setGridIndex(Number(e.target.value))}
            onMouseUp={(e) => (e.target as HTMLElement).blur()}
            style={{ marginLeft: '10px', cursor: 'pointer' }}
          />
        </label>
        <label>
          DENSITY: {Math.round(densityThreshold * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={densityThreshold}
            onChange={(e) => setDensityThreshold(Number(e.target.value))}
            onMouseUp={(e) => (e.target as HTMLElement).blur()}
            style={{ marginLeft: '10px', cursor: 'pointer' }}
          />
        </label>
      </div>
      <div className="piano-roll-viewport device-viewport">
        <div 
          className={`piano-roll-content ${isAnimated ? 'animated' : ''}`}
          style={{ transform: `translate(${-scrollX}px, ${-scrollY}px)` }}
        >
          <div className="piano-lanes-container">
            {renderBackground()}
          </div>
          <div className="midi-notes-container">
            {renderNotes()}
          </div>
        </div>
        <div className="crosshair">
          <svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
            <path d="M 0 21 L 21 21 L 21 0 L 25 0 L 25 25 L 0 25 Z" fill="var(--color-crosshair)" />
            <path d="M 60 21 L 39 21 L 39 0 L 35 0 L 35 25 L 60 25 Z" fill="var(--color-crosshair)" />
            <path d="M 0 39 L 21 39 L 21 60 L 25 60 L 25 35 L 0 35 Z" fill="var(--color-crosshair)" />
            <path d="M 60 39 L 39 39 L 39 60 L 35 60 L 35 35 L 60 35 Z" fill="var(--color-crosshair)" />
            <rect x="28" y="28" width="4" height="4" fill="var(--color-crosshair)" />
          </svg>
        </div>
      </div>
      <div className="instructions">
        Scroll: Arrow Keys (Up, Down, Left, Right)
      </div>
      {isSnapEnabled && (
        <div className="snap-description">
          {snapMode === 'nearest' && (
            <p><strong>Nearest Visual:</strong> Finds the visually closest note in the pressed half-plane using Manhattan distance in raw screen pixels. No normalization, no weighting. What you see is what the algorithm sees.</p>
          )}
          {snapMode === 'directional' && (
            <p><strong>Directional Bias:</strong> Manhattan distance but deviations from the main scroll axis cost 2×. Pressing Right prefers notes that are more to the right than off to the side. Still picks nearby off-axis notes if they are significantly closer overall. Note: the penalty is additive, so a very large off-axis distance can still outweigh a large on-axis distance.</p>
          )}
          {snapMode === 'ellipsoid' && (
            <p><strong>Ellipsoid (Voice Leading):</strong> The search space is shaped like an ellipse elongated in the navigation direction. The off-axis dimension is compressed by 4× <em>before</em> computing Euclidean distance — not added as a penalty afterward. Pressing Right reaches notes that are slightly higher or lower in pitch almost as easily as notes at the same pitch, making it natural to follow a rising or falling melody. This is the structural difference from Directional Bias: a note 80px off-axis costs the same as one only 20px off-axis in Directional mode.</p>
          )}
          {snapMode === 'pitch_proximity' && (
            <p><strong>Pitch Proximity:</strong> Horizontal distance costs 4x more than vertical. Strongly prefers notes that are close in pitch, even if they are slightly in a different time position. Follows musical voice leading: a note 4 semitones away (32px = score 32) is much cheaper to reach than one 50px ahead in time (score 200).</p>
          )}
          {snapMode === 'axis_priority' && (
            <p><strong>Axis Priority:</strong> Strict primary-axis navigation. Right = chronologically next note start. Up = next higher pitch. Secondary axis only as tie-breaker. Predictable and reversible, but can jump far on the secondary axis.</p>
          )}
          {snapMode === 'x_then_y' && (
            <p><strong>X then Y:</strong> Strict two-phase navigation. <strong>Step 1 – LEFT/RIGHT:</strong> moves the crosshair only in time to the next or previous note start. Pitch (Y position) does not change — the crosshair slides horizontally to align with a note column, but stays at its current vertical position. <strong>Step 2 – UP/DOWN:</strong> jumps vertically to the note above or below that is in the locked time column. Because a LEFT/RIGHT step guarantees at least one note exists in that column, UP/DOWN will always find a target there. Further UP/DOWN presses walk through all notes of a chord in that column. Failure mode: if no anchor column is set (e.g. after freely scrolling with SNAP off), falls back to Nearest Visual without Reversible.</p>
          )}
          {snapMode === 'time_harmony' && (
            <p><strong>Time / Harmony:</strong> Axes are strictly separated. <strong>LEFT/RIGHT:</strong> walks through note start ticks in chronological order (nearest first) and accepts the first tick that has a note within the PITCH GATE semitones. Ticks with only far-away notes are skipped. Fallback: if no tick qualifies, jumps to the nearest tick anyway. <strong>UP/DOWN:</strong> considers only notes whose duration covers the current X position ("sounding now"), then steps to the nearest pitch above or below. X never changes. Notes are treated as rectangles — a long sustained bass note is reachable via DOWN even if its start is far to the left.</p>
          )}
          {snapMode === 'time_harmony_fallback' && (
            <p><strong>Time / Harmony + Fallback:</strong> Identical to Time / Harmony, with one addition: <strong>UP/DOWN</strong> first searches notes sounding at the current X ("sounding now"). If no note is found in that direction, it falls back to notes whose <em>start tick</em> is within ~2 beats of the cursor — making short, isolated notes reachable that LEFT/RIGHT never lands inside. X never changes in either case.</p>
          )}
        </div>
      )}
      {isSnapEnabled && (
        <details className="algo-details">
          <summary>Pseudocode</summary>
        <pre className="algo-description">{snapMode === 'nearest' ?
`// ─── NEAREST VISUAL ───────────────────────────────────
// Input:  crosshair position (cx, cy)
//         all MIDI notes with (startTime, noteNumber)
//         pressed direction (up | down | left | right)
// Output: the note to snap to

FUNCTION snap_nearest(direction):
  best = null, best_score = INF

  FOR EACH note IN all_notes:
    dx = note.startTime - crosshair.x   // ticks or grid steps
    dy = note.pitch    - crosshair.y    // semitones

    // Only consider notes in the pressed half-plane
    IF direction == RIGHT AND dx <= 0: SKIP
    IF direction == LEFT  AND dx >= 0: SKIP
    IF direction == DOWN  AND dy <= 0: SKIP
    IF direction == UP    AND dy >= 0: SKIP

    // Score = Manhattan distance.
    // W_time and W_pitch are equal (both 1).
    // In a real system, tune these weights to balance
    // grid-steps vs semitones perceptually.
    score = |dx| * W_time + |dy| * W_pitch

    IF score < best_score:
      best = note, best_score = score

  RETURN best` : snapMode === 'directional' ?
`// ─── DIRECTIONAL BIAS ─────────────────────────────────
// Same structure as NEAREST, but the off-axis
// dimension costs 2x more. This narrows the search
// cone toward the pressed direction.

FUNCTION snap_directional(direction):
  best = null, best_score = INF

  FOR EACH note IN eligible_notes(direction):
    dx = |note.startTime - crosshair.x|
    dy = |note.pitch    - crosshair.y|

    IF direction IN (LEFT, RIGHT):
      // Horizontal is primary → vertical deviation penalized
      score = dx * W_time + dy * W_pitch * 2.0

    ELSE:  // UP or DOWN
      // Vertical is primary → horizontal deviation penalized
      score = dy * W_pitch + dx * W_time * 2.0

    IF score < best_score:
      best = note, best_score = score

  RETURN best

  // The factor 2.0 is tunable.
  // Higher = stricter axis alignment.
  // Lower  = more like Nearest Visual.` : snapMode === 'ellipsoid' ?
`// ─── ELLIPSOID (VOICE LEADING) ────────────────────────
// Instead of adding an off-axis penalty, the search space
// itself is reshaped into an ellipse elongated along the
// navigation axis. The off-axis dimension is COMPRESSED
// before Euclidean distance is computed, not penalized
// additively afterward. This is the key difference from
// Directional Bias.

FUNCTION snap_ellipsoid(direction):
  best = null, best_score = INF
  COMPRESSION = 0.25   // off-axis scale factor (tunable)

  FOR EACH note IN eligible_notes(direction):
    dx = |note.startTime - crosshair.x|
    dy = |note.pitch    - crosshair.y|

    IF direction IN (LEFT, RIGHT):
      // Compress vertical axis → ellipse is wide horizontally
      // A note 80px off-pitch costs only sqrt(80*0.25)²=20
      // instead of 80*2=160 (Directional Bias)
      score = sqrt( dx² + (dy * COMPRESSION)² )

    ELSE:  // UP or DOWN
      // Compress horizontal axis → ellipse is tall vertically
      score = sqrt( (dx * COMPRESSION)² + dy² )

    IF score < best_score:
      best = note, best_score = score

  RETURN best

  // Why Euclidean instead of Manhattan?
  // Manhattan: score = a + b  →  isolines are diamonds
  // Euclidean: score = sqrt(a²+b²)  →  isolines are circles/ellipses
  // Ellipsoid compresses one axis of that circle into an ellipse,
  // making the effective search cone wider in the primary direction.

  // Real-system translation:
  // dx in ticks, dy in semitones → apply separate W factors:
  // score = sqrt( (dx*W_time)² + (dy*W_pitch*COMPRESSION)² )` : snapMode === 'pitch_proximity' ?
`// ─── PITCH PROXIMITY ──────────────────────────────────
// Strongly favors notes close in pitch.
// Useful for navigating chord voicings and
// melodic voice-leading patterns.

FUNCTION snap_pitch_proximity(direction):
  best = null, best_score = INF

  FOR EACH note IN eligible_notes(direction):
    dx = |note.startTime - crosshair.x|
    dy = |note.pitch    - crosshair.y|

    IF direction IN (LEFT, RIGHT):
      // Time distance is expensive → prefer pitch neighbors
      score = dx * W_time * 4.0 + dy * W_pitch

    ELSE:  // UP or DOWN
      // Pitch distance is expensive → prefer time neighbors
      score = dy * W_pitch * 4.0 + dx * W_time

    IF score < best_score:
      best = note, best_score = score

  RETURN best

  // Example with W_time=1, W_pitch=1:
  //   Note A: 50 ticks right, same pitch   → score = 200
  //   Note B: 10 ticks right, 4 semi up    → score = 44
  //   → B wins. Voice leading is preserved.` : snapMode === 'axis_priority' ?
`// ─── AXIS PRIORITY ────────────────────────────────────
// Strictly navigates by primary axis.
// No weighting factor W needed.
// Works directly on tick/note data.

FUNCTION snap_axis_priority(direction):
  best = null, best_score = INF

  FOR EACH note IN eligible_notes(direction):
    dx = |note.startTime - crosshair.x|   // ticks
    dy = |note.pitch    - crosshair.y|    // semitones

    IF direction IN (LEFT, RIGHT):
      primary   = dx
      secondary = dy
    ELSE:
      primary   = dy
      secondary = dx

    // Primary axis dominates completely.
    // Secondary only breaks ties.
    score = primary * LARGE_NUMBER + secondary

    IF score < best_score:
      best = note, best_score = score

  RETURN best

  // Behavior:
  //   RIGHT → next note start in time, closest pitch if tied
  //   UP    → next higher pitch, closest in time if tied
  //   Guaranteed reversible on primary axis.`   : snapMode === 'time_harmony' ?
`// ─── TIME / HARMONY ───────────────────────────────────
// Notes are rectangles, not points.
// LEFT/RIGHT: tick-group search with pitch gate.
// UP/DOWN:    pitch axis only → step through notes sounding NOW.
// X and Y axes are strictly separated for UP/DOWN.
// LEFT/RIGHT may adjust Y but only within the pitch gate.

FUNCTION snap_time_harmony(direction):

  cursor_x     = crosshair.x
  cursor_pitch = 127 - floor(cursor_y / KEY_HEIGHT)
  MAX_PITCH_DISTANCE = 12  // semitones (1 octave)

  IF direction IN (LEFT, RIGHT):
    // ── Collect candidate ticks in given direction ────────
    IF direction == RIGHT:
      candidates = notes WHERE startTick > cursor_x
      ticks = UNIQUE(candidates.startTick) SORTED ASCENDING
    ELSE:
      candidates = notes WHERE startTick < cursor_x
      ticks = UNIQUE(candidates.startTick) SORTED DESCENDING

    IF candidates is EMPTY: DO NOTHING, RETURN

    // ── Walk ticks, accept first with pitch-near note ─────
    FOR EACH tick IN ticks:
      group = candidates WHERE startTick == tick
      nearest = group note WITH smallest |noteNumber - cursor_pitch|
      // tie: prefer lower noteNumber (deterministic)

      IF |nearest.noteNumber - cursor_pitch| <= MAX_PITCH_DISTANCE:
        SNAP cursor TO (nearest.startTick, nearest.noteNumber)
        RETURN

    // ── Fallback: all ticks exceed pitch gate ─────────────
    group = candidates WHERE startTick == ticks[0]
    nearest = group note WITH smallest |noteNumber - cursor_pitch|
    SNAP cursor TO (nearest.startTick, nearest.noteNumber)

  ELSE:  // UP or DOWN
    // ── Notes "sounding at" current time ─────────────────
    // Considers full note rectangles, not just start points.
    // A bass note that started 8 bars ago is included if its
    // duration still reaches the current cursor_x.
    sounding = notes WHERE startTick <= cursor_x < startTick + duration

    IF direction == UP:
      above = sounding WHERE noteNumber > cursor_pitch
      IF above is EMPTY: DO NOTHING, RETURN
      picked = above note WITH MIN(noteNumber)  // nearest above
    ELSE:
      below = sounding WHERE noteNumber < cursor_pitch
      IF below is EMPTY: DO NOTHING, RETURN
      picked = below note WITH MAX(noteNumber)  // nearest below

    SNAP cursor.y TO picked.noteNumber
    // cursor.x is NEVER changed by UP/DOWN` : snapMode === 'time_harmony_fallback' ?
`// ─── TIME / HARMONY + FALLBACK ────────────────────────
// Identical to Time / Harmony for LEFT/RIGHT.
// UP/DOWN adds a second search pass if the primary fails.

FUNCTION snap_time_harmony_fallback(direction):

  cursor_x     = crosshair.x
  cursor_pitch = 127 - floor(cursor_y / KEY_HEIGHT)
  MAX_PITCH_DISTANCE  = <PITCH GATE slider value>
  TIME_FALLBACK_RADIUS = 200  // pixels (~2 beats at beat=100px)

  IF direction IN (LEFT, RIGHT):
    // ── Same as Time / Harmony ────────────────────────
    // (tick-group search with pitch gate, see above)

  ELSE:  // UP or DOWN
    // ── Primary: notes sounding at current time ───────
    sounding = notes WHERE startTick <= cursor_x < startTick + duration

    picked = pitch-nearest note above/below cursor_pitch in sounding
    // (UP → MIN above, DOWN → MAX below)

    IF picked is NOT NULL:
      SNAP cursor.y TO picked.noteNumber
      RETURN

    // ── Fallback: notes starting near cursor.x ────────
    // Catches short notes that LEFT/RIGHT never lands inside.
    nearby = notes WHERE |startTick - cursor_x| < TIME_FALLBACK_RADIUS
                     AND NOT already in sounding

    picked = pitch-nearest note above/below cursor_pitch in nearby

    IF picked is NOT NULL:
      SNAP cursor.y TO picked.noteNumber

    // cursor.x is NEVER changed by UP/DOWN` : snapMode === 'x_then_y' ?
`// ─── X THEN Y ─────────────────────────────────────────
// Two-phase navigation: LEFT/RIGHT locks to a time column,
// UP/DOWN then steps through notes in that column.
// REVERSIBLE modifier applies to the normal path only.
// The fallback path (no notes in column) uses Nearest Visual.

FUNCTION snap_x_then_y(direction):

  IF direction IN (LEFT, RIGHT):
    // ── Phase 1: move in time, ignore pitch ──────────────
    best = null, best_score = INF

    FOR EACH note IN all_notes:
      dx = |note.startTime - crosshair.x|
      dy = |note.pitch    - crosshair.y|

      IF note not in pressed X direction: SKIP

      // Pure time distance. Y is only a tiebreaker when
      // two notes share the exact same start time.
      score = dx * LARGE_NUMBER + dy

      IF score < best_score:
        best = note, best_score = score

    IF best found:
      anchor_x = best.startTime   // remember column for next UP/DOWN
      SNAP TO best
      RETURN

  ELSE:  // UP or DOWN
    // ── Phase 2: move in pitch within the locked column ──
    IF anchor_x is SET:
      FOR EACH note IN all_notes:
        IF |note.startTime - anchor_x| >= EPSILON: SKIP  // wrong column
        dy = note.pitch - crosshair.y
        IF note not in pressed Y direction: SKIP
        score = |dy|

      IF any candidate found:
        SNAP TO lowest-score candidate
        // anchor_x stays set → further UP/DOWN keeps walking the chord
        RETURN

    // ── Fallback: no anchor or column is empty ───────────
    // User moved freely (SNAP was off) or no note in column.
    // Use Nearest Visual without REVERSIBLE.
    anchor_x = null
    SNAP TO nearest note in direction (Manhattan, no REVERSIBLE)` : `// ─── (select a mode above) ───`}
{`
// ─── REVERSIBLE MODIFIER (applies to all modes above) ─
//
// ON EACH SNAP:
//   store origin_note_id = current note under crosshair
//   store last_direction = pressed direction
//
// ON NEXT SNAP:
//   IF direction == opposite(last_direction):
//     force score = -1 for the stored origin_note_id
//     → guarantees return to exact previous position
//
// Only applies to immediate reversal (one step back).
// Continuing in same or different direction resets history.`}
        </pre>
        </details>
      )}
    </div>
  );
};

export default PianoRollPage;
