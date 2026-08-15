/**
 * 聊天气泡图片的显示尺寸规则（微信式：横图最宽 240px、竖图最高 360px，小图原样不放大）。
 *
 * 与 MessageImage 的最终渲染共用同一规则：聊天内生图请求时已知宽高比，
 * 骨架占位、加载占位与最终渲染同尺寸，图片回传后不跳变。
 */

/** 气泡图片显示上限 */
export const BUBBLE_IMAGE_MAX_WIDTH = 240;
export const BUBBLE_IMAGE_MAX_HEIGHT = 360;

/** 用户发送图片显示上限（比 AI 内容图更小，微信式缩略图观感，比例同气泡图 2:3） */
export const USER_IMAGE_MAX_WIDTH = 160;
export const USER_IMAGE_MAX_HEIGHT = 240;

/** 按请求宽高比算出最终渲染尺寸（宽 ≤240、高 ≤360 钳制），骨架占位与加载占位共用同一规则 */
export function imageDisplaySizeFromRatio(aspectRatio?: string): { width: number; height: number } {
  const [w, h] = (aspectRatio || '1:1').split(':').map(Number);
  if (!w || !h) return { width: BUBBLE_IMAGE_MAX_WIDTH, height: BUBBLE_IMAGE_MAX_WIDTH };
  const height = Math.min((BUBBLE_IMAGE_MAX_WIDTH * h) / w, BUBBLE_IMAGE_MAX_HEIGHT);
  const width = (height * w) / h;
  return { width: Math.round(width), height: Math.round(height) };
}
