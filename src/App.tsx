import React, { useState, useEffect, useRef } from 'react';
import './app.css';

const VISIBLE_WIDTH = 1280;
const VISIBLE_HEIGHT = 400;
const KEY_HEIGHT = 16;
const TOTAL_KEYS = 128;
const TOTAL_WIDTH = 5000;
const SCROLL_STEP_X = 50;
const SCROLL_STEP_Y = KEY_HEIGHT;

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
  const notes = useRef(generateSampleNotes()).current;
  
  useEffect(() => {
    const c4Y = (127 - 60) * KEY_HEIGHT;
    const initialScrollY = Math.max(0, Math.min(c4Y - VISIBLE_HEIGHT / 2, TOTAL_KEYS * KEY_HEIGHT - VISIBLE_HEIGHT));
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
        setScrollX((prev) => Math.max(0, prev - SCROLL_STEP_X));
      } else if (e.key === 'ArrowRight') {
        setScrollX((prev) => Math.min(TOTAL_WIDTH - VISIBLE_WIDTH, prev + SCROLL_STEP_X));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
      </div>
      <div className="instructions">
        Scroll: Arrow Keys (Up, Down, Left, Right)
      </div>
    </div>
  );
};

export default App;