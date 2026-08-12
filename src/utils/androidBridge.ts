/**
 * 与 Android 原生层的轻量桥调用（同步通道，无 @capacitor 依赖）。
 * AndroidInputState 由 MainActivity 注入，仅安卓壳存在；其他平台静默跳过。
 */

/**
 * 通知原生层当前聚焦输入框的类型（用于密码框长按菜单分流，见 MainActivity）。
 * 输入框 type 变化不一定走 focus 事件（如明文/密文切换），切换处也要主动调用。
 */
export function syncFocusedInputType(el: HTMLElement | null): void {
  const bridge = (window as unknown as {
    AndroidInputState?: { setFocusedInputType?: (type: string | null) => void };
  }).AndroidInputState;
  if (!bridge?.setFocusedInputType) return;
  bridge.setFocusedInputType(el instanceof HTMLInputElement ? el.type : null);
}

/**
 * 读取剪贴板文本。Android 壳优先走原生桥（WebView 的 Clipboard read API 需要
 * clipboard-read 权限且在不同设备/WebView 版本上不稳定，实测 NotAllowedError），
 * 其余平台回退 navigator.clipboard.readText()。
 */
export function readClipboardText(): Promise<string> {
  const bridge = (window as unknown as {
    AndroidClipboard?: { readText?: (callback: string) => void };
  }).AndroidClipboard;

  if (bridge?.readText) {
    return new Promise<string>((resolve, reject) => {
      const name = `__clipboardRead_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const w = window as unknown as Record<string, unknown>;
      let timer: ReturnType<typeof setTimeout>;
      const handler = (text: string) => {
        clearTimeout(timer);
        delete w[name];
        resolve(text);
      };
      w[name] = handler;
      timer = setTimeout(() => {
        delete w[name];
        reject(new Error('clipboard read timeout'));
      }, 2000);
      bridge.readText!(`window.${name}`);
    });
  }

  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.readText();
  }
  return Promise.reject(new Error('no clipboard available'));
}
