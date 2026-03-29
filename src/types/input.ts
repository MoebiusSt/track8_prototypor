/**
 * Input mapping types for keyboard and mouse interactions
 */

export type InputAction =
  | 'PLAY'
  | 'STOP'
  | 'RECORD'
  | 'ENCODER_TURN'
  | 'ENCODER_PUSH'
  | 'SCREEN_NEXT'
  | 'SCREEN_PREV'
  | 'FUNCTION_KEY';

export interface KeyboardBinding {
  key: string;
  action: InputAction;
  payload?: unknown;
}

export interface EncoderInput {
  encoderId: number;
  rotation: number; // positive = clockwise, negative = counter-clockwise
  pushed: boolean;
}