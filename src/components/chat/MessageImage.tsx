/**
 * 消息里的图片。
 *
 * 图片解析逻辑在 common/BlobImage，这里只负责聊天气泡里的占位与失效样式。
 * 显示尺寸参考微信用户发图：横图最宽 240px、竖图最高 360px，小图原样不放大；
 * 加载完成前按 4:3 预估占位，拿到自然尺寸后再按比例落到真实大小。
 */
import { useMemo, useState } from 'react';
import { ImageOff } from 'lucide-react';
import BlobImage from '../common/BlobImage';

interface MessageImageProps {
  src: string;
  alt?: string;
}

/** 微信式气泡图片上限：横图看宽、竖图看高 */
const MAX_WIDTH = 240;
const MAX_HEIGHT = 360;

export default function MessageImage({ src, alt = '图片' }: MessageImageProps) {
  // 尺寸和 src 绑定：src 变化（hydrate 时 dataURL → aishop-blob:<id>）时
  // 旧尺寸自动作废回占位，无需 effect 手动重置
  const [loaded, setLoaded] = useState<{ src: string; w: number; h: number } | null>(null);
  const current = loaded && loaded.src === src ? loaded : null;

  const style = useMemo(() => {
    if (!current) return undefined;
    const scale = Math.min(1, MAX_WIDTH / current.w, MAX_HEIGHT / current.h);
    return { width: Math.round(current.w * scale), height: Math.round(current.h * scale) };
  }, [current]);

  return (
    <BlobImage
      src={src}
      alt={alt}
      className="max-w-full rounded-lg"
      style={style}
      onLoad={e => {
        const el = e.currentTarget;
        if (el.naturalWidth > 0) {
          setLoaded({ src, w: el.naturalWidth, h: el.naturalHeight });
        }
      }}
      placeholder={
        // 从库里取图有一帧延迟，占位按 4:3 预估避免气泡高度跳得太凶
        <div className="h-44 w-60 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
      }
      fallback={
        <div className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs text-black/40 dark:bg-white/5 dark:text-white/40">
          <ImageOff size={14} />
          图片已不可用
        </div>
      }
    />
  );
}
