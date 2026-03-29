/**
 * Encoder parameter display with label, value box, and draggable knob (settings screen)
 */

import { useCallback } from 'react';
import type { EncoderParam as EncoderParamType } from '../../../types/device';
import { useDevice } from '../../../state/DeviceContext';
import { useEncoderDrag } from '../../../hooks/useEncoderDrag';
import './EncoderParam.css';

interface EncoderParamProps {
  param: EncoderParamType;
}

export function EncoderParam({ param }: EncoderParamProps) {
  const { dispatch } = useDevice();

  const onRotate = useCallback(
    (delta: number) => {
      dispatch({ type: 'ENCODER_ROTATE', payload: { index: param.id, delta } });
    },
    [dispatch, param.id]
  );

  const { onPointerDown, dragging } = useEncoderDrag({ onRotate, pixelsPerStep: 3 });

  return (
    <div className="encoder-param">
      <div
        className={`encoder-knob ${dragging ? 'encoder-knob--dragging' : ''}`}
        onPointerDown={onPointerDown}
        title="Drag horizontally to rotate"
        role="slider"
        aria-valuetext={param.value}
        aria-label={param.label}
      >
        <span className="encoder-knob__tick" />
      </div>
      <div className="encoder-label">{param.label}</div>
      <div className="encoder-value-box">{param.value}</div>
    </div>
  );
}
