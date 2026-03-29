/**
 * Main Settings Screen
 * Displays 8 encoder parameters with orange labels and green-bordered value boxes
 * Center: Song name in large pixel font
 * Bottom: Version info
 */

import { useDevice } from '../../../state/DeviceContext';
import { EncoderParam } from '../../shared/EncoderParam/EncoderParam';
import './MainSettings.css';

export function MainSettings() {
  const { state } = useDevice();

  return (
    <div className="main-settings">
      <div className="settings-encoder-row">
        {state.encoderParams.map((param) => (
          <EncoderParam key={param.id} param={param} />
        ))}
      </div>

      <div className="settings-center">
        <div className="song-name-box">
          <div className="song-name">{state.songName}</div>
        </div>
        <div className="version-info">Track8 Version: {state.firmwareVersion}</div>
      </div>
    </div>
  );
}