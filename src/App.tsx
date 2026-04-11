import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PianoRollPage } from './pages/PianoRollPage';
import { WaveformPage } from './pages/WaveformPage';
import { TimedMutePage } from './pages/TimedMutePage';
import { MainOverviewPage } from './pages/MainOverviewPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter basename="/track8_prototypor">
      <Routes>
        <Route path="/" element={<MainOverviewPage />} />
        <Route path="/overview" element={<MainOverviewPage />} />
        <Route path="/piano" element={<PianoRollPage />} />
        <Route path="/timed-mute" element={<TimedMutePage />} />
        <Route path="/waveform" element={<WaveformPage />} />
        <Route path="/multitrack" element={<Navigate to="/timed-mute" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
