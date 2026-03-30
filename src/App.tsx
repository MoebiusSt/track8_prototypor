import React, { useState, useEffect, useRef } from 'react';
import './app.css';

const VISIBLE_WIDTH = 1280;
const VISIBLE_HEIGHT = 400;
const KEY_HEIGHT = 8;
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

type SnapMode = 'nearest' | 'directional' | 'ellipsoid' | 'pitch_proximity' | 'axis_priority' | 'x_then_y';

interface MidiNote {
  id: string;
  noteNumber: number;
  startTime: number;
  duration: number;
  velocity: number;
}

const isBlackKey = (noteNumber: number) => {
  const noteInOctave = noteNumber % 12;
  return [1, 3, 6, 8, 10].includes(noteInOctave);
};

const generateSampleNotes = (): MidiNote[] => {
  const notes: MidiNote[] = [];
  let noteId = 0;
  
  const addNote = (note: number, time: number, dur: number) => {
    notes.push({
      id: `note-${noteId++}`,
      noteNumber: note,
      startTime: time,
      duration: dur,
      velocity: 80 + Math.random() * 40
    });
  };

  const beat = 100;

  const progressions = [
    { root: 48, quality: 'major' },
    { root: 55, quality: 'major' },
    { root: 57, quality: 'minor' },
    { root: 53, quality: 'major' },
    { root: 48, quality: 'major' },
    { root: 55, quality: 'major' },
    { root: 53, quality: 'major' },
    { root: 53, quality: 'major' },
  ];

  const getChordNotes = (root: number, quality: string) => {
    if (quality === 'major') return [root, root + 4, root + 7, root + 12];
    return [root, root + 3, root + 7, root + 12];
  };

  for (let bar = 0; bar < 16; bar++) {
    const prog = progressions[bar % 8];
    const chord = getChordNotes(prog.root, prog.quality);
    const barStart = bar * beat * 4;

    addNote(chord[0] - 12, barStart, beat * 4 + beat * 0.5);
    
    addNote(chord[0], barStart + beat * 0.5, beat * 1.5);
    addNote(chord[1], barStart + beat * 1.0, beat * 3.5);
    addNote(chord[2], barStart + beat * 1.5, beat * 2.8);
    
    const rollOffset = 5;
    addNote(chord[1] + 12, barStart + beat * 2.0 + rollOffset * 0, beat * 1.5);
    addNote(chord[2] + 12, barStart + beat * 2.0 + rollOffset * 1, beat * 1.5);
    addNote(chord[3] + 12, barStart + beat * 2.0 + rollOffset * 2, beat * 1.5 + beat * 0.2);

    const mBase = chord[3] + 12;
    if (bar % 2 === 0) {
      addNote(mBase, barStart + beat * 0.0, beat * 0.8);
      addNote(mBase + 2, barStart + beat * 1.0, beat * 0.4);
      addNote(mBase + 4, barStart + beat * 1.5, beat * 0.4);
      addNote(mBase + 7, barStart + beat * 2.5, beat * 1.2);
    } else {
      addNote(mBase + 7, barStart + beat * 0.0, beat * 0.3);
      addNote(mBase + 5, barStart + beat * 0.5, beat * 0.3);
      addNote(mBase + 4, barStart + beat * 1.0, beat * 0.8);
      addNote(mBase + 2, barStart + beat * 2.0, beat * 0.2);
      addNote(mBase + 4, barStart + beat * 2.2, beat * 0.2);
      addNote(mBase + 5, barStart + beat * 2.4, beat * 0.2);
      addNote(mBase + 7, barStart + beat * 2.6, beat * 1.4);
    }
  }

  return notes;
};

const getNotePos = (note: MidiNote) => ({
  x: note.startTime,
  y: (127 - note.noteNumber) * KEY_HEIGHT + KEY_HEIGHT / 2
});

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

export const App: React.FC = () => {
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [isSnapEnabled, setIsSnapEnabled] = useState(true);
  const [isAnimated, setIsAnimated] = useState(true);
  const [preferReversible, setPreferReversible] = useState(true);
  const [snapMode, setSnapMode] = useState<SnapMode>('directional');
  const [gridIndex, setGridIndex] = useState(3);
  const gridSize = GRID_OPTIONS[gridIndex].value;
  
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
      const opposites: Record<string, string> = { up: 'down', down: 'up', left: 'right', right: 'left' };
      const isReversal = preferReversible
        && snapHistory.current !== null
        && direction === opposites[snapHistory.current.direction];

      // Find the note we are currently on (closest to crosshair) to store as origin
      let currentNoteId: string | null = null;
      let minCurrentDist = Infinity;
      for (const n of notes) {
        const p = getNotePos(n);
        const d = Math.abs(p.x - cx) + Math.abs(p.y - cy);
        if (d < minCurrentDist) {
          minCurrentDist = d;
          currentNoteId = n.id;
        }
      }

      let bestNote: MidiNote | null = null;
      let bestScore = Infinity;

      for (const note of notes) {
        const pos = getNotePos(note);
        const dx = pos.x - cx;
        const dy = pos.y - cy;

        if (!isInDirection(dx, dy, direction)) continue;

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        let score = Infinity;

        if (snapMode === 'nearest') {
          score = absDx + absDy;
        } else if (snapMode === 'directional') {
          if (isHorizontal) {
            score = absDx + absDy * 2;
          } else {
            score = absDy + absDx * 2;
          }
        } else if (snapMode === 'ellipsoid') {
          // Compress the off-axis dimension before computing Euclidean distance.
          // Factor 0.25 makes the search space 4x wider in the primary direction,
          // equivalent to an ellipse elongated along the navigation axis.
          if (isHorizontal) {
            score = Math.sqrt(absDx * absDx + (absDy * 0.25) * (absDy * 0.25));
          } else {
            score = Math.sqrt((absDx * 0.25) * (absDx * 0.25) + absDy * absDy);
          }
        } else if (snapMode === 'pitch_proximity') {
          if (isHorizontal) {
            score = absDx * 4 + absDy;
          } else {
            score = absDy * 4 + absDx;
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
        for (const n of notes) {
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
        // x_then_y: set anchor after a horizontal snap, keep it after vertical.
        if (snapMode === 'x_then_y' && isHorizontal) {
          xThenYAnchorX.current = getNotePos(bestNote).x;
        }
        const target = getNotePos(bestNote);
        setScrollX(clampX(target.x - VISIBLE_WIDTH / 2));
        setScrollY(clampY(target.y - VISIBLE_HEIGHT / 2));
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
  }, [isSnapEnabled, snapMode, preferReversible, gridSize, notes]);

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
    return notes.map((note) => {
      const yPos = (127 - note.noteNumber) * KEY_HEIGHT;
      
      if (
        note.startTime + note.duration < scrollX ||
        note.startTime > scrollX + VISIBLE_WIDTH ||
        yPos + KEY_HEIGHT < scrollY ||
        yPos > scrollY + VISIBLE_HEIGHT
      ) {
        return null;
      }

      return (
        <div
          key={note.id}
          className="midi-note"
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
          </select>
        </label>
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
        <button 
          className={preferReversible ? 'active' : ''} 
          onClick={(e) => { setPreferReversible(!preferReversible); (e.currentTarget as HTMLElement).blur(); }}
        >
          WEIGHTED-REVERSE
        </button>
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
      </div>
      <div className="piano-roll-viewport">
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
            <p><strong>X then Y:</strong> Two-phase navigation. LEFT/RIGHT moves purely in time — it jumps to the previous or next note start, completely ignoring pitch. UP/DOWN then moves to the note directly above or below <em>at that same time position</em>. This lets you land precisely in a chord: first navigate to the right beat, then step through the chord vertically. If UP/DOWN finds no note at the current time column (e.g. after freely scrolling without SNAP), it falls back to Nearest Visual without Reversible.</p>
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
  //   Guaranteed reversible on primary axis.` : snapMode === 'x_then_y' ?
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

export default App;