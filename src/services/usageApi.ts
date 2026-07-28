import { settingsService } from './settingsService';
import { getProviderConfig } from '../config/providers';
import type { UsageCycleType, BillResponse, BillItem } from '../types';

/**
 * 从 chatBaseUrl 提取根域名
 * 例如 https://api.highwayapi.ai/openai/v1 -> https://api.highwayapi.ai
 */
function extractRootUrl(chatBaseUrl: string): string {
  try {
    const url = new URL(chatBaseUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return chatBaseUrl;
  }
}

/**
 * 查询用量账单
 */
export async function fetchUsageBills(
  cycleType: UsageCycleType,
  startTime?: number,
  endTime?: number,
): Promise<BillItem[]> {
  const provider = await settingsService.getProvider('llm');
  const apiKey = await settingsService.getApiKey(provider);
  const config = getProviderConfig(provider);

  if (!apiKey) {
    throw new Error('请先在设置中配置 API Key');
  }

  const baseUrl = extractRootUrl(config.chatBaseUrl);

  const params = new URLSearchParams({
    cycleType,
    productCategory: 'llm',
  });

  if (startTime !== undefined) {
    params.set('startTime', String(startTime));
  }
  if (endTime !== undefined) {
    params.set('endTime', String(endTime));
  }

  const url = `${baseUrl}/openapi/v1/billing/bill/list?${params.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`账单查询失败 (${response.status}): ${errorText}`);
    }

    const data: BillResponse = await response.json();
    return data.bills ?? [];
  } finally {
    clearTimeout(timeoutId);
  }
}
