/**
 * On-screen hardware simulation: transport, track keys, encoders (drag + F1–F8 press)
 */

import { useCallback } from 'react';
import { useDevice } from '../../state/DeviceContext';
import { FUNCTION_LABELS } from '../shared/FunctionBar/FunctionBar';
import { useEncoderDrag } from '../../hooks/useEncoderDrag';
import { PixelButton } from '../shared/PixelButton/PixelButton';
import './SimulationPanel.css';

function SimEncoderColumn({
  index,
  functionLabel,
}: {
  index: number;
  functionLabel: string;
}) {
  const { dispatch } = useDevice();
  const onRotate = useCallback(
    (delta: number) => {
      dispatch({ type: 'ENCODER_ROTATE', payload: { index, delta } });
    },
    [dispatch, index]
  );
  const { onPointerDown, dragging } = useEncoderDrag({ onRotate, pixelsPerStep: 3 });

  const onPress = () => {
    dispatch({ type: 'ENCODER_PRESS', payload: index });
  };

  return (
    <div className="sim-encoder-column">
      <div
        className={`sim-encoder-knob ${dragging ? 'sim-encoder-knob--drag' : ''}`}
        onPointerDown={onPointerDown}
        title="Drag horizontally to rotate"
      >
        <span className="sim-encoder-knob__tick" />
      </div>
      <PixelButton type="button" className="sim-f-key" onClick={onPress} title={`Encoder ${index + 1} push (F${index + 1})`}>
        F{index + 1}
      </PixelButton>
      {functionLabel ? (
        <div className="sim-f-label">{functionLabel}</div>
      ) : (
        <div className="sim-f-label sim-f-label--empty"> </div>
      )}
    </div>
  );
}

export function SimulationPanel() {
  const { state, dispatch } = useDevice();
  const labels = FUNCTION_LABELS[state.currentScreen] || FUNCTION_LABELS.audio;

  return (
    <aside className="simulation-panel" aria-label="Track8 hardware simulation">
      <div className="simulation-panel__header">Hardware simulation</div>

      <div className="sim-row sim-row--transport">
        <PixelButton
          type="button"
          variant={state.shiftHeld ? 'primary' : 'default'}
          onPointerDown={() => dispatch({ type: 'SET_SHIFT_HELD', payload: true })}
          onPointerUp={() => dispatch({ type: 'SET_SHIFT_HELD', payload: false })}
          onPointerLeave={() => dispatch({ type: 'SET_SHIFT_HELD', payload: false })}
        >
          SHIFT
        </PixelButton>
        <PixelButton type="button" onClick={() => dispatch({ type: 'TOGGLE_PLAY' })}>
          PLAY
        </PixelButton>
        <PixelButton type="button" onClick={() => dispatch({ type: 'TOGGLE_LOOP' })}>
          LOOP
        </PixelButton>
        <PixelButton type="button" onClick={() => dispatch({ type: 'SET_LOOP_START' })}>
          L START
        </PixelButton>
        <PixelButton type="button" onClick={() => dispatch({ type: 'SET_LOOP_END' })}>
          L END
        </PixelButton>
        <PixelButton type="button" className="sim-rec" onClick={() => dispatch({ type: 'TOGGLE_RECORD' })}>
          REC
        </PixelButton>
        <PixelButton type="button" onClick={() => dispatch({ type: 'ADJUST_POSITION', payload: -1.2 })}>
          LEFT
        </PixelButton>
        <PixelButton type="button" onClick={() => dispatch({ type: 'ADJUST_POSITION', payload: 1.2 })}>
          RIGHT
        </PixelButton>
      </div>

      <div className="sim-row sim-row--tracks">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <PixelButton
            key={i}
            type="button"
            onClick={() => dispatch({ type: 'TOGGLE_TRACK_ARM', payload: i })}
            variant={state.tracks[i]?.armed ? 'primary' : 'default'}
          >
            {i + 1}
          </PixelButton>
        ))}
      </div>

      <div className="sim-encoders-wrap">
        {labels.map((label, i) => (
          <SimEncoderColumn key={i} index={i} functionLabel={label} />
        ))}
      </div>

      <div className="simulation-panel__hint">
        Keys: Num0 SHIFT · Num. / comma PLAY · Num1 LOOP · Num2 L start · Num3 L end · NumEnter REC · Arrows L/R · 1–8 tracks ·
        F1–F8 encoder press
      </div>
    </aside>
  );
}
