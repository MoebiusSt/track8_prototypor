/**
 * Marker bar showing named markers (Intro, Chorus, Verse1, etc.)
 */

import { useDevice } from '../../../state/DeviceContext';
import './MarkerBar.css';

export function MarkerBar() {
  const { state } = useDevice();

  return (
    <div className="marker-bar">
      {state.markers.map((marker) => (
        <div
          key={marker.id}
          className="marker-badge"
          style={{
            left: `${marker.position * 100}%`,
          }}
        >
          {marker.label}
        </div>
      ))}
    </div>
  );
}