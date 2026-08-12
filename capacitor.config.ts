import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.portai.app',
  appName: 'PortAI',
  webDir: 'dist',
  plugins: {
    // 关闭 Capacitor 8 的自动 insets 处理（Android 16 上它会裁剪 WebView 视口
    // 且把 insets 清零导致 env(safe-area-inset-*) 恒为 0），
    // 改由 MainActivity 原生注入 --native-inset-top/bottom 真实值
    SystemBars: {
      insetsHandling: 'disable',
    },
  },
};

export default config;
