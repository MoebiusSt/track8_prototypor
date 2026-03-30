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

type SnapMode = 'nearest' | 'directional' | 'pitch_proximity' | 'axis_priority';

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
  const [isSnapEnabled, setIsSnapEnabled] = useState(false);
  const [isAnimated, setIsAnimated] = useState(true);
  const [snapMode, setSnapMode] = useState<SnapMode>('nearest');
  const [gridIndex, setGridIndex] = useState(3);
  const gridSize = GRID_OPTIONS[gridIndex].value;
  
  const notes = useRef(generateSampleNotes()).current;
  const scrollPos = useRef({ x: 0, y: 0 });

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
          // Pure Manhattan distance in raw pixels.
          // What the user sees is what the algorithm uses.
          score = absDx + absDy;

        } else if (snapMode === 'directional') {
          // Manhattan distance, but the off-axis costs 2x.
          // This creates a preference for notes aligned with the pressed direction
          // without being extreme. A note 50px ahead and 0 off-axis (score=50) beats
          // a note 20px ahead but 20px off-axis (score=20+40=60).
          if (isHorizontal) {
            score = absDx + absDy * 2;
          } else {
            score = absDy + absDx * 2;
          }

        } else if (snapMode === 'pitch_proximity') {
          // Horizontal distance costs 4x more than vertical.
          // Notes close in pitch are musically more related than
          // notes far away in time on the same pitch line.
          if (isHorizontal) {
            score = absDx * 4 + absDy;
          } else {
            score = absDy * 4 + absDx;
          }

        } else if (snapMode === 'axis_priority') {
          // Strict primary-axis priority: the note closest on the primary axis wins.
          // Secondary axis only used as tie-breaker (scaled down to never outweigh primary).
          // Guaranteed reversible on the primary axis.
          if (isHorizontal) {
            score = absDx * 10000 + absDy;
          } else {
            score = absDy * 10000 + absDx;
          }
        }

        if (score < bestScore) {
          bestScore = score;
          bestNote = note;
        }
      }

      if (bestNote) {
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
  }, [isSnapEnabled, snapMode, gridSize, notes]);

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
            onChange={(e) => setSnapMode(e.target.value as SnapMode)}
          >
            <option value="nearest">Nearest Visual</option>
            <option value="directional">Directional Bias</option>
            <option value="pitch_proximity">Pitch Proximity</option>
            <option value="axis_priority">Axis Priority</option>
          </select>
        </label>
        <button 
          className={isSnapEnabled ? 'active' : ''} 
          onClick={() => setIsSnapEnabled(!isSnapEnabled)}
        >
          SNAP
        </button>
        <button 
          className={isAnimated ? 'active' : ''} 
          onClick={() => setIsAnimated(!isAnimated)}
        >
          ANIMATED
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
            <p><strong>Directional Bias:</strong> Manhattan distance but deviations from the main scroll axis cost 2x. Pressing Right prefers notes that are more to the right than off to the side. Still picks nearby off-axis notes if they are significantly closer overall.</p>
          )}
          {snapMode === 'pitch_proximity' && (
            <p><strong>Pitch Proximity:</strong> Horizontal distance costs 4x more than vertical. Strongly prefers notes that are close in pitch, even if they are slightly in a different time position. Follows musical voice leading: a note 4 semitones away (32px = score 32) is much cheaper to reach than one 50px ahead in time (score 200).</p>
          )}
          {snapMode === 'axis_priority' && (
            <p><strong>Axis Priority:</strong> Strict primary-axis navigation. Right = chronologically next note start. Up = next higher pitch. Secondary axis only as tie-breaker. Predictable and reversible, but can jump far on the secondary axis.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default App;