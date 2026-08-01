/**
 * 消息里的图片。
 *
 * 单独成组件是因为 useBlobUrl 是 hook，不能在 content.map() 里直接调用。
 * 顺带处理了加载态：图片从 IndexedDB 取出来有一帧延迟，没有占位的话
 * 气泡高度会跳一下。
 */
import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { useBlobUrl } from '../../hooks/useBlobUrl';
import { isBlobRefUrl } from '../../db';

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
  const resolved = useBlobUrl(src);
  const [failed, setFailed] = useState(false);
  const isBlobRef = isBlobRefUrl(src);

  // blob 引用解析不出来说明图片已不在库里（被清理过，或导入的会话
  // 引用了本机没有的 blob）。这种情况没法重试，直接给个明确提示。
  const missing = failed || (isBlobRef && resolved === null);
  if (missing) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs text-black/40 dark:bg-white/5 dark:text-white/40">
        <ImageOff size={14} />
        图片已不可用
      </div>
    );
  }

  if (!resolved) {
    // 占位：从库里取图有一帧延迟，没有占位气泡高度会跳
    return (
      <div className="h-32 w-32 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
    );
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
