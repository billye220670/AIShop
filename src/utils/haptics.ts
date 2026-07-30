/**
 * 轻量触感反馈
 *
 * Android / Chrome: 原生 navigator.vibrate。
 * iOS Safari(含添加到主屏的 PWA): navigator.vibrate 不存在。改为利用 Safari 17.4
 *   引入的 <input type="checkbox" switch> —— 该原生开关被点击时会触发 Taptic
 *   Engine。造一个隐藏 switch 配 <label>，程序化点击 label 即可蹭到一次系统触感。
 *
 * 注意事项：
 * - iOS 这条路是在利用实现副作用而非公开 API，Apple 改了实现就会失效，因此全部
 *   包在 try 里，失败静默降级为“没有触感”，绝不影响交互本身。
 * - 必须在用户手势的调用栈内调用，否则 iOS 不会响应。
 * - iOS 只有一种强度，pattern 参数在该平台被忽略。
 */

let iosLabel: HTMLLabelElement | null = null;

/** 惰性创建并复用隐藏的 switch，避免每次点击都动 DOM */
function getIosTrigger(): HTMLLabelElement | null {
  if (iosLabel) return iosLabel;
  try {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    // 不能用 display:none —— 隐藏元素不触发触感，只能移出视口
    label.style.cssText =
      'position:fixed;left:-9999px;top:0;width:0;height:0;opacity:0;pointer-events:none;';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;

    label.appendChild(input);
    document.body.appendChild(label);
    iosLabel = label;
    return label;
  } catch {
    return null;
  }
}

const supportsVibrate = () =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/**
 * 触发一次轻触感。安全无副作用：不支持的平台静默跳过。
 * @param pattern 震动时长(ms)或模式，仅 Android 生效
 */
export function haptic(pattern: number | number[] = 10): void {
  try {
    if (supportsVibrate()) {
      navigator.vibrate(pattern);
      return;
    }
    getIosTrigger()?.click();
  } catch {
    // 触感是锦上添花，任何异常都不该冒泡
  }
}
