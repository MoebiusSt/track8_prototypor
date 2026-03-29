/**
 * Device state types for Track8 UI simulator
 */

export type ScreenId = 'audio' | 'midi' | 'settings' | 'utility' | 'tape' | 'marker-naming';

export interface Marker {
  id: string;
  position: number;
  label: string;
  locked: boolean;
}

export interface Track {
  id: number;
  name: string;
  type: 'audio' | 'midi';
  armed: boolean;
  muted: boolean;
  soloed: boolean;
  volume: number;
  pan: number;
  hasContent: boolean;
}

export interface TransportState {
  isPlaying: boolean;
  isRecording: boolean;
  isPaused: boolean;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  position: number;
  barPosition: string;
  timeDisplay: string;
}

export interface EncoderParam {
  id: number;
  label: string;
  value: string;
  muted: boolean;
}

export interface DeviceState {
  currentScreen: ScreenId;
  previousScreen: ScreenId;
  tracks: Track[];
  markers: Marker[];
  transport: TransportState;
  encoderParams: EncoderParam[];
  songName: string;
  firmwareVersion: string;
  storageUsed: number;
  storageTotal: number;
  brightness: number;
  bpm: number;
  shiftHeld: boolean;
}

export interface DisplayDimensions {
  width: number;
  height: number;
}