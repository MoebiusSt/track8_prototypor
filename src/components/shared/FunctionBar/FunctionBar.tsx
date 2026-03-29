/**
 * Function bar showing F1-F8 labels for encoder/function keys
 * Labels are context-dependent per screen
 */

import { useDevice } from '../../../state/DeviceContext';
import './FunctionBar.css';

export const FUNCTION_LABELS: Record<string, string[]> = {
  audio: [
    'TAP TEMPO',
    'UTILITY',
    '',
    '',
    'REDO AUDIO',
    'REDO MIDI',
    'TRK NAMES',
    'BROWSE',
  ],
  settings: [
    'TAP TEMPO',
    'UTILITY',
    '',
    '',
    'REDO AUDIO',
    'REDO MIDI',
    'TRK NAMES',
    'BROWSE',
  ],
  utility: [
    'EXIT',
    'TUNER',
    'THRESHOLD',
    'MIDI SYNC',
    'TAPE',
    '',
    '',
    'DEBUG',
  ],
};

export function FunctionBar() {
  const { state } = useDevice();
  const labels = FUNCTION_LABELS[state.currentScreen] || FUNCTION_LABELS.audio;

  return (
    <div className="function-bar">
      {labels.map((label, i) => (
        <div key={i} className="function-slot">
          {label && <div className="function-label">{label}</div>}
        </div>
      ))}
    </div>
  );
}
