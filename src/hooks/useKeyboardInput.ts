/**
 * Keyboard mapping from desktop keys to Track8 hardware actions
 *
 * Numpad layout (matches on-screen KeyboardPanel):
 *   Num7  Num8  Num9      — (unused)
 *   Num4  Num5  Num6      LOOP / LOOP START / LOOP END
 *   Num1  Num2  Num3  ENTER   — / — / — / RECORD
 *   Num0    .              SHIFT / PLAY
 *
 * Arrow keys:  ←  Audio view   →  Settings screen
 * F1–F8:  Encoder press 1–8
 * 1–8:    Track arm toggle
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

      // ── SHIFT (hold) ─────────────────────────────────────────────
      if (code === 'Numpad0') {
        event.preventDefault();
        dispatch({ type: 'SET_SHIFT_HELD', payload: true });
        return;
      }

      // ── PLAY ─────────────────────────────────────────────────────
      if (code === 'NumpadDecimal' || code === 'Comma') {
        event.preventDefault();
        dispatch({ type: 'TOGGLE_PLAY' });
        return;
      }

      // ── Screen navigation ─────────────────────────────────────────
      if (code === 'ArrowLeft') {
        event.preventDefault();
        dispatch({ type: 'SWITCH_SCREEN', payload: 'audio' });
        return;
      }

      if (code === 'ArrowRight') {
        event.preventDefault();
        dispatch({ type: 'SWITCH_SCREEN', payload: 'settings' });
        return;
      }

      // ── F-keys → encoder press ────────────────────────────────────
      const fk = F_KEYS.indexOf(code as (typeof F_KEYS)[number]);
      if (fk !== -1) {
        event.preventDefault();
        dispatch({ type: 'ENCODER_PRESS', payload: fk });
        return;
      }

      switch (code) {
        // ── Loop controls (middle numpad row) ──────────────────────
        case 'Numpad4':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_LOOP' });
          break;
        case 'Numpad5':
          event.preventDefault();
          dispatch({ type: 'SET_LOOP_START' });
          break;
        case 'Numpad6':
          event.preventDefault();
          dispatch({ type: 'SET_LOOP_END' });
          break;

        // ── Record ────────────────────────────────────────────────
        case 'NumpadEnter':
          event.preventDefault();
          dispatch({ type: 'TOGGLE_RECORD' });
          break;

        // ── Track arm (digit row 1–8) ──────────────────────────────
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
