/**
 * 能显示 IndexedDB 里图片的 <img>。
 *
 * 单独成组件是因为 useBlobUrl 是 hook，不能在 .map() 里直接调用。
 * src 传普通 http / data URL 时行为与原生 <img> 一致，所以可以无脑替换。
 */
import { useState } from 'react';
import { useBlobUrl } from '../../hooks/useBlobUrl';

interface BlobImageProps {
  src: string;
  alt?: string;
  className?: string;
  draggable?: boolean;
  loading?: 'lazy' | 'eager';
  /** 加载中显示什么；默认是一块脉冲占位 */
  placeholder?: React.ReactNode;
  /** 图片不可用时显示什么；默认什么都不显示 */
  fallback?: React.ReactNode;
  onLoad?: () => void;
}

export default function BlobImage({
  src,
  alt = '',
  className,
  draggable,
  loading,
  placeholder,
  fallback = null,
  onLoad,
}: BlobImageProps) {
  const resolved = useBlobUrl(src);
  const [failed, setFailed] = useState(false);

  // resolved 为 null 表示 blob 已不在库里（被清理过，或导入了引用不到的数据）
  if (failed || resolved === null) return <>{fallback}</>;

  if (resolved === undefined) {
    return (
      <>
        {placeholder ?? (
          <div className={`animate-pulse bg-black/10 dark:bg-white/10 ${className ?? ''}`} />
        )}
      </>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className={className}
      draggable={draggable}
      loading={loading}
      onLoad={onLoad}
      onError={() => setFailed(true)}
    />
  );
}
