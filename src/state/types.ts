/**
 * State management types and initial device state
 */

import type { DeviceState, ScreenId } from '../types/device';

export type DeviceAction =
  | { type: 'SWITCH_SCREEN'; payload: ScreenId }
  | { type: 'SET_POSITION'; payload: number }
  | { type: 'ADJUST_POSITION'; payload: number }
  | { type: 'SELECT_TRACK'; payload: number }
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
  | { type: 'ENCODER_ROTATE'; payload: { index: number; delta: number } }
  | { type: 'ENCODER_PRESS'; payload: number }
  | { type: 'TAP_TEMPO' }
  | { type: 'RESET' };

export const initialDeviceState: DeviceState = {
  currentScreen: 'audio',
  previousScreen: 'audio',
  selectedTrackIndex: 0,
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
  tracks: [
    // Track 1: white – normal audio with content
    { id: 0, name: 'Audio 1', type: 'audio', armed: false, muted: false, soloed: false, volume: 0, pan: 0, hasContent: true },
    // Track 2: green – soloed/selected
    { id: 1, name: 'Audio 2', type: 'audio', armed: false, muted: false, soloed: true,  volume: 0, pan: 0, hasContent: true },
    // Track 3: red – armed for recording
    { id: 2, name: 'Audio 3', type: 'audio', armed: true,  muted: false, soloed: false, volume: 0, pan: 0, hasContent: true },
    // Track 4: muted gray with content
    { id: 3, name: 'Audio 4', type: 'audio', armed: false, muted: true,  soloed: false, volume: 0, pan: 0, hasContent: true },
    // Track 5: dark green – muted + soloed (muted-selected)
    { id: 4, name: 'Audio 5', type: 'audio', armed: false, muted: true,  soloed: true,  volume: 0, pan: 0, hasContent: true },
    // Tracks 6-8: empty
    { id: 5, name: 'Audio 6', type: 'audio', armed: false, muted: false, soloed: false, volume: 0, pan: 0, hasContent: false },
    { id: 6, name: 'Audio 7', type: 'audio', armed: false, muted: false, soloed: false, volume: 0, pan: 0, hasContent: false },
    { id: 7, name: 'Audio 8', type: 'audio', armed: false, muted: false, soloed: false, volume: 0, pan: 0, hasContent: false },
  ],
  markers: [
    { id: '1', position: 0.10, label: 'Intro',  locked: false },
    { id: '2', position: 0.35, label: 'Chorus', locked: false },
    { id: '3', position: 0.65, label: 'Verse1', locked: false },
  ],
  encoderParams: [
    { id: 0, label: 'BPM',        value: '135',      muted: false },
    { id: 1, label: 'MEASURE',    value: '4 / 4',    muted: false },
    { id: 2, label: 'METRONOME',  value: 'REC / 70', muted: false },
    { id: 3, label: 'COUNT IN',   value: '4',        muted: false },
    { id: 4, label: 'OVERDUB',    value: 'OFF',      muted: false },
    { id: 5, label: 'RECORDING',  value: 'A I I M',  muted: false },
    { id: 6, label: 'FOOTSWITCH', value: 'PLAY',     muted: false },
    { id: 7, label: 'MONITOR',    value: 'ON',       muted: false },
  ],
};
