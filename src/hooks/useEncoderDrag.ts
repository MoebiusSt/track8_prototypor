/**
 * Custom hook for mouse drag to encoder rotation mapping
 */

import { useRef, useCallback } from 'react';

export interface EncoderDragOptions {
  onRotate: (delta: number) => void;
  sensitivity?: number;
}

export function useEncoderDrag({ onRotate, sensitivity = 2 }: EncoderDragOptions) {
  const isDraggingRef = useRef(false);
  const lastYRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    lastYRef.current = e.clientY;
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const delta = lastYRef.current - e.clientY;
      const rotation = delta * sensitivity;

      if (rotation !== 0) {
        onRotate(rotation);
      }

      lastYRef.current = e.clientY;
    },
    [onRotate, sensitivity]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const setupListeners = useCallback(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return { handleMouseDown, setupListeners };
}