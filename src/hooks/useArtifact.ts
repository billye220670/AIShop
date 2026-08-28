import { useCallback, useState } from 'react';
import type { ArtifactBlock } from '../types';

export const ARTIFACT_START = '<<<ARTIFACT_START>>>';
export const ARTIFACT_END = '<<<ARTIFACT_END>>>';
export const CODE_MARKER = '<<<CODE>>>';

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
 * 从不完整的流式内容中提取当前已有的 artifact 代码
 */
export function extractStreamingArtifact(content: string): { title: string; code: string } | null {
  const startIdx = content.indexOf(ARTIFACT_START);
  if (startIdx === -1) return null;

  const afterStart = content.substring(startIdx + ARTIFACT_START.length);

  // 提取 title
  const titleMatch = afterStart.match(/^[\s]*title:\s*"([^"]+)"/m);
  const title = titleMatch ? titleMatch[1] : '生成中...';

  // 提取已有的 code（<<<CODE>>> 之后的内容）
  const codeIdx = afterStart.indexOf(CODE_MARKER);
  if (codeIdx === -1) return { title, code: '' };

  const code = afterStart.substring(codeIdx + CODE_MARKER.length);
  return { title, code };
}

/**
 * 兜底识别：模型没有输出 <<<ARTIFACT_START>>> 标记，而是把完整 HTML 文档
 * 放在 ``` 代码块里返回时（DeepSeek 等指令遵循较弱的模型常见），把该代码块
 * 识别为 artifact，并返回剥离代码块后的剩余文本。
 * 仅识别同时含 <html> 与 </html> 的代码块，避免把普通 HTML 片段示例误判成应用。
 */
export function extractArtifactFromCodeFence(content: string): { artifact: ArtifactBlock; rest: string } | null {
  const fenceRegex = /```[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(content)) !== null) {
    const code = match[1].trim();
    if (!/<html[\s>]/i.test(code) || !/<\/html>/i.test(code)) continue;

    const titleMatch = code.match(/<title[^>]*>\s*([^<]+?)\s*<\/title>/i);
    const artifact: ArtifactBlock = {
      id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'html',
      title: titleMatch ? titleMatch[1] : '未命名网页',
      code,
      createdAt: Date.now(),
    };

    const before = content.substring(0, match.index).trimEnd();
    const after = content.substring(match.index + match[0].length).trimStart();
    const rest = before + (before && after ? '\n\n' : '') + after;
    return { artifact, rest };
  }
  return null;
}

/**
 * Hook：管理当前激活的 artifact 状态
 */
export function useArtifact() {
  const [activeArtifact, setActiveArtifact] = useState<ArtifactBlock | null>(null);
  const [isArtifactGenerating, setIsArtifactGenerating] = useState(false);

  // 全部 useCallback 稳定引用：openArtifact 会作为 prop 传给每条
  // memo 过的 MessageBubble，引用一变所有气泡的 memo 全部击穿
  const openArtifact = useCallback((artifact: ArtifactBlock) => setActiveArtifact(artifact), []);
  const closeArtifact = useCallback(() => {
    setActiveArtifact(null);
    setIsArtifactGenerating(false);
  }, []);

  // 开始流式 artifact（代码还在写入中）
  const startStreamingArtifact = useCallback((artifact: ArtifactBlock) => {
    setActiveArtifact(artifact);
    setIsArtifactGenerating(true);
  }, []);

  // 更新流式中的代码
  const updateStreamingCode = useCallback((code: string) => {
    setActiveArtifact(prev => prev ? { ...prev, code } : null);
  }, []);

  // 完成流式
  const finishStreamingArtifact = useCallback((artifact: ArtifactBlock) => {
    setActiveArtifact(artifact);
    setIsArtifactGenerating(false);
  }, []);

  return {
    activeArtifact,
    isArtifactGenerating,
    openArtifact,
    closeArtifact,
    startStreamingArtifact,
    updateStreamingCode,
    finishStreamingArtifact,
  };
}
