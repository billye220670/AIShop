import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';

// 设置 PDF.js worker
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

export interface ParsedFile {
  name: string;
  size: number;       // 原始文件大小（字节）
  textContent: string; // 提取的文本（可能已截断）
  truncated: boolean;  // 是否被截断
}

const MAX_TEXT_LENGTH = 8000; // 单文件文本截断阈值（字符数）

/**
 * 截断文本，超过阈值则截取前 MAX_TEXT_LENGTH 字符并附加提示
 */
function truncateText(text: string): { content: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_LENGTH) {
    return { content: text, truncated: false };
  }
  return {
    content: text.slice(0, MAX_TEXT_LENGTH) + '\n\n[...文档已截断，仅展示前 8000 字]',
    truncated: true,
  };
}

/**
 * 获取文件扩展名（小写）
 */
function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

/**
 * 解析纯文本文件（TXT / MD / CSV）
 */
async function parseTextFile(file: File): Promise<string> {
  return await file.text();
}

/**
 * 解析 JSON 文件
 */
async function parseJsonFile(file: File): Promise<string> {
  const raw = await file.text();
  const parsed = JSON.parse(raw);
  return JSON.stringify(parsed, null, 2);
}

/**
 * 解析 PDF 文件
 */
async function parsePdfFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item: any) => 'str' in item)
      .map((item: any) => item.str as string)
      .join('');
    textParts.push(pageText);
  }

  return textParts.join('\n');
}

/**
 * 统一文件解析入口
 */
export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = getFileExtension(file.name);
  let rawText: string;

  try {
    switch (ext) {
      case 'txt':
      case 'md':
      case 'csv':
        rawText = await parseTextFile(file);
        break;
      case 'pdf':
        rawText = await parsePdfFile(file);
        break;
      case 'json':
        rawText = await parseJsonFile(file);
        break;
      default:
        throw new Error(`不支持的文件格式: .${ext}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('不支持的文件格式')) {
      throw error;
    }
    if (ext === 'pdf') {
      throw new Error(`PDF 解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
    throw new Error(`文件解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }

  const { content, truncated } = truncateText(rawText);

  return {
    name: file.name,
    size: file.size,
    textContent: content,
    truncated,
  };
}
