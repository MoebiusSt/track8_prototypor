/**
 * Main device frame container displaying the 1280x404 display
 */

import { useDevice } from '../../state/DeviceContext';
import { AudioOverview } from '../screens/AudioOverview/AudioOverview';
import { MainSettings } from '../screens/MainSettings/MainSettings';
import { Utility } from '../screens/Utility/Utility';
import { StatusBar } from '../shared/StatusBar/StatusBar';
import { FunctionBar } from '../shared/FunctionBar/FunctionBar';
import './DeviceFrame.css';

export function DeviceFrame() {
  const { state } = useDevice();

  const getScreenComponent = () => {
    switch (state.currentScreen) {
      case 'audio':
        return <AudioOverview />;
      case 'settings':
        return <MainSettings />;
      case 'utility':
        return <Utility />;
      default:
        return <AudioOverview />;
    }
  };

  return (
    <div className="device-frame">
      <div className="screen-container">
        <div className="screen-content">
          {getScreenComponent()}
        </div>
      </div>

      <div className="status-footer">
        <StatusBar />
        <div className="function-footer">
          <FunctionBar />
        </div>
      </div>
    </div>
  );
}