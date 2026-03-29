/**
 * Encoder parameter display with label and value box
 * Shows: orange label on top, green-bordered box with white value
 */

import type { EncoderParam as EncoderParamType } from '../../../types/device';
import './EncoderParam.css';

interface EncoderParamProps {
  param: EncoderParamType;
}

export function EncoderParam({ param }: EncoderParamProps) {
  return (
    <div className="encoder-param">
      <div className="encoder-label">{param.label}</div>
      <div className="encoder-value-box">
        {param.value}
      </div>
    </div>
  );
}