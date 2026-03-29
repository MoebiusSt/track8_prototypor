/**
 * State management types
 */

import type { DeviceState, ScreenId } from '../types/device';

export type DeviceAction =
  | { type: 'SWITCH_SCREEN'; payload: ScreenId }
  | { type: 'SET_POSITION'; payload: number }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'TOGGLE_RECORD' }
  | { type: 'TOGGLE_LOOP' }
  | { type: 'SET_LOOP_START' }
  | { type: 'SET_LOOP_END' }
  | { type: 'TOGGLE_TRACK_ARM'; payload: number }
  | { type: 'TOGGLE_TRACK_MUTE'; payload: number }
  | { type: 'TOGGLE_TRACK_SOLO'; payload: number }
  | { type: 'SET_BPM'; payload: number }
  | { type: 'SET_BRIGHTNESS'; payload: number }
  | { type: 'SET_SHIFT_HELD'; payload: boolean }
  | { type: 'TAP_TEMPO' }
  | { type: 'RESET' };

export const initialDeviceState: DeviceState = {
  currentScreen: 'audio',
  previousScreen: 'audio',
  songName: 'my-song',
  firmwareVersion: '1.1.2-beta2',
  storageUsed: 110.6,
  storageTotal: 124.6,
  brightness: 50,
  bpm: 135,
  shiftHeld: false,
  transport: {
    isPlaying: false,
    isRecording: false,
    isPaused: false,
    loopEnabled: false,
    loopStart: 0,
    loopEnd: 1,
    position: 0,
    barPosition: '09:01',
    timeDisplay: '00:18',
  },
  tracks: Array.from({ length: 8 }, (_, i) => ({
    id: i,
    name: `Audio ${i + 1}`,
    type: 'audio',
    armed: i === 0,
    muted: false,
    soloed: false,
    volume: 0,
    pan: 0,
    hasContent: i < 3,
  })),
  markers: [
    { id: '1', position: 0.1, label: 'Intro', locked: false },
    { id: '2', position: 0.35, label: 'Chorus', locked: false },
    { id: '3', position: 0.65, label: 'Verse1', locked: false },
  ],
  encoderParams: [
    { id: 0, label: 'BPM', value: '135', muted: false },
    { id: 1, label: 'MEASURE', value: '4 / 4', muted: false },
    { id: 2, label: 'METRONOME', value: 'REC / 70', muted: false },
    { id: 3, label: 'COUNT IN', value: '4', muted: false },
    { id: 4, label: 'OVERDUB', value: 'OFF', muted: false },
    { id: 5, label: 'RECORDING', value: 'A I I M', muted: false },
    { id: 6, label: 'FOOTSWITCH', value: 'PLAY', muted: false },
    { id: 7, label: 'MONITOR', value: 'ON', muted: false },
  ],
};