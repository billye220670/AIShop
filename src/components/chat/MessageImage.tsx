/**
 * 消息里的图片。
 *
 * 图片解析逻辑在 common/BlobImage，这里只负责消息里的占位与失效样式。
 * 显示尺寸参考微信用户发图：默认横图最宽 240px、竖图最高 360px，小图原样不放大；
 * 用户上传的图片通过 maxWidth/maxHeight 传更小的上限（160×240，缩略图观感）。
 * 加载完成前按 4:3 预估占位，拿到自然尺寸后再按比例落到真实大小。
 * 聊天内生图的图片：请求时已知宽高比（initialSize），占位与最终渲染同尺寸，图片回传不跳变。
 * 点击图片打开全屏查看器（ImageViewer），长按（触发气泡上下文菜单）不响应点击。
 */
import { useMemo, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import BlobImage from '../common/BlobImage';
import ImageViewer from '../common/ImageViewer';
import { BUBBLE_IMAGE_MAX_WIDTH, BUBBLE_IMAGE_MAX_HEIGHT } from '../../utils/imageDisplaySize';

interface MessageImageProps {
  src: string;
  alt?: string;
  /** 已知请求比例时按显示规则预计算的占位尺寸：加载占位与最终渲染一致，避免图片回传时跳变 */
  initialSize?: { width: number; height: number };
  /** 显示尺寸上限：默认聊天气泡图上限；用户上传的图片传更小的上限（微信式缩略图） */
  maxWidth?: number;
  maxHeight?: number;
}

/** 长按超过该时长判定为触发上下文菜单，其后的 click 不再打开查看器（与 MessageBubble 的 LONG_PRESS_MS 对齐） */
const LONG_PRESS_MS = 450;

export default function MessageImage({ src, alt = '图片', initialSize, maxWidth = BUBBLE_IMAGE_MAX_WIDTH, maxHeight = BUBBLE_IMAGE_MAX_HEIGHT }: MessageImageProps) {
  // 尺寸和 src 绑定：src 变化（hydrate 时 dataURL → aishop-blob:<id>）时
  // 旧尺寸自动作废回占位，无需 effect 手动重置
  const [loaded, setLoaded] = useState<{ src: string; w: number; h: number } | null>(null);
  const current = loaded && loaded.src === src ? loaded : null;
  const [viewerOpen, setViewerOpen] = useState(false);
  // 按压开始时间：长按后的 click 不应打开查看器（长按菜单会同时出现）
  const pressStartRef = useRef(0);

  const style = useMemo(() => {
    if (current) {
      const scale = Math.min(1, maxWidth / current.w, maxHeight / current.h);
      return { width: Math.round(current.w * scale), height: Math.round(current.h * scale) };
    }
    // 加载完成前也固定占位尺寸：BlobImage 解析完 src 会立刻挂上 <img>，
    // 若不带固定尺寸，onLoad 之前的这一帧会按原图大小渲染（闪大一下）再缩回
    return initialSize ? { width: initialSize.width, height: initialSize.height } : undefined;
  }, [current, initialSize, maxWidth, maxHeight]);

  return (
    <>
      <BlobImage
        src={src}
        alt={alt}
        className="max-w-full rounded-lg cursor-pointer"
        style={style}
        onPointerDown={() => {
          pressStartRef.current = Date.now();
        }}
        onClick={() => {
          if (Date.now() - pressStartRef.current > LONG_PRESS_MS) return;
          setViewerOpen(true);
        }}
        onLoad={e => {
          const el = e.currentTarget;
          if (el.naturalWidth > 0) {
            setLoaded({ src, w: el.naturalWidth, h: el.naturalHeight });
          }
        }}
        placeholder={
          // 聊天内生图用已知比例占位（与最终渲染同尺寸，无跳变）；普通消息从库里取图有一帧延迟，
          // 按 4:3 预估避免气泡高度跳得太凶
          <div
            className={`animate-pulse rounded-lg bg-black/5 dark:bg-white/5 ${initialSize ? '' : 'h-44 w-60'}`}
            style={initialSize ? { width: initialSize.width, height: initialSize.height } : undefined}
          />
        }
        fallback={
          <div className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs text-black/40 dark:bg-white/5 dark:text-white/40">
            <ImageOff size={14} />
            图片已不可用
          </div>
        }
      />
      {viewerOpen && <ImageViewer src={src} alt={alt} onClose={() => setViewerOpen(false)} />}
    </>
  );
}
