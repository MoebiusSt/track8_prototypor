/**
 * Utility Screen
 * Shows brightness control and large centered UTILITY title
 */

import { useDevice } from '../../../state/DeviceContext';
import './Utility.css';

export function Utility() {
  const { state } = useDevice();

  return (
    <div className="utility-screen">
      <div className="utility-top-right">
        <div className="brightness-label">BRIGHTNESS</div>
        <div className="brightness-value">{state.brightness}%</div>
      </div>

      <div className="utility-center">
        <div className="utility-title-box">
          <div className="utility-title">UTILITY</div>
        </div>
      </div>

      <div className="utility-placeholder">
        {/* Bottom function bar labels are shown in FunctionBar component */}
      </div>
    </div>
  );
}