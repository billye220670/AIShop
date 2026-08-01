/**
 * 浮点排序键。
 *
 * 追加时 +SEQ_STEP，插入时取相邻两值的中点，于是"在两条消息之间插入"
 * （重新生成、分支）不需要给后面全部重编号。排序永不依赖数组下标。
 */
export const SEQ_STEP = 1000;

export function nextSeq(headSeq: number): number {
  return headSeq + SEQ_STEP;
}

/**
 * 求 before 与 after 之间的插入位。
 *
 * after 为 undefined 表示插到末尾。双精度的中点在约 50 次连续对半后就会
 * 耗尽精度，实际使用远达不到，但相等时退回追加以免产生重复键。
 */
export function seqBetween(before: number, after?: number): number {
  if (after === undefined) return nextSeq(before);
  const mid = (before + after) / 2;
  if (mid <= before || mid >= after) return nextSeq(before);
  return mid;
}
