/**
 * 发送前图片压缩。
 *
 * 手机原图动辄 3-10MB，base64 后请求体 4-13MB——在弱网上传慢、易被网关
 * 断开（Load failed），落盘到 IndexedDB 也慢。这里统一降采样到 1280px
 * 最长边 + JPEG 0.82，单图通常 < 500KB，请求体与存储都小一个数量级。
 *
 * 只降不升：小图原样返回；gif/svg 这类压缩会丢帧/无法解码的格式也原样保留。
 * EXIF 方向由浏览器在解码 <img> 时自动转正，canvas 画出来就是正的。
 */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.82;
const MAX_BYTES = 1.5 * 1024 * 1024;

function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function compressImageFile(file: File): Promise<string> {
  // 动图与矢量图压缩会丢帧/无法解码，原样保留
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return readAsDataURL(file);
  }

  try {
    const original = await readAsDataURL(file);
    const img = await loadImage(original);
    const { naturalWidth: w, naturalHeight: h } = img;
    if (!w || !h) return original;

    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    // 尺寸本来就不超限且文件不大：不折腾，直接发原图
    if (scale >= 1 && file.size <= MAX_BYTES) return original;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;

    // 先铺白底再画：JPEG 没有透明通道，透明 PNG 直接画会得到黑底
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let blob = await canvasToBlob(canvas, JPEG_QUALITY);
    // 质量兜底：压缩后仍超上限就降质量再压一次
    if (blob && blob.size > MAX_BYTES) {
      const retry = await canvasToBlob(canvas, 0.6);
      if (retry && retry.size < blob.size) blob = retry;
    }
    if (!blob) return original;
    return await readAsDataURL(blob);
  } catch {
    // 解码/压缩失败：回退原图，不阻塞用户发送
    return readAsDataURL(file);
  }
}
