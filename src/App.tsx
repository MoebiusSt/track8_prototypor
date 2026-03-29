/**
 * Root App component with device frame and state provider
 */

import { DeviceProvider } from './state/DeviceContext';
import { DeviceFrame } from './components/DeviceFrame/DeviceFrame';
import { useKeyboardInput } from './hooks/useKeyboardInput';
import './app.css';

function AppContent() {
  useKeyboardInput();

  return <DeviceFrame />;
}

export function App() {
  return (
    <DeviceProvider>
      <AppContent />
    </DeviceProvider>
  );
}