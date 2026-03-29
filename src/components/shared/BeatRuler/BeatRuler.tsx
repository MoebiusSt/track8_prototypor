/**
 * Beat/level ruler – pixel-accurate replica of Theme Editor canvas.
 * Shows dB scale labels across the top, dense tick marks below,
 * and named markers overlaid.
 */

import { useDevice } from '../../../state/DeviceContext';
import './BeatRuler.css';

/** dB labels visible on the ruler (from left to right) */
const DB_LABELS = ['V', '-12 DB', '-10 DB', '-8 DB', '-6 DB', '-4 DB', '-2 DB', '0 DB', '2 DB'];

/** Number of ticks rendered across the full ruler width */
const TICK_COUNT = 192;

export function BeatRuler() {
  const { state } = useDevice();

  return (
    <div className="beat-ruler">
      {/* Orange dB labels row */}
      <div className="ruler-label-row">
        {DB_LABELS.map((lbl, i) => (
          <span
            key={i}
            className="ruler-db-label"
            style={{ left: `${(i / (DB_LABELS.length - 1)) * 100}%` }}
          >
            {lbl}
          </span>
        ))}

        {/* Named song markers overlaid on the label row */}
        {state.markers.map((marker) => (
          <span
            key={marker.id}
            className="ruler-marker-tag"
            style={{ left: `${marker.position * 100}%` }}
          >
            {marker.label}
          </span>
        ))}
      </div>

      {/* White tick marks row */}
      <div className="ruler-tick-row">
        {Array.from({ length: TICK_COUNT }, (_, i) => {
          const isMajor = i % 24 === 0;
          const isSemi = i % 6 === 0;
          return (
            <div
              key={i}
              className={`rtick ${isMajor ? 'major' : isSemi ? 'semi' : 'minor'}`}
            />
          );
        })}
      </div>
    </div>
  );
}
