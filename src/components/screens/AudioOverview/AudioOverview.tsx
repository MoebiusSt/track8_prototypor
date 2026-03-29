/**
 * Audio Overview Screen - Main recording/playback interface
 * Shows beat ruler, markers, and 8 audio tracks with waveforms
 */

import { useDevice } from '../../../state/DeviceContext';
import { BeatRuler } from '../../shared/BeatRuler/BeatRuler';
import { MarkerBar } from '../../shared/MarkerBar/MarkerBar';
import { TrackLane } from '../../shared/TrackLane/TrackLane';
import './AudioOverview.css';

export function AudioOverview() {
  const { state } = useDevice();

  return (
    <div className="audio-overview">
      <BeatRuler />
      <MarkerBar />

      <div className="tracks-container">
        {state.tracks.map((track) => (
          <TrackLane key={track.id} track={track} />
        ))}
      </div>
    </div>
  );
}