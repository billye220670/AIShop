import { useState } from 'react';
import type { ArtifactBlock } from '../types';

const ARTIFACT_START = '<<<ARTIFACT_START>>>';
const ARTIFACT_END = '<<<ARTIFACT_END>>>';
const CODE_MARKER = '<<<CODE>>>';

/**
 * 从完整文本中解析 artifact
 */
export function parseArtifactFromContent(content: string): ArtifactBlock | null {
  const startIdx = content.indexOf(ARTIFACT_START);
  const endIdx = content.indexOf(ARTIFACT_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null;
  }

  const block = content.substring(startIdx + ARTIFACT_START.length, endIdx).trim();

  // 提取 title
  const titleMatch = block.match(/^title:\s*"([^"]+)"/m);
  const title = titleMatch ? titleMatch[1] : '未命名网页';

  // 提取 code（<<<CODE>>> 之后的内容）
  const codeIdx = block.indexOf(CODE_MARKER);
  if (codeIdx === -1) {
    return null;
  }

  const code = block.substring(codeIdx + CODE_MARKER.length).trim();
  if (!code) {
    return null;
  }

  return {
    id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'html',
    title,
    code,
    createdAt: Date.now(),
  };
}

/**
 * 返回去除 artifact 标记后的纯文本（用于消息显示）
 */
export function getDisplayContentWithoutArtifact(content: string): string {
  const startIdx = content.indexOf(ARTIFACT_START);
  const endIdx = content.indexOf(ARTIFACT_END);

  if (startIdx === -1 || endIdx === -1) {
    return content;
  }

  const before = content.substring(0, startIdx).trimEnd();
  const after = content.substring(endIdx + ARTIFACT_END.length).trimStart();

  return before + (before && after ? '\n\n' : '') + after;
}

/**
 * 检测流式文本中是否开始了 artifact（但尚未结束）
 */
export function isArtifactStreaming(content: string): boolean {
  const hasStart = content.includes(ARTIFACT_START);
  const hasEnd = content.includes(ARTIFACT_END);
  return hasStart && !hasEnd;
}

/**
 * Hook：管理当前激活的 artifact 状态
 */
export function useArtifact() {
  const [activeArtifact, setActiveArtifact] = useState<ArtifactBlock | null>(null);

  const openArtifact = (artifact: ArtifactBlock) => setActiveArtifact(artifact);
  const closeArtifact = () => setActiveArtifact(null);

  return { activeArtifact, openArtifact, closeArtifact };
}
