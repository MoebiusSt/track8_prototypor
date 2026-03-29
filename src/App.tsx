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
  const startNotes = [
    { note: 60, time: 100, dur: 80 },  
    { note: 62, time: 250, dur: 80 },  
    { note: 64, time: 400, dur: 80 },  
    { note: 65, time: 550, dur: 80 },  
    { note: 67, time: 700, dur: 80 },  
    { note: 69, time: 850, dur: 80 },  
    { note: 71, time: 1000, dur: 80 }, 
    { note: 72, time: 1150, dur: 80 }, 
    { note: 67, time: 1300, dur: 160 },
    { note: 64, time: 1500, dur: 160 },
    { note: 60, time: 1700, dur: 300 },
  ];

  startNotes.forEach((n, i) => {
    notes.push({
      id: `note-${i}`,
      noteNumber: n.note,
      startTime: n.time,
      duration: n.dur,
      velocity: 100
    });
  });

  return notes;
};

export const App: React.FC = () => {
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [isSnapEnabled, setIsSnapEnabled] = useState(false);
  const [gridIndex, setGridIndex] = useState(3); // Default to 1/8 (index 3)
  const gridSize = GRID_OPTIONS[gridIndex].value;
  
  const notes = useRef(generateSampleNotes()).current;
  
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }

      if (e.key === 'ArrowUp') {
        setScrollY((prev) => Math.max(0, prev - SCROLL_STEP_Y));
      } else if (e.key === 'ArrowDown') {
        setScrollY((prev) => Math.min(TOTAL_KEYS * KEY_HEIGHT - VISIBLE_HEIGHT, prev + SCROLL_STEP_Y));
      } else if (e.key === 'ArrowLeft') {
        if (!isSnapEnabled) {
          setScrollX((prev) => Math.max(0, prev - gridSize));
        }
        // SNAP behavior will be added later
      } else if (e.key === 'ArrowRight') {
        if (!isSnapEnabled) {
          setScrollX((prev) => Math.min(TOTAL_WIDTH - VISIBLE_WIDTH, prev + gridSize));
        }
        // SNAP behavior will be added later
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSnapEnabled, gridSize]);

  const renderBackground = () => {
    const lanes = [];
    const startLane = Math.floor(scrollY / KEY_HEIGHT);
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
        <button 
          className={isSnapEnabled ? 'active' : ''} 
          onClick={() => setIsSnapEnabled(!isSnapEnabled)}
        >
          SNAP
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
          className="piano-roll-content"
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
    </div>
  );
};

export default App;