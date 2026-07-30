/**
 * 应用版本配置
 * 用于调试和版本追踪
 *
 * 版本号由 Vite 在构建时从 package.json 注入（见 vite.config.ts 的 define），
 * 单一来源，改 package.json 即可，无需在此手动同步。
 */

export const APP_VERSION = __APP_VERSION__;

export function getVersionInfo() {
  return {
    version: APP_VERSION,
    buildTime: new Date().toISOString(),
  };
}
