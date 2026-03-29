/**
 * Device frame – the 1280×400 px LCD display
 * StatusBar lives at the bottom of this frame; FunctionBar is outside.
 */

import { useDevice } from '../../state/DeviceContext';
import { AudioOverview } from '../screens/AudioOverview/AudioOverview';
import { MainSettings } from '../screens/MainSettings/MainSettings';
import { Utility } from '../screens/Utility/Utility';
import { StatusBar } from '../shared/StatusBar/StatusBar';
import './DeviceFrame.css';

export function DeviceFrame() {
  const { state } = useDevice();

  const renderScreen = () => {
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
      <div className="screen-content">
        {renderScreen()}
      </div>
      <StatusBar />
    </div>
  );
}
