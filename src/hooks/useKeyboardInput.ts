/**
 * Keyboard mapping from desktop keys to Track8 hardware actions
 */

import { useEffect } from 'react';
import { useDevice } from '../state/DeviceContext';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

const F_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'] as const;

export function useKeyboardInput() {
  const { dispatch } = useDevice();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || isEditableTarget(event.target)) return;

      const code = event.code;

      if (code === 'Numpad0') {
        event.preventDefault();
        dispatch({ type: 'SET_SHIFT_HELD', payload: true });
        return;
      }

      if (code === 'NumpadDecimal' || code === 'Comma') {
        event.preventDefault();
        dispatch({ type: 'TOGGLE_PLAY' });
        return;
      }

      if (code === 'ArrowLeft') {
        event.preventDefault();
        dispatch({ type: 'ADJUST_POSITION', payload: -1.2 });
        return;
      }

      if (code === 'ArrowRight') {
        event.preventDefault();
        dispatch({ type: 'ADJUST_POSITION', payload: 1.2 });
        return;
      }

      const fk = F_KEYS.indexOf(code as (typeof F_KEYS)[number]);
      if (fk !== -1) {
        event.preventDefault();
        dispatch({ type: 'ENCODER_PRESS', payload: fk });
        return;
      }

      switch (code) {
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
        default:
          break;
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (event.code === 'Numpad0') {
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
