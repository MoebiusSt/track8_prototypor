/**
 * Bottom status bar showing transport info and storage
 * Format: -IN- | recording indicators | T time | B bar:beat | storage | -OUT-
 */

import { useDevice } from '../../../state/DeviceContext';
import './StatusBar.css';

export function StatusBar() {
  const { state } = useDevice();

  return (
    <div className="status-bar">
      <div className="status-left">-IN-</div>

      <div className="status-recording-lanes">
        {state.tracks.map((track) => (
          <div
            key={track.id}
            className={`recording-indicator ${track.armed ? 'armed' : ''}`}
          />
        ))}
      </div>

      <div className="status-displays">
        <div className="status-display">T {state.transport.timeDisplay}</div>
        <div className="status-display">B {state.transport.barPosition}</div>
        <div className="status-display">
          {state.storageUsed.toFixed(1)}GB/{state.storageTotal.toFixed(1)}GB
        </div>
      </div>

      <div className="status-right">-OUT-</div>
    </div>
  );
}