/**
 * State machine reducer for Track8 device state
 */

import type { DeviceState } from '../types/device';
import type { DeviceAction } from './types';
import { initialDeviceState } from './types';

export function deviceReducer(state: DeviceState, action: DeviceAction): DeviceState {
  switch (action.type) {
    case 'SWITCH_SCREEN':
      return {
        ...state,
        previousScreen: state.currentScreen,
        currentScreen: action.payload,
      };

    case 'SET_POSITION': {
      const newPosition = Math.max(0, Math.min(action.payload, 100));
      const barPosition = String(Math.floor(newPosition / 4)).padStart(2, '0') + ':' +
                         String(Math.floor((newPosition % 4) * 4)).padStart(2, '0');
      const timeDisplay = String(Math.floor(newPosition * 0.3)).padStart(2, '0') + ':' +
                         String(Math.floor((newPosition * 0.3 % 1) * 60)).padStart(2, '0');
      return {
        ...state,
        transport: {
          ...state.transport,
          position: newPosition,
          barPosition,
          timeDisplay,
        },
      };
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
      return { ...state, tracks: newTracks };
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

    case 'SET_BPM':
      return {
        ...state,
        bpm: Math.max(30, Math.min(action.payload, 300)),
      };

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

    case 'TAP_TEMPO':
      return state;

    case 'RESET':
      return initialDeviceState;

    default:
      return state;
  }
}