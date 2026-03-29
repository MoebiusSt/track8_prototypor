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

  // A more complex 8-bar progression repeated twice
  const progressions = [
    { root: 48, quality: 'major' }, // C
    { root: 55, quality: 'major' }, // G
    { root: 57, quality: 'minor' }, // Am
    { root: 53, quality: 'major' }, // F
    { root: 48, quality: 'major' }, // C
    { root: 55, quality: 'major' }, // G
    { root: 53, quality: 'major' }, // F
    { root: 53, quality: 'major' }, // F
  ];

  const getChordNotes = (root: number, quality: string) => {
    if (quality === 'major') return [root, root + 4, root + 7, root + 12];
    return [root, root + 3, root + 7, root + 12]; // minor
  };

  for (let bar = 0; bar < 16; bar++) {
    const prog = progressions[bar % 8];
    const chord = getChordNotes(prog.root, prog.quality);
    const barStart = bar * beat * 4;

    // Left hand: Low bass note, sustained
    addNote(chord[0] - 12, barStart, beat * 4 + beat * 0.5); // Sustain into next bar
    
    // Left hand: Broken chord, overlapping
    addNote(chord[0], barStart + beat * 0.5, beat * 1.5);
    addNote(chord[1], barStart + beat * 1.0, beat * 3.5); // overlapping heavily
    addNote(chord[2], barStart + beat * 1.5, beat * 2.8); // overlapping
    
    // Right hand: Block chord played slightly "rolled" (strummed)
    const rollOffset = 5;
    addNote(chord[1] + 12, barStart + beat * 2.0 + rollOffset * 0, beat * 1.5);
    addNote(chord[2] + 12, barStart + beat * 2.0 + rollOffset * 1, beat * 1.5);
    addNote(chord[3] + 12, barStart + beat * 2.0 + rollOffset * 2, beat * 1.5 + beat * 0.2); // rings out slightly longer

    // Right hand: Melody spanning multiple octaves and notes
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
      
      // Fast run
      addNote(mBase + 2, barStart + beat * 2.0, beat * 0.2);
      addNote(mBase + 4, barStart + beat * 2.2, beat * 0.2);
      addNote(mBase + 5, barStart + beat * 2.4, beat * 0.2);
      addNote(mBase + 7, barStart + beat * 2.6, beat * 1.4); // rings out
    }
  }

  return notes;
};

export const App: React.FC = () => {
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [isSnapEnabled, setIsSnapEnabled] = useState(false);
  const [isAnimated, setIsAnimated] = useState(true);
  const [snapMode, setSnapMode] = useState<'directional' | 'intent_weighted' | 'ellipsoid' | 'orthogonal'>('ellipsoid');
  const [gridIndex, setGridIndex] = useState(3); // Default to 1/8 (index 3)
  const gridSize = GRID_OPTIONS[gridIndex].value;
  
  const notes = useRef(generateSampleNotes()).current;
  const scrollPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    scrollPos.current = { x: scrollX, y: scrollY };
  }, [scrollX, scrollY]);
  
  useEffect(() => {
    // Initial scroll position: center around C4 (note 60)
    // The crosshair is at VISIBLE_HEIGHT / 2 = 200px.
    // To make crosshair fall exactly in the middle of a key,
    // scrollY should be such that the key's middle is at scrollY + 200.
    // C4 top Y = (127 - 60) * 16 = 1072.
    // C4 middle Y = 1072 + 8 = 1080.
    // So we want scrollY + 200 = 1080 => scrollY = 880.
    // 880 is a multiple of 16, which is good.
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

      let bestNote: MidiNote | null = null;

      if (snapMode === 'directional') {
        let minPrimaryDist = Infinity;
        let minSecondaryDist = Infinity;

        for (const note of notes) {
          const noteX = note.startTime; // Left edge
          const noteY = (127 - note.noteNumber) * KEY_HEIGHT + KEY_HEIGHT / 2;

          let primaryDist = Infinity;
          let secondaryDist = Infinity;

          if (direction === 'right' && noteX > cx + 1) {
            primaryDist = noteX - cx;
            secondaryDist = Math.abs(noteY - cy);
          } else if (direction === 'left' && noteX < cx - 1) {
            primaryDist = cx - noteX;
            secondaryDist = Math.abs(noteY - cy);
          } else if (direction === 'up' && noteY < cy - 1) {
            primaryDist = cy - noteY;
            secondaryDist = Math.abs(noteX - cx);
          } else if (direction === 'down' && noteY > cy + 1) {
            primaryDist = noteY - cy;
            secondaryDist = Math.abs(noteX - cx);
          }

          if (primaryDist < minPrimaryDist) {
            minPrimaryDist = primaryDist;
            minSecondaryDist = secondaryDist;
            bestNote = note;
          } else if (primaryDist === minPrimaryDist && secondaryDist < minSecondaryDist) {
            minSecondaryDist = secondaryDist;
            bestNote = note;
          }
        }
      } else if (snapMode === 'intent_weighted') {
        let bestScore = Infinity;

        for (const note of notes) {
          // Calculate distance to the left edge of the note
          const noteX = note.startTime;
          const noteY = (127 - note.noteNumber) * KEY_HEIGHT + KEY_HEIGHT / 2;

          const dx = noteX - cx;
          const dy = noteY - cy;
          
          let isEligible = false;

          // Check if note is in the general direction of intent
          if (direction === 'right' && dx > 0) isEligible = true;
          if (direction === 'left' && dx < 0) isEligible = true;
          if (direction === 'down' && dy > 0) isEligible = true;
          if (direction === 'up' && dy < 0) isEligible = true;

          if (isEligible) {
            // Normalize the distances so X (time) and Y (pitch) can be compared fairly.
            // 1 key height (8px) is roughly equivalent to a 16th note (25px) in terms of user perception
            const Y_WEIGHT = 25 / 8; 
            
            const normDx = Math.abs(dx);
            const normDy = Math.abs(dy) * Y_WEIGHT;

            // Calculate Euclidean distance in this normalized space
            const distance = Math.sqrt(normDx * normDx + normDy * normDy);

            let score = 0;
            const PENALTY_MULTIPLIER = 3.0; // Make the off-axis distance cost 3x more

            if (direction === 'left' || direction === 'right') {
               score = distance + (normDy * PENALTY_MULTIPLIER);
            } else {
               score = distance + (normDx * PENALTY_MULTIPLIER);
            }

            if (score < bestScore) {
              bestScore = score;
              bestNote = note;
            }
          }
        }
      } else if (snapMode === 'ellipsoid') {
        let bestScore = Infinity;

        for (const note of notes) {
          const noteX = note.startTime;
          const noteY = (127 - note.noteNumber) * KEY_HEIGHT + KEY_HEIGHT / 2;

          const dx = noteX - cx;
          const dy = noteY - cy;
          
          let isEligible = false;
          if (direction === 'right' && dx > 0) isEligible = true;
          if (direction === 'left' && dx < 0) isEligible = true;
          if (direction === 'down' && dy > 0) isEligible = true;
          if (direction === 'up' && dy < 0) isEligible = true;

          if (isEligible) {
            const normDx = Math.abs(dx);
            const normDy = Math.abs(dy) * (25 / 8); 

            let score = 0;
            if (direction === 'left' || direction === 'right') {
               // Time is primary. We squish the Y axis penalty so pitch jumps are "cheaper".
               score = Math.sqrt(Math.pow(normDx, 2) + Math.pow(normDy * 0.25, 2));
            } else {
               // Pitch is primary. We squish the X axis penalty so time jumps are "cheaper".
               score = Math.sqrt(Math.pow(normDy, 2) + Math.pow(normDx * 0.25, 2));
            }

            if (score < bestScore) {
              bestScore = score;
              bestNote = note;
            }
          }
        }
      } else if (snapMode === 'orthogonal') {
        let bestScore1 = Infinity;
        let bestScore2 = Infinity;

        for (const note of notes) {
          const noteX = note.startTime;
          const noteY = (127 - note.noteNumber) * KEY_HEIGHT + KEY_HEIGHT / 2;

          const dx = noteX - cx;
          const dy = noteY - cy;
          
          let isEligible = false;
          if (direction === 'right' && dx > 0) isEligible = true;
          if (direction === 'left' && dx < 0) isEligible = true;
          if (direction === 'down' && dy > 0) isEligible = true;
          if (direction === 'up' && dy < 0) isEligible = true;

          if (isEligible) {
            let primary = 0;
            let secondary = 0;
            
            if (direction === 'left' || direction === 'right') {
               primary = Math.abs(dx);
               secondary = Math.abs(dy);
            } else {
               primary = Math.abs(dy);
               secondary = Math.abs(dx);
            }

            if (primary < bestScore1) {
              bestScore1 = primary;
              bestScore2 = secondary;
              bestNote = note;
            } else if (primary === bestScore1 && secondary < bestScore2) {
              bestScore2 = secondary;
              bestNote = note;
            }
          }
        }
      }

      if (bestNote) {
        const targetX = bestNote.startTime;
        const targetY = (127 - bestNote.noteNumber) * KEY_HEIGHT + KEY_HEIGHT / 2;
        
        setScrollX(clampX(targetX - VISIBLE_WIDTH / 2));
        setScrollY(clampY(targetY - VISIBLE_HEIGHT / 2));
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
  }, [isSnapEnabled, gridSize, notes]);

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
            onChange={(e) => setSnapMode(e.target.value as any)}
          >
            <option value="directional">Directional (Nearest)</option>
            <option value="intent_weighted">Cone (Strict Axis)</option>
            <option value="ellipsoid">Ellipsoid (Balanced)</option>
            <option value="orthogonal">Orthogonal (Strict Next)</option>
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
          {snapMode === 'directional' && (
            <p><strong>Directional Mode:</strong> Searches strictly for the nearest note in the pressed direction based on Euclidean distance to its start edge. Can lead to unintuitive jumps if a note is horizontally far but vertically close.</p>
          )}
          {snapMode === 'intent_weighted' && (
            <p><strong>Cone (Strict Axis):</strong> Prioritizes notes that lie along the axis of your pressed arrow key. Deviations from the main scroll direction are heavily penalized (Cone of vision). Sometimes skips the next melody note if it's too far off-axis.</p>
          )}
          {snapMode === 'ellipsoid' && (
            <p><strong>Ellipsoid (Balanced Voice Leading):</strong> Squishes the penalty for the off-axis. When moving Left/Right, it strongly favors the next note in time, but prefers closer pitches if multiple notes occur soon. When moving Up/Down, favors the next pitch regardless of slight time offsets.</p>
          )}
          {snapMode === 'orthogonal' && (
            <p><strong>Orthogonal (Strict Next):</strong> Absolute rigid priority. Moving Right always goes to the chronologically next note, even if it is 8 octaves away. Moving Up always goes to the next higher pitch, regardless of time.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default App;