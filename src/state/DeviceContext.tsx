/**
 * React Context provider for Track8 device state management
 */

import { createContext, useContext, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { DeviceState } from '../types/device';
import type { DeviceAction } from './types';
import { initialDeviceState } from './types';
import { deviceReducer } from './deviceReducer';

interface DeviceContextType {
  state: DeviceState;
  dispatch: (action: DeviceAction) => void;
}

const DeviceContext = createContext<DeviceContextType | undefined>(undefined);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(deviceReducer, initialDeviceState);

  return (
    <DeviceContext.Provider value={{ state, dispatch }}>
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevice() {
  const context = useContext(DeviceContext);
  if (!context) {
    throw new Error('useDevice must be used within a DeviceProvider');
  }
  return context;
}