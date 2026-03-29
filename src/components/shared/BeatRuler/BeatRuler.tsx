/**
 * Beat/measure ruler bar at top of audio overview
 * Shows tick marks and dB level labels
 */

import './BeatRuler.css';

export function BeatRuler() {
  const ticks = Array.from({ length: 32 }, (_, i) => ({
    id: i,
    major: i % 4 === 0,
  }));

  return (
    <div className="beat-ruler">
      <div className="ruler-ticks">
        {ticks.map((tick) => (
          <div
            key={tick.id}
            className={`tick ${tick.major ? 'major' : 'minor'}`}
          />
        ))}
      </div>
      <div className="ruler-labels">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="label">
            -3 DB
          </div>
        ))}
      </div>
    </div>
  );
}