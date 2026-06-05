import { settingsService } from './settingsService';

const BOCHA_SEARCH_URL = 'https://api.bochaai.com/v1/web-search';
const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

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

/**
 * 统一搜索入口：根据设置面板选择的搜索提供商路由到对应引擎
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  try {
    const provider = await settingsService.getProvider('search') || 'bocha';
    console.log(`🔍 当前搜索提供商: ${provider}`);

    if (provider === 'tavily') {
      return await searchWithTavily(query);
    }
    return await searchWithBocha(query);
  } catch (error) {
    console.error('Web search failed:', error);
    return [];
  }
}

/**
 * 博查 AI 搜索
 */
async function searchWithBocha(query: string): Promise<SearchResult[]> {
  const apiKey = await settingsService.getApiKey('bocha');
  if (!apiKey) {
    console.warn('⚠️ Bocha API key not configured');
    console.log('🔍 调试信息:');
    console.log('  - isElectron:', typeof window !== 'undefined' && !!window.electronAPI);
    console.log('  - window.electronAPI:', window?.electronAPI?.settings);
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('aishop_settings');
        console.log('  - localStorage aishop_settings:', raw);
      } catch (e) {
        console.log('  - localStorage 不可用:', e);
      }
    }
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
    throw new Error(`Bocha Search API error: ${response.status}`);
  }

  const result = await response.json();
  const pages: BochaWebPage[] = result?.data?.webPages?.value || [];
  return pages.map((page) => ({
    name: page.name || '',
    url: page.url || '',
    snippet: page.snippet || '',
    siteName: page.siteName || '',
  }));
}

/**
 * Tavily 搜索
 */
async function searchWithTavily(query: string): Promise<SearchResult[]> {
  const apiKey = await settingsService.getApiKey('tavily');
  if (!apiKey) {
    console.warn('⚠️ Tavily API key not configured');
    return [];
  }

  const response = await fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'advanced',
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily Search API error: ${response.status}`);
  }

  const data = await response.json();
  const results: { title?: string; url?: string; content?: string }[] = data?.results || [];
  return results.map((item) => ({
    name: item.title || '',
    url: item.url || '',
    snippet: item.content || '',
    siteName: item.url ? new URL(item.url).hostname : '',
  }));
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
