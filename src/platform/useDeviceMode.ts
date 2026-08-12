import { useSyncExternalStore } from 'react';
import { detectDeviceMode, type DeviceMode } from './capabilities';

function subscribe(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  window.addEventListener('orientationchange', cb);
  return () => {
    window.removeEventListener('resize', cb);
    window.removeEventListener('orientationchange', cb);
  };
}

function getSnapshot(): DeviceMode {
  return detectDeviceMode();
}

/** 实时设备形态；窗口跨越断点时自动切换 */
export function useDeviceMode(): DeviceMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'desktop');
}
