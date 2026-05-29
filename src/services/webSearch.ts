const BOCHA_API_URL = 'https://api.bochaai.com/v1/web-search';
const BOCHA_API_KEY = 'sk-054dffdcd2f04a2cb7974ac0a71b41a1';

export interface SearchResult {
  name: string;
  url: string;
  snippet: string;
  siteName: string;
}

interface BochaWebPage {
  name?: string;
  url?: string;
  snippet?: string;
  siteName?: string;
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  try {
    const response = await fetch(BOCHA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BOCHA_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        freshness: 'noLimit',
        summary: true,
        count: 8,
      }),
    });

    if (!response.ok) {
      throw new Error(`Search API error: ${response.status}`);
    }

    const result = await response.json();
    const pages: BochaWebPage[] = result?.data?.webPages?.value || [];
    return pages.map((page) => ({
      name: page.name || '',
      url: page.url || '',
      snippet: page.snippet || '',
      siteName: page.siteName || '',
    }));
  } catch (error) {
    console.error('Web search failed:', error);
    return [];
  }
}

export function formatSearchResultsForContext(results: SearchResult[]): string {
  if (results.length === 0) return '';

  let context =
    '以下是联网搜索的参考资料，请基于这些信息回答用户问题，并在回答中标注引用来源：\n\n';
  results.forEach((result, idx) => {
    context += `[${idx + 1}] ${result.name}\n来源: ${result.siteName} (${result.url})\n摘要: ${result.snippet}\n\n`;
  });
  return context;
}
