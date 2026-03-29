/**
 * Loop region + playhead line aligned with waveform area (matches device timeline strip).
 */

import { useDevice } from '../../../state/DeviceContext';
import './TimelineStrip.css';

export function TimelineStrip() {
  const { state } = useDevice();
  const { transport } = state;
  const pos = transport.position;
  const loopOn = transport.loopEnabled;
  const ls = Math.min(transport.loopStart, transport.loopEnd);
  const le = Math.max(transport.loopStart, transport.loopEnd);

  return (
    <div className="timeline-strip">
      {loopOn && (
        <div
          className="timeline-strip__loop"
          style={{
            left: `${ls}%`,
            width: `${Math.max(0, le - ls)}%`,
          }}
        />
      )}
      <div className="timeline-strip__markers">
        {state.markers.map((m) => (
          <div
            key={m.id}
            className="timeline-strip__marker"
            style={{ left: `${m.position * 100}%` }}
            title={m.label}
          />
        ))}
      </div>
      <div className="timeline-strip__playhead" style={{ left: `${pos}%` }} />
      <div className="timeline-strip__labels">
        <span className={loopOn ? 'ts-lbl ts-lbl--on' : 'ts-lbl'}>LOOP</span>
        <span className="ts-lbl">MARK</span>
        <span className="ts-lbl">PUNCH</span>
      </div>
    </div>
  );
}
