/** 旧版结构化摘要（对象）的形状，改版前存下的数据可能还是这个样子 */
interface LegacyStructuredSummary {
  goal?: string;
  decisions?: string[];
  facts?: string[];
  preferences?: string[];
  todos?: string[];
  rejected?: string[];
}

/**
 * 把摘要归一化为纯文本。
 * 除了兼容 localStorage 里的旧数据，也兜底内存里可能残留的旧结构（例如
 * 开发环境热更新保留的旧 state），所以在每个读取 summary 的地方都应该过一遍。
 */
export function migrateSummary(summary: unknown): string {
  if (typeof summary === 'string') return summary;
  if (!summary || typeof summary !== 'object') return '';

  const s = summary as LegacyStructuredSummary;
  const blocks: string[] = [];
  if (s.goal?.trim()) blocks.push(`会话目标：${s.goal.trim()}`);
  const renderList = (label: string, items?: string[]) => {
    const cleaned = (items || []).filter(x => x && x.trim());
    if (cleaned.length) blocks.push(`${label}：\n${cleaned.map(x => `- ${x}`).join('\n')}`);
  };
  renderList('已确定结论', s.decisions);
  renderList('事实与约束', s.facts);
  renderList('用户偏好', s.preferences);
  renderList('待办与未决', s.todos);
  renderList('已否决的方案', s.rejected);
  return blocks.join('\n\n');
}
