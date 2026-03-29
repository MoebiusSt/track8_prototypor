/**
 * Single track waveform lane
 * Shows waveform visualization with dotted centerline
 */

import type { Track } from '../../../types/device';
import './TrackLane.css';

interface TrackLaneProps {
  track: Track;
}

export function TrackLane({ track }: TrackLaneProps) {
  // Generate pseudo-random waveform heights for visual variety
  const waveformBars = Array.from({ length: 60 }, (_, i) => {
    const seed = track.id * 1000 + i;
    const value = Math.sin(seed * 0.3) * Math.cos(seed * 0.7);
    const height = Math.abs(value) * 60;
    return height;
  });

  const baseColor = track.muted
    ? 'var(--color-audio-track-muted)'
    : track.armed
    ? 'var(--color-audio-track-recording)'
    : 'var(--color-audio-track)';

  return (
    <div className={`track-lane ${track.muted ? 'muted' : ''}`}>
      <div className="waveform-container">
        <div className="centerline"></div>
        <div className="waveform">
          {waveformBars.map((height, i) => (
            <div
              key={i}
              className="waveform-bar"
              style={{
                height: `${height}%`,
                backgroundColor: baseColor,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}