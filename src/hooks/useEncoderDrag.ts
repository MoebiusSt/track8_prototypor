/**
 * Map pointer drag to encoder rotation (horizontal drag = turn)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type EncoderAxis = 'x' | 'y';

export interface EncoderDragOptions {
  onRotate: (delta: number) => void;
  /** Pixels moved before one reducer step is applied (higher = slower) */
  pixelsPerStep?: number;
  axis?: EncoderAxis;
}

export function useEncoderDrag({
  onRotate,
  pixelsPerStep = 4,
  axis = 'x',
}: EncoderDragOptions) {
  const [dragging, setDragging] = useState(false);
  const lastRef = useRef(0);
  const accRef = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      setDragging(true);
      lastRef.current = axis === 'x' ? e.clientX : e.clientY;
      accRef.current = 0;
    },
    [axis]
  );

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const cur = axis === 'x' ? e.clientX : e.clientY;
      const delta = cur - lastRef.current;
      lastRef.current = cur;
      accRef.current += delta;
      const steps = Math.trunc(accRef.current / pixelsPerStep);
      if (steps !== 0) {
        accRef.current -= steps * pixelsPerStep;
        onRotate(steps);
      }
    };

    const onUp = () => {
      setDragging(false);
      accRef.current = 0;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, axis, pixelsPerStep, onRotate]);

  return { onPointerDown, dragging };
}
