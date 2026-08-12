// 平台能力检测：设备形态判定供桌面/移动布局分发使用。
// 平台识别（iOS/Android/独立窗口）复用 src/utils/pwa.ts 的 detectPlatform/isStandalone，此处不重复实现。
import { Capacitor } from '@capacitor/core';

/** 是否运行在 Electron 外壳内（window.electronAPI 由 preload 暴露） */
export function isElectron(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as unknown as { electronAPI?: unknown }).electronAPI === 'object';
}

/** 是否运行在 Capacitor 原生壳内（Android APK / 将来的 iOS IPA） */
export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  return Capacitor.isNativePlatform();
}

/** 是否运行在 Android 原生壳内 */
export function isNativeAndroid(): boolean {
  return isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/** 是否有触摸主输入（触摸屏手机/平板/触摸笔记本） */
export function hasTouch(): boolean {
  return navigator.maxTouchPoints > 1 ||
    window.matchMedia('(pointer: coarse)').matches;
}

/** 设备形态（Web/Electron 共用） */
export type DeviceMode = 'mobile' | 'desktop';

/** 设备形态判定规则：
 *  桌面 = PC 类设备（Electron 外壳 或 主指针为精确指针鼠标/触控板），与窗口宽度无关；
 *  触摸设备（手机/平板）按宽度断点区分：视口 ≥1024 判为 desktop，否则 mobile；
 *  兜底：任何设备窗口过窄（<480）都判为 mobile，防止桌面布局被极端窄窗口挤坏；
 *  原生 Android（含大屏平板/折叠屏横屏）永远移动布局，大屏适配后续单独评估 */
export function detectDeviceMode(): DeviceMode {
  if (typeof window === 'undefined') return 'desktop';
  if (isNativeAndroid()) return 'mobile';
  const w = window.innerWidth;
  if (w < 480) return 'mobile';
  if (isElectron() || window.matchMedia('(pointer: fine)').matches) return 'desktop';
  return w >= 1024 ? 'desktop' : 'mobile';
}
