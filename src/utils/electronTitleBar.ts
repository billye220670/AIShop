import { loadTheme, loadMode, type ColorMode } from '../services/storage';

/**
 * Electron 窗口标题栏 overlay 颜色映射（紫/绿 × 亮/暗），与 meta-theme-color 逻辑保持一致。
 * 亮色模式必须同步改 overlay 颜色，否则原生窗口按钮在浅色背景下不可见。
 */
const TITLEBAR_COLORS = {
  purple: {
    dark: { bg: '#0d0a1a', symbol: '#ffffff' },
    light: { bg: '#f5f5f7', symbol: '#1a1a1a' },
  },
  green: {
    dark: { bg: '#121211', symbol: '#e0e0e0' },
    light: { bg: '#f5f5f7', symbol: '#1a1a1a' },
  },
} as const;

/** 把当前主题/模式同步到 Electron 窗口标题栏（Web 下 electronAPI 不存在，天然 no-op） */
export function syncElectronTitleBar(theme?: string, mode?: ColorMode): void {
  const api = window.electronAPI;
  if (!api?.updateTitleBarColor) return;
  const t = (theme ?? loadTheme()) as 'purple' | 'green';
  const m = (mode ?? loadMode()) as 'light' | 'dark';
  const colors = TITLEBAR_COLORS[t]?.[m] ?? TITLEBAR_COLORS.green.dark;
  void api.updateTitleBarColor(colors.bg, colors.symbol);
}
