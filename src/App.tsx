/**
 * Root App component with device frame and state provider
 */

import { DeviceProvider } from './state/DeviceContext';
import { DeviceFrame } from './components/DeviceFrame/DeviceFrame';
import { SimulationPanel } from './components/SimulationPanel/SimulationPanel';
import { useKeyboardInput } from './hooks/useKeyboardInput';
import './app.css';

function AppContent() {
  useKeyboardInput();

  return (
    <div className="app-shell">
      <DeviceFrame />
      <SimulationPanel />
    </div>
  );
}

export function App() {
  return (
    <DeviceProvider>
      <AppContent />
    </DeviceProvider>
  );
}