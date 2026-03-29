/**
 * Root App component – device frame + function bar + keyboard panel
 */

import { DeviceProvider } from './state/DeviceContext';
import { DeviceFrame } from './components/DeviceFrame/DeviceFrame';
import { FunctionBar } from './components/shared/FunctionBar/FunctionBar';
import { KeyboardPanel } from './components/KeyboardPanel/KeyboardPanel';
import { useKeyboardInput } from './hooks/useKeyboardInput';
import './app.css';

function AppContent() {
  useKeyboardInput();

  return (
    <div className="app-shell">
      {/* The 1280×400 px device screen */}
      <DeviceFrame />
      {/* F1-F8 encoder labels – below the screen, like physical device labels */}
      <FunctionBar />
      {/* On-screen keyboard reference panel */}
      <KeyboardPanel />
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
