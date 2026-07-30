/**
 * 应用版本配置
 * 用于调试和版本追踪
 */

export const APP_VERSION = '0.1.1';

export function getVersionInfo() {
  return {
    version: APP_VERSION,
    buildTime: new Date().toISOString(),
  };
}
