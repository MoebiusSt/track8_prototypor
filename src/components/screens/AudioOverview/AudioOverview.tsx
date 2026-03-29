/**
 * Audio Overview — header, ruler + timeline (over waveform width), eight track lanes with gutters.
 */

import { useDevice } from '../../../state/DeviceContext';
import { BeatRuler } from '../../shared/BeatRuler/BeatRuler';
import { TrackLane } from '../../shared/TrackLane/TrackLane';
import { AudioOverviewHeader } from './AudioOverviewHeader';
import { TimelineStrip } from './TimelineStrip';
import './AudioOverview.css';

export function AudioOverview() {
  const { state } = useDevice();

  return (
    <div className="audio-overview">
      <AudioOverviewHeader />

      <div className="audio-overview__ruler-row">
        <div className="audio-overview__ruler-corner" aria-hidden>
          <span className="audio-overview__corner-label">dB</span>
        </div>
        <div className="audio-overview__ruler-main">
          <BeatRuler />
          <TimelineStrip />
        </div>
      </div>

      <div className="tracks-container">
        {state.tracks.map((track) => (
          <TrackLane
            key={track.id}
            track={track}
            isSelected={track.id === state.selectedTrackIndex}
          />
        ))}
      </div>
    </div>
  );
}
