/**
 * Main Settings Screen
 * Top row: 8 encoder parameter boxes (orange label + green-bordered value)
 * Centre: Song name in pixel font
 * Bottom: BPM + firmware version info
 */

import { useDevice } from '../../../state/DeviceContext';
import { EncoderParam } from '../../shared/EncoderParam/EncoderParam';
import './MainSettings.css';

export function MainSettings() {
  const { state } = useDevice();

  return (
    <div className="main-settings">
      {/* Top encoder row – matches device Track FX layout */}
      <div className="ms-encoder-row">
        {state.encoderParams.map((param) => (
          <EncoderParam key={param.id} param={param} />
        ))}
      </div>

      {/* Centre content */}
      <div className="ms-center">
        <div className="ms-label-row">
          <span className="ms-dim-label">SONG</span>
        </div>
        <div className="ms-song-box">
          <span className="ms-song-name">{state.songName}</span>
        </div>
        <div className="ms-meta-row">
          <span className="ms-dim-label">BPM</span>
          <span className="ms-meta-value">{state.bpm}</span>
          <span className="ms-dim-label">&nbsp;·&nbsp;v{state.firmwareVersion}</span>
        </div>
      </div>
    </div>
  );
}
