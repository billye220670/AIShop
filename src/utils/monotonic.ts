/**
 * 严格单调递增的毫秒时钟。
 *
 * Date.now() 在连续调用时可能返回相同值：user 与 assistant 消息在同一毫秒
 * 创建时 timestamp 相等，会让所有按 timestamp 排序的路径失去区分度——
 * 同键时 IndexedDB 索引按主键（id）排序，'-assistant' < '-user' 会排反；
 * 依赖稳定排序的合并也失去纠错能力。本函数保证每次调用至少 +1，
 * 使"先创建的消息 timestamp 恒小于后创建的消息"永远成立。
 */
let last = 0;

export function monotonicNow(): number {
  const now = Date.now();
  last = Math.max(now, last + 1);
  return last;
}
