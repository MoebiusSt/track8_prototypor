import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PianoRollPage } from './pages/PianoRollPage';
import { WaveformPage } from './pages/WaveformPage';
import { TimedMutePage } from './pages/TimedMutePage';

export const App: React.FC = () => {
  return (
    <BrowserRouter basename="/track8_midi-note-snap">
      <Routes>
        <Route path="/" element={<WaveformPage />} />
        <Route path="/piano" element={<PianoRollPage />} />
        <Route path="/timed-mute" element={<TimedMutePage />} />
        <Route path="/multitrack" element={<Navigate to="/timed-mute" replace />} />
        <Route path="/waveform" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
