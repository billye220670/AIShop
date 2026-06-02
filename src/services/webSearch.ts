import { settingsService } from './settingsService';

const BOCHA_SEARCH_URL = 'https://api.bochaai.com/v1/web-search';

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
    const apiKey = await settingsService.getApiKey('bocha');
    if (!apiKey) {
      console.warn('Bocha API key not configured');
      return [];
    }

    const response = await fetch(BOCHA_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, freshness: 'noLimit', summary: true, count: 10 }),
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
