/**
 * 与 Android 原生层相册保存桥的轻量封装（同步通道，无 @capacitor 依赖）。
 * AndroidGallery 由 MainActivity 注入，仅安卓壳存在；其他平台静默不可用。
 *
 * 调用 MainActivity 的 GalleryBridge.saveImage：把 data URL 交给原生，
 * 用系统 MediaStore 直接把图片写入相册（Android 10+ 免权限），一步到位，
 * 不弹分享面板——与主流 App 长按保存图片的行为一致。
 */

/** 保存一张图片到系统相册（data URL 形式）。成功 resolve，失败 reject(Error)。 */
export function saveImageToAndroidGallery(dataUrl: string, filename: string): Promise<void> {
  const bridge = (window as unknown as {
    AndroidGallery?: { saveImage?: (dataUrl: string, filename: string, cb: string) => void };
  }).AndroidGallery;

  if (!bridge?.saveImage) {
    return Promise.reject(new Error('当前环境不支持原生相册保存'));
  }
  const doSave = bridge.saveImage.bind(bridge);

  return new Promise<void>((resolve, reject) => {
    const name = `__gallerySave_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const w = window as unknown as Record<string, unknown>;
    const timer = setTimeout(() => {
      delete w[name];
      reject(new Error('保存相册超时'));
    }, 15000);
    const handler = (success: boolean, message: string | null) => {
      clearTimeout(timer);
      delete w[name];
      if (success) resolve();
      else reject(new Error(message || '保存到相册失败'));
    };
    w[name] = handler;
    doSave(dataUrl, filename, `window.${name}`);
  });
}
