/**
 * Audio Overview Screen
 * Beat/level ruler → 8 track waveform lanes
 * Fills its container (400px display minus 20px status bar = 380px).
 */

import { useDevice } from '../../../state/DeviceContext';
import { BeatRuler } from '../../shared/BeatRuler/BeatRuler';
import { TrackLane } from '../../shared/TrackLane/TrackLane';
import './AudioOverview.css';

export function AudioOverview() {
  const { state } = useDevice();

  return (
    <div className="audio-overview">
      <BeatRuler />
      <div className="tracks-container">
        {state.tracks.map((track) => (
          <TrackLane key={track.id} track={track} />
        ))}
      </div>
    </div>
  );
}
