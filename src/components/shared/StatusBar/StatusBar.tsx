/**
 * Status bar – bottom strip of the device display.
 * Format (matching real device): -IN- [8 track indicators] T time  B bar  storage -OUT-
 */

import { useDevice } from '../../../state/DeviceContext';
import './StatusBar.css';

export function StatusBar() {
  const { state } = useDevice();
  const { transport, tracks, storageUsed, storageTotal } = state;

  return (
    <div className="status-bar">
      {/* Loop in marker */}
      <span className="sb-edge">-IN-</span>

      {/* 8 track recording indicators */}
      <div className="sb-track-indicators">
        {tracks.map((t) => (
          <div
            key={t.id}
            className={`sb-track-dot ${t.armed ? 'armed' : ''} ${t.id === state.selectedTrackIndex ? 'selected' : ''}`}
          />
        ))}
      </div>

      {/* Transport time and bar position – centred */}
      <div className="sb-transport">
        <span className="sb-time">T {transport.timeDisplay}</span>
        <span className="sb-bar">B {transport.barPosition}</span>
        <span className="sb-storage">{storageUsed.toFixed(1)}GB/{storageTotal.toFixed(1)}GB</span>
      </div>

      {/* Loop out marker */}
      <span className="sb-edge sb-edge-right">-OUT-</span>
    </div>
  );
}
