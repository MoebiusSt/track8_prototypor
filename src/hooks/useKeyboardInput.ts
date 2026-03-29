/**
 * Custom hook for keyboard input mapping to device actions
 * Maps numpad keys to Track8 device controls
 */

import { useEffect } from 'react';
import { useDevice } from '../state/DeviceContext';

export function useKeyboardInput() {
  const { dispatch } = useDevice();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const code = event.code;

      if (code === 'Numpad0') {
        event.preventDefault();
        dispatch({ type: 'SET_SHIFT_HELD', payload: true });
        return;
      }

      switch (code) {
        case 'NumpadDecimal':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_PLAY' });
          break;
        case 'ArrowLeft':
          event.preventDefault();
          dispatch({ type: 'SWITCH_SCREEN', payload: 'audio' });
          break;
        case 'ArrowRight':
          event.preventDefault();
          dispatch({ type: 'SWITCH_SCREEN', payload: 'settings' });
          break;
        case 'Numpad1':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_LOOP' });
          break;
        case 'Numpad2':
          event.preventDefault();
          dispatch({ type: 'SET_LOOP_START' });
          break;
        case 'Numpad3':
          event.preventDefault();
          dispatch({ type: 'SET_LOOP_END' });
          break;
        case 'NumpadEnter':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_RECORD' });
          break;
        case 'Digit1':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_TRACK_ARM', payload: 0 });
          break;
        case 'Digit2':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_TRACK_ARM', payload: 1 });
          break;
        case 'Digit3':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_TRACK_ARM', payload: 2 });
          break;
        case 'Digit4':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_TRACK_ARM', payload: 3 });
          break;
        case 'Digit5':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_TRACK_ARM', payload: 4 });
          break;
        case 'Digit6':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_TRACK_ARM', payload: 5 });
          break;
        case 'Digit7':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_TRACK_ARM', payload: 6 });
          break;
        case 'Digit8':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_TRACK_ARM', payload: 7 });
          break;
        case 'F1':
        case 'F2':
        case 'F3':
        case 'F4':
        case 'F5':
        case 'F6':
        case 'F7':
        case 'F8':
          event.preventDefault();
          break;
        default:
          break;
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      const code = event.code;

      if (code === 'Numpad0') {
        event.preventDefault();
        dispatch({ type: 'SET_SHIFT_HELD', payload: false });
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [dispatch]);
}