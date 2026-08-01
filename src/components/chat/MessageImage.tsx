/**
 * 消息里的图片。
 *
 * 图片解析逻辑在 common/BlobImage，这里只负责聊天气泡里的占位与失效样式。
 */
import { ImageOff } from 'lucide-react';
import BlobImage from '../common/BlobImage';

interface MessageImageProps {
  src: string;
  alt?: string;
  className?: string;
}

export default function MessageImage({
  src,
  alt = '图片',
  className = 'max-w-full rounded-lg',
}: MessageImageProps) {
  return (
    <BlobImage
      src={src}
      alt={alt}
      className={className}
      placeholder={
        // 从库里取图有一帧延迟，没有占位气泡高度会跳
        <div className="h-32 w-32 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
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
