/**
 * State machine reducer for Track8 device state
 */

import type { DeviceState, TransportState } from '../types/device';
import type { DeviceAction } from './types';
import { initialDeviceState } from './types';

function applyTransportPosition(transport: TransportState, position: number): TransportState {
  const newPosition = Math.max(0, Math.min(position, 100));
  const barPosition =
    String(Math.floor(newPosition / 4)).padStart(2, '0') +
    ':' +
    String(Math.floor((newPosition % 4) * 4)).padStart(2, '0');
  const timeDisplay =
    String(Math.floor(newPosition * 0.3)).padStart(2, '0') +
    ':' +
    String(Math.floor((newPosition * 0.3 % 1) * 60)).padStart(2, '0');
  return {
    ...transport,
    position: newPosition,
    barPosition,
    timeDisplay,
  };
}

function applyTapTempo(state: DeviceState): DeviceState {
  const newBpm = Math.min(300, state.bpm + 1);
  const encoderParams = [...state.encoderParams];
  if (encoderParams[0]) {
    encoderParams[0] = { ...encoderParams[0], value: String(newBpm) };
  }
  return { ...state, bpm: newBpm, encoderParams };
}

function applyEncoderPress(state: DeviceState, keyIndex: number): DeviceState {
  if (keyIndex < 0 || keyIndex > 7) return state;

  if (state.currentScreen === 'utility') {
    if (keyIndex === 0) {
      const back: DeviceState['currentScreen'] =
        state.previousScreen !== 'utility' ? state.previousScreen : 'audio';
      return { ...state, currentScreen: back, previousScreen: 'utility' };
    }
    return state;
  }

  if (keyIndex === 0) {
    return applyTapTempo(state);
  }

  if (keyIndex === 1) {
    return {
      ...state,
      previousScreen: state.currentScreen,
      currentScreen: 'utility',
    };
  }

  return state;
}

function applyEncoderRotate(state: DeviceState, index: number, delta: number): DeviceState {
  const steps = Math.max(-12, Math.min(12, Math.round(delta)));
  if (steps === 0) return state;

  if (state.currentScreen === 'utility' && index === 0) {
    return {
      ...state,
      brightness: Math.max(0, Math.min(100, state.brightness + steps)),
    };
  }

  if (index === 0) {
    const newBpm = Math.max(30, Math.min(300, state.bpm + steps));
    const encoderParams = [...state.encoderParams];
    if (encoderParams[0]) {
      encoderParams[0] = { ...encoderParams[0], value: String(newBpm) };
    }
    return { ...state, bpm: newBpm, encoderParams };
  }

  if (state.currentScreen !== 'settings') {
    return state;
  }

  const encoderParams = [...state.encoderParams];
  if (!encoderParams[index]) return state;

  if (index === 1) {
    const measures = ['4 / 4', '3 / 4', '6 / 8'];
    const cur = measures.indexOf(encoderParams[1].value);
    const start = cur < 0 ? 0 : cur;
    const nextIdx = (start + (steps > 0 ? 1 : -1) + measures.length * 4) % measures.length;
    encoderParams[1] = { ...encoderParams[1], value: measures[nextIdx] };
    return { ...state, encoderParams };
  }

  if (index === 2) {
    const modes = ['REC / 70', 'OFF / 70', 'ON / 100'];
    const cur = modes.indexOf(encoderParams[2].value);
    const start = cur < 0 ? 0 : cur;
    const nextIdx = (start + (steps > 0 ? 1 : -1) + modes.length * 4) % modes.length;
    encoderParams[2] = { ...encoderParams[2], value: modes[nextIdx] };
    return { ...state, encoderParams };
  }

  return state;
}

export function deviceReducer(state: DeviceState, action: DeviceAction): DeviceState {
  switch (action.type) {
    case 'SWITCH_SCREEN':
      return {
        ...state,
        previousScreen: state.currentScreen,
        currentScreen: action.payload,
      };

    case 'SET_POSITION':
      return {
        ...state,
        transport: applyTransportPosition(state.transport, action.payload),
      };

    case 'ADJUST_POSITION':
      return {
        ...state,
        transport: applyTransportPosition(
          state.transport,
          state.transport.position + action.payload
        ),
      };

    case 'SELECT_TRACK': {
      const i = Math.max(0, Math.min(7, action.payload));
      return { ...state, selectedTrackIndex: i };
    }

    case 'TOGGLE_PLAY':
      return {
        ...state,
        transport: {
          ...state.transport,
          isPlaying: !state.transport.isPlaying,
          isRecording: !state.transport.isPlaying ? state.transport.isRecording : false,
        },
      };

    case 'TOGGLE_RECORD':
      return {
        ...state,
        transport: {
          ...state.transport,
          isRecording: !state.transport.isRecording,
          isPlaying: !state.transport.isRecording ? true : state.transport.isPlaying,
        },
      };

    case 'TOGGLE_LOOP':
      return {
        ...state,
        transport: {
          ...state.transport,
          loopEnabled: !state.transport.loopEnabled,
        },
      };

    case 'SET_LOOP_START':
      return {
        ...state,
        transport: {
          ...state.transport,
          loopStart: state.transport.position,
        },
      };

    case 'SET_LOOP_END':
      return {
        ...state,
        transport: {
          ...state.transport,
          loopEnd: state.transport.position,
        },
      };

    case 'TOGGLE_TRACK_ARM': {
      const trackIndex = action.payload;
      const newTracks = [...state.tracks];
      if (newTracks[trackIndex]) {
        newTracks[trackIndex].armed = !newTracks[trackIndex].armed;
      }
      return { ...state, tracks: newTracks, selectedTrackIndex: trackIndex };
    }

    case 'TOGGLE_TRACK_MUTE': {
      const trackIndex = action.payload;
      const newTracks = [...state.tracks];
      if (newTracks[trackIndex]) {
        newTracks[trackIndex].muted = !newTracks[trackIndex].muted;
      }
      return { ...state, tracks: newTracks };
    }

    case 'TOGGLE_TRACK_SOLO': {
      const trackIndex = action.payload;
      const newTracks = [...state.tracks];
      if (newTracks[trackIndex]) {
        newTracks[trackIndex].soloed = !newTracks[trackIndex].soloed;
      }
      return { ...state, tracks: newTracks };
    }

    case 'SET_BPM': {
      const bpm = Math.max(30, Math.min(action.payload, 300));
      const encoderParams = [...state.encoderParams];
      if (encoderParams[0]) {
        encoderParams[0] = { ...encoderParams[0], value: String(bpm) };
      }
      return { ...state, bpm, encoderParams };
    }

    case 'SET_BRIGHTNESS':
      return {
        ...state,
        brightness: Math.max(0, Math.min(action.payload, 100)),
      };

    case 'SET_SHIFT_HELD':
      return {
        ...state,
        shiftHeld: action.payload,
      };

    case 'ENCODER_PRESS':
      return applyEncoderPress(state, action.payload);

    case 'ENCODER_ROTATE':
      return applyEncoderRotate(state, action.payload.index, action.payload.delta);

    case 'TAP_TEMPO':
      return applyTapTempo(state);

    case 'RESET':
      return initialDeviceState;

    default:
      return state;
  }
}
